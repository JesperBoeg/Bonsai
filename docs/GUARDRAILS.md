# Free-plan guardrails

Bonsai runs on the Supabase **free** plan by design (see
[future-state-plan.md](future-state-plan.md) §6). The free plan is viable because
four guardrails cover exactly what it does not give us. All four are free, and
three of them are GitHub Actions in this repo.

| # | Guardrail | Covers | Where |
|---|---|---|---|
| 1 | Keep-alive | 7-day-idle project pause | [`.github/workflows/keep-alive.yml`](../.github/workflows/keep-alive.yml) |
| 2 | DIY backups | no managed backups on free | [`.github/workflows/nightly-backup.yml`](../.github/workflows/nightly-backup.yml) |
| 3 | Custom SMTP | default sender caps auth email at ~2/hour | Brevo relay, configured in Supabase auth (done 2026-08-17) |
| 4 | Storage watermark | 1 GB storage ceiling arrives unannounced | same nightly-backup workflow |

Plus a fifth thing that is not a cron but is part of the same promise: the
**restore drill** ([`.github/workflows/restore-drill.yml`](../.github/workflows/restore-drill.yml)),
because a backup that has never been restored is a hope, not a backup.

---

## Repository secrets and variables

Set these in **GitHub → Settings → Secrets and variables → Actions**.

| Name | Kind | Needed by | Where to find it |
|---|---|---|---|
| `SUPABASE_DB_URL` | secret | nightly backup | **set 2026-08-17.** Session pooler URI: `postgresql://postgres.epqxygxvvlsobbyhhnke@aws-1-eu-central-1.pooler.supabase.com:5432/postgres` with the database password. Session mode on 5432, not transaction mode on 6543 — `pg_dump` needs a session, and GitHub runners are IPv4-only while the direct host is IPv6-only |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | nightly backup | **set 2026-08-17.** Supabase → Project Settings → API Keys → `service_role` |
| `FLY_API_TOKEN` | secret | deploy | **rotated 2026-08-17** to app token `github-actions-deploy-2026-08` (1-year expiry); the previous token was revoked. Renew with `fly tokens create deploy -a bonsai-progress -x 8760h` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | secret (optional) | keep-alive, CI build | Supabase → Project settings → API → publishable key |
| `APP_URL` | variable (optional) | keep-alive | defaults to `https://bonsai-progress.fly.dev` |
| `SUPABASE_URL` | variable (optional) | backup, keep-alive | defaults to the current project URL |
| `STORAGE_WATERMARK_MB` | variable (optional) | watermark | defaults to `800` |
| `BACKUP_RETENTION_DAYS` | variable (optional) | backup artifacts | defaults to `30` |

All three are set. Should either Supabase secret ever be removed, the nightly
backup **fails on purpose** — a silent no-op backup is worse than a red run.

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

**In place since 2026-08-17: Brevo.** `smtp-relay.brevo.com:587`, login
`b5ce77001@smtp-brevo.com`, sender `Bonsai <agileupgrade@gmail.com>`, and
`rate_limit_email_sent` raised from 2 to **30/hour**. Brevo's free tier allows 300
emails/day. The SMTP key lives only in Supabase's auth config — rotate it in
Brevo (**SMTP & API → SMTP**) and re-apply if it ever leaks.

Brevo was chosen over Resend for one reason: it verifies a single *sender address*
by email, so it needs no DNS records. The cost is deliverability — mail sent as a
Gmail address without domain authentication lands in spam more often. If that
starts to matter, register a domain, verify it with Brevo (or Resend), and change
the sender; nothing else about the setup changes.

To reconfigure, either use the dashboard (**Authentication → Emails → SMTP
Settings** and **Authentication → Rate Limits**) or `PATCH
/v1/projects/<ref>/config/auth` with `smtp_host`, `smtp_port` (**as a string** —
the API rejects a number), `smtp_user`, `smtp_pass`, `smtp_admin_email`,
`smtp_sender_name`, `rate_limit_email_sent`.
5. URL configuration — **already done (2026-08-17)**, and it was wrong before:
   Site URL was still `http://localhost:3000`, so every production confirmation
   link pointed at a machine that is not the app. It is now
   `https://bonsai-progress.fly.dev/auth/callback` (the path matters — GoTrue
   redirects the confirmation link there verbatim, and that route is what exchanges
   the code for a session), with the allow-list covering
   `https://bonsai-progress.fly.dev/**` plus localhost ports 3000 and 3100 for
   development.
