import { readJson, send, useWorkspace } from '$lib/server/api';
import type { CreatePilotInput } from '$lib/server/lendtrial';
import { sameOrigin, signedIn } from '$lib/server/session';
import type { RequestHandler } from './$types';

export const prerender = false;

export const GET: RequestHandler = (event) =>
	useWorkspace(event, (db) => send({ pilots: db.listPilots() }));

export const POST: RequestHandler = (event) =>
	useWorkspace(event, async (db) => {
		if (!signedIn(event.cookies) || !sameOrigin(event))
			return send({ error: 'Sign in to create a pilot.' }, 403);
		const input = (await readJson(
			event.request
		)) as unknown as CreatePilotInput;
		return send({ pilotId: db.createPilot(input).id }, 201);
	});
