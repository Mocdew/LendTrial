import { createHash, randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MAX_ROWS = 5_000;
const MAX_AMOUNT = 1_000_000_000_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;
const FUNDING_RECONCILIATION_DAYS = 7;

type Arm = 'control' | 'candidate';
type Status = 'draft' | 'active' | 'paused';

export type CreatePilotInput = {
	name: string;
	modelType: string;
	modelVersion: string;
	currentCap: number;
	candidateCap: number;
	maxRisk: number;
	candidateShare: number;
	graceDays: number;
	minMaturedPerArm: number;
	pauseMargin: number;
};

export type Pilot = CreatePilotInput & {
	id: string;
	policyVersion: string;
	status: Status;
	createdAt: string;
	startedAt: string | null;
	pausedAt: string | null;
};

export type LiveApplication = {
	id: string;
	borrowerId: string;
	requestedAmount: number;
	referenceRisk: number;
	successfulLoans: number;
	applicationDate: string;
	modelType: string;
	modelVersion: string;
};

export type LiveOutcome = {
	applicationId: string;
	fundedAmount: number;
	fundedOn: string | null;
	firstDueDate: string | null;
	firstInstallment: number | null;
	paidByGrace: number | null;
	observedOn: string;
};

export type AssignmentRow = LiveApplication & {
	currentOffer: number | null;
	candidateOffer: number | null;
	delta: number;
	reason: string;
	arm: Arm | 'routed' | null;
	plannedArm: Arm | null;
	assignedOffer: number | null;
	assignedAt: string | null;
};

export type ArmMetrics = {
	assigned: number;
	funded: number;
	unfunded: number;
	awaitingFunding: number;
	fundingUnconfirmed: number;
	fundedPrincipal: number;
	pending: number;
	missingOutcome: number;
	matured: number;
	misses: number;
	missRate: number | null;
};

export type AuditRow = {
	id: number;
	action: string;
	detail: string;
	at: string;
};
export type ImportResult = {
	inserted: number;
	updated: number;
	unchanged: number;
};

export class LendTrialError extends Error {
	constructor(
		message: string,
		public readonly status = 400
	) {
		super(message);
		this.name = 'LendTrialError';
	}
}

function invalid(message: string): never {
	throw new LendTrialError(message);
}

function range(value: unknown, min: number, max: number, integer = false): value is number {
	return (
		typeof value === 'number' &&
		Number.isFinite(value) &&
		value >= min &&
		value <= max &&
		(!integer || Number.isSafeInteger(value))
	);
}

function validId(value: unknown, pattern = ID): value is string {
	return typeof value === 'string' && pattern.test(value);
}

function validDate(value: unknown): value is string {
	if (typeof value !== 'string' || !DATE.test(value) || value.startsWith('0000-')) return false;
	const instant = new Date(`${value}T00:00:00.000Z`);
	return Number.isFinite(+instant) && instant.toISOString().slice(0, 10) === value;
}

function isAfterWindow(date: string, start: string, days: number) {
	return (
		Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`) > days * MS_PER_DAY
	);
}

function normalizePilot(input: CreatePilotInput): CreatePilotInput {
	if (
		!input ||
		typeof input.name !== 'string' ||
		!input.name.trim() ||
		input.name.trim().length > 120
	) {
		invalid('Enter a pilot name of up to 120 characters.');
	}
	if (
		!validId(input.modelType, MODEL_ID) ||
		!validId(input.modelVersion, MODEL_ID) ||
		input.modelVersion.toLowerCase() === 'latest'
	) {
		invalid('Enter the reference model type and an exact model version.');
	}
	if (
		!range(input.currentCap, 1, MAX_AMOUNT, true) ||
		!range(input.candidateCap, input.currentCap, MAX_AMOUNT, true)
	) {
		invalid('Caps must be whole kobo and the candidate cap must be at least the current cap.');
	}
	if (
		!range(input.maxRisk, 0, 1) ||
		!range(input.candidateShare, 0.001, 0.999) ||
		!range(input.pauseMargin, 0, 1)
	) {
		invalid(
			'Risk and margin must be fractions from 0 to 1, and candidate share from 0.001 to 0.999.'
		);
	}
	if (!range(input.graceDays, 0, 90, true) || !range(input.minMaturedPerArm, 1, MAX_ROWS, true)) {
		invalid('Grace days must be 0–90 and the minimum mature loans per arm must be 1–5,000.');
	}
	return {
		name: input.name.trim(),
		modelType: input.modelType,
		modelVersion: input.modelVersion,
		currentCap: input.currentCap,
		candidateCap: input.candidateCap,
		maxRisk: input.maxRisk,
		candidateShare: input.candidateShare,
		graceDays: input.graceDays,
		minMaturedPerArm: input.minMaturedPerArm,
		pauseMargin: input.pauseMargin
	};
}

function normalizeApplication(row: LiveApplication, pilot: Pilot, today: string): LiveApplication {
	if (!row || !validId(row.id) || !validId(row.borrowerId))
		invalid('Application and borrower IDs must be valid pseudonymous identifiers.');
	if (
		!range(row.requestedAmount, 1, MAX_AMOUNT, true) ||
		!range(row.referenceRisk, 0, 1) ||
		!range(row.successfulLoans, 0, 1_000, true)
	) {
		invalid(`Application ${row.id} has an invalid amount, risk, or completed-loan count.`);
	}
	if (!validDate(row.applicationDate) || row.applicationDate > today)
		invalid(`Application ${row.id} has an invalid or future application date.`);
	if (row.modelType !== pilot.modelType || row.modelVersion !== pilot.modelVersion)
		invalid(`Application ${row.id} does not use this pilot’s pinned model.`);
	return {
		id: row.id,
		borrowerId: row.borrowerId,
		requestedAmount: row.requestedAmount,
		referenceRisk: row.referenceRisk,
		successfulLoans: row.successfulLoans,
		applicationDate: row.applicationDate,
		modelType: row.modelType,
		modelVersion: row.modelVersion
	};
}

function normalizeOutcome(
	row: LiveOutcome,
	app: AssignmentRow,
	pilot: Pilot,
	today: string
): LiveOutcome {
	if (app.assignedOffer === null || app.assignedAt === null)
		invalid(`Application ${app.id} has no pilot offer.`);
	if (
		!validDate(row.observedOn) ||
		row.observedOn < app.assignedAt.slice(0, 10) ||
		row.observedOn > today
	) {
		invalid(`Application ${app.id} has an invalid observation date.`);
	}
	if (row.fundedAmount === 0) {
		if (
			row.fundedOn !== null ||
			row.firstDueDate !== null ||
			row.firstInstallment !== null ||
			row.paidByGrace !== null
		) {
			invalid(
				`Unfunded application ${app.id} must leave funding, schedule, and payment fields blank.`
			);
		}
		return {
			applicationId: app.id,
			fundedAmount: 0,
			fundedOn: null,
			firstDueDate: null,
			firstInstallment: null,
			paidByGrace: null,
			observedOn: row.observedOn
		};
	}
	if (
		!range(row.fundedAmount, 1, app.assignedOffer, true) ||
		!range(row.firstInstallment, 1, MAX_AMOUNT, true) ||
		(row.paidByGrace !== null && !range(row.paidByGrace, 0, MAX_AMOUNT, true))
	) {
		invalid(`Application ${app.id} has invalid funding or first-payment amounts.`);
	}
	if (
		!validDate(row.fundedOn) ||
		!validDate(row.firstDueDate) ||
		row.fundedOn < app.assignedAt.slice(0, 10) ||
		row.firstDueDate < row.fundedOn ||
		row.observedOn < row.fundedOn
	) {
		invalid(`Application ${app.id} has invalid funding, due, or observation dates.`);
	}
	if (
		row.paidByGrace !== null &&
		!isAfterWindow(row.observedOn, row.firstDueDate, pilot.graceDays)
	) {
		invalid(
			`Application ${app.id} cannot have a final payment total before the grace date closes.`
		);
	}
	return {
		applicationId: app.id,
		fundedAmount: row.fundedAmount,
		fundedOn: row.fundedOn,
		firstDueDate: row.firstDueDate,
		firstInstallment: row.firstInstallment,
		paidByGrace: row.paidByGrace,
		observedOn: row.observedOn
	};
}

function replayRow(app: LiveApplication, pilot: Pilot): AssignmentRow {
	const eligible = app.successfulLoans > 0 && app.referenceRisk <= pilot.maxRisk;
	const currentOffer = eligible ? Math.min(app.requestedAmount, pilot.currentCap) : null;
	const candidateOffer = eligible ? Math.min(app.requestedAmount, pilot.candidateCap) : null;
	const delta = (candidateOffer ?? 0) - (currentOffer ?? 0);
	let reason = 'Offer unchanged';
	if (app.successfulLoans === 0) reason = 'No completed loan';
	else if (!eligible) reason = 'Above reference risk cutoff';
	else if (delta > 0) reason = 'Higher cap raises offer';
	return {
		...app,
		currentOffer,
		candidateOffer,
		delta,
		reason,
		arm: null,
		plannedArm: null,
		assignedOffer: null,
		assignedAt: null
	};
}

function plannedArm(salt: string, borrowerId: string, candidateShare: number): Arm {
	const point = createHash('sha256')
		.update(salt)
		.update(':')
		.update(borrowerId)
		.digest()
		.readUInt32BE(0);
	return point / 2 ** 32 < candidateShare ? 'candidate' : 'control';
}

function emptyArm(): ArmMetrics {
	return {
		assigned: 0,
		funded: 0,
		unfunded: 0,
		awaitingFunding: 0,
		fundingUnconfirmed: 0,
		fundedPrincipal: 0,
		pending: 0,
		missingOutcome: 0,
		matured: 0,
		misses: 0,
		missRate: null
	};
}

function measure(
	row: AssignmentRow,
	outcome: LiveOutcome | undefined,
	metrics: ArmMetrics,
	pilot: Pilot,
	asOf: string
) {
	metrics.assigned++;
	if (!outcome) {
		const assignedOn = row.assignedAt!.slice(0, 10);
		if (isAfterWindow(asOf, assignedOn, FUNDING_RECONCILIATION_DAYS)) metrics.fundingUnconfirmed++;
		else metrics.awaitingFunding++;
		return;
	}
	if (outcome.firstDueDate === null || outcome.firstInstallment === null) {
		metrics.unfunded++;
		return;
	}
	metrics.funded++;
	metrics.fundedPrincipal += outcome.fundedAmount;
	if (!isAfterWindow(asOf, outcome.firstDueDate, pilot.graceDays)) {
		metrics.pending++;
	} else if (outcome.paidByGrace === null) {
		metrics.missingOutcome++;
	} else {
		metrics.matured++;
		if (outcome.paidByGrace < outcome.firstInstallment) metrics.misses++;
	}
}

function gate(
	pilot: Pilot,
	control: ArmMetrics,
	candidate: ArmMetrics,
	missRateDelta: number | null,
	asOf: string
) {
	if (pilot.startedAt === null || pilot.startedAt.slice(0, 10) > asOf)
		return {
			decision: 'hold',
			reason: 'Start the pilot to assign live applications.'
		} as const;
	if (control.missingOutcome + candidate.missingOutcome > 0) {
		return {
			decision: 'hold',
			reason: 'Import verified payment totals for funded loans past the grace date.'
		} as const;
	}
	if (
		control.matured < pilot.minMaturedPerArm ||
		candidate.matured < pilot.minMaturedPerArm ||
		missRateDelta === null
	) {
		return {
			decision: 'hold',
			reason: `Wait for at least ${pilot.minMaturedPerArm} verified mature loans in each arm.`
		} as const;
	}
	if (missRateDelta - pilot.pauseMargin > Number.EPSILON) {
		return {
			decision: 'pause',
			reason: 'The candidate miss rate exceeds the configured gap.'
		} as const;
	}
	if (control.fundingUnconfirmed + candidate.fundingUnconfirmed > 0) {
		return {
			decision: 'hold',
			reason: 'Reconcile the funding status of assignments more than seven days old.'
		} as const;
	}
	return {
		decision: 'continue',
		reason: 'The observed gap is within the configured limit.'
	} as const;
}

export function openLendTrial(path: string, now: () => Date = () => new Date()) {
	if (path !== ':memory:') {
		mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
		closeSync(openSync(path, 'a', 0o600));
	}
	const db = new DatabaseSync(path);
	db.exec(`
		PRAGMA busy_timeout = 5000;
		PRAGMA foreign_keys = ON;
		PRAGMA journal_mode = WAL;
		CREATE TABLE IF NOT EXISTS pilots (
			id TEXT PRIMARY KEY, created_at TEXT NOT NULL, salt TEXT NOT NULL, payload TEXT NOT NULL
		) STRICT;
		CREATE TABLE IF NOT EXISTS applications (
			pilot_id TEXT NOT NULL REFERENCES pilots(id), id TEXT NOT NULL, borrower_id TEXT NOT NULL,
			assigned_at TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (pilot_id, id)
		) STRICT;
		CREATE UNIQUE INDEX IF NOT EXISTS borrower_enrollment ON applications(pilot_id, borrower_id)
			WHERE assigned_at IS NOT NULL;
		CREATE TABLE IF NOT EXISTS outcomes (
			pilot_id TEXT NOT NULL, application_id TEXT NOT NULL, observed_on TEXT NOT NULL,
			payload TEXT NOT NULL, PRIMARY KEY (pilot_id, application_id, observed_on),
			FOREIGN KEY (pilot_id, application_id) REFERENCES applications(pilot_id, id)
		) STRICT;
		CREATE TABLE IF NOT EXISTS audit (
			id INTEGER PRIMARY KEY, pilot_id TEXT NOT NULL REFERENCES pilots(id), action TEXT NOT NULL,
			detail TEXT NOT NULL, at TEXT NOT NULL
		) STRICT;
		CREATE INDEX IF NOT EXISTS audit_by_pilot ON audit(pilot_id, id);
	`);

	function transaction<T>(run: () => T, mode: 'IMMEDIATE' | 'DEFERRED' = 'IMMEDIATE'): T {
		db.exec(`BEGIN ${mode}`);
		try {
			const result = run();
			db.exec('COMMIT');
			return result;
		} catch (error) {
			db.exec('ROLLBACK');
			throw error;
		}
	}

	const auditInsert = db.prepare(
		'INSERT INTO audit(pilot_id, action, detail, at) VALUES (?, ?, ?, ?)'
	);
	const pilotFind = db.prepare('SELECT payload, salt FROM pilots WHERE id = ?');
	const pilotUpdate = db.prepare('UPDATE pilots SET payload = ? WHERE id = ?');
	const appFind = db.prepare('SELECT payload FROM applications WHERE pilot_id = ? AND id = ?');
	const appInsert = db.prepare(
		'INSERT INTO applications(pilot_id, id, borrower_id, assigned_at, created_at, payload) VALUES (?, ?, ?, ?, ?, ?)'
	);
	const outcomeLatest = db.prepare(
		'SELECT payload FROM outcomes WHERE pilot_id = ? AND application_id = ? ORDER BY observed_on DESC LIMIT 1'
	);
	const outcomeFind = db.prepare(
		'SELECT payload FROM outcomes WHERE pilot_id = ? AND application_id = ? AND observed_on = ?'
	);
	const outcomeInsert = db.prepare(
		'INSERT INTO outcomes(pilot_id, application_id, observed_on, payload) VALUES (?, ?, ?, ?)'
	);
	const enrolled = db.prepare(
		'SELECT 1 FROM applications WHERE pilot_id = ? AND borrower_id = ? AND assigned_at IS NOT NULL'
	);
	const countApplications = db.prepare(
		'SELECT COUNT(*) AS total FROM applications WHERE pilot_id = ?'
	);

	function findPilot(id: string) {
		const found = pilotFind.get(id);
		if (!found) throw new LendTrialError('Pilot not found.', 404);
		return {
			pilot: JSON.parse(found.payload as string) as Pilot,
			salt: found.salt as string
		};
	}

	function audit(id: string, action: string, detail: string, at: string) {
		auditInsert.run(id, action, detail, at);
	}

	function allApplications(id: string) {
		return db
			.prepare('SELECT payload FROM applications WHERE pilot_id = ? ORDER BY rowid')
			.all(id)
			.map((row) => JSON.parse(row.payload as string) as AssignmentRow);
	}

	return {
		close() {
			db.close();
		},
		listPilots(): Pilot[] {
			return db
				.prepare('SELECT payload FROM pilots ORDER BY created_at DESC, id')
				.all()
				.map((row) => JSON.parse(row.payload as string) as Pilot);
		},
		createPilot(input: CreatePilotInput): Pilot {
			const config = normalizePilot(input);
			return transaction(() => {
				const createdAt = now().toISOString();
				const id = randomUUID();
				const policyVersion = `v1-${createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 12)}`;
				const pilot: Pilot = {
					...config,
					id,
					policyVersion,
					status: 'draft',
					createdAt,
					startedAt: null,
					pausedAt: null
				};
				db.prepare('INSERT INTO pilots(id, created_at, salt, payload) VALUES (?, ?, ?, ?)').run(
					id,
					createdAt,
					randomUUID(),
					JSON.stringify(pilot)
				);
				audit(
					id,
					'created',
					`Policy ${policyVersion} uses ${config.modelType} ${config.modelVersion}.`,
					createdAt
				);
				return pilot;
			});
		},
		startPilot(id: string): Pilot {
			return transaction(() => {
				const { pilot } = findPilot(id);
				if (pilot.status !== 'draft')
					throw new LendTrialError('This pilot has already started.', 409);
				pilot.status = 'active';
				pilot.startedAt = now().toISOString();
				pilotUpdate.run(JSON.stringify(pilot), id);
				audit(
					id,
					'started',
					'New eligible applications can receive a pilot offer.',
					pilot.startedAt
				);
				return pilot;
			});
		},
		setPaused(id: string, paused: boolean, reason: string): Pilot {
			if (
				typeof paused !== 'boolean' ||
				typeof reason !== 'string' ||
				!reason.trim() ||
				reason.trim().length > 300
			) {
				invalid('Enter a reason of up to 300 characters.');
			}
			return transaction(() => {
				const { pilot } = findPilot(id);
				if (pilot.status === 'draft')
					throw new LendTrialError('Start the pilot before pausing it.', 409);
				const status = paused ? 'paused' : 'active';
				if (pilot.status === status) return pilot;
				const at = now().toISOString();
				pilot.status = status;
				pilot.pausedAt = paused ? at : null;
				pilotUpdate.run(JSON.stringify(pilot), id);
				audit(id, paused ? 'paused' : 'resumed', reason.trim(), at);
				return pilot;
			});
		},
		importApplications(id: string, rows: LiveApplication[]): ImportResult {
			if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_ROWS)
				invalid('Provide 1–5,000 applications.');
			return transaction(() => {
				const { pilot, salt } = findPilot(id);
				const at = now().toISOString();
				const today = at.slice(0, 10);
				const total = countApplications.get(id)?.total as number;
				const result = { inserted: 0, updated: 0, unchanged: 0 };
				const applications = rows
					.map((row) => normalizeApplication(row, pilot, today))
					.sort(
						(a, b) => a.applicationDate.localeCompare(b.applicationDate) || a.id.localeCompare(b.id)
					);
				for (const app of applications) {
					const found = appFind.get(id, app.id);
					if (found) {
						const stored = JSON.parse(found.payload as string) as AssignmentRow;
						if (
							JSON.stringify(app) !== JSON.stringify(normalizeApplication(stored, pilot, today))
						) {
							throw new LendTrialError(
								`Application ${app.id} already exists with different inputs.`,
								409
							);
						}
						result.unchanged++;
						continue;
					}
					if (total + result.inserted >= MAX_ROWS)
						invalid('A pilot can store up to 5,000 applications.');
					const row = replayRow(app, pilot);
					if (
						row.delta > 0 &&
						pilot.startedAt !== null &&
						row.applicationDate >= pilot.startedAt.slice(0, 10)
					) {
						if (enrolled.get(id, row.borrowerId)) {
							row.reason = 'Borrower already enrolled';
						} else {
							row.plannedArm = plannedArm(salt, row.borrowerId, pilot.candidateShare);
							row.arm = pilot.status === 'paused' ? 'routed' : row.plannedArm;
							row.assignedOffer = row.arm === 'candidate' ? row.candidateOffer : row.currentOffer;
							row.assignedAt = at;
							if (row.arm === 'routed') row.reason = 'Current cap applied during pause';
						}
					}
					appInsert.run(id, row.id, row.borrowerId, row.assignedAt, at, JSON.stringify(row));
					result.inserted++;
				}
				if (result.inserted)
					audit(
						id,
						'applications_imported',
						`${result.inserted} added; ${result.unchanged} already recorded.`,
						at
					);
				return result;
			});
		},
		importOutcomes(id: string, rows: LiveOutcome[]): ImportResult {
			if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_ROWS)
				invalid('Provide 1–5,000 outcomes.');
			return transaction(() => {
				const { pilot } = findPilot(id);
				const at = now().toISOString();
				const today = at.slice(0, 10);
				const result = { inserted: 0, updated: 0, unchanged: 0 };
				const outcomes = rows
					.map((row) => {
						if (!row || !validId(row.applicationId))
							invalid('Each outcome needs a valid application ID.');
						const found = appFind.get(id, row.applicationId);
						if (!found) invalid(`Unknown application ${row.applicationId}.`);
						return normalizeOutcome(
							row,
							JSON.parse(found.payload as string) as AssignmentRow,
							pilot,
							today
						);
					})
					.sort((a, b) => a.observedOn.localeCompare(b.observedOn));
				for (const row of outcomes) {
					const payload = JSON.stringify(row);
					const found = outcomeFind.get(id, row.applicationId, row.observedOn);
					if (found) {
						if (found.payload !== payload)
							throw new LendTrialError(
								`Outcome ${row.applicationId} already has different inputs for ${row.observedOn}.`,
								409
							);
						result.unchanged++;
						continue;
					}
					const latest = outcomeLatest.get(id, row.applicationId);
					if (latest) {
						const previous = JSON.parse(latest.payload as string) as LiveOutcome;
						if (previous.observedOn > row.observedOn)
							throw new LendTrialError(
								`Outcome ${row.applicationId} is older than its latest observation.`,
								409
							);
						if (previous.paidByGrace !== null && row.paidByGrace === null)
							invalid(`Outcome ${row.applicationId} cannot remove a verified payment total.`);
						if (previous.fundedAmount > 0 && row.fundedAmount === 0)
							invalid(
								`Outcome ${row.applicationId} cannot replace a funded loan with an unfunded record.`
							);
						if (
							previous.fundedAmount === 0 &&
							row.fundedOn !== null &&
							row.fundedOn <= previous.observedOn
						) {
							invalid(
								`Outcome ${row.applicationId} must be funded after its last unfunded observation.`
							);
						}
						result.updated++;
					} else result.inserted++;
					outcomeInsert.run(id, row.applicationId, row.observedOn, payload);
				}
				if (result.inserted + result.updated)
					audit(
						id,
						'outcomes_imported',
						`${result.inserted} first observations; ${result.updated} newer observations; ${result.unchanged} unchanged.`,
						at
					);
				return result;
			});
		},
		exportAssignments(id: string): AssignmentRow[] {
			findPilot(id);
			return allApplications(id);
		},
		getPilot(id: string, asOf = now().toISOString().slice(0, 10)) {
			if (!validDate(asOf) || asOf > now().toISOString().slice(0, 10))
				invalid('Choose a valid observation date up to today.');
			return transaction(() => {
				const { pilot } = findPilot(id);
				const applications = allApplications(id);
				const replay = {
					applications: applications.length,
					eligible: 0,
					changed: 0,
					currentPrincipal: 0,
					candidatePrincipal: 0,
					additionalPrincipal: 0
				};
				const control = emptyArm();
				const candidate = emptyArm();
				let redirected = 0;
				let routedToCurrent = 0;
				const outcomeRows = db
					.prepare(
						`
					SELECT current.payload FROM outcomes AS current
					JOIN (
						SELECT application_id, MAX(observed_on) AS latest_on FROM outcomes
						WHERE pilot_id = ? AND observed_on <= ? GROUP BY application_id
					) AS latest ON current.application_id = latest.application_id AND current.observed_on = latest.latest_on
					WHERE current.pilot_id = ?
				`
					)
					.all(id, asOf, id);
				const outcomes = new Map(
					outcomeRows.map((row) => {
						const outcome = JSON.parse(row.payload as string) as LiveOutcome;
						return [outcome.applicationId, outcome];
					})
				);
				for (const row of applications) {
					if (row.currentOffer !== null) replay.eligible++;
					if (row.delta > 0) replay.changed++;
					replay.currentPrincipal += row.currentOffer ?? 0;
					replay.candidatePrincipal += row.candidateOffer ?? 0;
					replay.additionalPrincipal += row.delta;
					if (row.assignedAt === null || row.assignedAt.slice(0, 10) > asOf) continue;
					if (row.arm === 'routed') {
						routedToCurrent++;
						if (row.plannedArm === 'candidate') redirected++;
					} else if (row.arm === 'control' || row.arm === 'candidate') {
						measure(
							row,
							outcomes.get(row.id),
							row.arm === 'control' ? control : candidate,
							pilot,
							asOf
						);
					}
				}
				for (const arm of [control, candidate])
					if (arm.matured) arm.missRate = arm.misses / arm.matured;
				const missRateDelta =
					control.missRate === null || candidate.missRate === null
						? null
						: candidate.missRate - control.missRate;
				const recommendation = gate(pilot, control, candidate, missRateDelta, asOf);
				const auditRows = db
					.prepare(
						'SELECT id, action, detail, at FROM audit WHERE pilot_id = ? ORDER BY id DESC LIMIT 100'
					)
					.all(id) as AuditRow[];
				return {
					pilot,
					replay,
					monitor: {
						asOf,
						control,
						candidate,
						redirected,
						routedToCurrent,
						missRateDelta,
						...recommendation
					},
					applications,
					audit: auditRows
				};
			}, 'DEFERRED');
		}
	};
}

export type LendTrialStore = ReturnType<typeof openLendTrial>;
export type PilotDetail = ReturnType<LendTrialStore['getPilot']>;
