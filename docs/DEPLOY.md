# Deploying Bonsai (container hosting on Render)

Bonsai is a local-filesystem app: the web service persists each user's store and
photo uploads to `<repo-root>/data`, and the vision service runs PyTorch (DINOv2).
Neither fits a read-only serverless platform, so both run as containers with the
web service backed by a persistent disk.

## Architecture

| Service         | Image                          | Needs                                   |
| --------------- | ------------------------------ | --------------------------------------- |
| `bonsai-web`    | `apps/web/Dockerfile`          | Persistent disk at `/app/data`          |
| `bonsai-vision` | `services/vision/Dockerfile`   | ~2–4 GB RAM, downloads HF model weights |

## One-time setup

1. Push this branch to GitHub (the Blueprint lives in `render.yaml`).
2. In the Render dashboard: **New → Blueprint**, connect the `JesperBoeg/Bonsai`
   repo, and select this branch. Render reads `render.yaml` and creates both
   services plus the disk.
3. Render will prompt for the two `sync: false` env vars on `bonsai-web`. Leave
   them blank for the first apply (set them in step 5).
4. Approve the plans. Current spec: vision `standard` (2 GB), web `starter` + 1 GB
   disk. Roughly ~$32/mo; raise vision to `pro` (4 GB) if it OOMs at boot.

## After the first deploy

5. Set the two env vars on `bonsai-web`, then redeploy it:
   - `NEXT_PUBLIC_SITE_URL` → the web service URL, e.g. `https://bonsai-web.onrender.com`
   - `VISION_SERVICE_URL` → the vision service URL, e.g. `https://bonsai-vision.onrender.com`
6. Update Supabase Auth → URL Configuration: add the web URL as Site URL and to the
   redirect allow-list, so `/auth/callback` works.

## Notes

- The vision service's first boot is slow (downloads ~350 MB of weights and embeds
  the reference catalog). Subsequent boots reuse the cached weights.
- The web app's `data/` disk is single-instance; do not scale `bonsai-web` beyond
  one instance without migrating storage to Supabase/Postgres first.
