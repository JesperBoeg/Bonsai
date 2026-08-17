# Free-plan guardrails

Bonsai runs on the Supabase **free** plan by design (see
[future-state-plan.md](future-state-plan.md) §6). The free plan is viable because
four guardrails cover exactly what it does not give us. All four are free, and
three of them are GitHub Actions in this repo.

| # | Guardrail | Covers | Where |
|---|---|---|---|
| 1 | Keep-alive | 7-day-idle project pause | [`.github/workflows/keep-alive.yml`](../.github/workflows/keep-alive.yml) |
| 2 | DIY backups | no managed backups on free | [`.github/workflows/nightly-backup.yml`](../.github/workflows/nightly-backup.yml) |
| 3 | Custom SMTP | default sender caps auth email at ~2/hour | Supabase dashboard (owner, one-time) |
| 4 | Storage watermark | 1 GB storage ceiling arrives unannounced | same nightly-backup workflow |

Plus a fifth thing that is not a cron but is part of the same promise: the
**restore drill** ([`.github/workflows/restore-drill.yml`](../.github/workflows/restore-drill.yml)),
because a backup that has never been restored is a hope, not a backup.

---

## Repository secrets and variables

Set these in **GitHub → Settings → Secrets and variables → Actions**.

| Name | Kind | Needed by | Where to find it |
|---|---|---|---|
| `SUPABASE_DB_URL` | secret | nightly backup | Supabase → Project settings → Database → Connection string → URI (session pooler), password included |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | nightly backup | Supabase → Project settings → API → `service_role` key |
| `FLY_API_TOKEN` | secret | deploy | `fly tokens create deploy` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | secret (optional) | keep-alive, CI build | Supabase → Project settings → API → publishable key |
| `APP_URL` | variable (optional) | keep-alive | defaults to `https://bonsai-progress.fly.dev` |
| `SUPABASE_URL` | variable (optional) | backup, keep-alive | defaults to the current project URL |
| `STORAGE_WATERMARK_MB` | variable (optional) | watermark | defaults to `800` |
| `BACKUP_RETENTION_DAYS` | variable (optional) | backup artifacts | defaults to `30` |

Until `SUPABASE_DB_URL` and `SUPABASE_SERVICE_ROLE_KEY` exist, the nightly backup
**fails on purpose** — a silent no-op backup is worse than a red run.

---

## 1. Keep-alive (daily, 06:12 UTC)

Two requests: `GET /api/health` on the app (which itself round-trips to Postgres
through PostgREST and reports `database: "ok"`), and a direct `select` against
the REST API so the database sees traffic even when the container is down. The run
fails if either is unhealthy, which makes it a free uptime check as well.

Verify by hand any time:

```sh
curl -s https://bonsai-progress.fly.dev/api/health | jq
# {"status":"ok","backend":"supabase","database":"ok",...}
```

## 2. DIY backups (nightly, 02:37 UTC)

Each run produces one private artifact, `bonsai-backup-<timestamp>`:

- `bonsai-db-<timestamp>.dump` — `pg_dump --format=custom --schema=public`.
  Supabase-managed schemas (`auth`, `storage`) are deliberately excluded: user
  accounts belong to Supabase Auth, and re-uploading photos through the storage
  API recreates their metadata rows.
- `storage/` — every object in the `bonsai-photos` bucket, plus a `manifest.json`
  with each object's size and sha256.

Artifacts are visible to anyone with repo access and expire after
`BACKUP_RETENTION_DAYS` (30 by default). They live outside Supabase, which is the
point. If image volume outgrows artifacts, swap the upload step for an
S3/R2-compatible sync — the scripts already produce a plain directory tree.

Restore locally:

```sh
node scripts/restore-drill.mjs --dump backup/bonsai-db-<stamp>.dump --storage backup/storage
# with RESTORE_TARGET_DB_URL pointing at a SCRATCH database (the drill wipes it)
```

## 3. Custom SMTP (owner, one-time)

Supabase's built-in email sender is limited to roughly **2 auth emails per hour**
on any plan. Sign-up confirmation is part of onboarding, so that limit is a
product blocker, not an inconvenience. Custom SMTP is supported on the free plan
and raises it to a configurable 30+/hour.

1. Create a free account at [Resend](https://resend.com) (3,000 emails/month) or
   [Brevo](https://www.brevo.com) (300/day) and verify a sender domain or address.
2. Create an SMTP credential. Resend: host `smtp.resend.com`, port `465`,
   username `resend`, password = the API key.
3. Supabase dashboard → **Authentication → Emails → SMTP Settings**: enable custom
   SMTP, fill in host/port/username/password, set the sender name and address to
   the verified sender.
4. Raise **Authentication → Rate limits → Emails per hour** to 30 or more.
5. Supabase dashboard → **Authentication → URL Configuration**: Site URL
   `https://bonsai-progress.fly.dev`, and the same URL in the redirect allow-list
   so `/auth/callback` works.
6. Verify: sign up a throwaway address in production, confirm the email arrives
   from your sender, and click through to a signed-in session.

Status: **not configured yet** — until it is, production sign-ups are capped at
about two per hour.

## 4. Storage watermark (part of the nightly backup)

The backup step measures the bucket and marks the run when it passes
`STORAGE_WATERMARK_MB` (800 MB). Past the mark, a follow-up job opens (or comments
on) a GitHub issue titled *"Storage watermark passed — plan the Supabase Pro
upgrade"*. 800 MB of a 1 GB ceiling leaves room to decide calmly.

Free-plan ceilings worth remembering: ~2,000–2,500 photos (1 GB at ~400 KB each),
5 GB egress/month, 500 MB database. Upgrade triggers are in
[future-state-plan.md](future-state-plan.md) §6.

## 5. Restore drill

Run **Actions → Restore drill → Run workflow** after the first successful nightly
backup. It restores the newest backup into a throwaway `pgvector/pgvector:pg17`
service container and asserts the restored data is usable: expected tables and
the `allocate_tree_sequence()` RPC exist, the species catalog still has its 244
pinned IDs, no photo row is orphaned, and every storage object matches its
manifest hash.

| Date | Backup run | Result | Notes |
|---|---|---|---|
| _pending_ | — | — | Run once after the first nightly backup completes. |

---

## Key hygiene

Credentials that appeared in chat during setup and should be rotated (owner
action, tracked in [future-state-plan.md](future-state-plan.md) §5.4):

| Credential | Action | Status |
|---|---|---|
| Anthropic API key | rotate, then `fly secrets set ANTHROPIC_API_KEY=…` and update `apps/web/.env.local` | owner to confirm |
| Supabase access token (migrations) | revoke in Supabase → Account → Access tokens | owner to confirm |
| Fly deploy token | `fly tokens create deploy`, update the `FLY_API_TOKEN` GitHub secret, revoke the old one | owner to confirm |

The Supabase publishable/anon key is not a secret — it ships in the client bundle
and is scoped by RLS. The `service_role` key is the opposite: it bypasses RLS, so
it belongs only in GitHub Actions secrets and never in the app container.