**Verified end to end on 2026-08-17**: Brevo authenticated and accepted the sender
in a live `MAIL FROM`/`RCPT TO` probe; a production sign-up was accepted with no
send error and GoTrue recorded `confirmation_sent_at` 30 ms later; the email was
delivered and its link clicked (`email_confirmed_at` 16:50:58Z, ~3.5 minutes after
sign-up); the confirmed account then signed in and reached the capture flow. The
throwaway account was deleted afterwards.

One behaviour worth knowing rather than fixing: the confirmation link carries a
PKCE `?code=`, and `/auth/callback` can only exchange it in the browser that
signed up (the verifier lives in a cookie there). Sign up and click on the same
device → straight into the app. Click on a different device → the account is
confirmed and the user signs in with their password. Both paths work; only the
first is a single click.

## 4. Storage watermark (part of the nightly backup)

The backup step measures the bucket and marks the run when it passes
`STORAGE_WATERMARK_MB` (800 MB). Past the mark, a follow-up job opens (or comments
on) a GitHub issue titled *"Storage watermark passed — plan the Supabase Pro
upgrade"*. 800 MB of a 1 GB ceiling leaves room to decide calmly.

Free-plan ceilings worth remembering: ~2,000–2,500 photos (1 GB at ~400 KB each),
5 GB egress/month, 500 MB database. Upgrade triggers are in
[future-state-plan.md](future-state-plan.md) §6.

## 5. Restore drill

**Passed 2026-08-17 — 12/12 checks.** Re-run **Actions → Restore drill → Run
workflow** whenever the schema changes materially. It restores the newest backup into a throwaway `pgvector/pgvector:pg17` service
container and asserts the restored data is usable: expected tables and the
`allocate_tree_sequence()` RPC exist, the species catalog still has its 244 pinned
IDs, no photo row is orphaned, and every storage object matches its manifest hash.

The restore runs in three phases — schema + data, then seeding `auth.users` from
the restored owner ids, then constraints and policies. That is not ceremony: the
dump's foreign keys point at `auth.users`, a table Supabase owns and the dump
deliberately does not carry, so restoring in one shot buries real problems under
ignored errors. Done in phases, the foreign keys have to build, which additionally
proves every owner id survived the round trip. Two complaints are still expected
and explicitly allowlisted (`--clean` cannot drop `public` because the scratch
database must pre-create pgvector); any other error fails the drill.

| Date | Backup run | Result | Notes |
|---|---|---|---|
| 2026-08-17 | `bonsai-backup-20260817T152958Z` (75 KB dump, 4 objects / 0.7 MB) | **PASS 12/12** | Restored into `pgvector/pgvector:pg17`. 244 species with no ID drift, `allocate_tree_sequence()` present, 3 trees / 3 photos / 3 submissions / 3 targets, no orphan photos, 4/4 storage hashes matched, every foreign key rebuilt. |

---

## Key hygiene

Credentials that appeared in chat during setup and should be rotated (owner
action, tracked in [future-state-plan.md](future-state-plan.md) §5.4):

| Credential | Action | Status |
|---|---|---|
| Anthropic API key | rotate, then `fly secrets set ANTHROPIC_API_KEY=…` and update `apps/web/.env.local` | owner to confirm |
| Supabase access token (migrations) | revoke in Supabase → Account → Access tokens | owner to confirm |
| Fly deploy token | rotated to `github-actions-deploy-2026-08`, GitHub secret updated, verified by a deploy, old token revoked | **done 2026-08-17** |
| Supabase database password | reset via the Management API; the new one exists only inside the `SUPABASE_DB_URL` secret. `npx supabase db push` will prompt for it — reset it again in the dashboard when you next need it by hand | **rotated 2026-08-17** |
| Supabase Management access token | a temporary one was used for the work above; revoke it at https://supabase.com/dashboard/account/tokens | owner to revoke |

The Supabase publishable/anon key is not a secret — it ships in the client bundle
and is scoped by RLS. The `service_role` key is the opposite: it bypasses RLS, so
it belongs only in GitHub Actions secrets and never in the app container.
