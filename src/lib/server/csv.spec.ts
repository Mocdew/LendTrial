import { describe, expect, it } from 'vitest';
import {
	APPLICATIONS_CSV_HEADER,
	MAX_CSV_ROWS,
	OUTCOMES_CSV_HEADER,
	parseApplicationsCsv,
	parseOutcomesCsv
} from './csv';

const applications = APPLICATIONS_CSV_HEADER.join(',');
const outcomes = OUTCOMES_CSV_HEADER.join(',');
const application = 'A-01,B-01,6500000,0.08,1,2028-02-29,lightgbm,20261113T114637Z';
const observation = 'A-01,5000000,2028-02-29,2028-03-31,1750000,,2028-03-05';

describe('lender CSV input', () => {
	it('accepts spreadsheet CSV with a BOM, quoted fields and reordered headers', () => {
		const header = APPLICATIONS_CSV_HEADER.toReversed().join(',');
		const row = application
			.split(',')
			.toReversed()
			.map((field) => `"${field}"`)
			.join(',');
		expect(parseApplicationsCsv(`\uFEFF${header}\r\n${row}\r\n\r\n`)).toEqual([
			{
				id: 'A-01',
				borrowerId: 'B-01',
				requestedAmount: 6_500_000,
				referenceRisk: 0.08,
				successfulLoans: 1,
				applicationDate: '2028-02-29',
				modelType: 'lightgbm',
				modelVersion: '20261113T114637Z'
			}
		]);
	});

	it('keeps unknown payments distinct from a confirmed zero balance paid', () => {
		const final = 'A-01,5000000,2028-02-29,2028-03-31,1750000,0,2028-04-08';
		const [pending, missed] = parseOutcomesCsv(`${outcomes}\n${observation}\n${final}`);
		expect(pending).toMatchObject({ applicationId: 'A-01', fundedAmount: 5_000_000, paidByGrace: null });
		expect(missed).toMatchObject({ applicationId: 'A-01', firstInstallment: 1_750_000, paidByGrace: 0 });
	});

	it('accepts a confirmed unfunded offer only with the funding and installment fields blank', () => {
		expect(parseOutcomesCsv(`${outcomes}\nA-01,0,,,,,2028-03-08`)).toEqual([
			{
				applicationId: 'A-01',
				fundedAmount: 0,
				fundedOn: null,
				firstDueDate: null,
				firstInstallment: null,
				paidByGrace: null,
				observedOn: '2028-03-08'
			}
		]);
		expect(() => parseOutcomesCsv(`${outcomes}\nA-01,0,,,,0,2028-03-08`)).toThrow(
			/paid_by_grace_kobo.*leave blank/
		);
		expect(() => parseOutcomesCsv(`${outcomes}\nA-01,1,,,,,2028-03-08`)).toThrow(/funded_on/);
	});

	it.each([
		[application.replace('2028-02-29', '2027-02-29'), /line 2, application_date/],
		[application.replace('6500000', '6.5e6'), /line 2, requested_amount_kobo/],
		[application.replace('0.08', '8%'), /line 2, reference_risk/],
		[application.replace('A-01', '=A-01'), /line 2, application_id/],
		[application.replace('A-01', '"A""-01"'), /line 2, application_id/],
		[application.replace('A-01', '"A-\r\n01"'), /line 2, application_id/],
		[application.replace('A-01', '"A-01"extra'), /line 2 has an unexpected quote/],
		['"A-01', /line 2 has an unclosed quote/]
	])('rejects malformed data with a row and field error', (row, message) => {
		expect(() => parseApplicationsCsv(`${applications}\r\n${row}`)).toThrow(message);
	});

	it('requires known columns and rejects unexpected extra fields', () => {
		expect(() => parseApplicationsCsv(`${applications.replace('borrower_id', 'full_name')}\n${application}`)).toThrow(/header/);
		expect(() => parseApplicationsCsv(`${applications}\n${application},extra`)).toThrow(/too many columns/);
		expect(() => parseApplicationsCsv(`${applications}\n`)).toThrow(/at least one data row/);
	});

	it('rejects conflicting chronology and oversized uploads', () => {
		expect(() => parseOutcomesCsv(`${outcomes}\n${observation.replace('2028-03-31', '2028-02-28')}`)).toThrow(/first_due_date/);
		const batch = `${applications}\n${`${application}\n`.repeat(MAX_CSV_ROWS + 1)}`;
		expect(() => parseApplicationsCsv(batch)).toThrow(/no more than 5000/);
		expect(() => parseApplicationsCsv('x'.repeat(2_000_001))).toThrow(/2 MB/);
	});
});
