<script lang="ts">
	import { asset } from '$app/paths';
	import LendTrial from '$lib/components/LendTrial.svelte';
	import {
		MAX_SCORE_FILE_BYTES,
		readScoreExport,
		type ScoreExport
	} from '$lib/lendtrial/import';

	let scoreExport = $state<ScoreExport | null>(null);
	let importMessage = $state('');
	let importing = $state(false);
	let importFailed = $state(false);
	let revision = $state(0);

	function loadScores(imported: ScoreExport, source: string) {
		scoreExport = imported;
		revision += 1;
		const count = imported.applications.length;
		importMessage = `Loaded ${count.toLocaleString('en-NG')} scored ${count === 1 ? 'application' : 'applications'}${source}.`;
	}

	async function importScores(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importMessage = '';
		importFailed = false;
		importing = true;
		try {
			if (file.size > MAX_SCORE_FILE_BYTES) throw new Error('Choose a JSON file up to 2 MB.');
			loadScores(readScoreExport(await file.text()), '');
		} catch (error) {
			importFailed = true;
			importMessage = error instanceof Error ? error.message : 'Could not read this score export.';
		} finally {
			input.value = '';
			importing = false;
		}
	}

	async function loadSample() {
		importMessage = '';
		importFailed = false;
		importing = true;
		try {
			const response = await fetch(asset('/lendtrial-scores.json'));
			if (!response.ok) throw new Error('The scored sample is temporarily unavailable.');
			loadScores(readScoreExport(await response.text()), ' from the sample');
		} catch (error) {
			importFailed = true;
			importMessage = error instanceof Error ? error.message : 'Could not load the scored sample.';
		} finally {
			importing = false;
		}
	}

	function resetScores() {
		scoreExport = null;
		importFailed = false;
		importMessage = 'Restored the synthetic demo cohort.';
		revision += 1;
	}
</script>

<svelte:head>
	<title>LendTrial</title>
	<meta
		name="description"
		content="Replay loan caps on the same applications and simulate a controlled rollout."
	/>
</svelte:head>

<main>
	<header>
		<nav aria-label="Project links">
			<a href="https://github.com/Mocdew/LendTrial">GitHub</a>
			<a href="https://olumide-erinfolami.vercel.app/projects/lendtrial">Case study</a>
		</nav>
		<h1>LendTrial</h1>
		<p>Test loan policy changes before rollout.</p>
	</header>

	{#key revision}
		<LendTrial
			applications={scoreExport?.applications}
			model={scoreExport?.model}
			scoreSource={scoreExport
				? `Imported · ${scoreExport.model.type} / ${scoreExport.model.version}`
				: undefined}
		/>
	{/key}
	<details class="score-import">
		<summary>Load Can I borrow.ai scores</summary>
		<p>
			Try a sample of synthetic applications scored by a pinned LightGBM artifact, or create a
			file with the <a
				href="https://github.com/Mocdew/LendTrial/tree/main/scripts/lendtrial">local Python exporter</a
			>. The browser reads imported files on your device.
		</p>
		<div class="score-controls">
			<button type="button" onclick={loadSample} disabled={importing}>Load scored sample</button>
			<label>
				Score export (JSON)
				<input
					type="file"
					accept=".json,application/json"
					onchange={importScores}
					disabled={importing}
				/>
			</label>
			{#if scoreExport}
				<button type="button" onclick={resetScores} disabled={importing}>
					Restore demo cohort
				</button>
			{/if}
		</div>
		<div aria-live="polite" aria-atomic="true">
			{#if importMessage}
				<p>{importFailed ? 'Import failed. ' : ''}{importMessage}</p>
			{/if}
		</div>
	</details>
</main>

<style>
	main {
		width: min(100% - 2rem, 58rem);
		margin: clamp(1.5rem, 5vw, 4rem) auto;
	}

	header {
		margin-bottom: 1.45rem;
	}

	nav {
		display: flex;
		gap: 1.2rem;
		margin-bottom: 0.8rem;
		font-size: 0.82rem;
	}

	h1 {
		font-size: clamp(2rem, 5vw, 3.1rem);
		line-height: 1.1;
		font-weight: 720;
		letter-spacing: -0.06em;
	}

	header p {
		margin-top: 0.55rem;
		color: var(--color-muted);
		font-size: clamp(0.9rem, 2.8vw, 1.08rem);
	}

	.score-import {
		margin-top: 1rem;
		padding: 0.85rem 1rem;
		border: 1px solid var(--color-hairline);
		border-radius: 0.65rem;
		background: var(--color-panel);
		font-size: 0.85rem;
	}

	summary {
		width: fit-content;
		font-weight: 650;
		cursor: pointer;
	}

	.score-import p {
		margin-top: 0.6rem;
		color: var(--color-muted);
	}

	.score-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
		align-items: end;
		margin-top: 0.75rem;
	}

	.score-controls label {
		display: grid;
		gap: 0.3rem;
		min-width: 0;
		max-width: 100%;
	}

	.score-controls button,
	.score-controls input {
		min-height: 2.2rem;
		max-width: 100%;
		padding: 0.3rem 0.55rem;
		border: 1px solid var(--color-hairline);
		border-radius: 0.35rem;
		background: var(--color-bg);
		font-size: 0.78rem;
	}

	.score-controls button:hover:not(:disabled) {
		border-color: var(--color-muted);
		cursor: pointer;
	}

	.score-controls button:disabled,
	.score-controls input:disabled {
		opacity: 0.65;
	}
</style>
