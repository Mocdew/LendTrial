<script lang="ts">
	import { base } from '$app/paths';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
</script>

<svelte:head
	><title>Sign in to LendTrial</title><meta
		name="robots"
		content="noindex"
	/></svelte:head
>

<main>
	<a href="{base}/">LendTrial</a>
	<h1>Sign in to your workspace</h1>
	{#if data.configured}
		<form method="POST">
			<label for="access-key">Workspace access key</label>
			<input
				id="access-key"
				name="access_key"
				type="password"
				autocomplete="current-password"
				maxlength="1024"
				required
			/>
			{#if form?.message}<p role="alert">{form.message}</p>{/if}
			<button type="submit">Sign in</button>
		</form>
	{:else}
		<p>Set the server’s workspace access key to enable sign-in.</p>
	{/if}
</main>

<style>
	main {
		width: min(100% - 2rem, 29rem);
		margin: 12vh auto;
		padding: clamp(1.25rem, 5vw, 2.25rem);
		border: 1px solid var(--color-hairline);
		border-radius: 0.75rem;
		background: var(--color-panel);
	}
	h1 {
		font-size: 1.65rem;
		line-height: 1.15;
		margin-block: 1rem 1.5rem;
	}
	a {
		font-size: 0.85rem;
		font-weight: 700;
	}
	form {
		display: grid;
		gap: 0.7rem;
	}
	input,
	button {
		min-height: 2.7rem;
		border: 1px solid var(--color-hairline);
		border-radius: 0.4rem;
		padding: 0.6rem;
	}
	input {
		color: var(--color-fg);
		background: var(--color-bg);
	}
	button {
		background: var(--color-accent);
		color: white;
		font-weight: 650;
		cursor: pointer;
	}
	p {
		color: var(--color-muted);
		font-size: 0.9rem;
	}
</style>
