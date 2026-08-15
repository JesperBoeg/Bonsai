# Deploying Bonsai (container hosting on Render)

Bonsai deploys as containers on Render — this is the only supported deploy
story. The web service persists photo uploads and per-user data under
`<repo-root>/data`, and the vision service runs PyTorch (DINOv2). Neither fits
a read-only serverless platform (Vercel is not supported), so both run as
containers backed by persistent disks.

> **Restore Supabase first.** The Supabase project referenced in `render.yaml`
> (`epqxygxvvlsobbyhhnke`) no longer resolves in DNS — it appears paused or
> deleted. Restore it (or create a new project) in the Supabase dashboard,
> update `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` in
> `render.yaml`, and re-apply migrations (see below) before any deploy will
> work end to end.

## Architecture

| Service         | Image                        | Persistent disk                       | Needs                                   |
| --------------- | ---------------------------- | ------------------------------------- | --------------------------------------- |
| `bonsai-web`    | `apps/web/Dockerfile`        | `bonsai-data` at `/app/data` (1 GB)   | Supabase project, API keys              |
| `bonsai-vision` | `services/vision/Dockerfile` | `hf-cache` at `/app/.hf-cache` (2 GB) | ~2–4 GB RAM; downloads HF model weights |

## CI/CD

- GitHub Actions (`.github/workflows/main-ci-cd.yml`) is a **quality gate
  only**: web lint + build and the vision unit tests, on every push and pull
  request to `main`.
- Render deploys automatically: both services have `autoDeploy: true`, so
  **every push to `main` triggers a Render build and deploy** from the
  Dockerfiles. There is no deploy step in GitHub Actions.

## One-time setup

1. Push to GitHub (the Blueprint lives in `render.yaml` at the repo root).
2. In the Render dashboard: **New → Blueprint**, connect the `JesperBoeg/Bonsai`
   repo, and select the branch. Render reads `render.yaml` and creates both
   services plus the two disks.
3. Render prompts for the `sync: false` env vars on `bonsai-web`
   (`NEXT_PUBLIC_SITE_URL`, `VISION_SERVICE_URL`, `ANTHROPIC_API_KEY`,
   `GEMINI_API_KEY`). Enter the API keys; leave the two URLs blank for the
   first apply (set them in step 6).
4. Approve the plans. Current spec: vision `standard` (2 GB) + 2 GB disk, web
   `starter` + 1 GB disk. Roughly ~$32/mo; raise vision to `pro` (4 GB) if it
   OOMs at boot.

## Environment variables (`bonsai-web`)

| Variable                        | Where set                    | Value                                                        |
| ------------------------------- | ---------------------------- | ------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | `render.yaml`                | Supabase project URL — **update after restoring the project** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `render.yaml`                | Supabase publishable/anon key — **update after restoring**    |
| `NEXT_PUBLIC_SITE_URL`          | dashboard (`sync: false`)    | Web service URL, e.g. `https://bonsai-web.onrender.com`       |
| `VISION_SERVICE_URL`            | dashboard (`sync: false`)    | Vision service URL, e.g. `https://bonsai-vision.onrender.com` |
| `ANTHROPIC_API_KEY`             | dashboard (`sync: false`)    | Anthropic API key                                             |
| `GEMINI_API_KEY`                | dashboard (`sync: false`)    | Gemini API key (optional; needed while the image provider is Gemini) |
| `BONSAI_IMAGE_PROVIDER`         | `render.yaml`                | `gemini`                                                      |
| `BONSAI_DATA_BACKEND`           | `render.yaml`                | `supabase`                                                    |

## Database migrations

Migrations in `supabase/migrations` are not applied by CI or Render. After the
Supabase project is restored/recreated:

```sh
npx supabase link --project-ref <project-ref>   # once; asks for the database password
npx supabase db push
```

Authentication: either export `SUPABASE_ACCESS_TOKEN` or run `supabase login`
first. `db push` also needs the database password (prompted, or via
`--password` / `SUPABASE_DB_PASSWORD`).

## After the first deploy

5. Set the two URL env vars on `bonsai-web`, then redeploy it:
   - `NEXT_PUBLIC_SITE_URL` → the web service URL, e.g. `https://bonsai-web.onrender.com`
   - `VISION_SERVICE_URL` → the vision service URL, e.g. `https://bonsai-vision.onrender.com`
6. Update Supabase Auth → URL Configuration: add the web URL as Site URL and to
   the redirect allow-list, so `/auth/callback` works.

## Notes

- The vision service's first boot is slow (downloads ~350 MB of weights and
  embeds the reference catalog). Weights are cached on the `hf-cache` disk, so
  subsequent deploys and restarts reuse them. Its health check is `/health`.
- The web app's `data/` disk is single-instance; do not scale `bonsai-web`
  beyond one instance without migrating storage fully to Supabase/Postgres
  first.
