import { validateApplications, type Application } from './engine';

export type ScoreExport = {
	schemaVersion: 1;
	model: { type: string; version: string };
	applications: Application[];
};

export const MAX_SCORE_FILE_BYTES = 2_000_000;

export function readScoreExport(json: string): ScoreExport {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new Error('Choose a valid JSON score export.');
	}

	if (typeof parsed !== 'object' || parsed === null || !('schemaVersion' in parsed)) {
		throw new Error('The file must be a version 1 score export.');
	}
	if (parsed.schemaVersion !== 1 || !('model' in parsed) || !('applications' in parsed)) {
		throw new Error('The file must contain schemaVersion 1, model and applications.');
	}
	const { model, applications } = parsed;
	if (
		typeof model !== 'object' ||
		model === null ||
		!('type' in model) ||
		!('version' in model) ||
		typeof model.type !== 'string' ||
		!['lightgbm', 'logistic_regression'].includes(model.type) ||
		typeof model.version !== 'string' ||
		!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(model.version)
	) {
		throw new Error('The file must identify a Can I borrow.ai model and model version.');
	}
	validateApplications(applications);
	if (applications.length === 0) throw new Error('The score export contains no applications.');
	return {
		schemaVersion: 1,
		model: { type: model.type, version: model.version },
		applications: applications.map(
			({ id, borrowerId, requestedAmount, referenceRisk, successfulLoans, applicationDay }) => ({
				id,
				borrowerId,
				requestedAmount,
				referenceRisk,
				successfulLoans,
				applicationDay
			})
		)
	};
}
