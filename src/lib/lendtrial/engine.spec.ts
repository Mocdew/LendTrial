import { describe, expect, it } from 'vitest';
import {
	createDemoApplications,
	DEFAULT_POLICY,
	DEFAULT_ROLLOUT,
	replayCsv,
	replayPolicies,
	simulateRollout,
	validateApplications,
	type Application
} from './engine';

const application: Application = {
	id: 'A-1',
	borrowerId: 'B-1',
	requestedAmount: 65_000,
	referenceRisk: DEFAULT_POLICY.maxRisk,
	successfulLoans: 1,
	applicationDay: 0
};

describe('replay', () => {
	it('only varies the offer cap on eligible records and reconciles offers to the headline totals', () => {
		const applicants = [
			application,
			{ ...application, id: 'A-2', requestedAmount: 40_000 },
			{ ...application, id: 'A-3', successfulLoans: 0 },
			{ ...application, id: 'A-4', referenceRisk: 0.2501 }
		];
		const result = replayPolicies(applicants);
		expect(
			result.rows.map(({ currentOffer, candidateOffer, delta }) => [
				currentOffer,
				candidateOffer,
				delta
			])
		).toEqual([
			[50_000, 65_000, 15_000],
			[40_000, 40_000, 0],
			[null, null, 0],
			[null, null, 0]
		]);
		expect(result.summary).toEqual({
			applications: 4,
			eligible: 2,
			changed: 1,
			currentPrincipal: 90_000,
			candidatePrincipal: 105_000,
			additionalPrincipal: 15_000
		});
		const equalCaps = replayPolicies(applicants, { ...DEFAULT_POLICY, candidateCap: 50_000 });
		expect(equalCaps.summary.changed).toBe(0);
		expect(equalCaps.summary.additionalPrincipal).toBe(0);
		expect(equalCaps.cohortFingerprint).toBe(result.cohortFingerprint);
	});

	it('rejects duplicate and invalid inputs instead of silently scoring a different cohort', () => {
		expect(() => validateApplications([application, application])).toThrow(
			/repeats an application ID/
		);
		expect(() => validateApplications([{ ...application, id: '=unsafe' }])).toThrow(/valid id/);
		expect(() => validateApplications([{ ...application, referenceRisk: NaN }])).toThrow(
			/referenceRisk/
		);
		expect(() => validateApplications([{ ...application, applicationDay: 61 }])).toThrow(
			/applicationDay/
		);
	});

	it('exports each decision with cap, score, and imported model provenance', () => {
		const csv = replayCsv(replayPolicies([application]), { type: 'lightgbm', version: 'v1' });
		expect(csv).toContain('cohort_fingerprint,score_source,model_type,model_version');
		expect(csv).toContain('0.25,50000,65000,15000,"Higher cap raises offer"');
		expect(csv).toContain('"imported-reference-scores","lightgbm","v1"');
	});
});

describe('rollout', () => {
	it('assigns a borrower once, uses their earliest affected offer and stays stable across checkpoints', () => {
		const replay = replayPolicies([
			{ ...application, id: 'A-later', applicationDay: 10 },
			application
		]);
		const start = simulateRollout(replay, { ...DEFAULT_ROLLOUT, checkpointDay: 0 });
		const finish = simulateRollout(replay, { ...DEFAULT_ROLLOUT, checkpointDay: 100 });
		expect(start.rows).toHaveLength(1);
		expect(finish.rows).toHaveLength(1);
		expect(finish.rows[0].applicationId).toBe(application.id);
		expect(finish.rows[0].arm).toBe(start.rows[0].arm);
	});

	it('counts only fully observed loans and uses grace-period payments to determine a miss', () => {
		const replay = replayPolicies(createDemoApplications());
		const early = simulateRollout(replay, { ...DEFAULT_ROLLOUT, checkpointDay: 37 });
		expect(early.control.matured + early.candidate.matured).toBe(0);
		expect(early.control.pending + early.candidate.pending).toBeGreaterThan(0);
		expect(early.control.missRate).toBeNull();
		expect(early.decision).toBe('wait');

		const final = simulateRollout(replay, { ...DEFAULT_ROLLOUT, checkpointDay: 120 });
		for (const arm of [final.control, final.candidate]) {
			expect(arm.pending).toBe(0);
			expect(arm.matured).toBe(arm.funded);
			expect(arm.followedUp).toBe(arm.assigned);
			expect(arm.missRate).toBe(arm.misses / arm.matured);
			expect(arm.missesPerAssigned).toBe(arm.misses / arm.followedUp);
		}
		const paidLate = final.rows.find((row) =>
			row.firstPayments.some((payment) => payment.day > row.graceEndDay!)
		);
		expect(paidLate).toBeDefined();
		expect(paidLate?.missed).toBe(true);
		expect(paidLate?.firstPayments.reduce((total, payment) => total + payment.amount, 0)).toBe(
			paidLate?.firstInstallment
		);
	});

	it('pauses a deteriorating scenario and leaves the neutral scenario below the configured threshold', () => {
		const replay = replayPolicies(createDemoApplications());
		const checkpoint = { ...DEFAULT_ROLLOUT, checkpointDay: DEFAULT_ROLLOUT.decisionDay };
		const adverse = simulateRollout(replay, checkpoint);
		const neutral = simulateRollout(replay, { ...checkpoint, scenario: 'neutral' });
		expect(adverse.gateControl).toEqual(neutral.gateControl);
		expect(adverse.gateCandidate?.assigned).toBe(neutral.gateCandidate?.assigned);
		expect(adverse.gateCandidate?.matured).toBe(neutral.gateCandidate?.matured);
		expect(adverse.gateCandidate?.misses).toBeGreaterThan(neutral.gateCandidate!.misses);
		expect(adverse.decision).toBe('pause');
		expect(neutral.decision).toBe('continue');
		expect(simulateRollout(replay, { ...DEFAULT_ROLLOUT, minMaturedPerArm: 200 }).decision).toBe(
			'wait'
		);
	});

	it('freezes the gate decision and switches new arrivals to the current offer after a pause', () => {
		const replay = replayPolicies(createDemoApplications());
		const before = simulateRollout(replay, { ...DEFAULT_ROLLOUT, checkpointDay: 53 });
		const atGate = simulateRollout(replay, { ...DEFAULT_ROLLOUT, checkpointDay: 54 });
		const later = simulateRollout(replay);
		const neutralLater = simulateRollout(replay, { ...DEFAULT_ROLLOUT, scenario: 'neutral' });
		expect(before.decision).toBe('wait');
		expect(before.gateCandidate).toBeNull();
		expect(atGate.decision).toBe('pause');
		expect(atGate.redirected).toBe(0);
		expect(later.decision).toBe('pause');
		expect(later.gateControl).toEqual(atGate.gateControl);
		expect(later.gateCandidate).toEqual(atGate.gateCandidate);
		expect(later.rows.map(({ borrowerId, arm }) => ({ borrowerId, arm }))).toEqual(
			atGate.rows.map(({ borrowerId, arm }) => ({ borrowerId, arm }))
		);
		const laterCandidates = neutralLater.rows.filter(
			(row) => row.assignedDay > 54 && row.arm === 'candidate'
		);
		expect(laterCandidates.length).toBeGreaterThan(0);
		expect(later.redirected).toBe(laterCandidates.length);
		expect(later.fallbackRows).toHaveLength(later.routedToCurrent);
		expect(
			later.fallbackRows.every(
				(row) =>
					row.assignedDay > 54 && row.arm === 'control' && row.offer === DEFAULT_POLICY.currentCap
			)
		).toBe(true);
	});
});
