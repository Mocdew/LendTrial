import { expect, test } from '@playwright/test';

const today = new Date().toISOString().slice(0, 10);
const csvHeaders =
	'application_id,borrower_id,requested_amount_kobo,reference_risk,successful_loans,application_date,model_type,model_version';
const borrower = (id: string) =>
	`${id},b-${id},6500000,0.08,2,${today},lightgbm,version-1`;

test('an operator can replay, activate and pause a durable pilot using imported records', async ({
	page,
	request
}) => {
	await page.goto('/');
	await page.getByRole('link', { name: 'Open lender workspace' }).click();
	await expect(page).toHaveURL(/\/session\/login\/$/);
	expect((await request.get('/api/pilots/')).status()).toBe(401);
	await page
		.getByLabel('Workspace access key')
		.fill('workspace-e2e-test-key-not-for-production');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(
		page.getByRole('heading', { name: 'Loan policy pilots' })
	).toBeVisible();
	await page.getByLabel('Pilot name').fill('Repeat-loan cap');
	await page.getByLabel(/model version/i).fill('version-1');
	await page.getByLabel(/maximum reference risk/i).fill('20');
	await page.getByLabel(/minimum evaluable loans per group/i).fill('1');
	await page.getByLabel(/pause margin/i).fill('5');
	await page.getByRole('button', { name: 'Create draft' }).click();
	await expect(page.getByText('Draft pilot created.')).toBeVisible();
	const context = page.context().request;
	const list = await (await context.get('/api/pilots/')).json();
	const url = `/api/pilots/${list.pilots[0].id}`;
	const headers = {
		origin: 'http://127.0.0.1:4175',
		'content-type': 'text/csv'
	};
	const send = async (route: string, data: string) => {
		const response = await context.post(`${url}/${route}/`, { headers, data });
		expect(response.ok(), await response.text()).toBeTruthy();
		return response.json();
	};
	await send('applications', `${csvHeaders}\n${borrower('a-historical')}\n`);
	await page.reload();
	await expect(
		page.getByRole('row').filter({ hasText: 'a-historical' })
	).toContainText('65,000');
	await page.getByRole('button', { name: 'Activate pilot' }).click();
	await expect(page.getByText(/Pilot activated/)).toBeVisible();

	const integration = {
		authorization: 'Bearer integration-e2e-test-key-not-for-production',
		'content-type': 'text/csv'
	};
	const upload = await request.post(`${url}/applications/`, {
		headers: integration,
		data: `${csvHeaders}\n${borrower('a-live')}\n`
	});
	expect(upload.ok(), await upload.text()).toBeTruthy();
	expect(
		(await request.post(`${url}/start/`, { headers: integration })).status()
	).toBe(403);
	const csv = await (
		await request.get(`${url}/assignments.csv/`, { headers: integration })
	).text();
	expect(csv).toContain('"a-live"');
	expect(csv).toMatch(/"a-live".*"(?:control|candidate)"/);
	const outcomes =
		'application_id,funded_amount_kobo,funded_on,first_due_date,first_installment_kobo,paid_by_grace_kobo,observed_on';
	await send(
		'outcomes',
		`${outcomes}\na-live,4000000,${today},${today},2000000,,${today}\n`
	);
	const crossOrigin = await context.post(`${url}/pause/`, {
		headers: { origin: 'https://example.com' },
		data: { paused: true, reason: 'Untrusted' }
	});
	expect(crossOrigin.status()).toBe(403);
	const pause = await context.post(`${url}/pause/`, {
		headers: { origin: headers.origin },
		data: { paused: true, reason: 'Review source system records' }
	});
	expect(pause.ok(), await pause.text()).toBeTruthy();
	await send('applications', `${csvHeaders}\n${borrower('a-later')}\n`);
	await page.reload();
	await page.getByRole('button', { name: 'Repayment monitor' }).click();
	await expect(page.getByText('Hold', { exact: true })).toBeVisible();
	const snapshot = await (await context.get(`${url}/`)).json();
	expect(snapshot.pilot.status).toBe('paused');
	expect(
		snapshot.monitor.control.pending + snapshot.monitor.candidate.pending
	).toBe(1);
	expect(
		snapshot.applications.find((row: { id: string }) => row.id === 'a-later')
	).toMatchObject({ arm: 'routed', assignedOffer: 5_000_000 });
	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page).toHaveURL(/\/session\/login\/$/);
	expect((await context.get('/api/pilots/')).status()).toBe(401);
});
