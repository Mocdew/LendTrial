import { base } from '$app/paths';
import { error, redirect } from '@sveltejs/kit';
import { endSession, sameOrigin } from '$lib/server/session';
import type { RequestHandler } from './$types';

export const prerender = false;

export const POST: RequestHandler = (event) => {
	if (!sameOrigin(event)) error(403, 'Invalid request origin.');
	endSession(event.cookies);
	redirect(303, `${base}/session/login/`);
};
