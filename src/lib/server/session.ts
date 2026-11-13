import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { Cookies, RequestEvent } from '@sveltejs/kit';

const COOKIE_NAME = 'lendtrial_session';
const SESSION_SECONDS = 8 * 60 * 60;
const RETRY_WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 12;
let attempts = 0;
let retryAt = 0;

function signature(value: string, key: string) {
	return createHmac('sha256', key).update(value).digest('base64url');
}

function same(a: string, b: string) {
	const first = Buffer.from(a);
	const second = Buffer.from(b);
	return first.length === second.length && timingSafeEqual(first, second);
}

function accessKey() {
	const key = env.LENDTRIAL_ACCESS_KEY;
	return key && key.length >= 32 ? key : undefined;
}

export function sessionConfigured() {
	return Boolean(accessKey());
}

export function verifyAccessKey(input: unknown): 'ok' | 'invalid' | 'limited' {
	const key = accessKey();
	if (!key || typeof input !== 'string' || input.length > 1024)
		return 'invalid';
	const now = Date.now();
	if (now >= retryAt) {
		attempts = 0;
		retryAt = now + RETRY_WINDOW_MS;
	}
	if (attempts >= MAX_ATTEMPTS) return 'limited';
	attempts++;
	if (!same(signature(input, key), signature(key, key))) return 'invalid';
	attempts = 0;
	return 'ok';
}

export function startSession(cookies: Cookies, url: URL) {
	const key = accessKey();
	if (!key)
		throw new Error('Configure LENDTRIAL_ACCESS_KEY to use the workspace.');
	const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
	const value = `${expires}.${randomBytes(24).toString('base64url')}`;
	cookies.set(COOKIE_NAME, `${value}.${signature(`session:${value}`, key)}`, {
		path: '/',
		httpOnly: true,
		secure: url.protocol === 'https:',
		sameSite: 'strict',
		maxAge: SESSION_SECONDS
	});
}

export function endSession(cookies: Cookies) {
	cookies.delete(COOKIE_NAME, { path: '/' });
}

export function signedIn(cookies: Cookies) {
	const key = accessKey();
	const token = cookies.get(COOKIE_NAME);
	if (
		!key ||
		!token ||
		!/^\d{10}\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(token)
	) {
		return false;
	}
	const [expires, nonce, mac] = token.split('.');
	return (
		Number(expires) > Math.floor(Date.now() / 1000) &&
		same(mac, signature(`session:${expires}.${nonce}`, key))
	);
}

export function sameOrigin(event: RequestEvent) {
	return event.request.headers.get('origin') === event.url.origin;
}

export function integrationAuthorized(request: Request) {
	const key = env.LENDTRIAL_INTEGRATION_KEY;
	const auth = request.headers.get('authorization');
	if (
		!key ||
		key.length < 32 ||
		!auth?.startsWith('Bearer ') ||
		auth.length > 1031
	)
		return false;
	return same(signature(auth.slice(7), key), signature(key, key));
}
