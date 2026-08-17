# CI/CD and deployment

Bonsai deploys as **one stateless container on Fly.io** — app `bonsai-progress`,
live at https://bonsai-progress.fly.dev. Photo bytes live in Supabase Storage, so
the container needs no persistent disk and machines are disposable.

Full runbook: [docs/DEPLOY.md](../docs/DEPLOY.md). Free-plan guardrails and the
secrets they need: [docs/GUARDRAILS.md](../docs/GUARDRAILS.md).

## Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| [`main-ci-cd.yml`](workflows/main-ci-cd.yml) | push + PR to `main` | quality gate: web lint/build, vision unit tests |
| [`fly-deploy.yml`](workflows/fly-deploy.yml) | push to `main`, manual | `flyctl deploy --remote-only` |
| [`keep-alive.yml`](workflows/keep-alive.yml) | daily 06:12 UTC, manual | pings `/api/health` and Postgres so the free project never idles into a pause |
| [`nightly-backup.yml`](workflows/nightly-backup.yml) | daily 02:37 UTC, manual | `pg_dump` + storage-bucket copy as a private artifact; opens an issue past the 800 MB watermark |
| [`restore-drill.yml`](workflows/restore-drill.yml) | manual | restores the newest backup into a scratch Postgres and verifies it |

CI and deploy are independent: a push to `main` deploys whether or not CI is
green, so a red CI run means a bad deploy is already rolling out.

## Repository secrets and variables

| Name | Kind | Used by |
|---|---|---|
| `FLY_API_TOKEN` | secret | `fly-deploy.yml` |
| `SUPABASE_DB_URL` | secret | `nightly-backup.yml` (database dump) |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | `nightly-backup.yml` (storage copy) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `VISION_SERVICE_URL` | secrets | `main-ci-cd.yml` build only |
| `APP_URL`, `SUPABASE_URL`, `STORAGE_WATERMARK_MB`, `BACKUP_RETENTION_DAYS` | variables (optional) | guardrail crons; sensible defaults if unset |

Runtime configuration is **not** in GitHub: non-secret env lives in
[`fly.toml`](../fly.toml), secrets in `fly secrets set`.

## Database migrations

Applied by neither CI nor Fly:

```sh
npx supabase link --project-ref epqxygxvvlsobbyhhnke
npx supabase db push
```

Needs `SUPABASE_ACCESS_TOKEN` (or a prior `supabase login`) plus the database
password. Migrations 0001–0006 are applied in production.
