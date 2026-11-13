import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const path = `${process.env.BASE_PATH || ''}/`;

test('replays a cap, exports the audit and inspects the rollout', async ({ page }) => {
	await page.goto(path);
	await expect(page).toHaveTitle('LendTrial');
	await expect(page.getByRole('heading', { level: 1, name: 'LendTrial' })).toBeVisible();
	const cap = page.getByRole('slider', { name: 'Candidate cap' });
	await cap.press('Home');
	await expect(page.getByText('No offers change at this cap', { exact: false })).toBeVisible();
	await cap.press('End');
	await expect(page.getByRole('table', { name: '' })).toBeVisible();

	const downloaded = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download CSV' }).click();
	const download = await downloaded;
	expect(download.suggestedFilename()).toBe('lendtrial-100000.csv');
	const csv = await readFile((await download.path())!, 'utf8');
	expect(csv.split('\r\n')[0]).toContain('candidate_offer_naira');
	expect(csv).toContain('"synthetic-demo"');

	await cap.press('Home');
	for (let step = 0; step < 5; step++) await cap.press('ArrowRight');
	await page.getByRole('button', { name: 'After launch' }).click();
	const day = page.getByRole('slider', { name: 'Days into rollout' });
	await day.press('Home');
	await expect(page.getByText('Wait', { exact: true })).toBeVisible();
	await day.press('End');
	await page.getByLabel('Repayment scenario').selectOption('adverse');
	await expect(page.getByText('Pause', { exact: true })).toBeVisible();
	await expect(page.getByText(/18 would have received the candidate cap/)).toBeVisible();
	await page.getByLabel('Repayment scenario').selectOption('neutral');
	await expect(page.getByText('Continue', { exact: true })).toBeVisible();
});

test('a score file drives replay locally and preserves its provenance in the export', async ({
	page
}) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto(path);
	await page.getByText('Load Can I borrow.ai scores', { exact: true }).click();
	await page.getByRole('button', { name: 'Load scored sample' }).click();
	await expect(page.getByText('Loaded 2,400 scored applications from the sample.')).toBeVisible();
	await expect(page.getByText(/Imported · lightgbm/)).toBeVisible();
	const input = page.getByLabel('Score export (JSON)');
	await input.setInputFiles({
		name: 'broken.json',
		mimeType: 'application/json',
		buffer: Buffer.from('{}')
	});
	await expect(page.getByText(/Import failed/)).toBeVisible();

	await input.setInputFiles({
		name: 'scores.json',
		mimeType: 'application/json',
		buffer: Buffer.from(
			JSON.stringify({
				schemaVersion: 1,
				model: { type: 'lightgbm', version: 'fixture-1' },
				applications: [
					{
						id: 'a-1',
						borrowerId: 'b-1',
						requestedAmount: 65_000,
						referenceRisk: 0.1,
						successfulLoans: 2,
						applicationDay: 0
					}
				]
			})
		)
	});
	await expect(page.getByText('Loaded 1 scored application.')).toBeVisible();
	await expect(page.getByRole('row').filter({ hasText: 'a-1' })).toContainText('65,000');
	const downloaded = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download CSV' }).click();
	const csv = await readFile((await (await downloaded).path())!, 'utf8');
	expect(csv).toContain('"lightgbm","fixture-1"');
	await page.getByRole('button', { name: 'Restore demo cohort' }).click();
	await expect(page.getByText('Restored the synthetic demo cohort.')).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
});
