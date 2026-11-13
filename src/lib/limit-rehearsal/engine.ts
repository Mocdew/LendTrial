export const MAX_APPLICATIONS = 5_000;
export const MAX_APPLICATION_DAY = 60;
export const MAX_CHECKPOINT_DAY = 120;
export const GRACE_DAYS = 7;

const MAX_AMOUNT = 1_000_000_000;
const ACCEPTANCE_DELAY = 1;
const FUNDING_DELAY = 2;
const FIRST_INSTALLMENT_DELAY = 28;
const FOLLOW_UP_DAYS = ACCEPTANCE_DELAY + FUNDING_DELAY + FIRST_INSTALLMENT_DELAY + GRACE_DAYS;

export type Application = {
	id: string;
	borrowerId: string;
	requestedAmount: number;
	referenceRisk: number;
	successfulLoans: number;
	applicationDay: number;
};

export type PolicyConfig = {
	currentCap: number;
	candidateCap: number;
	maxRisk: number;
};

export type ReplayRow = Application & {
	currentOffer: number | null;
	candidateOffer: number | null;
	delta: number;
	reason: string;
};

export type ReplayResult = {
	config: PolicyConfig;
	cohortFingerprint: string;
	rows: ReplayRow[];
	summary: {
		applications: number;
		eligible: number;
		changed: number;
		currentPrincipal: number;
		candidatePrincipal: number;
		additionalPrincipal: number;
	};
};

export type Scenario = 'neutral' | 'adverse';

export type RolloutConfig = {
	scenario: Scenario;
	seed: number;
	candidateShare: number;
	checkpointDay: number;
	decisionDay: number;
	minMaturedPerArm: number;
	pauseMargin: number;
};

type Arm = 'control' | 'candidate';

export type RolloutRow = {
	borrowerId: string;
	applicationId: string;
	arm: Arm;
	offer: number;
	assignedDay: number;
	acceptedDay: number | null;
	fundedDay: number | null;
	firstDueDay: number | null;
	graceEndDay: number | null;
	firstInstallment: number | null;
	firstPayments: { day: number; amount: number }[];
	followedUp: boolean;
	missed: boolean | null;
};

export type ArmMetrics = {
	assigned: number;
	followedUp: number;
	accepted: number;
	funded: number;
	fundedPrincipal: number;
	pending: number;
	matured: number;
	misses: number;
	missRate: number | null;
	missesPerAssigned: number | null;
};

export type RolloutResult = {
	config: RolloutConfig;
	control: ArmMetrics;
	candidate: ArmMetrics;
	decision: 'wait' | 'continue' | 'pause';
	missRateDelta: number | null;
	gateControl: ArmMetrics | null;
	gateCandidate: ArmMetrics | null;
	gateMissRateDelta: number | null;
	redirected: number;
	routedToCurrent: number;
	fallbackRows: RolloutRow[];
	rows: RolloutRow[];
};

export const DEFAULT_POLICY: Readonly<PolicyConfig> = Object.freeze({
	currentCap: 50_000,
	candidateCap: 75_000,
	maxRisk: 0.25
});

export const DEFAULT_ROLLOUT: Readonly<RolloutConfig> = Object.freeze({
	scenario: 'adverse',
	seed: 1_908,
	candidateShare: 0.2,
	checkpointDay: 75,
	decisionDay: 54,
	minMaturedPerArm: 40,
	pauseMargin: 0.05
});

function hash(value: string) {
	let state = 2_166_136_261;
	for (let index = 0; index < value.length; index++) {
		state = Math.imul(state ^ value.charCodeAt(index), 16_777_619);
	}
	state = Math.imul(state ^ (state >>> 16), 0x85ebca6b);
	state = Math.imul(state ^ (state >>> 13), 0xc2b2ae35);
	return (state ^ (state >>> 16)) >>> 0;
}

function draw(seed: number, key: string, stream: string) {
	return hash(`${seed}:${key}:${stream}`) / 2 ** 32;
}

