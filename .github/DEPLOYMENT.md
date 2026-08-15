# CI/CD and deployment

Bonsai deploys as containers on Render. That is the only deploy story: the web
app needs a persistent filesystem (`/app/data`), so serverless platforms such as
Vercel are not supported.

> **Before anything can deploy:** the Supabase project referenced in
> `render.yaml` (`epqxygxvvlsobbyhhnke`) no longer resolves in DNS — it appears
> to be paused or deleted. Restore it (or create a new project) in the Supabase
> dashboard, update the URL/anon key in `render.yaml` and in GitHub secrets,
> and re-apply migrations with `npx supabase db push` before deploying.

## How deployment works

- **Render Blueprint** (`render.yaml` at the repo root) defines both services:
  - `bonsai-web` — Next.js app built from `apps/web/Dockerfile` with a
    persistent disk at `/app/data`.
  - `bonsai-vision` — FastAPI/PyTorch service built from
    `services/vision/Dockerfile` with a persistent disk at `/app/.hf-cache`
    for Hugging Face model weights.
- Both services have `autoDeploy: true`, so **Render builds and deploys on
  every push to `main`**. There is no deploy step in GitHub Actions.
- **GitHub Actions** (`.github/workflows/main-ci-cd.yml`) is the quality gate:
  it lints and builds the web app and runs the vision service's unit tests on
  every push and pull request to `main`. Keep it green — Render deploys on
  push regardless, so a red CI run means a bad deploy is already rolling out.

## GitHub secrets (CI build only)

The web build job reads these repository secrets (used only so `next build`
has real values; nothing is deployed from CI):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL`
- `VISION_SERVICE_URL`

## Render environment variables

Configured on `bonsai-web` (via `render.yaml`; `sync: false` values are entered
in the Render dashboard):

| Variable                        | Value / source                                                     |
| ------------------------------- | ------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL (in `render.yaml`; update after restore)      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable/anon key (in `render.yaml`; update after restore) |
| `NEXT_PUBLIC_SITE_URL`          | The web service's own https URL, e.g. `https://bonsai-web.onrender.com` |
| `VISION_SERVICE_URL`            | The vision service's https URL, e.g. `https://bonsai-vision.onrender.com` |
| `ANTHROPIC_API_KEY`             | Anthropic API key (dashboard, `sync: false`)                       |
| `GEMINI_API_KEY`                | Gemini API key (dashboard, `sync: false`; optional — only if `BONSAI_IMAGE_PROVIDER=gemini`) |
| `BONSAI_IMAGE_PROVIDER`         | `gemini`                                                           |
| `BONSAI_DATA_BACKEND`           | `supabase`                                                         |

## Database migrations

Migrations in `supabase/migrations` are **not** applied by CI or Render. Apply
them with the Supabase CLI:

```sh
npx supabase db push
```

This requires either `SUPABASE_ACCESS_TOKEN` in the environment or a prior
`supabase login`, plus the database password when prompted (the project must be
linked, e.g. `npx supabase link --project-ref <ref>`).

## Full runbook

See [docs/DEPLOY.md](../docs/DEPLOY.md) for one-time Render setup, plans/costs,
and post-deploy configuration.
