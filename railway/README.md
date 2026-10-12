# Railway: one file per service

Each Railway service in the project points at one of these files (Service → Settings →
Config-as-code → "Railway config file", e.g. `railway/read.json`). They differ only in the word
passed to `tools/railway-start.mjs`, which maps Railway's `PORT` to the port each service
answers `/health` on, and runs the projector's one-shot jobs on their schedule.

| Service    | Config file              | Public domain? |
|------------|--------------------------|----------------|
| runner     | `railway/runner.json`    | no             |
| chainwatch | `railway/chainwatch.json`| no             |
| project    | `railway/project.json`   | no             |
| read       | `railway/read.json`      | yes (Vercel proxies `/api/read` to it) |
| trade      | `railway/trade.json`     | yes (`/api/trade`) |
| social     | `railway/social.json`    | yes (`/api/social`) |
| notify     | `railway/notify.json`    | yes (`/api/notify`) |

Every service restarts on failure (up to ten times) and is health-checked on `/health`.
Environment values are set by the owner in Railway; see `DEPLOY.md` for the names.