function numberInRange(value: unknown, min: number, max: number, integer = false): value is number {
	return (
		typeof value === 'number' &&
		Number.isFinite(value) &&
		value >= min &&
		value <= max &&
		(!integer || Number.isInteger(value))
	);
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function validateApplications(applications: unknown): asserts applications is Application[] {
	if (!Array.isArray(applications) || applications.length > MAX_APPLICATIONS) {
		throw new RangeError(`Provide an application array with at most ${MAX_APPLICATIONS} rows.`);
	}
	const ids = new Set<string>();
	for (const [index, row] of applications.entries()) {
		const label = `Application row ${index + 1}`;
		if (typeof row !== 'object' || row === null) throw new TypeError(`${label} must be an object.`);
		if (
			typeof row.id !== 'string' ||
			!identifier.test(row.id) ||
			typeof row.borrowerId !== 'string' ||
			!identifier.test(row.borrowerId)
		) {
			throw new RangeError(`${label} needs valid id and borrowerId values.`);
		}
		if (ids.has(row.id)) throw new RangeError(`${label} repeats an application ID.`);
		if (!numberInRange(row.requestedAmount, 1, MAX_AMOUNT, true)) {
			throw new RangeError(`${label} needs a positive, whole-naira requestedAmount.`);
		}
		if (!numberInRange(row.referenceRisk, 0, 1)) {
			throw new RangeError(`${label} needs a referenceRisk from 0 to 1.`);
		}
		if (!numberInRange(row.successfulLoans, 0, 1_000, true)) {
			throw new RangeError(`${label} needs a whole successfulLoans count from 0 to 1,000.`);
		}
		if (!numberInRange(row.applicationDay, 0, MAX_APPLICATION_DAY, true)) {
			throw new RangeError(
				`${label} needs a whole applicationDay from 0 to ${MAX_APPLICATION_DAY}.`
			);
		}
		ids.add(row.id);
	}
}

export function createDemoApplications(seed = 2_026, count = 1_800): Application[] {
	if (
		!numberInRange(seed, 0, 0xffffffff, true) ||
		!numberInRange(count, 0, MAX_APPLICATIONS, true)
	) {
		throw new RangeError('Choose a valid whole-number seed and cohort size.');
	}
	return Array.from({ length: count }, (_, index) => {
		const key = String(index + 1).padStart(4, '0');
		const successfulLoans = Math.floor(draw(seed, key, 'history') * 7);
		return {
			id: `A-${key}`,
			borrowerId: `B-${key}`,
			requestedAmount: 35_000 + 5_000 * Math.floor(draw(seed, key, 'amount') * 15),
			// A synthetic reference score in the same shape as a default probability.
			referenceRisk: Math.round((0.025 + 0.35 * draw(seed, key, 'risk') ** 1.7) * 1e4) / 1e4,
			successfulLoans,
			// Spread arrivals through the decision and give the demo post-decision offers to reroute.
			applicationDay: Math.floor((Math.floor(draw(seed, key, 'day') * 56) * 61) / 56)
		};
	});
}

export function replayPolicies(
	applications: Application[],
	config: PolicyConfig = DEFAULT_POLICY
): ReplayResult {
	validateApplications(applications);
	const { currentCap, candidateCap, maxRisk } = config;
	if (
		!numberInRange(currentCap, 1, MAX_AMOUNT, true) ||
		!numberInRange(candidateCap, 1, MAX_AMOUNT, true) ||
		!numberInRange(maxRisk, 0, 1)
	) {
		throw new RangeError(
			'Policy caps must be positive whole naira and the risk cutoff must be 0–1.'
		);
	}
	const summary = {
		applications: applications.length,
		eligible: 0,
		changed: 0,
		currentPrincipal: 0,
		candidatePrincipal: 0,
		additionalPrincipal: 0
	};
	const rows = applications.map((application): ReplayRow => {
		const { id, borrowerId, requestedAmount, referenceRisk, successfulLoans, applicationDay } =
			application;
		const row = { id, borrowerId, requestedAmount, referenceRisk, successfulLoans, applicationDay };
		if (successfulLoans === 0) {
			return {
				...row,
				currentOffer: null,
				candidateOffer: null,
				delta: 0,
				reason: 'No completed loan'
			};
		}
		if (referenceRisk > maxRisk) {
			return {
				...row,
				currentOffer: null,
				candidateOffer: null,
				delta: 0,
				reason: 'Above risk cutoff'
			};
		}
		const currentOffer = Math.min(requestedAmount, currentCap);
		const candidateOffer = Math.min(requestedAmount, candidateCap);
		const delta = candidateOffer - currentOffer;
		summary.eligible++;
		if (delta !== 0) summary.changed++;
		summary.currentPrincipal += currentOffer;
		summary.candidatePrincipal += candidateOffer;
		summary.additionalPrincipal += delta;
		let reason = 'Offer unchanged';
		if (delta > 0) reason = 'Higher cap raises offer';
		if (delta < 0) reason = 'Lower cap reduces offer';
		return { ...row, currentOffer, candidateOffer, delta, reason };
	});
	const fingerprintInput = applications.map(
		({ id, borrowerId, requestedAmount, referenceRisk, successfulLoans, applicationDay }) => [
			id,
			borrowerId,
			requestedAmount,
			referenceRisk,
			successfulLoans,
			applicationDay
		]
	);
	return {
		config: { currentCap, candidateCap, maxRisk },
		cohortFingerprint: hash(JSON.stringify(fingerprintInput)).toString(16).padStart(8, '0'),
		rows,
		summary
	};
}

function simulateBorrower(
	row: ReplayRow,
	arm: Arm,
	config: RolloutConfig,
	checkpointDay = config.checkpointDay
): RolloutRow {
	const { seed, scenario } = config;
	const { borrowerId, applicationDay, referenceRisk, delta } = row;
	// simulateRollout enrolls only borrowers with offers under both policies.
	const offer = (arm === 'candidate' ? row.candidateOffer : row.currentOffer)!;
	const accepted = draw(seed, borrowerId, 'acceptance') < 0.84 - 0.22 * referenceRisk;
	const acceptanceDay = applicationDay + ACCEPTANCE_DELAY;
	const fundingDay = acceptanceDay + FUNDING_DELAY;
	const dueDay = fundingDay + FIRST_INSTALLMENT_DELAY;
	const graceDay = dueDay + GRACE_DAYS;
	const installment = Math.ceil(offer / 3);
	// The reference risk contributes to a separately defined synthetic payment process.
	const baseMissChance = 0.04 + 0.28 * referenceRisk;
	let addedMissChance = 0;
	if (arm === 'candidate' && scenario === 'adverse') {
		addedMissChance = Math.min(0.3, Math.max(0, delta) * (0.24 / 25_000));
	}
	const misses = draw(seed, borrowerId, 'repayment') < baseMissChance + addedMissChance;
	const payments: RolloutRow['firstPayments'] = [];
	if (accepted && misses) {
		if (installment > 1 && draw(seed, borrowerId, 'partial-payment') < 0.55) {
			payments.push({ day: dueDay, amount: Math.floor(installment / 2) });
		}
		if (draw(seed, borrowerId, 'late-payment') < 0.65) {
			payments.push({ day: graceDay + 5, amount: installment - (payments[0]?.amount ?? 0) });
		}
	} else if (accepted) {
		payments.push({
			day: dueDay + Math.floor(draw(seed, borrowerId, 'payment-day') * (GRACE_DAYS + 1)),
			amount: installment
		});
	}
	const firstPayments = payments.filter((payment) => payment.day <= checkpointDay);
	const paidByGrace = firstPayments.reduce(
		(total, payment) => total + (payment.day <= graceDay ? payment.amount : 0),
		0
	);
	const funded = accepted && fundingDay <= checkpointDay;
	const followedUp = applicationDay + FOLLOW_UP_DAYS <= checkpointDay;
	return {
		borrowerId,
		applicationId: row.id,
		arm,
		offer,
		assignedDay: applicationDay,
		acceptedDay: accepted && acceptanceDay <= checkpointDay ? acceptanceDay : null,
		fundedDay: funded ? fundingDay : null,
		firstDueDay: funded ? dueDay : null,
		graceEndDay: funded ? graceDay : null,
		firstInstallment: funded ? installment : null,
		firstPayments,
		followedUp,
		missed: funded && followedUp ? paidByGrace < installment : null
	};
}

function measureArm(rows: RolloutRow[], arm: Arm): ArmMetrics {
	const metrics: ArmMetrics = {
		assigned: 0,
		followedUp: 0,
		accepted: 0,
		funded: 0,
		fundedPrincipal: 0,
		pending: 0,
		matured: 0,
		misses: 0,
		missRate: null,
		missesPerAssigned: null
	};
	for (const row of rows) {
		if (row.arm !== arm) continue;
		metrics.assigned++;
		if (row.followedUp) metrics.followedUp++;
		if (row.acceptedDay !== null) metrics.accepted++;
		if (row.fundedDay === null) continue;
		metrics.funded++;
		metrics.fundedPrincipal += row.offer;
		if (row.missed === null) {
			metrics.pending++;
		} else {
			metrics.matured++;
			if (row.missed) metrics.misses++;
		}
	}
	if (metrics.matured > 0) metrics.missRate = metrics.misses / metrics.matured;
	if (metrics.followedUp > 0) metrics.missesPerAssigned = metrics.misses / metrics.followedUp;
	return metrics;
}

export function simulateRollout(
	replay: ReplayResult,
	config: RolloutConfig = DEFAULT_ROLLOUT
): RolloutResult {
	const {
		scenario,
		seed,
		candidateShare,
		checkpointDay,
		decisionDay,
		minMaturedPerArm,
		pauseMargin
	} = config;
	if (
		(scenario !== 'neutral' && scenario !== 'adverse') ||
		!numberInRange(seed, 0, 0xffffffff, true) ||
		!numberInRange(candidateShare, 0.01, 0.99) ||
		!numberInRange(checkpointDay, 0, MAX_CHECKPOINT_DAY, true) ||
		!numberInRange(decisionDay, 1, MAX_CHECKPOINT_DAY, true) ||
		!numberInRange(minMaturedPerArm, 1, MAX_APPLICATIONS, true) ||
		!numberInRange(pauseMargin, 0, 1)
	) {
		throw new RangeError('Rollout parameters are outside their valid ranges.');
	}
	const eligible = replay.rows
		.filter((row) => row.delta !== 0 && row.applicationDay <= checkpointDay)
		.sort((a, b) => a.applicationDay - b.applicationDay || (a.id < b.id ? -1 : 1));
	const enrolled = new Set<string>();
	const assignments: { row: ReplayRow; arm: Arm }[] = [];
	for (const row of eligible) {
		if (enrolled.has(row.borrowerId)) continue;
		enrolled.add(row.borrowerId);
		const arm = draw(seed, row.borrowerId, 'assignment') < candidateShare ? 'candidate' : 'control';
		assignments.push({ row, arm });
	}
	let gateControl = null;
	let gateCandidate = null;
	let gateMissRateDelta = null;
	let decision: RolloutResult['decision'] = 'wait';
	if (checkpointDay >= decisionDay) {
		const gateRows = assignments
			.filter(({ row }) => row.applicationDay <= decisionDay)
			.map(({ row, arm }) => simulateBorrower(row, arm, config, decisionDay));
		gateControl = measureArm(gateRows, 'control');
		gateCandidate = measureArm(gateRows, 'candidate');
		gateMissRateDelta = missRateDifference(gateControl, gateCandidate);
		if (
			gateMissRateDelta !== null &&
			gateControl.matured >= minMaturedPerArm &&
			gateCandidate.matured >= minMaturedPerArm
		) {
			decision = gateMissRateDelta - pauseMargin > Number.EPSILON ? 'pause' : 'continue';
		}
	}
	const rows: RolloutRow[] = [];
	const fallbackRows: RolloutRow[] = [];
	let redirected = 0;
	for (const { row, arm } of assignments) {
		if (decision === 'pause' && row.applicationDay > decisionDay) {
			if (arm === 'candidate') redirected++;
			fallbackRows.push(simulateBorrower(row, 'control', config));
		} else {
			rows.push(simulateBorrower(row, arm, config));
		}
	}
	const control = measureArm(rows, 'control');
	const candidate = measureArm(rows, 'candidate');
	return {
		config: { ...config },
		control,
		candidate,
		decision,
		missRateDelta: missRateDifference(control, candidate),
		gateControl,
		gateCandidate,
		gateMissRateDelta,
		redirected,
		routedToCurrent: fallbackRows.length,
		fallbackRows,
		rows
	};
}

function missRateDifference(control: ArmMetrics, candidate: ArmMetrics) {
	if (control.missRate === null || candidate.missRate === null) return null;
	return candidate.missRate - control.missRate;
}

function csvCell(value: string | number | null) {
	if (value === null) return '';
	if (typeof value === 'number') return String(value);
	const safe = /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
	return `"${safe.replaceAll('"', '""')}"`;
}

export function replayCsv(replay: ReplayResult, model?: { type: string; version: string }): string {
	const header = [
		'application_id',
		'borrower_id',
		'application_day',
		'completed_loans',
		'requested_naira',
		'reference_risk',
		'current_offer_naira',
		'candidate_offer_naira',
		'delta_naira',
		'reason',
		'current_cap_naira',
		'candidate_cap_naira',
		'risk_cutoff',
		'cohort_fingerprint',
		'score_source',
		'model_type',
		'model_version'
	].join(',');
	const { currentCap, candidateCap, maxRisk } = replay.config;
	const lines = replay.rows.map((row) =>
		[
			row.id,
			row.borrowerId,
			row.applicationDay,
			row.successfulLoans,
			row.requestedAmount,
			row.referenceRisk,
			row.currentOffer,
			row.candidateOffer,
			row.delta,
			row.reason,
			currentCap,
			candidateCap,
			maxRisk,
			replay.cohortFingerprint,
			model ? 'imported-reference-scores' : 'synthetic-demo',
			model?.type ?? null,
			model?.version ?? null
		]
			.map(csvCell)
			.join(',')
	);
	return [header, ...lines].join('\r\n') + '\r\n';
}
