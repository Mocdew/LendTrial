import { base } from '$app/paths';
import { redirect } from '@sveltejs/kit';
import { signedIn } from '$lib/server/session';
import type { PageServerLoad } from './$types';

export const prerender = false;

export const load: PageServerLoad = ({ cookies, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	if (!signedIn(cookies)) redirect(303, `${base}/session/login/`);
};
