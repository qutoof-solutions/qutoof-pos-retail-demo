# Operational Hardening — Branch Isolation and Production Readiness

**Audit date:** 2026-10-12 (UTC+03:00)  
**Production URL:** https://qutoof-crm-2.pages.dev  
**Production D1:** `qutoof-db`  
**Working branch:** `feature/branch-membership-hardening`  
**Scope:** Source review, local SQLite/D1 and local Pages HTTP tests, plus read-only production observations. No production account, patient, appointment, invoice, inventory, or telemetry records were created or modified.

## Implemented on the working branch

- Added `branch_memberships` with tenant/user/branch keys, uniqueness and indexes, plus migration `0020_branch_memberships.sql`.
- Backfills tenant administrators to active branches and clinicians only to branches implied by their schedules. Reception and storekeeper access is deliberately **not** granted to every branch by default; those roles must be assigned explicitly.
- Added shared server-side branch/warehouse scope helpers and a protected branch-membership API and Arabic UI.
- Applied membership checks and branch-scoped queries/mutations across appointments, gate tickets, queue, schedules, services, customer files/records/EMR/prescriptions, invoices/payments, reports, settlements/commissions, POS, inventory/warehouses/movements/materials, purchases, suppliers, onboarding and shared settings.
- Patient/customer resources outside the caller's branch scope return a non-enumerating 404. Writes also validate the original and target branch; client-provided `branchId` alone is never authorization.
- Hardened future audit writes: raw IP and user-agent are no longer stored; patient/appointment/clinical identifiers, direct contact details, credentials, request references and clinical resource IDs are filtered from audit payloads. Opaque tenant/actor identifiers remain for accountability. Historical production audit/log entries were not read, reviewed, or scrubbed.
- Fixed a latent Z-report close failure discovered by local acceptance testing: the raw `UPDATE shift_settlements` omitted its final `tenantId` binding. Tenant-scoped update now binds both settlement ID and tenant ID before the atomic batch.

## Local verification

All checks below ran against local code and synthetic data. HTTP tests used `127.0.0.1:8788` and a local persistent D1 directory. No command used `--remote`.

| Check | Result |
|---|---|
| `npm run test` | Pass — 50/50 unit tests, including audit privacy redaction |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, no warnings |
| `npm run test:integration` | Pass — SQLite migration/integration suite, including branch-membership backfill and least-privilege assertions |
| `npm run test:inventory` | Pass — inventory, supplier, expiry, FEFO, transfer and POS coverage |
| `npm run build` | Pass |
| `npm run pages:build` | Pass — Cloudflare Pages artifact generated |
| `QUTOOF_API_BASE=http://127.0.0.1:8788 npm run test:api` | Pass — full synthetic HTTP acceptance path: onboarding identity/branch/schedule completion; two-tenant/two-branch isolation; explicit membership assignment and cross-branch denial; QR issue/check-in and one-use replay rejection; synthetic EMR and prescription; POS/payment and idempotency; inventory/purchase/supplier operations; queue/service consumption; Z-report shift open/close and balanced cash lines. |

The local persistent D1 test database received migrations `0012`–`0020`; this was not the production database. Test patients, staff and clinical fixtures were synthetic and local only.

## Production observations — read-only

| Check | Observation | Result |
|---|---|---|
| Public login | `GET https://qutoof-crm-2.pages.dev/login` returned HTTP 200. | Pass for availability only; not an authenticated workflow test |
| Production schema at last Cloudflare read-only audit | Latest recorded migration was `0018_familiar_mastermind.sql`; migration `0019_service_material_guards.sql` was not recorded. | Drift: migration 0019 is pending before 0020 |
| Membership schema | `branch_memberships` was absent at that audit. | Blocker: branch authorization code/migration is not deployed |
| Worker telemetry | No production heartbeat or worker-job-run rows were returned. | No evidence of active heartbeat/job execution |
| Cron Worker | The production account’s Worker script listing was empty at that audit. | WhatsApp scheduled Worker was not found in that account |
| Raw logs | Not opened. | Production log cleanliness cannot be claimed |
| Production lifecycle | No test tenant or operational records were created. | Not executed |

## Acceptance status and safe next steps

