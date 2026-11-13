import type { LiveApplication, LiveOutcome } from './lendtrial';

export const MAX_CSV_BYTES = 2_000_000;
export const MAX_CSV_ROWS = 5_000;

const MAX_AMOUNT_KOBO = 1_000_000_000_000;

export const APPLICATIONS_CSV_HEADER = [
	'application_id',
	'borrower_id',
	'requested_amount_kobo',
	'reference_risk',
	'successful_loans',
	'application_date',
	'model_type',
	'model_version'
] as const;

export const OUTCOMES_CSV_HEADER = [
	'application_id',
	'funded_amount_kobo',
	'funded_on',
	'first_due_date',
	'first_installment_kobo',
	'paid_by_grace_kobo',
	'observed_on'
] as const;

export class CsvInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CsvInputError';
	}
}

type CsvRecord = { line: number; values: string[] };

function readRecords(input: string, columns: number): CsvRecord[] {
	if (Buffer.byteLength(input, 'utf8') > MAX_CSV_BYTES) {
		throw new CsvInputError('Upload a CSV file of 2 MB or less.');
	}
	const text = input.replace(/^\uFEFF/, '');
	const records: CsvRecord[] = [];
	let values: string[] = [];
	let field = '';
	let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
	let line = 1;
	let recordLine = 1;

	function finishField() {
		if (values.length === columns) {
			throw new CsvInputError(`CSV line ${recordLine} has too many columns.`);
		}
		values.push(field);
		field = '';
		state = 'start';
	}

	function finishRecord() {
		finishField();
		if (values.length > 1 || values[0].trim() !== '') {
			if (records.length > MAX_CSV_ROWS) {
				throw new CsvInputError(`Upload no more than ${MAX_CSV_ROWS} data rows at a time.`);
			}
			records.push({ line: recordLine, values });
		}
		values = [];
	}

	for (let index = 0; index < text.length; index++) {
		const character = text[index];
		const newline = character === '\n' || character === '\r';
		if (state === 'quoted') {
			if (character === '"') {
				if (text[index + 1] === '"') {
					field += '"';
					index++;
				} else {
					state = 'closed';
				}
			} else {
				field += character;
				if (newline) {
					if (character === '\r' && text[index + 1] === '\n') {
						field += '\n';
						index++;
					}
					line++;
				}
			}
		} else if (character === ',') {
			finishField();
		} else if (newline) {
			finishRecord();
			if (character === '\r' && text[index + 1] === '\n') index++;
			recordLine = ++line;
		} else if (state === 'closed' || (state === 'plain' && character === '"')) {
			throw new CsvInputError(`CSV line ${line} has an unexpected quote or character.`);
		} else if (state === 'start' && character === '"') {
			state = 'quoted';
		} else {
			state = 'plain';
			field += character;
		}
	}
	if (state === 'quoted') throw new CsvInputError(`CSV line ${recordLine} has an unclosed quote.`);
	if (values.length || state !== 'start') finishRecord();
	return records;
}

type ReadField<T extends string> = (column: T) => string;

function parseCsv<TColumn extends string, TRow>(
	text: string,
	expected: readonly TColumn[],
	parseRow: (field: ReadField<TColumn>, line: number) => TRow
): TRow[] {
	const [header, ...rows] = readRecords(text, expected.length);
	const columns = header?.values.map((column) => column.trim());
	if (columns?.length !== expected.length || expected.some((column) => !columns.includes(column))) {
		throw new CsvInputError(`CSV header must contain exactly these columns: ${expected.join(', ')}.`);
	}
	if (!rows.length) throw new CsvInputError('Include at least one data row below the CSV header.');
	const positions = new Map(columns.map((column, index) => [column, index]));
	return rows.map(({ line, values }) => {
		if (values.length !== expected.length) {
			throw new CsvInputError(`CSV line ${line} must contain ${expected.length} columns.`);
		}
		return parseRow((column) => values[positions.get(column)!].trim(), line);
	});
}

function invalid(line: number, column: string, expectation: string): never {
	throw new CsvInputError(`CSV line ${line}, ${column}: ${expectation}.`);
}

function identifier(value: string, line: number, column: string, max = 64): string {
	if (value.length > max || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) {
		invalid(line, column, `use 1–${max} characters starting with a letter or number`);
	}
	return value;
}

function integer(value: string, line: number, column: string, min: number, max: number): number {
	const number = Number(value);
	if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
		invalid(line, column, `use an integer from ${min} to ${max}`);
	}
	return number;
}

function date(value: string, line: number, column: string): string {
	const pattern = /^(?!0000)\d{4}-\d{2}-\d{2}$/;
	const time = pattern.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
	if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
		invalid(line, column, 'use a valid calendar date in YYYY-MM-DD format');
	}
	return value;
}

function risk(value: string, line: number): number {
	if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value)) {
		invalid(line, 'reference_risk', 'use a fraction from 0 to 1, such as 0.08 for 8%');
	}
	return Number(value);
}

export function parseApplicationsCsv(text: string): LiveApplication[] {
	return parseCsv(text, APPLICATIONS_CSV_HEADER, (field, line) => ({
		id: identifier(field('application_id'), line, 'application_id'),
		borrowerId: identifier(field('borrower_id'), line, 'borrower_id'),
		requestedAmount: integer(
			field('requested_amount_kobo'),
			line,
			'requested_amount_kobo',
			1,
			MAX_AMOUNT_KOBO
		),
		referenceRisk: risk(field('reference_risk'), line),
		successfulLoans: integer(field('successful_loans'), line, 'successful_loans', 0, 1_000),
		applicationDate: date(field('application_date'), line, 'application_date'),
		modelType: identifier(field('model_type'), line, 'model_type', 80),
		modelVersion: identifier(field('model_version'), line, 'model_version', 80)
	}));
}

export function parseOutcomesCsv(text: string): LiveOutcome[] {
	return parseCsv(text, OUTCOMES_CSV_HEADER, (field, line) => {
		const applicationId = identifier(field('application_id'), line, 'application_id');
		const fundedAmount = integer(
			field('funded_amount_kobo'),
			line,
			'funded_amount_kobo',
			0,
			MAX_AMOUNT_KOBO
		);
		const observedOn = date(field('observed_on'), line, 'observed_on');
		if (fundedAmount === 0) {
			for (const column of [
				'funded_on',
				'first_due_date',
				'first_installment_kobo',
				'paid_by_grace_kobo'
			] as const) {
				if (field(column) !== '') invalid(line, column, 'leave blank for a confirmed unfunded offer');
			}
			return {
				applicationId,
				fundedAmount,
				fundedOn: null,
				firstDueDate: null,
				firstInstallment: null,
				paidByGrace: null,
				observedOn
			};
		}
		const fundedOn = date(field('funded_on'), line, 'funded_on');
		const firstDueDate = date(field('first_due_date'), line, 'first_due_date');
		if (firstDueDate < fundedOn) invalid(line, 'first_due_date', 'must be on or after funding');
		if (observedOn < fundedOn) invalid(line, 'observed_on', 'must be on or after funding');
		const paid = field('paid_by_grace_kobo');
		return {
			applicationId,
			fundedAmount,
			fundedOn,
			firstDueDate,
			firstInstallment: integer(
				field('first_installment_kobo'),
				line,
				'first_installment_kobo',
				1,
				MAX_AMOUNT_KOBO
			),
			paidByGrace:
				paid === '' ? null : integer(paid, line, 'paid_by_grace_kobo', 0, MAX_AMOUNT_KOBO),
			observedOn
		};
	});
}
