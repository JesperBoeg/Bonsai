# Bonsai — Future-State Plan

Status: **agreed, execution pending two owner decisions** (see [Open decisions](#open-decisions))
Last updated: 2026-08-17
Companion docs: [architecture.md](architecture.md) (original recognition design), [DEPLOY.md](DEPLOY.md) (current Render-based deploy), the review/implementation report artifact (claude.ai artifact "Bonsai — App Review & AI Roadmap").

This document is the single source of truth for where the product's infrastructure and AI architecture are going, why, and in what order. It captures the full plan agreed on 2026-08-16/17, including every constraint and correction surfaced during review.

---

## 1. Where we are today (validated baseline)

Everything below is implemented on `main`, CI-green, and was validated visually end-to-end (Playwright drives with screenshot review) — first in local mode, then against the live Supabase project.

| Area | State |
|---|---|
| Core loops (capture → identify → confirm → timeline) | Working. The automatic identity match, photo serving, and full-catalog tree creation were all broken before 2026-08-15; all fixed and validated. |
| Persistence | One authoritative `CollectionStore` per deployment: `supabase` (Postgres, owner-scoped queries + RLS) or `local` (file-backed, zero dependencies). Selected via `BONSAI_DATA_BACKEND`. |
| Photo bytes | **Still on app-server disk** (`data/users/<uid>/uploads/`) in both modes. This is what Stage A removes for supabase mode. |
| Database | Hosted Supabase project `epqxygxvvlsobbyhhnke` (Frankfurt), migrations 0001–0006 applied. 244 species with pinned stable IDs, capture-submission wizard columns, `tree_target_states`, `allocate_tree_sequence()` RPC. Zero ID drift verified. |
| AI recognition | Claude (`claude-opus-5`, structured outputs, server-side fallbacks) suggests species + style per capture; falls back to the Python vision service's leaf index when Claude is unavailable or errors (fallback proven live during a billing outage). |
| AI Design Studio | Two-stage pipeline live: Claude designs (assessment, staged seasonal plan, constrained photo-edit instruction) → image provider renders (`gemini` implemented, `mock` for dev, `none`). Validated live end-to-end incl. persistence to `tree_target_states`. |
| Identity matching | Python vision service (FastAPI + DINOv2 CPU), per-embedding-model candidate scoring (legacy `pixel-rgb-16` embeddings coexist with `dinov2-base-pooler`). |
| Deploy story | Render Blueprint config (`render.yaml`) exists but **no Render services were ever provisioned**. CI is a lint/build/test quality gate on `main`. This plan supersedes the Render setup. |
| PWA | Installable: icons, manifest, service worker (production-only registration), offline page. |

**Fixed costs today: $0** (nothing hosted; app runs locally). Supabase is on the free plan.

Credentials note (2026-08-15/16): an Anthropic API key and a Supabase access token were shared in chat during setup. The token was single-purpose (migrations) and should be revoked; the API key should be rotated and lives only in gitignored `.env.local` / host env.

---

## 2. Target architecture (end state)

One managed backbone for all state, one tiny stateless container for compute, APIs for all ML.

```mermaid
flowchart LR
    U["Browser / PWA"] --> W["Web app container\nNext.js, ~512 MB, stateless\nFly.io or Hetzner"]
    U -->|"signed URLs (CDN)"| ST
    W --> SB["Supabase (Frankfurt)\nPostgres + pgvector · Auth"]
    W --> ST["Supabase Storage\nbonsai-photos bucket"]
    W --> CL["Anthropic API\nclaude-opus-5\nspecies/style + Studio design"]
    W --> VY["Voyage AI API\nvoyage-multimodal-3\nidentity embeddings (Stage B)"]
    W --> GM["Gemini image API\nphotoreal target renders"]
    GH["GitHub Actions crons\nkeep-alive · backups · alerts"] --> SB
```

### Component decisions and rationale

| Component | Decision | Why (and what was rejected) |
|---|---|---|
| Data, auth, files, vectors | **Supabase** (free now → Pro on triggers) | Already integrated and migrated; EU-resident next to nothing else to glue; auth-integrated RLS on both rows and storage objects; pgvector included. Rejected: Firebase (weak Postgres story), Neon+Clerk+R2 (three vendors of glue), AWS (ops overhead). Lock-in is moderate — Postgres/GoTrue/S3-compatible are all portable. |
| Web compute | **One always-on ~512 MB container** | Deliberately *not* serverless: Studio designs are 60–90 s in-process background jobs; serverless turns those into timeout gymnastics for zero benefit at this scale. Stateless after Stage A → host is a commodity, horizontally scalable later. |
| Identity embeddings | **Voyage `voyage-multimodal-3` API** (Stage B, gated) | Removes the only reason a 2 GB torch container exists. ~$0.0006/photo, first 150 B pixels free. **Gate:** must match DINOv2 re-ID quality side-by-side on real data before the Python service is retired. |
| Species/style + Studio design | **Claude `claude-opus-5`** (as shipped) | Vision + structured outputs + horticultural reasoning validated live. Server-side fallbacks enabled. Model tier is a cost lever the owner can pull later. |
| Photoreal renders | **Gemini image API** behind the provider interface | Identity-preserving photo *editing* (not text-to-image). `mock`/`none` fallbacks shipped. Unvalidated until a `GEMINI_API_KEY` exists. |
| Email | **Custom SMTP** (Resend/Brevo free tier) via Supabase auth | Supabase's default sender is limited to ~2 auth emails/hour — breaks onboarding on any plan. Custom SMTP is supported on the free plan and lifts the cap to a configurable 30+/hour. |

### Cost model

| Phase | Fixed / month | Marginal (per action) |
|---|---|---|
| **Early-adopter mode** (Supabase free + guardrails) | **~$3–5** (container only) | Capture with AI suggestions ~$0.05–0.15 · Studio design ~$0.15–0.30 · Gemini render ~$0.04 · Voyage embedding ~$0.0006 (free tier covers tens of thousands) |
| **Steady state** (Supabase Pro) | **~$28** ($25 Pro + ~$3 container) | same |

The marginal-cost shape maps directly onto the intended freemium model (free tier capped, Pro subscription + Studio credits) from the product report: fixed costs stay flat, paying users carry their own AI usage.

---

## 3. Stage A — Supabase Storage migration + stateless deploy

**Goal:** no photo byte ever depends on a container's disk again (in supabase mode); deploy the app as a stateless container with a live public URL.

### 3.1 Storage migration scope

The `bonsai-photos` bucket already exists (migration 0001) with owner-scoped RLS: objects must live under `<auth.uid()>/...` (first path folder = owner id). Touchpoints, all inside `SupabaseCollectionStore` + `lib/storage-paths.ts`:

1. **Path convention change:** storage keys become `<uid>/captures/<submissionId>-front.jpg`, `<uid>/captures/<submissionId>-leaf.png`, `<uid>/studio/<targetId>.png`. The DB `storage_path` values keep their current relative form (`captures/...`, `studio/...`); the storage layer prefixes the owner id.
2. **Uploads:** capture front/leaf writes and Studio render writes go to `supabase.storage.from("bonsai-photos").upload(...)` (server-side, service uses the user's session → RLS-scoped).
3. **Serving:** `/api/photos/[...segments]` resolves via short-lived signed URLs (redirect, CDN-cached) with the existing `private, max-age, immutable` semantics; fall back to streaming through the route if signed-URL redirects interact badly with the service worker. Local mode keeps disk + streaming unchanged.
4. **AI reads:** Claude/Voyage/Gemini inputs download bytes server-side from Storage instead of `readPhotoFile`.
5. **Deletes:** `deleteTree` calls `storage.remove()` for all collected paths (photos, leaf files, studio renders).
6. **One-time migration script** (`scripts/migrate-photos-to-storage.mjs`): uploads every existing disk file for each user to the bucket, verifies by download-hash, idempotent (skip-if-exists). Run once per environment; legacy disk files kept until verified, then removable.
7. **Local mode unaffected** — disk remains the local backend's storage; that is its purpose.

### 3.2 Hosting

- **Primary choice: Fly.io**, `ams` or `fra` region, one machine `shared-cpu-1x` 512 MB (~$3.19/mo), no volume needed after 3.1. Deploy via `fly.toml` + GitHub Action on `main` (replacing Render autoDeploy).
- **Alternative (owner preference): Hetzner CX22** (~€4.49/mo) with Docker Compose + Caddy (auto-TLS) + a deploy Action over SSH; also comfortably hosts the vision service during the Stage B transition, which Fly would price at ~$10.70/mo extra until retirement.
- Note: until Stage B completes, the Python vision service still needs somewhere to run (2 GB RAM). Options during the interim: Hetzner box (covers both cheaply), Fly 2 GB machine with auto-stop (cold start 1–2 min, capture degrades gracefully), or accept degraded identity matching (manual tree pick) in production until Stage B. **Decision folded into the Fly-vs-Hetzner choice.**

### 3.3 Environment variables (production container)

| Var | Value |
|---|---|
| `BONSAI_DATA_BACKEND` | `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from the project (re-check after any key rotation) |
| `ANTHROPIC_API_KEY` | rotated key |
| `BONSAI_IMAGE_PROVIDER` | `gemini` once `GEMINI_API_KEY` exists, else `none` |
| `GEMINI_API_KEY` | optional |
| `VISION_SERVICE_URL` | interim vision host URL, or unset (graceful degradation) |
| `VOYAGE_API_KEY` | Stage B |
| `BONSAI_REPO_ROOT` | not needed in the container (marker discovery works); available as override |

### 3.4 Definition of done

Production smoke test against the live URL: sign-in (via custom SMTP), capture → suggestion → tree creation, photo loads from Storage CDN, Studio design persisted, then **redeploy the container and verify every photo still loads** (the statelessness proof). Screenshot evidence, same method as all prior validation.

---

## 4. Stage B — Voyage embeddings, vision service retirement

**Goal:** delete the 2 GB Python dependency from the architecture — after proving quality, not before.

### 4.1 The benchmark gate (blocking)

Script `scripts/benchmark-voyage-reid.mjs`:
- Embed the reference catalog (~55 captured tree images) and all real capture photos with both DINOv2 (via the running vision service) and `voyage-multimodal-3`.
- Task: same-tree re-identification — for each duplicate/near-duplicate capture, does the true tree rank #1 (and within the current shortlist thresholds)?
- Also spot-check the leaf-species index path (217 leaf references) since Voyage would take that over too.
- **Cutover only if Voyage ≥ DINOv2 on top-1 and top-3.** Otherwise the Python service stays and this stage is shelved — the architecture still works, just at Hetzner-tier hosting cost.

### 4.2 Schema and code changes (post-gate)

- **Dimension mismatch (discovered in review):** existing columns are `vector(768)`; Voyage multimodal-3 outputs 1024-dim. Migration 0007 adds `embedding_v2 vector(1024)` (+ `embedding_model` already tracks provenance) on `photos` and `capture_submissions`; ivfflat index on the new column.
- Matching moves out of the Python service: JS cosine over the candidate set in the web app initially (collections are ≤ hundreds of photos), switching to a pgvector `<=>` query once collections warrant it. The per-embedding-model scoring already in `lib/` means old-space and new-space candidates coexist during transition; a re-embed script converges the backlog.
- Leaf-species suggestions: Voyage-embed the 217-entry leaf index once into a table; the Claude-unavailable fallback path queries it via pgvector instead of the Python endpoint.
- Retire: `services/vision` deployment (repo code can remain for the benchmark/leaf-review tooling), `VISION_SERVICE_URL`, the interim vision host, vision entries in deploy config.

---

## 5. Stage C — robustness + cleanup

1. **Studio stale-job sweeper (required for production trust):** in-process pipelines die with the process; a deploy mid-design leaves a target stuck at `analyzing`. Add: on Studio data load, mark in-progress targets older than 10 minutes as `failed` ("interrupted by a restart — design again"), and a retry button on the failed card.
2. **Backups get restore-tested** once (see guardrails — a backup that's never been restored is a hope, not a backup).
3. Deploy-config cleanup: remove/slim `render.yaml` to whatever survives, update `DEPLOY.md` + `.github/DEPLOYMENT.md` to the final shape, CI unchanged as quality gate.
4. Key hygiene confirmation: chat-exposed Anthropic key rotated; Supabase access token revoked.

---

## 6. Free tier now, Pro on triggers

**Decision: launch early-adopter mode on the Supabase free plan.** The pause risk that killed the project in summer 2026 was an artifact of zero traffic, not a plan property. Four guardrails (all free, all GitHub Actions) make free viable:

| Guardrail | Implementation |
|---|---|
| Keep-alive | Daily scheduled Action pings a health endpoint / runs `select 1` — pausing (7-day-idle) becomes impossible |
| DIY backups | Nightly `pg_dump` + storage-bucket sync to a private, off-Supabase location; **one restore drill** to prove it |
| Custom SMTP | Resend/Brevo free tier in Supabase auth settings (default sender = ~2 emails/hour, an onboarding-killer; custom SMTP → 30+/hour configurable) |
| Storage watermark | Backup job alerts at 800 MB bucket usage so the Pro upgrade is planned, not forced |

**Free-plan ceilings to respect:** ~2,000–2,500 photos (1 GB at current ~400 KB client-side compression), 5 GB egress/month (~10k image views; immutable caching stretches this), 500 MB database (ample — embeddings are KBs), no managed backups (mitigated above).

**Upgrade to Pro ($25/mo: 100 GB storage, 250 GB egress, daily backups, no pausing) when any trigger fires:**
- storage > 800 MB, or
- egress consistently > 4 GB/month, or
- **first paying user** (cleanest: revenue buys it), or
- owner judgment that user data now exceeds what DIY backups should carry.

---

## 7. Execution order and effort

| Step | Depends on | Size |
|---|---|---|
| A1 Guardrail crons (keep-alive, backups, SMTP, watermark) | SMTP account (owner) | small |
| A2 Storage migration code + migration script | — | medium |
| A3 Container deploy (Fly or Hetzner) + deploy Action | **owner: host choice + token** | small–medium |
| A4 Production smoke test incl. redeploy-persistence proof | A2, A3 | small |
| B1 Voyage benchmark | `VOYAGE_API_KEY` (owner) | small |
| B2 Migration 0007 + matching relocation + re-embed + leaf index | B1 gate passed | medium |
| B3 Vision service retirement | B2 validated | small |
| C1 Studio sweeper + retry | — (can run parallel to A) | small |
| C2 Restore drill, config cleanup, docs, key-hygiene check | A, B | small |

Validation bar for every stage: the same as this whole effort — drive the real app, screenshot it, verify the rows/objects landed, never call it done on theory.

## Open decisions

1. **Container host: Fly.io (~$3/mo, zero-ops, vision interim costs extra) vs Hetzner CX22 (~€4.5/mo, one box covers the vision interim too, light self-management).** Needed to start A3 — provide the matching API token.
2. **SMTP provider account** (Resend or Brevo free tier) — needed for A1.
3. **`GEMINI_API_KEY`** (optional, any time) — turns Studio renders photoreal.
4. **`VOYAGE_API_KEY`** — needed to start B1.
5. Confirm the Anthropic key rotation + Supabase token revocation happened.

## Deferred by design (tracked, not planned)

- Cloudflare R2 as an egress-cost lever if image traffic ever dominates Supabase egress.
- Multi-instance scaling, native app (both unlocked by the stateless container + same API).
- Product-feature roadmap (care engine, health diagnosis, journal, timelapse, billing) — lives in the review/roadmap artifact; infrastructure above is sized so none of it requires re-architecture.
