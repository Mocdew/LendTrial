# LendTrial

LendTrial is a credit policy testing and pilot monitoring tool for lenders. Compare two repeat-loan caps using historical application records, assign eligible live borrowers to the current or candidate policy, and monitor first payments using records from the lender’s servicing system.

1. Create a draft pilot and pin the scorer version, caps, allocation, grace period and decision thresholds.
2. Import historical application snapshots for a side-by-side replay. Download the replay with application-level decisions and versioned scores.
3. Activate the pilot and import new applications. Use the assignment export in your origination system to make offers. The same pilot enrolls each borrower at most once.
4. Import confirmed funding, unfunded dispositions and first-payment observations. The monitor separates verified misses, pending installments and missing records. An operator can pause or resume with a recorded reason. New eligible offers route to the current cap while the pilot is paused.

The lender controls offers and disbursements in its own systems. LendTrial stores pilot rules and decisions in SQLite and never generates repayment outcomes in the authenticated workspace. See the [CSV formats and data guide](docs/lender-data.md).

## Run the lender workspace

Use Node.js 24 and pnpm 11. Run the following from the project directory:

```sh
pnpm install --frozen-lockfile
pnpm build:server
export LENDTRIAL_ACCESS_KEY="$(openssl rand -hex 32)"
export LENDTRIAL_DB_PATH="$PWD/data/lendtrial.sqlite"
HOST=127.0.0.1 PORT=3000 BODY_SIZE_LIMIT=2M pnpm start
```

Open `http://127.0.0.1:3000/workspace/` and enter the generated access key. Keep the key in your local secret store. Use `pnpm dev:server` for development.

For a lender installation, run one Node instance behind HTTPS, set `ORIGIN` to its exact public origin, and put `LENDTRIAL_DB_PATH` on a private durable volume. Keep `BODY_SIZE_LIMIT=2M` to accept CSV files up to the documented size. Keep the workspace access key server-side and configure backup and retention for the database. This release has one workspace per installation, a shared operator key, and a 5,000-application limit per pilot. Use your lender’s validated reference scores and reconcile imported counts with the source systems.

### Integrate with a lending system

Optionally set a separate random `LENDTRIAL_INTEGRATION_KEY` (minimum 32 characters). Server-to-server clients can send it in `Authorization: Bearer …` to read a pilot, send application or outcome CSVs, and download decisions. An operator signs in to create, activate, pause or resume a pilot.

| Method | Route | Use |
| --- | --- | --- |
| GET | `/api/pilots/` | Find a pilot ID |
| GET | `/api/pilots/{id}/?asOf=YYYY-MM-DD` | Read the pilot, replay, monitor and audit |
| POST | `/api/pilots/{id}/applications/` | Import an application CSV with `Content-Type: text/csv` |
| POST | `/api/pilots/{id}/outcomes/` | Import a funding and first-payment CSV with `Content-Type: text/csv` |
| GET | `/api/pilots/{id}/assignments.csv/` | Download replay and assigned offers. `arm` is blank for unassigned rows |

CSV imports are transactional. Reposting the same application or observation is safe. Use a stable pseudonymous identifier and keep any mapping to personal details in your source system.

If your lender uses Can I borrow.ai, `scripts/lendtrial/score_applications.py` can score application snapshots through its pinned local Flask API and write the workspace CSV. See the [scoring input format](docs/lender-data.md#score-applications-with-can-i-borrowai).

## Public demo and checks

[Try the public demo](https://mocdew.github.io/LendTrial/demo/) or read the [portfolio case study](https://olumide-erinfolami.vercel.app/projects/lendtrial). The public demo uses fictional applications and simulated repayments. Its optional [Can I borrow.ai score exporter](scripts/lendtrial/README.md) generates the scored demo fixture. The GitHub Pages build hosts the public pages only.

```sh
pnpm check
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:workspace
pnpm build
```

Set `PW_CHANNEL=chrome` to test with installed Chrome. `BASE_PATH=/LendTrial pnpm build` creates the GitHub Pages build in `build/`. `pnpm build:server` creates the Node service in `build-server/`.