**Operational hardening is implemented and passed local verification, but production closure is not complete.** The live database contains tenant data and was observed at migration 0018, without `branch_memberships`; the scheduled Worker was not found. Therefore the full production onboarding → walk-in/calendar → QR gate → EMR/prescription → POS/inventory → shift/Z-report cycle has **not** been production-tested.

Before production acceptance:

1. Review and publish the working branch through the release process.
2. Apply the missing migration chain to production in order: `0019_service_material_guards.sql`, then `0020_branch_memberships.sql`. Do not apply 0020 by itself to the observed production state.
3. Deploy the matching Pages build and verify schema consistency and the membership endpoint.
4. Confirm the scheduled Worker configuration/deployment and observe a new heartbeat through aggregate, non-sensitive telemetry.
5. Run a controlled production test using a dedicated, clearly synthetic test tenant/account and non-real patient data; capture results for every requested lifecycle step. Avoid modifying existing customer records.
6. Review Cloudflare/application logs through an approved redacted or aggregate view. The code change prevents sensitive fields in new application audit records, but does not retroactively remove historical log data.

No R2 backup or automated payment gateway was added; these remain deferred as agreed to stay within the free-tier/manual-payment plan.


## Production follow-up — 2026-10-13 (read-only, supersedes earlier observations)

A fresh Cloudflare API inspection confirmed that the Pages production deployment is now `success` for `main` commit `c271c2f3c1665244a69e769ec8a55ab53060a6f1` (deployment `0278776d-27e1-42b7-bc46-6f5554794465`). The exact D1 database checked was `qutoof-db` (`9eeffd92-b58f-43ca-ac88-a8036e9a9646`). The migration ledger records `0019_service_material_guards.sql` and `0020_branch_memberships.sql` as applied at `2026-10-13 09:02:25` and `09:03:12`, respectively.

However, read-only `sqlite_schema` checks found **no** `branch_memberships` table or any of its three expected indexes. In addition, the four expected service-material triggers exist by name but their SQL bodies are the earlier null-only checks, not the stronger tenant/item/warehouse/branch validations in migration 0019 on `main`. Git history review found no source for the old production error-message bodies. Therefore the schema drift affects both migrations 0019 and 0020; the ledger is not evidence that their schema effects exist.

This finding supersedes the earlier production-schema observations above. Root cause remains unknown from available read-only evidence. No production writes, migration reruns, manual ledger edits, test tenant creation, or authenticated production API calls were performed. Because deployed branch-access code queries the absent table, operational endpoints using it are at risk of database errors; this impact is inferred from source/schema, not confirmed by live authenticated API tests. The Pages `/login` HTTP 200 remains an availability-only check.

Do not rerun 0019/0020 or alter `d1_migrations`. A new corrective forward migration must be designed/tested against an isolated fixture reproducing this exact drift, reviewed, and separately authorized before production repair. See `docs/production-d1-schema-drift-diagnosis.md` for the evidence and proposed recovery sequence.


## Corrective migration candidate — 2026-10-13 (local only)

A forward migration candidate `0021_reconcile_production_schema_drift.sql` and a dedicated SQLite drift-recovery fixture were prepared on local branch `fix/production-d1-schema-recovery`, based on production `main` SHA `c271c2f3c1665244a69e769ec8a55ab53060a6f1`. It recreates the canonical 0019 service-material triggers, creates the missing branch-membership table/indexes idempotently, and backfills only administrative roles and clinicians with matching schedules under existing least-privilege rules.

Local checks passed: `npm run test:integration` (22 migrations plus a simulated production drift fixture), `npm test` (50/50), Python compilation, migration journal JSON validation, isolated Wrangler D1 local apply/list, and `git diff --check`. The drift fixture verifies the production-like 0019/0020 ledger rows do not get edited, the stale triggers are replaced with SQL identical to 0019, membership backfill is limited and repeat-safe, and invalid cross-tenant/inactive/cross-branch service-material changes are rejected.

This is a **candidate only**: it is not committed, pushed, merged, applied remotely, or deployed. Production repair still requires explicit final approval after review of the exact SQL and sequence in `docs/production-d1-schema-drift-diagnosis.md`. No production data was changed.
