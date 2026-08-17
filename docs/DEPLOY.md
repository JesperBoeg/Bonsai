# Deploying Bonsai (Fly.io)

Bonsai deploys as **one stateless container on Fly.io**. Production is live at
**https://bonsai-progress.fly.dev** (app `bonsai-progress`, region `ams`, a single
`shared-cpu-1x` 512 MB machine, ~$3.19/mo).

Stateless is load-bearing: in `supabase` mode all photo bytes live in Supabase
Storage, so a machine can be destroyed and recreated without losing anything. The
container carries no volume.

> Deliberately not serverless: a Design Studio run is a 60–90 s in-process
> background job. See [future-state-plan.md](future-state-plan.md) §2.

## Architecture

| Piece | Where | Notes |
|---|---|---|
| Web app | Fly machine, `apps/web/Dockerfile` | stateless, always-on (`min_machines_running = 1`) |
| Database + auth | Supabase project `epqxygxvvlsobbyhhnke` (Frankfurt) | free plan + [guardrails](GUARDRAILS.md) |
| Photo bytes | Supabase Storage bucket `bonsai-photos` | owner-scoped RLS, signed-URL serving |
| Species/style + Studio design | Anthropic API (`claude-opus-5`) | `ANTHROPIC_API_KEY` as a Fly secret |
| Photoreal renders | Gemini image API | optional; `BONSAI_IMAGE_PROVIDER=none` until `GEMINI_API_KEY` exists |
| Identity matching | Python vision service | **not deployed** — see [The vision service](#the-vision-service) |

## CI/CD

- [`.github/workflows/main-ci-cd.yml`](../.github/workflows/main-ci-cd.yml) — quality
  gate: web lint + build, vision unit tests, on every push and PR to `main`.
- [`.github/workflows/fly-deploy.yml`](../.github/workflows/fly-deploy.yml) — deploy:
  `flyctl deploy --remote-only` on every push to `main` (and on demand), using the
  `FLY_API_TOKEN` repository secret.
- Guardrail crons (keep-alive, nightly backup, restore drill) are documented in
  [GUARDRAILS.md](GUARDRAILS.md).

CI and deploy run independently, so keep CI green: a red run means a bad deploy is
already rolling out.

## Configuration

Non-secret config lives in [`fly.toml`](../fly.toml) `[env]`; secrets are set with
`fly secrets set` (never committed).

| Variable | Value | Where |
|---|---|---|
| `BONSAI_DATA_BACKEND` | `supabase` | `fly.toml` |
| `NEXT_PUBLIC_SUPABASE_URL` | project URL | `fly.toml` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable key (not a secret — RLS-scoped) | `fly.toml` |
| `BONSAI_IMAGE_PROVIDER` | `none`, or `gemini` once a key exists | `fly.toml` |
| `ANTHROPIC_API_KEY` | rotated Anthropic key | `fly secrets set` |
| `GEMINI_API_KEY` | optional, for photoreal renders | `fly secrets set` |
| `VISION_SERVICE_URL` | interim vision host, or unset for graceful degradation | `fly secrets set` |
| `BONSAI_SIGNUP_MODE` | `closed` — no public sign-up (see below). `open` restores self-serve sign-up | `fly.toml` |
| `BONSAI_SIGNUP_ALLOWLIST` | addresses that may still create an account while closed, comma-separated | `fly.toml` |
| `SUPABASE_SERVICE_ROLE_KEY` | needed only for allowlisted account creation; bypasses RLS | `fly secrets set` |
| `BONSAI_PHOTO_SERVING` | unset (signed-URL redirects). `stream` proxies bytes through the app instead | `fly secrets set` |
| `BONSAI_REPO_ROOT` | not needed — marker discovery works in the image | override only |

```sh
fly secrets set ANTHROPIC_API_KEY=sk-ant-…      # triggers a rolling restart
fly secrets list                                 # names and digests only
fly config env                                   # non-secret env from fly.toml
```

## One-time setup (already done for `bonsai-progress`)

```sh
fly auth login
fly launch --no-deploy            # reads fly.toml; app name bonsai-progress, region ams
fly secrets set ANTHROPIC_API_KEY=…
fly deploy --remote-only
fly tokens create deploy          # store as the FLY_API_TOKEN GitHub secret
```

Then in Supabase → Authentication → URL Configuration, set the Site URL and
redirect allow-list to `https://bonsai-progress.fly.dev` so `/auth/callback`
works. Email delivery needs custom SMTP — see [GUARDRAILS.md](GUARDRAILS.md) §3.

## Database migrations

Migrations in `supabase/migrations` are applied by neither CI nor Fly:

```sh
npx supabase link --project-ref epqxygxvvlsobbyhhnke   # once; asks for the DB password
npx supabase db push
```

Needs `SUPABASE_ACCESS_TOKEN` in the environment (or a prior `supabase login`) plus
the database password. Migrations 0001–0006 are applied in production.

## Photo storage

- Objects are keyed `<owner id>/captures/…` and `<owner id>/studio/…` in the
  `bonsai-photos` bucket; the bucket's RLS policies scope objects by that first
  path segment, and the database keeps storing the owner-free relative path.
- `/api/photos/*` authenticates the viewer, then redirects to a 1-hour signed URL
  so the Storage CDN serves the bytes; the redirect itself is cached for 30
  minutes, always less than the signature's life. Supabase serves signed URLs with
  an `expires` header matching the signature, so a client re-fetches a photo at
  most once an hour. Set `BONSAI_PHOTO_SERVING=stream` to proxy the bytes through
  the app instead — same URLs, and the original `private, max-age=31536000,
  immutable` response headers.
- Local mode (`BONSAI_DATA_BACKEND=local`) still uses `<repo>/data` on disk. That
  is what local mode is for.
- Migrating an environment that predates Storage:

  ```sh
  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
    node scripts/migrate-photos-to-storage.mjs --dry-run
  # then without --dry-run; it is idempotent and verifies every upload by hash
  ```

## Sign-ups (currently closed)

Bonsai is in private testing, so account creation is off — in two places, because
the app alone would not be a boundary. The anon key ships in the client bundle, so
anyone could call Supabase's sign-up endpoint directly.

1. **Supabase project config**: `disable_signup = true`. The public endpoint answers
   `422 signup_disabled`. This is the actual gate.
2. **App** (`BONSAI_SIGNUP_MODE=closed`, [`lib/signup.ts`](../apps/web/lib/signup.ts)):
   `/sign-in` renders no create-account form and says accounts are invite-only. The
   form remains reachable at `/sign-in?signup=1`, and the server action refuses any
   address outside `BONSAI_SIGNUP_ALLOWLIST` regardless of what the UI did.

An allowlisted address gets an account **immediately, with no confirmation email**:
it is created through the admin API as already-confirmed and signed straight in.
Plus-aliases normalise to the base address, so `owner+test@gmail.com` counts as
`owner@gmail.com`. An allowlisted address that already exists but is unconfirmed
(signed up before sign-ups closed) gets confirmed on the next attempt, so its
original password simply starts working.

To invite someone: add their address to `BONSAI_SIGNUP_ALLOWLIST` in `fly.toml`,
push, and send them `/sign-in?signup=1`. To open the doors properly: set
`BONSAI_SIGNUP_MODE=open` **and** flip `disable_signup` back to `false` in Supabase
(Authentication → Sign In / Providers), which restores ordinary sign-up with email
confirmation.

## The vision service

`services/vision` (FastAPI + DINOv2, ~2 GB RAM) provides identity matching and the
leaf-species fallback index. It is **not currently deployed**: with
`VISION_SERVICE_URL` unset, capture degrades gracefully — Claude still suggests
species and style, and the user picks the tree manually instead of getting an
automatic identity match.

Options while Stage B ([future-state-plan.md](future-state-plan.md) §4) is
unresolved:

- leave it off (today's state; costs nothing);
- run it on a Fly 2 GB machine with auto-stop (~$10.70/mo when always on; cold
  start 1–2 min);
- run it on a Hetzner CX22 alongside nothing else (~€4.49/mo);
- retire it entirely once the Voyage benchmark gate passes:
  `node scripts/benchmark-voyage-reid.mjs` (needs `VOYAGE_API_KEY`).

Locally: `npm run dev:vision` (first boot downloads ~350 MB of weights and embeds
the reference catalog).

## Operations

```sh
fly status                        # machine state and health checks
fly logs                          # live logs
fly deploy --remote-only          # manual deploy
fly machine restart <id>          # statelessness proof: photos must still load
fly apps open                     # open the production URL
```

Health: `GET /api/health` returns `{status, backend, database}`. It answers 200
with `status: "degraded"` when Postgres is unreachable so a Supabase blip cannot
pull the machine out of rotation; add `?strict=1` for a 503 in that case. Fly's own
check is configured against it in `fly.toml`.
