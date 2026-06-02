# GitHub CI/CD setup

This repository uses the workflow in `.github/workflows/main-ci-cd.yml`.

## What it does

- runs the Next.js production build when code is pushed to `main`
- runs the two existing vision test files as separate jobs
- deploys the web app to Vercel only if all CI jobs succeed

## Required GitHub secrets

Add these repository or environment secrets before relying on the workflow:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL`
- `VISION_SERVICE_URL`
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

## Vercel setup

Create a Vercel project for the Next.js app and set its root directory to `apps/web`.

Then either:

- run `vercel link` locally and copy the generated org and project identifiers into GitHub secrets, or
- copy `orgId` and `projectId` from `.vercel/project.json` after linking.

The Vercel project should also have these production environment variables configured:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL`
- `VISION_SERVICE_URL`

## Notes

- This workflow deploys the web app only. The vision service must already be hosted somewhere reachable by `VISION_SERVICE_URL`.
- If you want the vision service deployed automatically too, add a second deployment job for that platform separately.