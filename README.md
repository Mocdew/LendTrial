# LendTrial

LendTrial is a browser-based sandbox for testing repeat-loan limits on a simulated naira installment product. [Open the app](https://mocdew.github.io/LimitRehearsal/) or read the [portfolio case study](https://olumide-erinfolami.vercel.app/projects/lendtrial).

- **Before launch** replays the current and candidate caps on the same applications. It shows which offers change and exports the per-application decisions to CSV.
- **After launch** simulates a randomized rollout and shows whether the candidate policy meets the first-payment pause rule.
- **Load Can I borrow.ai scores** opens a bundled sample or imports a JSON score export from your device. The [optional Python exporter](scripts/limit-rehearsal/README.md) can score fictional applications against a pinned local model.

The app starts with a synthetic cohort. The scored sample also uses fictional applications, and repayment events are simulated for all cohorts. Imported score files are processed in the browser.

## Run locally

Use Node.js 22.13+ and pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

## Check and build

```sh
pnpm check
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

Set `PW_CHANNEL=chrome` to run the browser tests with an installed Chrome instead of Playwright's Chromium. The static build is written to `build/`. Set `BASE_PATH=/LimitRehearsal` when building or previewing under a subpath.

GitHub Actions builds and deploys the site on pushes to `main`. The repository's GitHub Pages publishing source is GitHub Actions.
