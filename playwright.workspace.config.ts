import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const origin = 'http://127.0.0.1:4175';
const dbPath = join(
	mkdtempSync(join(tmpdir(), 'lendtrial-test-')),
	'workspace.sqlite'
);

export default defineConfig({
	testDir: './tests',
	testMatch: 'workspace.e2e.ts',
	webServer: {
		command: 'pnpm build:server && pnpm start',
		url: origin,
		env: {
			HOST: '127.0.0.1',
			PORT: '4175',
			ORIGIN: origin,
			BASE_PATH: '',
			BODY_SIZE_LIMIT: '2M',
			LENDTRIAL_DB_PATH: dbPath,
			LENDTRIAL_ACCESS_KEY: 'workspace-e2e-test-key-not-for-production',
			LENDTRIAL_INTEGRATION_KEY: 'integration-e2e-test-key-not-for-production'
		}
	},
	use: { baseURL: origin, channel: process.env.PW_CHANNEL }
});
