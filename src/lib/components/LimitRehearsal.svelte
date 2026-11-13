<script lang="ts">
	import {
		createDemoApplications,
		DEFAULT_POLICY,
		DEFAULT_ROLLOUT,
		GRACE_DAYS,
		MAX_CHECKPOINT_DAY,
		replayCsv,
		replayPolicies,
		simulateRollout,
		type Application,
		type RolloutConfig
	} from '$lib/limit-rehearsal/engine';

	let {
		applications,
		scoreSource = 'Synthetic reference scores',
		model
	}: {
		applications?: Application[];
		scoreSource?: string;
		model?: { type: string; version: string };
	} = $props();
	const demo = createDemoApplications();
	const currency = new Intl.NumberFormat('en-NG', {
		style: 'currency',
		currency: 'NGN',
		maximumFractionDigits: 0
	});
	const integer = new Intl.NumberFormat('en-NG');
	const percent = new Intl.NumberFormat('en-NG', {
		style: 'percent',
		maximumFractionDigits: 1
	});
	const pageSize = 5;
	const maximumCap = 100_000;
	const pauseLimits = Array.from({ length: 20 }, (_, index) => index + 1);

	let view = $state<'replay' | 'rollout'>('replay');
	let candidateCap = $state(DEFAULT_POLICY.candidateCap);
	let filter = $state<'changed' | 'all'>('changed');
	let page = $state(0);
	let scenario = $state<RolloutConfig['scenario']>(DEFAULT_ROLLOUT.scenario);
	let checkpointDay = $state(DEFAULT_ROLLOUT.checkpointDay);
	let pauseMarginPoints = $state(Math.round(DEFAULT_ROLLOUT.pauseMargin * 100));

	const replay = $derived(
		replayPolicies(applications ?? demo, { ...DEFAULT_POLICY, candidateCap })
	);
	const filteredRows = $derived(
		filter === 'changed' ? replay.rows.filter((row) => row.delta !== 0) : replay.rows
	);
	const pageCount = $derived(Math.max(1, Math.ceil(filteredRows.length / pageSize)));
	const visiblePage = $derived(Math.min(page, pageCount - 1));
	const visibleRows = $derived(
		filteredRows.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize)
	);
	const rollout = $derived(
		simulateRollout(replay, {
			...DEFAULT_ROLLOUT,
			scenario,
			checkpointDay,
			pauseMargin: pauseMarginPoints / 100
		})
	);
	const arms = $derived([
		{ label: 'Control', amount: DEFAULT_POLICY.currentCap, ...rollout.control },
		{ label: 'Candidate', amount: candidateCap, ...rollout.candidate }
	]);
	const principalScale = $derived(
		Math.max(1, replay.summary.currentPrincipal, replay.summary.candidatePrincipal)
	);
	const statusLabel = $derived(
		{ wait: 'Wait', continue: 'Continue', pause: 'Pause' }[rollout.decision]
	);

	function rate(value: number | null) {
		return value === null ? '—' : percent.format(value);
	}

	function points(value: number) {
		return `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)} pp`;
	}

	function downloadCsv() {
		const url = URL.createObjectURL(
			new Blob([replayCsv(replay, model)], { type: 'text/csv;charset=utf-8' })
		);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `lendtrial-${candidateCap}.csv`;
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
</script>

<div class="console" role="region" aria-label="LendTrial console">
	<div class="console-header">
		<div class="identity">
			<span class="monogram" aria-hidden="true">LT</span>
			<div>
				<div class="wordmark">LendTrial</div>
				<div class="console-label">Loan policy sandbox</div>
			</div>
		</div>
		<span class="simulation-label"><span aria-hidden="true"></span> Simulation</span>
	</div>

	<div class="view-switch" role="group" aria-label="Console view">
		<button type="button" aria-pressed={view === 'replay'} onclick={() => (view = 'replay')}>
			Before launch
		</button>
		<button type="button" aria-pressed={view === 'rollout'} onclick={() => (view = 'rollout')}>
			After launch
		</button>
	</div>

	{#if view === 'replay'}
		<div class="workspace">
			<div class="workspace-heading">
				<div>
					<h2>Offer comparison</h2>
					<p>
						Both caps require a completed loan and reference risk at or below
						{percent.format(DEFAULT_POLICY.maxRisk)}.
					</p>
				</div>
				<button type="button" class="secondary-button" onclick={downloadCsv}>
					<svg
						aria-hidden="true"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M12 5v14M19 12l-7 7-7-7" />
					</svg>
					Download CSV
				</button>
			</div>

			<div class="compare-controls">
				<div class="current-setting">
					<div class="field-label">Current cap</div>
					<div class="value">{currency.format(DEFAULT_POLICY.currentCap)}</div>
				</div>
				<div class="adjust-setting">
					<div class="field-line">
						<label for="limit-rehearsal-cap" class="field-label">Candidate cap</label>
						<span class="value">{currency.format(candidateCap)}</span>
					</div>
					<input
						id="limit-rehearsal-cap"
						type="range"
						min={DEFAULT_POLICY.currentCap}
						max={maximumCap}
						step={5000}
						value={candidateCap}
						aria-valuetext={currency.format(candidateCap)}
						oninput={(event) => {
							candidateCap = event.currentTarget.valueAsNumber;
							page = 0;
						}}
					/>
					<div class="range-scale" aria-hidden="true">
						<span>{currency.format(DEFAULT_POLICY.currentCap)}</span>
						<span>{currency.format(maximumCap)}</span>
					</div>
				</div>
			</div>

			<dl class="metrics" aria-label="Replay results" aria-live="polite" aria-atomic="true">
				<div>
					<dt>Applications</dt>
					<dd>{integer.format(replay.summary.applications)}</dd>
				</div>
				<div>
					<dt>Higher offers</dt>
					<dd>{integer.format(replay.summary.changed)}</dd>
				</div>
				<div>
					<dt>Extra principal offered</dt>
					<dd class="accent">{currency.format(replay.summary.additionalPrincipal)}</dd>
				</div>
			</dl>

			<div class="comparison-bars" role="group" aria-label="Total principal offered by policy">
				{#each [{ label: 'Current', value: replay.summary.currentPrincipal }, { label: 'Candidate', value: replay.summary.candidatePrincipal }] as row (row.label)}
					<div class="bar-row">
						<span>{row.label}</span>
						<div class="track" aria-hidden="true">
							<span
								class:accent-fill={row.label === 'Candidate'}
								style:width={(row.value / principalScale) * 100 + '%'}
							></span>
						</div>
						<span>{currency.format(row.value)}</span>
					</div>
				{/each}
			</div>

			<div class="table-heading">
				<h3>Application decisions</h3>
				<label>
					<span class="sr-only">Filter applications</span>
					<select
						value={filter}
						onchange={(event) => {
							filter = event.currentTarget.value === 'all' ? 'all' : 'changed';
							page = 0;
						}}
					>
						<option value="changed">Changed offers</option>
						<option value="all">All applications</option>
					</select>
				</label>
			</div>
			{#if visibleRows.length}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to be able to scroll the table when it overflows.) -->
				<div
					class="table-scroll"
					tabindex="0"
					role="region"
					aria-label="Application decisions table"
				>
					<table>
						<thead>
							<tr
								><th scope="col">Application</th><th scope="col">Requested</th><th scope="col"
									>Current</th
								><th scope="col">Candidate</th><th scope="col">Reason</th></tr
							>
						</thead>
						<tbody>
							{#each visibleRows as row (row.id)}
								<tr>
									<th scope="row">{row.id}</th>
									<td>{currency.format(row.requestedAmount)}</td>
									<td>{row.currentOffer === null ? '—' : currency.format(row.currentOffer)}</td>
									<td class:accent={row.delta > 0}
										>{row.candidateOffer === null ? '—' : currency.format(row.candidateOffer)}</td
									>
									<td>{row.reason}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<div class="pagination">
					<span aria-live="polite"
						>{integer.format(visiblePage * pageSize + 1)}–{integer.format(
							visiblePage * pageSize + visibleRows.length
						)} of {integer.format(filteredRows.length)}</span
					>
					<div>
						<button
							type="button"
							class="secondary-button"
							disabled={visiblePage === 0}
							onclick={() => (page = visiblePage - 1)}>Previous</button
						>
						<button
							type="button"
							class="secondary-button"
							disabled={visiblePage + 1 >= pageCount}
							onclick={() => (page = visiblePage + 1)}>Next</button
						>
					</div>
				</div>
			{:else}
				<p class="empty">No offers change at this cap. Adjust the cap or view all applications.</p>
			{/if}
		</div>
	{:else}
		<div class="workspace">
			<div class="workspace-heading">
				<div>
					<h2>Rollout monitor</h2>
					<p>
						Borrowers whose offers change have a {percent.format(rollout.config.candidateShare)}
						chance of receiving the candidate cap.
					</p>
				</div>
			</div>

			<div class="compare-controls rollout-controls">
				<div class="scenario-setting">
					<label class="field-label" for="limit-rehearsal-scenario">Repayment scenario</label>
					<select id="limit-rehearsal-scenario" bind:value={scenario}>
						<option value="neutral">No added repayment stress</option>
						<option value="adverse">Higher repayment stress</option>
					</select>
				</div>
				<div class="adjust-setting">
					<div class="field-line">
						<label for="limit-rehearsal-day" class="field-label">Days into rollout</label>
						<span class="value">Day {checkpointDay}</span>
					</div>
					<input
						id="limit-rehearsal-day"
						type="range"
						min={0}
						max={MAX_CHECKPOINT_DAY}
						step={1}
						bind:value={checkpointDay}
						aria-valuetext={`Day ${checkpointDay}`}
					/>
					<div class="range-scale" aria-hidden="true">
						<span>Day 0</span><span>Day {MAX_CHECKPOINT_DAY}</span>
					</div>
				</div>
				<div class="pause-setting">
					<label class="field-label" for="limit-rehearsal-margin"
						>Allowed increase over the control miss rate</label
					>
					<select id="limit-rehearsal-margin" bind:value={pauseMarginPoints}>
						{#each pauseLimits as limit (limit)}
							<option value={limit}
								>{limit} {limit === 1 ? 'percentage point' : 'percentage points'}</option
							>
						{/each}
					</select>
				</div>
			</div>

			<div
				class="gate"
				class:gate-pause={rollout.decision === 'pause'}
				class:gate-continue={rollout.decision === 'continue'}
				aria-live="polite"
				aria-atomic="true"
			>
				<div class="gate-heading">
					<span class="field-label">Day {rollout.config.decisionDay} decision</span><strong
						>{statusLabel}</strong
					>
				</div>
				<div>
					<p>
						{#if replay.summary.changed === 0}
							No higher offers qualify for the rollout at this cap.
						{:else if checkpointDay < rollout.config.decisionDay}
							The rollout rule will run on day {rollout.config.decisionDay}.
						{:else if rollout.decision === 'wait'}
							The rule requires at least {rollout.config.minMaturedPerArm} loans past the grace period
							in each group at the decision point.
						{:else if rollout.decision === 'pause'}
							The candidate exceeded the miss-rate limit. Later offers use the current cap.
							{integer.format(rollout.redirected)} would have received the candidate cap.
						{:else}
							The simulated pilot continued. The candidate was within the miss-rate limit at the
							decision point.
						{/if}
					</p>
					{#if rollout.gateControl && rollout.gateCandidate}
						<p class="gate-detail">
							{rollout.gateControl.matured} control / {rollout.gateCandidate.matured} candidate evaluable
							{#if rollout.gateMissRateDelta !== null}
								· Miss-rate gap {points(rollout.gateMissRateDelta)}
							{/if}
						</p>
					{/if}
				</div>
			</div>

			<div class="arm-grid" role="group" aria-label="Rollout results by group">
				{#each arms as arm (arm.label)}
					<div class="arm">
						<div class="arm-heading">
							<h3>{arm.label}</h3>
							<span>{currency.format(arm.amount)} cap</span>
						</div>
						<div class="arm-rate">{rate(arm.missRate)}</div>
						<div class="arm-caption">Missed first payment</div>
						<div class="track" aria-hidden="true">
							<span
								class:accent-fill={arm.label === 'Candidate'}
								style:width={(arm.missRate ?? 0) * 100 + '%'}
							></span>
						</div>
						<dl>
							<dt>Misses / evaluable</dt>
							<dd>{arm.misses} / {arm.matured}</dd>
							<dt>Pending first payments</dt>
							<dd>{arm.pending}</dd>
							<dt>Assigned borrowers</dt>
							<dd>{arm.assigned}</dd>
							<dt>Accepted / funded</dt>
							<dd>{arm.accepted} / {arm.funded}</dd>
							<dt>Funded principal</dt>
							<dd>{currency.format(arm.fundedPrincipal)}</dd>
							<dt>Completed follow-up</dt>
							<dd>{arm.followedUp}</dd>
							<dt>Miss rate per borrower with follow-up</dt>
							<dd>{rate(arm.missesPerAssigned)}</dd>
						</dl>
					</div>
				{/each}
			</div>
			<p class="metric-note">
				A first payment counts as missed if any balance remains {GRACE_DAYS} days after its due date.
				The loan rate uses funded loans past that window. The borrower rate also includes assigned borrowers
				who declined their offer and completed follow-up.
			</p>
		</div>
	{/if}

	<div class="console-footer">
		<span>{scoreSource}</span>
		<span>Simulated repayment outcomes</span>
	</div>
</div>

<style>
	.console {
		--tint: color-mix(in srgb, var(--color-accent) 8%, var(--color-panel));
		--warning: #a2382f;
		--good: #19694e;
		overflow: hidden;
		border: 1px solid var(--color-hairline);
		border-radius: 0.65rem;
		background: var(--color-panel);
		color: var(--color-fg);
		font-family: var(--font-sans);
		font-variant-numeric: tabular-nums;
	}

	@media (prefers-color-scheme: dark) {
		.console {
			--warning: #f3a49e;
			--good: #8bd3b5;
		}
	}

	.console-header,
	.console-footer,
	.workspace-heading,
	.table-heading,
	.field-line,
	.pagination,
	.arm-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
	}

	.console-header {
		padding: 1rem 1.2rem;
		border-bottom: 1px solid var(--color-hairline);
	}

	.identity {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}

	.monogram {
		display: grid;
		width: 2.25rem;
		height: 2.25rem;
		place-items: center;
		border: 1px solid color-mix(in srgb, var(--color-accent) 35%, var(--color-hairline));
		border-radius: 0.4rem;
		background: var(--tint);
		color: var(--color-accent);
		font: 650 0.78rem var(--font-mono);
	}

	.wordmark {
		font-size: 0.92rem;
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	.console-label,
	.console-footer,
	.range-scale,
	.pagination {
		color: var(--color-dim);
		font-size: 0.72rem;
	}

	.simulation-label {
		display: inline-flex;
		align-items: center;
		gap: 0.36rem;
		border: 1px solid var(--color-hairline);
		border-radius: 999px;
		padding: 0.25rem 0.55rem;
		color: var(--color-muted);
		font-size: 0.72rem;
		font-weight: 550;
	}

	.simulation-label span {
		width: 0.37rem;
		height: 0.37rem;
		border-radius: 50%;
		background: var(--color-accent);
	}

	.view-switch {
		display: flex;
		gap: 1.25rem;
		padding-inline: 1.2rem;
		border-bottom: 1px solid var(--color-hairline);
		background: var(--color-bg);
	}

	.view-switch button {
		min-height: 2.75rem;
		border-bottom: 2px solid transparent;
		color: var(--color-muted);
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
	}

	.view-switch button[aria-pressed='true'] {
		border-bottom-color: var(--color-accent);
		color: var(--color-accent);
	}
	.view-switch button:hover {
		color: var(--color-fg);
	}
	.view-switch button:focus-visible {
		outline-offset: -3px;
	}
	.workspace {
		padding: 1.2rem;
	}
	.workspace-heading h2 {
		margin: 0;
		color: var(--color-fg);
		font-size: 1.15rem;
		font-weight: 650;
		letter-spacing: -0.035em;
	}
	.workspace-heading p,
	.gate p,
	.empty,
	.metric-note {
		color: var(--color-muted);
		font-size: 0.78rem;
	}

	.secondary-button,
	select {
		display: inline-flex;
		min-height: 2.25rem;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.65rem;
		border: 1px solid var(--color-hairline);
		border-radius: 0.35rem;
		background: var(--color-panel);
		color: var(--color-fg);
		font-size: 0.75rem;
		font-weight: 550;
		cursor: pointer;
	}

	select {
		appearance: auto;
	}
	.secondary-button:hover:enabled,
	select:hover {
		border-color: var(--color-dim);
	}
	.secondary-button:disabled {
		color: var(--color-dim);
		opacity: 0.65;
		cursor: default;
	}

	.compare-controls {
		display: grid;
		grid-template-columns: minmax(0, 0.65fr) minmax(0, 1.35fr);
		gap: 0.9rem;
		margin-top: 1.15rem;
		padding: 0.85rem;
		border: 1px solid var(--color-hairline);
		border-radius: 0.45rem;
		background: var(--color-bg);
	}

	.current-setting,
	.scenario-setting {
		padding-right: 0.9rem;
		border-right: 1px solid var(--color-hairline);
	}
	.field-label {
		color: var(--color-muted);
		font-size: 0.75rem;
		font-weight: 600;
	}
	.value {
		color: var(--color-fg);
		font: 650 1rem var(--font-mono);
	}
	.current-setting .value {
		margin-top: 0.35rem;
	}
	input[type='range'] {
		display: block;
		width: 100%;
		min-height: 1.7rem;
		accent-color: var(--color-accent);
		cursor: pointer;
	}
	.range-scale {
		display: flex;
		justify-content: space-between;
	}

	.metrics {
		display: grid;
		grid-template-columns: 1fr 1fr 1.3fr;
		margin-top: 0.9rem;
		border: 1px solid var(--color-hairline);
		border-radius: 0.45rem;
	}

	.metrics div {
		min-width: 0;
		padding: 0.75rem;
	}
	.metrics div + div {
		border-left: 1px solid var(--color-hairline);
	}
	.metrics dt {
		color: var(--color-muted);
		font-size: 0.72rem;
	}
	.metrics dd {
		margin-top: 0.25rem;
		font: 650 clamp(0.8rem, 2.1vw, 1.25rem) var(--font-mono);
	}
	.accent {
		color: var(--color-accent);
		font-weight: 650;
	}

	.comparison-bars {
		display: grid;
		gap: 0.38rem;
		margin-top: 0.8rem;
	}
	.bar-row {
		display: grid;
		grid-template-columns: 4.5rem minmax(0, 1fr) 7rem;
		align-items: center;
		gap: 0.55rem;
		color: var(--color-muted);
		font-size: 0.72rem;
	}
	.bar-row > span:last-child {
		text-align: right;
	}
	.track {
		overflow: hidden;
		height: 0.3rem;
		border-radius: 999px;
		background: var(--color-hairline);
	}
	.track span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--color-dim);
	}
	.track span.accent-fill {
		background: var(--color-accent);
	}

	.table-heading {
		margin-top: 1.25rem;
	}
	h3 {
		color: var(--color-fg);
		font-size: 0.8rem;
		font-weight: 650;
	}
	.table-scroll {
		overflow-x: auto;
		margin-top: 0.55rem;
		border: 1px solid var(--color-hairline);
		border-radius: 0.4rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: 0.73rem;
	}
	th,
	td {
		padding: 0.6rem 0.55rem;
		white-space: nowrap;
	}
	td:last-child {
		min-width: 9rem;
		white-space: normal;
	}
	thead {
		background: var(--color-bg);
		color: var(--color-muted);
	}
	thead th,
	tbody th {
		font-weight: 600;
	}
	tbody tr {
		border-top: 1px solid var(--color-hairline);
	}
	tbody td {
		color: var(--color-muted);
	}
	tbody td.accent {
		color: var(--color-accent);
	}
	.pagination {
		margin-top: 0.55rem;
	}
	.pagination div {
		display: flex;
		gap: 0.4rem;
	}
	.empty {
		margin-top: 0.55rem;
		padding: 0.75rem;
		border: 1px dashed var(--color-hairline);
		border-radius: 0.35rem;
	}

	.rollout-controls {
		grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
	}
	.scenario-setting select {
		display: block;
		max-width: 100%;
		margin-top: 0.25rem;
	}
	.pause-setting {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.45rem;
		padding-top: 0.65rem;
		border-top: 1px solid var(--color-hairline);
	}
	.gate {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.8rem;
		align-items: center;
		margin-top: 0.9rem;
		padding: 0.75rem;
		border: 1px solid var(--color-hairline);
		border-left: 3px solid var(--color-dim);
		border-radius: 0.4rem;
		background: var(--color-bg);
	}

	.gate-pause {
		border-left-color: var(--warning);
	}
	.gate-continue {
		border-left-color: var(--good);
	}
	.gate-heading strong {
		display: block;
		font: 650 1.05rem var(--font-mono);
	}
	.gate-pause .gate-heading strong {
		color: var(--warning);
	}
	.gate-continue .gate-heading strong {
		color: var(--good);
	}
	.gate p.gate-detail {
		margin-top: 0.15rem;
		font: 0.68rem var(--font-mono);
	}
	.arm-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.7rem;
		margin-top: 0.8rem;
	}
	.arm {
		min-width: 0;
		padding: 0.75rem;
		border: 1px solid var(--color-hairline);
		border-radius: 0.4rem;
	}
	.arm-heading span,
	.arm-caption {
		color: var(--color-muted);
		font-size: 0.73rem;
	}
	.arm-rate {
		margin-top: 0.6rem;
		color: var(--color-fg);
		font: 650 1.35rem var(--font-mono);
	}
	.arm .track {
		margin-top: 0.6rem;
	}
	.arm dl {
		display: grid;
		grid-template-columns: minmax(0, 1fr) max-content;
		gap: 0.4rem;
		align-items: baseline;
		margin-top: 0.7rem;
		font-size: 0.71rem;
	}
	.arm dt {
		color: var(--color-muted);
	}
	.arm dd {
		text-align: right;
	}
	.metric-note {
		margin-top: 0.7rem;
	}
	.console-footer {
		padding: 0.7rem 1.2rem;
		border-top: 1px solid var(--color-hairline);
		background: var(--color-bg);
	}

	@media (max-width: 34rem) {
		.workspace,
		.console-header {
			padding: 0.85rem;
		}
		.view-switch,
		.console-footer {
			padding-inline: 0.85rem;
		}
		.metrics div {
			padding: 0.6rem 0.4rem;
		}
		.metrics dt {
			min-height: 2em;
		}
		.arm-grid {
			grid-template-columns: 1fr;
		}
		.rollout-controls {
			grid-template-columns: 1fr;
		}
		.scenario-setting {
			padding: 0 0 0.75rem;
			border-right: 0;
			border-bottom: 1px solid var(--color-hairline);
		}
		.gate {
			grid-template-columns: 1fr;
			gap: 0.3rem;
		}
	}
</style>
