import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	openLendTrial,
	type CreatePilotInput,
	type LiveApplication,
	type LiveOutcome
} from './lendtrial';

const config: CreatePilotInput = {
	name: 'Repeat loan pilot',
	modelType: 'lightgbm',
	modelVersion: 'v2026',
	currentCap: 5_000_000,
	candidateCap: 7_500_000,
	maxRisk: 0.25,
	candidateShare: 0.5,
	graceDays: 7,
	minMaturedPerArm: 1,
	pauseMargin: 0.05
};

function app(id: string, fields: Partial<LiveApplication> = {}): LiveApplication {
	return {
		id,
		borrowerId: `borrower-${id}`,
		requestedAmount: 6_500_000,
		referenceRisk: 0.15,
		successfulLoans: 2,
		applicationDate: '2026-01-01',
		modelType: config.modelType,
		modelVersion: config.modelVersion,
		...fields
	};
}

function harness() {
	let current = '2026-01-01';
	const now = () => new Date(`${current}T12:00:00.000Z`);
	return {
		now,
		date: (value: string) => {
			current = value;
		}
	};
}

let store: ReturnType<typeof openLendTrial> | undefined;
let directory: string | undefined;

afterEach(() => {
	store?.close();
	store = undefined;
	if (directory) rmSync(directory, { recursive: true, force: true });
	directory = undefined;
});

