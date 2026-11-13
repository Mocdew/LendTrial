<script lang="ts">
	import { base } from '$app/paths';
	import PublicDemo from '$lib/components/PublicDemo.svelte';
	const server = import.meta.env.VITE_LENDTRIAL_SERVER === '1';
</script>

<svelte:head>
	{#if server}
		<title>LendTrial | Loan policy testing</title>
		<meta
			name="description"
			content="Replay loan policy changes, run a controlled pilot, and monitor observed repayments."
		/>
	{/if}
</svelte:head>

{#if server}
	<main>
		<header>
			<div class="mark" aria-hidden="true">LT</div>
			<p class="brand">LendTrial</p>
		</header>
		<section class="hero" aria-labelledby="title">
			<div>
				<h1 id="title">Test loan policy changes before rollout.</h1>
				<p>
					Compare offers on your own application history. Run a controlled pilot
					and monitor first payments as they come due.
				</p>
				<div class="actions">
					<a class="primary" href="{base}/workspace/">Open lender workspace</a>
					<a href="{base}/demo/">Explore the demo</a>
					<a href="https://github.com/Mocdew/LendTrial">Source and setup</a>
				</div>
			</div>
			<dl aria-label="Lender workflow">
				<div>
					<dt>Replay</dt>
					<dd>
						Compare the current and proposed cap on the same applications.
					</dd>
				</div>
				<div>
					<dt>Run the pilot</dt>
					<dd>
						Export borrower assignments and offered amounts to your lending
						system.
					</dd>
				</div>
				<div>
					<dt>Review repayments</dt>
					<dd>
						Use actual funding and payment records to review whether to pause.
					</dd>
				</div>
			</dl>
		</section>
		<footer>
			<a href="https://olumide-erinfolami.vercel.app/projects/lendtrial"
				>Portfolio case study</a
			>
		</footer>
	</main>
{:else}
	<PublicDemo isHome />
{/if}

<style>
	main {
		width: min(100% - 2rem, 67rem);
		margin: 0 auto;
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-height: 4.2rem;
		border-bottom: 1px solid var(--color-hairline);
	}
	.brand {
		font-weight: 740;
		letter-spacing: -0.03em;
	}
	.mark {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: 0.35rem;
		background: var(--color-accent);
		color: var(--color-panel);
		font-family: var(--font-mono);
		font-size: 0.82rem;
		font-weight: 750;
	}
	.hero {
		display: grid;
		grid-template-columns: 1.35fr 1fr;
		gap: clamp(2rem, 7vw, 6rem);
		align-items: center;
		padding: clamp(3rem, 10vw, 7rem) 0;
	}
	h1 {
		font-size: clamp(2.45rem, 6vw, 4.8rem);
		font-weight: 720;
		line-height: 1.01;
		letter-spacing: -0.075em;
	}
	.hero p {
		max-width: 48ch;
		margin-top: 1.3rem;
		font-size: clamp(1rem, 2.5vw, 1.15rem);
		color: var(--color-muted);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.9rem 1.2rem;
		margin-top: 1.8rem;
		font-size: 0.9rem;
		font-weight: 650;
	}
	.primary {
		display: inline-flex;
		align-items: center;
		min-height: 2.8rem;
		padding: 0.5rem 1rem;
		border-radius: 0.4rem;
		background: var(--color-accent);
		color: var(--color-panel);
		text-decoration: none;
	}
	dl {
		padding: 0 1.35rem;
		border: 1px solid var(--color-hairline);
		border-radius: 0.65rem;
		background: var(--color-panel);
	}
	dl div {
		padding: 1.2rem 0;
	}
	dl div + div {
		border-top: 1px solid var(--color-hairline);
	}
	dt {
		font-weight: 700;
	}
	dd {
		margin-top: 0.25rem;
		font-size: 0.9rem;
		color: var(--color-muted);
	}
	footer {
		padding: 1.2rem 0;
		border-top: 1px solid var(--color-hairline);
		font-size: 0.85rem;
	}
	@media (max-width: 700px) {
		.hero {
			grid-template-columns: 1fr;
		}
	}
</style>
