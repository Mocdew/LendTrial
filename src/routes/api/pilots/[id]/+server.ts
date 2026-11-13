import { send, useWorkspace } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const prerender = false;

export const GET: RequestHandler = (event) =>
	useWorkspace(event, (db) =>
		send(
			db.getPilot(
				event.params.id,
				event.url.searchParams.get('asOf') || undefined
			)
		)
	);
