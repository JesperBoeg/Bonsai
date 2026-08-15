# Bonsai

Bonsai is being built as a phone-friendly web application with a separate vision service. The first version focuses on three things:

- capturing tree photos from a phone or browser
- identifying whether a photo belongs to an existing tree or a new tree
- showing each tree's photo history over time

## Why this stack

- Next.js gives us one product surface that works on desktop and mobile browsers without maintaining separate web and mobile codebases.
- Supabase gives us Postgres, object storage, auth, and `pgvector` in one place.
- A separate FastAPI vision service keeps image recognition isolated from product UI concerns, which matters when we later add disease detection and care guidance.

## Workspace layout

- `apps/web`: Next.js app router frontend, designed as a PWA-first experience.
- `services/vision`: FastAPI service for embeddings, similarity search, and future classifiers.
- `supabase/migrations`: database schema for trees, photos, and recognition results.
- `docs`: architecture notes and product decisions.

## MVP rules

- Tree identity should be confirmation-driven, not blind automation.
- Species and style can be suggested by AI, but the user remains the source of truth.
- The generated tree name follows `species + style + sequence number`.

## Local development

1. Install web dependencies with `npm install`.
2. Run the web app with `npm run dev:web`.
3. Create a Python virtual environment for `services/vision` and install the FastAPI dependencies from `pyproject.toml`.
4. Run the vision service with `npm run dev:vision`.

## CI/CD

GitHub Actions is a quality gate only: it lints and builds the web app and runs the two vision test files on every push and pull request to `main`. Deployment is handled by Render — both services in `render.yaml` have `autoDeploy` enabled, so Render builds and deploys the containers on every push to `main`.

The workflow, required secrets, and Render environment variables are documented in [.github/DEPLOYMENT.md](.github/DEPLOYMENT.md); the full deploy runbook is in [docs/DEPLOY.md](docs/DEPLOY.md).

## Architecture notes

See `docs/architecture.md` for the reasoning behind the stack and the recognition flow.
