import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from '$env/dynamic/private';
import { json, type RequestEvent } from '@sveltejs/kit';
import { LendTrialError, openLendTrial } from './lendtrial';
import { CsvInputError } from './csv';
import { integrationAuthorized, sameOrigin, signedIn } from './session';

const noStore = { 'cache-control': 'no-store' };
let database: ReturnType<typeof openLendTrial> | undefined;

function store() {
	if (!database) {
		const file = resolve(env.LENDTRIAL_DB_PATH || './data/lendtrial.sqlite');
		mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
		database = openLendTrial(file);
	}
	return database;
}

export class RequestProblem extends Error {
	constructor(
		message: string,
		readonly status = 400
	) {
		super(message);
	}
}

export function send(data: unknown, status = 200) {
	return json(data, { status, headers: noStore });
}

export async function useWorkspace(
	event: RequestEvent,
	action: (database: ReturnType<typeof store>) => Response | Promise<Response>
) {
	const integration = integrationAuthorized(event.request);
	if (!integration && !signedIn(event.cookies))
		return send({ error: 'Sign in to use this workspace.' }, 401);
	if (!integration && event.request.method !== 'GET' && !sameOrigin(event)) {
		return send({ error: 'Invalid request origin.' }, 403);
	}
	try {
		return await action(store());
	} catch (error) {
		if (error instanceof RequestProblem)
			return send({ error: error.message }, error.status);
		if (error instanceof LendTrialError)
			return send({ error: error.message }, error.status);
		if (error instanceof CsvInputError)
			return send({ error: error.message }, 422);
		if (error instanceof RangeError || error instanceof TypeError)
			return send({ error: error.message }, 400);
		console.error(
			'LendTrial API operation failed:',
			error instanceof Error ? error.name : 'unknown'
		);
		return send(
			{ error: 'The workspace could not complete this request.' },
			500
		);
	}
}

export async function readBody(request: Request, maxBytes: number) {
	const contentLength = Number(request.headers.get('content-length'));
	if (contentLength > maxBytes)
		throw new RequestProblem('The request is too large.', 413);
	const reader = request.body?.getReader();
	if (!reader) return '';
	const decoder = new TextDecoder('utf-8', { fatal: true });
	let bytes = 0;
	let text = '';
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > maxBytes) {
				await reader.cancel();
				throw new RequestProblem('The request is too large.', 413);
			}
			text += decoder.decode(chunk.value, { stream: true });
		}
		return text + decoder.decode();
	} catch (error) {
		if (error instanceof TypeError)
			throw new RequestProblem('Send a UTF-8 text file.');
		throw error;
	} finally {
		reader.releaseLock();
	}
}

export async function readJson(
	request: Request
): Promise<Record<string, unknown>> {
	if (
		request.headers.get('content-type')?.split(';')[0].trim() !==
		'application/json'
	) {
		throw new RequestProblem('Send an application/json request.', 415);
	}
	const body = await readBody(request, 8_192);
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		throw new RequestProblem('The request body must contain valid JSON.');
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new RequestProblem('The request body must be a JSON object.');
	}
	return parsed as Record<string, unknown>;
}

function csvCell(value: unknown) {
	if (value == null) return '';
	if (typeof value === 'number') return String(value);
	const text = String(value);
	const safe = /^[\s]*[=+\-@]|^[\t\r\n]/.test(text) ? `'${text}` : text;
	return `"${safe.replaceAll('"', '""')}"`;
}

export function sendCsv(
	filename: string,
	columns: readonly string[],
	rows: unknown[][]
) {
	const body = [
		columns.join(','),
		...rows.map((row) => row.map(csvCell).join(','))
	].join('\r\n');
	return new Response(body + '\r\n', {
		headers: {
			...noStore,
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${filename}"`,
			'x-content-type-options': 'nosniff'
		}
	});
}
