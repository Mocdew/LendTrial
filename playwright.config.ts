import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	testMatch: '**/*.e2e.ts',
	webServer: { command: 'pnpm build && pnpm preview --host 127.0.0.1 --port 4174', port: 4174 },
	use: { baseURL: 'http://127.0.0.1:4174', channel: process.env.PW_CHANNEL }
});
