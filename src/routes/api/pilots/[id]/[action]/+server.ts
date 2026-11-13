import {
	RequestProblem,
	readBody,
	readJson,
	send,
	sendCsv,
	useWorkspace
} from '$lib/server/api';
import {
	MAX_CSV_BYTES,
	parseApplicationsCsv,
	parseOutcomesCsv
} from '$lib/server/csv';
import { sameOrigin, signedIn } from '$lib/server/session';
import type { RequestHandler } from './$types';

export const prerender = false;

export const GET: RequestHandler = (event) =>
	useWorkspace(event, (db) => {
		if (event.params.action !== 'assignments.csv')
			throw new RequestProblem('Unknown resource.', 404);
		const assignments = db.exportAssignments(event.params.id);
		return sendCsv(
			'lendtrial-assignments.csv',
			[
				'application_id',
				'borrower_id',
				'application_date',
				'requested_amount_kobo',
				'reference_risk',
				'model_type',
				'model_version',
				'current_offer_kobo',
				'candidate_offer_kobo',
				'delta_kobo',
				'reason',
				'arm',
				'planned_arm',
				'assigned_offer_kobo',
				'assigned_at'
			],
			assignments.map((row) => [
				row.id,
				row.borrowerId,
				row.applicationDate,
				row.requestedAmount,
				row.referenceRisk,
				row.modelType,
				row.modelVersion,
				row.currentOffer,
				row.candidateOffer,
				row.delta,
				row.reason,
				row.arm,
				row.plannedArm,
				row.assignedOffer,
				row.assignedAt
			])
		);
	});

export const POST: RequestHandler = (event) =>
	useWorkspace(event, async (db) => {
		const { id, action } = event.params;
		if (action === 'applications' || action === 'outcomes') {
			if (
				event.request.headers.get('content-type')?.split(';')[0].trim() !==
				'text/csv'
			) {
				throw new RequestProblem('Send a text/csv request.', 415);
			}
			const raw = await readBody(event.request, MAX_CSV_BYTES);
			return send(
				action === 'applications'
					? db.importApplications(id, parseApplicationsCsv(raw))
					: db.importOutcomes(id, parseOutcomesCsv(raw))
			);
		}
		if (action === 'start') {
			if (!signedIn(event.cookies) || !sameOrigin(event))
				throw new RequestProblem('Sign in to start a pilot.', 403);
			db.startPilot(id);
			return send({ ok: true });
		}
		if (action === 'pause') {
			if (!signedIn(event.cookies) || !sameOrigin(event))
				throw new RequestProblem('Sign in to change the pilot state.', 403);
			const { paused, reason } = await readJson(event.request);
			if (typeof paused !== 'boolean' || typeof reason !== 'string') {
				throw new RequestProblem('Provide a pause state and a reason.');
			}
			db.setPaused(id, paused, reason);
			return send({ ok: true });
		}
		throw new RequestProblem('Unknown action.', 404);
	});