describe('LendTrial pilot store', () => {
	it('replays a draft without enrolling borrowers and preserves data across process restarts', () => {
		const { now } = harness();
		directory = mkdtempSync(join(tmpdir(), 'lendtrial-domain-'));
		const path = join(directory, 'workspace.sqlite');
		store = openLendTrial(path, now);
		const pilot = store.createPilot(config);
		expect(
			store.importApplications(pilot.id, [app('draft'), app('first-loan', { successfulLoans: 0 })])
		).toEqual({ inserted: 2, updated: 0, unchanged: 0 });
		expect(store.getPilot(pilot.id).replay).toMatchObject({
			applications: 2,
			eligible: 1,
			changed: 1,
			additionalPrincipal: 1_500_000
		});
		expect(store.getPilot(pilot.id).applications.every((row) => row.arm === null)).toBe(true);
		store.close();
		store = openLendTrial(path, now);
		expect(store.listPilots()).toEqual([pilot]);
		expect(store.startPilot(pilot.id).status).toBe('active');
		expect(store.importApplications(pilot.id, [app('draft')]).unchanged).toBe(1);
		expect(store.getPilot(pilot.id).applications.every((row) => row.arm === null)).toBe(true);
	});

	it('assigns only a single eligible offer per borrower and rolls back a conflicting import', () => {
		const { now } = harness();
		store = openLendTrial(':memory:', now);
		const { id } = store.createPilot(config);
		store.startPilot(id);
		store.importApplications(id, [app('initial')]);
		const first = store.exportAssignments(id)[0];
		store.importApplications(id, [
			app('later', { borrowerId: first.borrowerId }),
			app('small', { requestedAmount: 4_000_000 })
		]);
		expect(store.exportAssignments(id)).toMatchObject([
			{
				id: 'initial',
				arm: first.arm,
				assignedOffer: first.arm === 'candidate' ? 6_500_000 : 5_000_000
			},
			{ id: 'later', arm: null, reason: 'Borrower already enrolled' },
			{ id: 'small', arm: null, reason: 'Offer unchanged' }
		]);
		expect(first.arm).not.toBeNull();
		expect(() =>
			store!.importApplications(id, [app('added'), app('initial', { requestedAmount: 5_400_000 })])
		).toThrow('different inputs');
		expect(store.exportAssignments(id)).toHaveLength(3);
		expect(() =>
			store!.importApplications(id, [app('future', { applicationDate: '2026-01-02' })])
		).toThrow('future');
		expect(() =>
			store!.importApplications(id, [app('wrong-model', { modelVersion: 'different' })])
		).toThrow('pinned model');
	});

	it('measures observed mature payments, holds for missing evidence, and routes new offers during a pause', () => {
		const { now, date } = harness();
		store = openLendTrial(':memory:', now);
		const { id } = store.createPilot(config);
		store.startPilot(id);
		// Deterministic by stored salt and borrower ID. Enough rows make both arms practically certain.
		store.importApplications(
			id,
			Array.from({ length: 96 }, (_, index) => app(`app-${index}`))
		);
		const assigned = store.exportAssignments(id);
		const control = assigned.find((row) => row.arm === 'control')!;
		const candidate = assigned.find((row) => row.arm === 'candidate')!;
		const outcome = (
			applicationId: string,
			paidByGrace: number | null,
			observedOn: string
		): LiveOutcome => ({
			applicationId,
			fundedAmount: 5_000_000,
			fundedOn: '2026-01-01',
			firstDueDate: '2026-01-08',
			firstInstallment: 1_000_000,
			paidByGrace,
			observedOn
		});
		date('2026-01-10');
		expect(() => store!.importOutcomes(id, [outcome(candidate.id, 0, '2026-01-10')])).toThrow(
			'grace date'
		);
		store.importOutcomes(id, [
			outcome(control.id, null, '2026-01-10'),
			outcome(candidate.id, null, '2026-01-10')
		]);
		expect(store.getPilot(id).monitor.candidate).toMatchObject({
			funded: 1,
			pending: 1,
			matured: 0,
			missRate: null
		});
		date('2026-01-16');
		expect(store.getPilot(id).monitor).toMatchObject({
			decision: 'hold',
			candidate: { pending: 0, missingOutcome: 1 }
		});
		store.importOutcomes(id, [
			outcome(control.id, 1_000_000, '2026-01-16'),
			outcome(candidate.id, 500_000, '2026-01-16')
		]);
		expect(store.getPilot(id).monitor).toMatchObject({
			decision: 'pause',
			missRateDelta: 1,
			control: { matured: 1, misses: 0 },
			candidate: { matured: 1, misses: 1 }
		});
		expect(store.getPilot(id, '2026-01-15').monitor.candidate).toMatchObject({
			matured: 0,
			pending: 1
		});
		expect(store.importOutcomes(id, [outcome(candidate.id, 500_000, '2026-01-16')]).unchanged).toBe(
			1
		);
		expect(() => store!.importOutcomes(id, [outcome(candidate.id, 0, '2026-01-16')])).toThrow(
			'different inputs'
		);
		store.setPaused(id, true, 'Miss-rate gap exceeded the limit.');
		date('2026-01-17');
		store.importApplications(id, [app('after-pause', { applicationDate: '2026-01-17' })]);
		const result = store.getPilot(id);
		expect(result.monitor.routedToCurrent).toBe(1);
		expect(result.monitor.control.assigned + result.monitor.candidate.assigned).toBe(96);
		expect(result.applications.find((row) => row.id === 'after-pause')).toMatchObject({
			arm: 'routed',
			assignedOffer: config.currentCap
		});
		expect(result.audit).toContainEqual(
			expect.objectContaining({
				action: 'paused',
				detail: 'Miss-rate gap exceeded the limit.'
			})
		);
		store.setPaused(id, false, 'Manual review completed.');
		store.importApplications(id, [app('after-resume', { applicationDate: '2026-01-17' })]);
		expect(store.getPilot(id).monitor.routedToCurrent).toBe(1);
		expect(store.exportAssignments(id).find((row) => row.id === 'after-resume')?.arm).toMatch(
			/^(control|candidate)$/
		);
	});

	it('holds continuation until older assignments have a funded or explicitly unfunded disposition', () => {
		const { now, date } = harness();
		store = openLendTrial(':memory:', now);
		const { id } = store.createPilot(config);
		store.startPilot(id);
		store.importApplications(
			id,
			Array.from({ length: 96 }, (_, index) => app(`app-${index}`))
		);
		const assignments = store.exportAssignments(id);
		const control = assignments.find((row) => row.arm === 'control')!;
		const candidate = assignments.find((row) => row.arm === 'candidate')!;
		const unsettled = assignments.filter((row) => row.id !== control.id && row.id !== candidate.id);
		const confirmedUnfunded: LiveOutcome[] = unsettled.map(({ id }) => ({
			applicationId: id,
			fundedAmount: 0,
			fundedOn: null,
			firstDueDate: null,
			firstInstallment: null,
			paidByGrace: null,
			observedOn: '2026-01-16'
		}));
		const knownFunded = (applicationId: string): LiveOutcome => ({
			applicationId,
			fundedAmount: 5_000_000,
			fundedOn: '2026-01-01',
			firstDueDate: '2026-01-08',
			firstInstallment: 1_000_000,
			paidByGrace: 1_000_000,
			observedOn: '2026-01-16'
		});
		const initial = store.getPilot(id).monitor;
		expect(initial.control.awaitingFunding + initial.candidate.awaitingFunding).toBe(96);
		date('2026-01-16');
		store.importOutcomes(id, [knownFunded(control.id), knownFunded(candidate.id)]);
		const unresolved = store.getPilot(id).monitor;
		expect(unresolved.decision).toBe('hold');
		expect(unresolved.control.fundingUnconfirmed + unresolved.candidate.fundingUnconfirmed).toBe(
			94
		);
		store.importOutcomes(id, confirmedUnfunded);
		const reconciled = store.getPilot(id).monitor;
		expect(reconciled.decision).toBe('continue');
		expect(reconciled.control.unfunded + reconciled.candidate.unfunded).toBe(94);
		date('2026-01-17');
		expect(() =>
			store!.importOutcomes(id, [
				{
					...confirmedUnfunded[0],
					applicationId: candidate.id,
					observedOn: '2026-01-17'
				}
			])
		).toThrow('cannot remove a verified payment total');
		expect(() =>
			store!.importOutcomes(id, [
				{
					...knownFunded(unsettled[0].id),
					observedOn: '2026-01-17'
				}
			])
		).toThrow('after its last unfunded observation');
		store.importOutcomes(id, [
			{
				...knownFunded(unsettled[0].id),
				observedOn: '2026-01-17',
				fundedOn: '2026-01-17',
				firstDueDate: '2026-02-10',
				paidByGrace: null
			}
		]);
		const later = store.getPilot(id).monitor;
		expect(later.control.unfunded + later.candidate.unfunded).toBe(93);
		expect(later.control.pending + later.candidate.pending).toBe(1);
	});
});
