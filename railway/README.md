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

| embed      | `services/embed/railway.json` (root directory `services/embed`) | no (private network only) |

`embed` is the one service built on its own: its root directory is `services/embed`, it installs
with npm from its own lockfile (not the pnpm workspace — its model runtime is about 450 MB of native
binaries no other service should carry), and it needs a volume at `/data` with
`MODEL_DIR=/data/models` so the model (about 680 MB) is downloaded once, not on every deploy. It
holds about 1.7 GB resident once loaded. `EMBED_SECRET` (24+ characters) is set on it and on the
runner, and the runner's `EMBED_SERVICE_URL` is its private address
(`http://embed.railway.internal:8790`, with `PORT=8790` set on the service).

Every service restarts on failure (up to ten times) and is health-checked on `/health`.
Environment values are set by the owner in Railway; see `DEPLOY.md` for the names.
