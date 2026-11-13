import { base } from '$app/paths';
import { fail, redirect } from '@sveltejs/kit';
import {
	sessionConfigured,
	signedIn,
	startSession,
	verifyAccessKey
} from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const prerender = false;

export const load: PageServerLoad = ({ cookies, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	if (signedIn(cookies)) redirect(303, `${base}/workspace/`);
	return { configured: sessionConfigured() };
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const result = verifyAccessKey(form.get('access_key'));
		if (result === 'limited')
			return fail(429, {
				message: 'Too many attempts. Try again in a minute.'
			});
		if (result !== 'ok')
			return fail(401, { message: 'The access key is incorrect.' });
		startSession(cookies, url);
		redirect(303, `${base}/workspace/`);
	}
};
