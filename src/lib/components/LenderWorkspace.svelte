<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import type { ImportResult, Pilot, PilotDetail } from '$lib/server/lendtrial';

	const api = `${base}/api/pilots`;
	const count = new Intl.NumberFormat('en-NG');
	const currency = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });
	const percentage = new Intl.NumberFormat('en-NG', { style: 'percent', maximumFractionDigits: 2 });
	const money = (kobo: number) => currency.format(kobo / 100);
	const rate = (value: number | null) => (value === null ? '—' : percentage.format(value));
	const points = (value: number | null) =>
		value === null ? '—' : `${value > 0 ? '+' : ''}${(value * 100).toFixed(2)} pp`;
	const today = () => new Date().toISOString().slice(0, 10);
	const dateTime = (value: string) =>
		new Intl.DateTimeFormat('en-NG', {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone: 'UTC'
		}).format(new Date(value));
	const applicationHeaders =
		'application_id,borrower_id,requested_amount_kobo,reference_risk,successful_loans,application_date,model_type,model_version';
	const outcomeHeaders =
		'application_id,funded_amount_kobo,funded_on,first_due_date,first_installment_kobo,paid_by_grace_kobo,observed_on';
	const statusLabels = { draft: 'Draft', active: 'Active', paused: 'Paused' };
	const decisionLabels = { hold: 'Hold', continue: 'Continue', pause: 'Pause recommended' };

	let busy = $state(true);
	let notice = $state('');
	let problem = $state('');
	let creating = $state(false);
	let selected = $state('');
	let pilots = $state<Pilot[]>([]);
	let detail = $state<PilotDetail | null>(null);
	let asOf = $state(today());
	let activeTab = $state<'replay' | 'monitor' | 'audit'>('replay');
	let displayRows = $state(12);
	let changedOnly = $state(false);
	let name = $state('');
	let modelType = $state('lightgbm');
	let modelVersion = $state('');
	let currentCap = $state<number | undefined>(50_000);
	let candidateCap = $state<number | undefined>(75_000);
	let maxRisk = $state<number | undefined>();
	let candidateShare = $state<number | undefined>(20);
	let graceDays = $state<number | undefined>(7);
	let minMaturedPerArm = $state<number | undefined>();
	let pauseMargin = $state<number | undefined>();
	let reason = $state('');
	let applicationFile = $state<FileList>();
	let outcomeFile = $state<FileList>();
	const displayedApplications = $derived(
		(detail?.applications ?? []).filter((row) => !changedOnly || row.delta !== 0)
	);
	const formatOffer = (amount: number | null) => (amount === null ? '—' : money(amount));

	onMount(() => {
		void work(async () => {
			await refreshPilots();
			if (pilots.length) await selectPilot(pilots[0].id);
			else creating = true;
		});
	});

	async function request<T>(url: string, init?: RequestInit): Promise<T> {
		const response = await fetch(url, init);
		if (response.status === 401 || (response.redirected && response.url.includes('/login'))) {
			window.location.assign(`${base}/session/login/`);
			throw new Error('Sign in again to continue.');
		}
		const isJson = response.headers.get('content-type')?.includes('application/json');
		const payload = isJson ? await response.json() : null;
		if (!response.ok) throw new Error(payload?.error ?? `Request failed (${response.status}).`);
		if (!isJson) throw new Error('The workspace service returned an unexpected response.');
		return payload as T;
	}

	async function work(action: () => Promise<void>) {
		busy = true;
		notice = '';
		problem = '';
		try {
			await action();
		} catch (error) {
			problem = error instanceof Error ? error.message : 'The request could not be completed.';
		} finally {
			busy = false;
		}
	}

	function endpoint(id: string, suffix = '') {
		return `${api}/${encodeURIComponent(id)}${suffix}`;
	}

	async function refreshPilots() {
		const result = await request<{ pilots: Pilot[] }>(api);
		pilots = result.pilots;
	}

	async function refreshDetail(id: string, date = asOf) {
		detail = await request<PilotDetail>(`${endpoint(id)}?asOf=${encodeURIComponent(date)}`);
	}

	async function selectPilot(id: string) {
		const date = today();
		await refreshDetail(id, date);
		selected = id;
		asOf = date;
		creating = false;
		activeTab = 'replay';
		displayRows = 12;
		changedOnly = false;
		reason = '';
		applicationFile = undefined;
		outcomeFile = undefined;
	}

	function jsonPost(payload: unknown): RequestInit {
		return {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		};
	}

	function createPilot(event: SubmitEvent) {
		event.preventDefault();
		void work(async () => {
			if (
				currentCap === undefined ||
				candidateCap === undefined ||
				maxRisk === undefined ||
				candidateShare === undefined ||
				graceDays === undefined ||
				minMaturedPerArm === undefined ||
				pauseMargin === undefined
			)
				throw new Error('Fill in all policy and monitoring settings.');
			const result = await request<{ pilotId: string }>(
				api,
				jsonPost({
					name: name.trim(),
					modelType: modelType.trim(),
					modelVersion: modelVersion.trim(),
					currentCap: Math.round(currentCap * 100),
					candidateCap: Math.round(candidateCap * 100),
					maxRisk: maxRisk / 100,
					candidateShare: candidateShare / 100,
					graceDays,
					minMaturedPerArm,
					pauseMargin: pauseMargin / 100
				})
			);
			await refreshPilots();
			await selectPilot(result.pilotId);
			name = '';
			notice = 'Draft pilot created.';
		});
	}

	function importCsv(event: SubmitEvent, kind: 'applications' | 'outcomes') {
		event.preventDefault();
		const file = (kind === 'applications' ? applicationFile : outcomeFile)?.[0];
		const form = event.currentTarget as HTMLFormElement;
		void work(async () => {
			if (!file) throw new Error('Choose a CSV file first.');
			const result = await request<ImportResult>(endpoint(selected, `/${kind}`), {
				method: 'POST',
				headers: { 'content-type': 'text/csv' },
				body: file
			});
			if (kind === 'applications') applicationFile = undefined;
			else outcomeFile = undefined;
			form.reset();
			await refreshDetail(selected);
			notice = `${count.format(result.inserted)} added, ${count.format(result.updated)} updated, ${count.format(result.unchanged)} unchanged.`;
		});
	}

	function startPilot(event: SubmitEvent) {
		event.preventDefault();
		void work(async () => {
			await request(endpoint(selected, '/start'), { method: 'POST' });
			await refreshPilots();
			await refreshDetail(selected);
			activeTab = 'monitor';
			notice = 'Pilot activated. Import new applications to assign offers.';
		});
	}

	function changePause(event: SubmitEvent, paused: boolean) {
		event.preventDefault();
		void work(async () => {
			await request(endpoint(selected, '/pause'), jsonPost({ paused, reason: reason.trim() }));
			reason = '';
			await refreshPilots();
			await refreshDetail(selected);
			notice = paused
				? 'Pilot paused. New eligible offers will use the current cap outside the pilot.'
				: 'Pilot resumed.';
		});
	}

	function saveTemplate(name: string, headers: string) {
		const url = URL.createObjectURL(
			new Blob([`${headers}\r\n`], { type: 'text/csv;charset=utf-8' })
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = name;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1_000);
	}
</script>

<header class="topbar">
	<div class="bar-content">
		<a href={`${base}/workspace/`} class="brand"><span aria-hidden="true">LT</span> LendTrial</a>
		<form method="POST" action={`${base}/session/logout/`}>
			<button type="submit" class="secondary">Sign out</button>
		</form>
	</div>
</header>

<main>
	<div class="title-row">
		<div>
			<h1>Loan policy pilots</h1>
			<p>Replay an offer change and track repayments from your loan records.</p>
		</div>
		<button
			type="button"
			class="primary"
			onclick={() => {
				creating = true;
			}}
			disabled={busy}>New pilot</button
		>
	</div>

	{#if pilots.length}
		<div class="select-row">
			<label for="workspace-pilot">Pilot</label>
			<select
				id="workspace-pilot"
				value={selected}
				disabled={busy}
				onchange={(event) => {
					const id = event.currentTarget.value;
					if (id) void work(() => selectPilot(id));
				}}
			>
				<option value="" disabled>Choose a pilot</option>
				{#each pilots as pilot (pilot.id)}<option value={pilot.id}>{pilot.name}</option>{/each}
			</select>
		</div>
	{/if}

	<div aria-live="polite" aria-atomic="true">
		{#if problem}<p class="message error">{problem}</p>
		{:else if notice}<p class="message success">{notice}</p>
		{:else if busy}<p class="busy">Working…</p>{/if}
	</div>

	{#if creating}
		<section class="panel" aria-labelledby="create-heading">
			<div class="section-head">
				<div>
					<h2 id="create-heading">Create a pilot</h2>
					<p>
						Agree on the score cutoff, minimum sample and pause margin before saving. Pilot settings
						are fixed once saved.
					</p>
				</div>
				{#if detail}<button
						type="button"
						class="secondary"
						disabled={busy}
						onclick={() => (creating = false)}>Cancel</button
					>{/if}
			</div>
			<form onsubmit={createPilot}>
				<fieldset disabled={busy} class="settings-grid">
					<label class="wide"
						>Pilot name<input
							bind:value={name}
							placeholder="Repeat-loan cap"
							maxlength="120"
							required
						/></label
					>
					<label>Score model<input bind:value={modelType} maxlength="80" required /></label>
					<label
						>Score model version<input
							bind:value={modelVersion}
							maxlength="80"
							placeholder="e.g. credit-model-v3"
							required
						/></label
					>
					<label
						>Current cap (₦)<input
							type="number"
							bind:value={currentCap}
							min="0.01"
							step="0.01"
							required
						/></label
					>
					<label
						>Candidate cap (₦)<input
							type="number"
							bind:value={candidateCap}
							min="0.01"
							step="0.01"
							required
						/></label
					>
					<label
						>Maximum reference risk (%)<input
							type="number"
							bind:value={maxRisk}
							min="0"
							max="100"
							step="0.01"
							required
						/></label
					>
					<label
						>Candidate allocation (%)<input
							type="number"
							bind:value={candidateShare}
							min="1"
							max="99"
							step="1"
							required
						/></label
					>
					<label
						>Payment grace period (days)<input
							type="number"
							bind:value={graceDays}
							min="0"
							max="90"
							step="1"
							required
						/></label
					>
					<label
						>Minimum evaluable loans per group<input
							type="number"
							bind:value={minMaturedPerArm}
							min="1"
							max="5000"
							step="1"
							required
						/></label
					>
					<label
						>Pause margin (percentage points)<input
							type="number"
							bind:value={pauseMargin}
							min="0"
							max="100"
							step="0.01"
							required
						/></label
					>
				</fieldset>
				<button type="submit" class="primary create-submit" disabled={busy}>Create draft</button>
			</form>
		</section>
	{:else if detail}
		{@const pilot = detail.pilot}
		{@const replay = detail.replay}
		{@const monitor = detail.monitor}
		<section class="pilot-summary" aria-labelledby="pilot-heading">
			<div class="section-head">
				<div>
					<h2 id="pilot-heading">{pilot.name}</h2>
					<p>
						{pilot.modelType} / {pilot.modelVersion} <span aria-hidden="true">·</span> Policy {pilot.policyVersion}
					</p>
				</div>
				<span
					class:active={pilot.status === 'active'}
					class:paused={pilot.status === 'paused'}
					class="pill">{statusLabels[pilot.status]}</span
				>
			</div>
			<dl class="cap-grid">
				<div>
					<dt>Current cap</dt>
					<dd>{money(pilot.currentCap)}</dd>
				</div>
				<div>
					<dt>Candidate cap</dt>
					<dd>{money(pilot.candidateCap)}</dd>
				</div>
				<div>
					<dt>Candidate allocation</dt>
					<dd>{percentage.format(pilot.candidateShare)}</dd>
				</div>
			</dl>
			<p class="fine-print as-of">
				Reference risk cutoff {percentage.format(pilot.maxRisk)} · {pilot.graceDays} grace days ·
				{count.format(pilot.minMaturedPerArm)} evaluable loans per group · Pause margin {points(
					pilot.pauseMargin
				)}
			</p>
		</section>

		<div class="views" role="group" aria-label="Pilot view">
			<button
				type="button"
				class:chosen={activeTab === 'replay'}
				aria-pressed={activeTab === 'replay'}
				onclick={() => (activeTab = 'replay')}>Replay and assignments</button
			>
			<button
				type="button"
				class:chosen={activeTab === 'monitor'}
				aria-pressed={activeTab === 'monitor'}
				onclick={() => (activeTab = 'monitor')}>Repayment monitor</button
			>
			<button
				type="button"
				class:chosen={activeTab === 'audit'}
				aria-pressed={activeTab === 'audit'}
				onclick={() => (activeTab = 'audit')}>Audit log</button
			>
		</div>

		{#if activeTab === 'replay'}
			<section class="panel" aria-labelledby="replay-heading">
				<div class="section-head">
					<div>
						<h2 id="replay-heading">Replay and assignments</h2>
						<p>Compare offers using the same applications and reference scores.</p>
					</div>
					{#if replay.applications}<a
							class="secondary"
							href={endpoint(selected, '/assignments.csv')}>Download decisions</a
						>{/if}
				</div>
				<dl class="metrics">
					<div>
						<dt>Applications</dt>
						<dd>{count.format(replay.applications)}</dd>
					</div>
					<div>
						<dt>Eligible applications</dt>
						<dd>{count.format(replay.eligible)}</dd>
					</div>
					<div>
						<dt>Offers changed</dt>
						<dd>{count.format(replay.changed)}</dd>
					</div>
					<div>
						<dt>Difference in principal offered</dt>
						<dd>{money(replay.additionalPrincipal)}</dd>
					</div>
				</dl>
				<form onsubmit={(event) => importCsv(event, 'applications')} class="import-box">
					<h3>Import applications</h3>
					<p>
						{pilot.status === 'draft'
							? 'Draft imports are used for replay. Activate the pilot before importing new applications for assignment.'
							: 'New eligible applications with different offers are assigned once per borrower. Use the assignment CSV in your loan system.'}
					</p>
					<div class="inline-controls">
						<label
							>Application CSV<input
								type="file"
								accept=".csv,text/csv"
								bind:files={applicationFile}
								disabled={busy}
								required
							/></label
						>
						<button type="submit" class="primary" disabled={busy}>Import applications</button>
						<button
							type="button"
							class="secondary"
							onclick={() =>
								saveTemplate('lendtrial-applications-template.csv', applicationHeaders)}
							>CSV template</button
						>
					</div>
					<p class="fine-print">
						Use pseudonymous IDs, integer kobo, dates in YYYY-MM-DD and reference risk as a
						fraction. Match the pilot’s model name and version.
					</p>
				</form>
				{#if pilot.status === 'draft'}
					<form onsubmit={startPilot} class="action-row">
						<p>Activation applies to new applications. Draft records stay in the replay.</p>
						<button type="submit" class="secondary" disabled={busy}>Activate pilot</button>
					</form>
				{/if}
				{#if replay.applications}
					<div class="table-head">
						<h3>Application decisions</h3>
						<label class="check-label"
							><input
								type="checkbox"
								bind:checked={changedOnly}
								onchange={() => (displayRows = 12)}
							/> Changed offers only</label
						>
					</div>
					{#if displayedApplications.length}
						<!-- svelte-ignore a11y_no_noninteractive_tabindex (Allow keyboard scrolling in the overflow table.) -->
						<div
							class="table-scroll"
							tabindex="0"
							role="region"
							aria-label="Application decisions table"
						>
							<table>
								<thead
									><tr
										><th scope="col">Application</th><th scope="col">Requested</th><th scope="col"
											>Current</th
										><th scope="col">Candidate</th><th scope="col">Assignment</th><th scope="col"
											>Reason</th
										></tr
									></thead
								>
								<tbody
									>{#each displayedApplications.slice(0, displayRows) as row (row.id)}
										<tr
											><th scope="row">{row.id}</th><td>{money(row.requestedAmount)}</td><td
												>{formatOffer(row.currentOffer)}</td
											><td>{formatOffer(row.candidateOffer)}</td><td
												>{row.arm === 'routed'
													? 'Current after pause'
													: (row.arm ?? '—')}{row.assignedOffer === null
													? ''
													: ` · ${money(row.assignedOffer)}`}</td
											><td>{row.reason}</td></tr
										>
									{/each}</tbody
								>
							</table>
						</div>
						{#if displayedApplications.length > displayRows}<button
								type="button"
								class="secondary more"
								onclick={() => (displayRows += 12)}>Show more applications</button
							>{/if}
					{:else}<p class="empty">No applications match this filter.</p>{/if}
				{/if}
			</section>
		{:else if activeTab === 'monitor'}
			<section class="panel" aria-labelledby="monitor-heading">
				<div class="section-head">
					<div>
						<h2 id="monitor-heading">Repayment monitor</h2>
						<p>Based on observed funding and first-payment records.</p>
					</div>
					<form
						class="inline-controls"
						onsubmit={(event) => {
							event.preventDefault();
							void work(() => refreshDetail(selected));
						}}
					>
						<label
							>As of<input
								type="date"
								bind:value={asOf}
								max={today()}
								required
								disabled={busy}
							/></label
						>
						<button type="submit" class="secondary" disabled={busy}>Refresh</button>
					</form>
				</div>
				<div class:alert={monitor.decision === 'pause'} class="decision">
					<div>
						<h3>{decisionLabels[monitor.decision]}</h3>
						<p>{monitor.reason}</p>
					</div>
					<dl>
						<dt>Miss rate gap</dt>
						<dd>{points(monitor.missRateDelta)}</dd>
					</dl>
				</div>
				<p class="fine-print as-of">
					Observed through {monitor.asOf}. A miss counts when the first installment is short after {pilot.graceDays}
					grace days. Pending and missing outcomes are excluded from the rate.
				</p>
				<div class="arm-grid">
					{#each [{ title: 'Control', metrics: monitor.control }, { title: 'Candidate', metrics: monitor.candidate }] as arm (arm.title)}
						<div class="arm">
							<h3>{arm.title}</h3>
							<div class="arm-rate">{rate(arm.metrics.missRate)}</div>
							<p>Missed first payment</p>
							<dl>
								<div>
									<dt>Misses / evaluable</dt>
									<dd>{count.format(arm.metrics.misses)} / {count.format(arm.metrics.matured)}</dd>
								</div>
								<div>
									<dt>Pending grace window</dt>
									<dd>{count.format(arm.metrics.pending)}</dd>
								</div>
								<div>
									<dt>Missing final payment total</dt>
									<dd>{count.format(arm.metrics.missingOutcome)}</dd>
								</div>
								<div>
									<dt>Assigned borrowers</dt>
									<dd>{count.format(arm.metrics.assigned)}</dd>
								</div>
								<div>
									<dt>Funded loans</dt>
									<dd>{count.format(arm.metrics.funded)}</dd>
								</div>
								<div>
									<dt>Confirmed unfunded</dt>
									<dd>{count.format(arm.metrics.unfunded)}</dd>
								</div>
								<div>
									<dt>Awaiting funding record</dt>
									<dd>{count.format(arm.metrics.awaitingFunding)}</dd>
								</div>
								<div>
									<dt>Funding unconfirmed after 7 days</dt>
									<dd>{count.format(arm.metrics.fundingUnconfirmed)}</dd>
								</div>
								<div>
									<dt>Funded principal</dt>
									<dd>{money(arm.metrics.fundedPrincipal)}</dd>
								</div>
							</dl>
						</div>
					{/each}
				</div>
				{#if monitor.routedToCurrent}<p class="fine-print as-of">
						{count.format(monitor.routedToCurrent)} new borrowers used the current cap outside the pilot
						while paused. {count.format(monitor.redirected)} would otherwise have entered the candidate
						group.
					</p>{/if}
				{#if pilot.status !== 'draft'}
					<form onsubmit={(event) => importCsv(event, 'outcomes')} class="import-box">
						<h3>Import funding and repayment records</h3>
						<p>
							Use loan records that match assigned application IDs. Record how much of the first
							installment was paid by its grace deadline.
						</p>
						<div class="inline-controls">
							<label
								>Funding and repayment CSV<input
									type="file"
									accept=".csv,text/csv"
									bind:files={outcomeFile}
									disabled={busy}
									required
								/></label
							>
							<button type="submit" class="primary" disabled={busy}>Import repayments</button>
							<button
								type="button"
								class="secondary"
								onclick={() => saveTemplate('lendtrial-repayments-template.csv', outcomeHeaders)}
								>CSV template</button
							>
						</div>
						<p class="fine-print">
							Use zero funded amount and leave the funding date, schedule and payment fields blank
							for a confirmed unfunded application. For funded loans, leave the amount paid blank
							until known. Use zero paid for verified nonpayment.
						</p>
					</form>
					<form
						onsubmit={(event) => changePause(event, pilot.status !== 'paused')}
						class="action-row"
					>
						<label
							>Reason for {pilot.status === 'paused' ? 'resuming' : 'pausing'}<input
								bind:value={reason}
								maxlength="400"
								required
								disabled={busy}
							/></label
						>
						<button
							type="submit"
							class:danger={pilot.status !== 'paused'}
							class="secondary"
							disabled={busy || !reason.trim()}
							>{pilot.status === 'paused' ? 'Resume pilot' : 'Pause pilot'}</button
						>
					</form>
				{/if}
			</section>
		{:else}
			<section class="panel" aria-labelledby="audit-heading">
				<div class="section-head">
					<div>
						<h2 id="audit-heading">Audit log</h2>
						<p>Up to 100 recent policy and import events. Times are UTC.</p>
					</div>
				</div>
				{#if detail.audit.length}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex (Allow keyboard scrolling in the overflow table.) -->
					<div class="table-scroll" tabindex="0" role="region" aria-label="Audit log table">
						<table>
							<thead
								><tr
									><th scope="col">Time</th><th scope="col">Event</th><th scope="col">Details</th
									></tr
								></thead
							>
							<tbody
								>{#each detail.audit as row (row.id)}<tr
										><td>{dateTime(row.at)}</td><th scope="row"
											>{row.action.replaceAll('_', ' ')}</th
										><td>{row.detail}</td></tr
									>{/each}</tbody
							>
						</table>
					</div>
				{:else}<p class="empty">No events have been recorded.</p>{/if}
			</section>
		{/if}
	{/if}
</main>

<style>
	.topbar {
		border-bottom: 1px solid var(--color-hairline);
		background: var(--color-panel);
	}
	.bar-content,
	main {
		width: min(100% - 2rem, 70rem);
		margin-inline: auto;
	}
	.bar-content,
	.title-row,
	.section-head,
	.table-head {
		display: flex;
		justify-content: space-between;
		align-items: start;
		flex-wrap: wrap;
		gap: 0.8rem;
	}
	.bar-content {
		align-items: center;
		min-height: 3.65rem;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		text-decoration: none;
		color: var(--color-fg);
		font-weight: 720;
		letter-spacing: -0.04em;
	}
	.brand span {
		font: 650 0.72rem var(--font-mono);
		color: var(--color-accent);
		border: 1px solid color-mix(in srgb, var(--color-accent) 35%, var(--color-hairline));
		background: color-mix(in srgb, var(--color-accent) 8%, var(--color-panel));
		padding: 0.4rem;
		border-radius: 0.32rem;
		letter-spacing: 0;
	}
	main {
		padding-block: clamp(1.8rem, 4vw, 3rem) 4rem;
	}
	h1 {
		font-size: clamp(1.65rem, 4.4vw, 2.35rem);
		line-height: 1.1;
		letter-spacing: -0.05em;
	}
	h2 {
		font-size: 1.16rem;
		line-height: 1.2;
		letter-spacing: -0.025em;
	}
	h3 {
		font-size: 0.93rem;
	}
	p {
		font-size: 0.88rem;
		color: var(--color-muted);
	}
	.title-row p,
	.section-head p {
		margin-top: 0.3rem;
	}
	.primary,
	.secondary {
		min-height: 2.25rem;
		padding: 0.4rem 0.7rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		text-decoration: none;
		border: 1px solid var(--color-hairline);
		border-radius: 0.42rem;
		font-size: 0.83rem;
		font-weight: 630;
		cursor: pointer;
	}
	.primary {
		background: var(--color-accent);
		border-color: transparent;
		color: var(--color-panel);
	}
	.secondary {
		color: var(--color-fg);
		background: var(--color-panel);
	}
	.primary:hover:not(:disabled) {
		filter: brightness(0.9);
	}
	.secondary:hover:not(:disabled) {
		border-color: var(--color-muted);
	}
	button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}
	.danger {
		color: var(--error-text);
	}
	.select-row {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		flex-wrap: wrap;
		margin-top: 1.15rem;
	}
	label {
		display: grid;
		gap: 0.24rem;
		font-size: 0.8rem;
		font-weight: 620;
	}
	input,
	select {
		min-height: 2.25rem;
		min-width: 0;
		max-width: 100%;
		padding: 0.38rem 0.6rem;
		border: 1px solid var(--color-hairline);
		border-radius: 0.36rem;
		background: var(--color-panel);
		font-size: 0.84rem;
	}
	input[type='checkbox'] {
		min-height: auto;
		padding: 0;
		accent-color: var(--color-accent);
	}
	.message,
	.busy {
		margin-top: 1rem;
	}
	.message {
		padding: 0.65rem 0.8rem;
		border: 1px solid var(--color-hairline);
		border-radius: 0.4rem;
		background: var(--color-panel);
		color: var(--color-fg);
	}
	main {
		--error-text: #9a2c24;
		--error-bg: #fff2ef;
		--success-text: #216445;
		--success-bg: #f0f8f2;
	}
	@media (prefers-color-scheme: dark) {
		main {
			--error-text: #ffc4b8;
			--error-bg: #382625;
			--success-text: #9bddb1;
			--success-bg: #1c3129;
		}
	}
	.error {
		color: var(--error-text);
		background: var(--error-bg);
	}
	.success {
		color: var(--success-text);
		background: var(--success-bg);
	}
	.panel,
	.pilot-summary {
		margin-top: 1.05rem;
		padding: clamp(0.8rem, 2.5vw, 1.35rem);
		background: var(--color-panel);
		border: 1px solid var(--color-hairline);
		border-radius: 0.55rem;
		min-width: 0;
	}
	.pilot-summary .section-head p {
		overflow-wrap: anywhere;
	}
	.settings-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.8rem;
		border: 0;
		padding: 0;
		margin: 1rem 0 0;
	}
	.wide {
		grid-column: 1 / -1;
	}
	.create-submit {
		margin-top: 1rem;
	}
	.pill {
		font-size: 0.73rem;
		border: 1px solid var(--color-hairline);
		border-radius: 99rem;
		background: var(--color-bg);
		padding: 0.15rem 0.55rem;
	}
	.pill.active {
		background: var(--success-bg);
		color: var(--success-text);
	}
	.pill.paused {
		background: var(--error-bg);
		color: var(--error-text);
	}
	.cap-grid,
	.metrics {
		display: grid;
		gap: 0.7rem;
		margin-top: 0.95rem;
	}
	.cap-grid {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
	.metrics {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}
	.cap-grid div,
	.metrics div {
		padding: 0.65rem;
		background: var(--color-bg);
		border: 1px solid var(--color-hairline);
		border-radius: 0.36rem;
	}
	dt {
		color: var(--color-muted);
		font-size: 0.73rem;
	}
	dd {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: 0.86rem;
		overflow-wrap: anywhere;
	}
	.cap-grid dd,
	.metrics dd {
		font-weight: 650;
		margin-top: 0.2rem;
	}
	.views {
		display: flex;
		align-items: end;
		flex-wrap: wrap;
		gap: 0.3rem 0.85rem;
		margin-top: 0.9rem;
		border-bottom: 1px solid var(--color-hairline);
	}
	.views button {
		padding: 0.45rem 0.1rem;
		color: var(--color-muted);
		font-size: 0.83rem;
		border-bottom: 2px solid transparent;
		cursor: pointer;
	}
	.views button.chosen {
		color: var(--color-accent);
		border-color: var(--color-accent);
		font-weight: 690;
	}
	.import-box {
		margin-top: 1rem;
		padding: 0.8rem;
		border: 1px solid var(--color-hairline);
		background: var(--color-bg);
		border-radius: 0.38rem;
	}
	.import-box p {
		margin-block: 0.22rem 0.55rem;
	}
	.import-box .fine-print {
		margin-bottom: 0;
	}
	.inline-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 0.5rem;
	}
	.inline-controls label {
		min-width: 0;
		max-width: 100%;
	}
	.fine-print,
	.arm > p {
		font-size: 0.77rem;
	}
	.action-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.7rem;
		align-items: end;
		margin-top: 0.9rem;
	}
	.action-row label {
		flex: 1 1 16rem;
	}
	.action-row p {
		align-self: center;
	}
	.table-head {
		margin-block: 1.15rem 0.45rem;
		align-items: center;
	}
	.check-label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.table-scroll {
		overflow: auto;
		margin-top: 0.5rem;
		border: 1px solid var(--color-hairline);
		border-radius: 0.35rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
		text-align: left;
	}
	th,
	td {
		padding: 0.55rem 0.62rem;
		border-bottom: 1px solid var(--color-hairline);
		white-space: nowrap;
	}
	thead {
		background: var(--color-bg);
	}
	td:last-child {
		min-width: 10rem;
		white-space: normal;
	}
	tbody tr:last-child > * {
		border-bottom: 0;
	}
	.more,
	.empty {
		margin-top: 0.6rem;
	}
	.decision {
		margin-top: 0.85rem;
		display: flex;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.55rem 0.8rem;
		padding: 0.7rem;
		background: var(--color-bg);
		border: 1px solid var(--color-hairline);
		border-radius: 0.4rem;
	}
	.decision.alert {
		background: var(--error-bg);
	}
	.decision.alert h3,
	.decision.alert dd {
		color: var(--error-text);
	}
	.as-of {
		margin-top: 0.5rem;
	}
	.arm-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.65rem;
		margin-top: 0.75rem;
	}
	.arm {
		padding: 0.7rem;
		border: 1px solid var(--color-hairline);
		border-radius: 0.4rem;
	}
	.arm-rate {
		margin-top: 0.35rem;
		font: 700 1.45rem var(--font-mono);
	}
	.arm dl {
		margin-top: 0.55rem;
	}
	.arm dl div {
		display: flex;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.22rem 0.45rem;
		padding-block: 0.17rem;
	}
	@media (max-width: 40rem) {
		.settings-grid,
		.metrics {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 30rem) {
		.arm-grid {
			grid-template-columns: 1fr;
		}
		.cap-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
