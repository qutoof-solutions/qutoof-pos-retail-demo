# Production D1 Schema Drift — Read-only Diagnosis

**Checked:** 2026-10-13 12:20 (+03:00)
**Repository:** `qutoof-solutions/qutoof-crm-2`
**Production branch/SHA:** `main` / `c271c2f3c1665244a69e769ec8a55ab53060a6f1`
**Pages deployment observed:** `0278776d-27e1-42b7-bc46-6f5554794465` (`success`)
**D1 database:** `qutoof-db` / `9eeffd92-b58f-43ca-ac88-a8036e9a9646`
**Method:** Cloudflare API read-only SELECT/PRAGMA, Git history review. No production writes, migration reruns, marker edits, test tenant or user records.

## Executive conclusion

The production D1 migration ledger and actual schema are inconsistent. This is **not only** a missing `branch_memberships` table:

1. `d1_migrations` records both `0019_service_material_guards.sql` and `0020_branch_memberships.sql` as applied.
2. `sqlite_schema` contains none of the expected `branch_memberships` table or its three indexes.
3. The four service-material triggers expected after migration 0019 exist by name, but their actual SQL bodies are older/simple null-check triggers and do not match the validation rules in migration 0019 on `main`.

The root cause cannot be established from current database state and repository history alone. Possibilities include schema alteration outside this migration history, restore/import of schema and migration ledger from different points, or migrations being recorded/applied against another target during the earlier operation. These are hypotheses, not verified explanations.

**Do not rerun migrations 0019/0020, delete or edit ledger entries, or mark migrations manually.** Wrangler normally uses the ledger to decide which files remain pending; because the rows already exist, a normal apply may skip the missing schema effects. A corrective forward migration is likely needed, but its exact contents and application plan require separate review and authorization because it will mutate production.

## Read-only evidence

### Migration ledger

On the exact Cloudflare D1 UUID above, `d1_migrations` columns are `id`, `name`, and `applied_at`. The rows returned were:

| id | migration name | recorded applied_at |
|---:|---|---|
| 20 | `0019_service_material_guards.sql` | `2026-10-13 09:02:25` |
| 21 | `0020_branch_memberships.sql` | `2026-10-13 09:03:12` |

This output contains migration metadata only, not tenant or customer data.

### Missing 0020 objects

Read-only `sqlite_schema` search returned no objects matching `branch_membership`. Specifically absent:

- table `branch_memberships`
- unique index `branch_memberships_user_branch_uq`
- index `branch_memberships_user_idx`
- index `branch_memberships_branch_idx`

`PRAGMA table_info('d1_migrations')` returned the expected ledger structure; there was no `branch_memberships` table to inspect.

### 0019 trigger mismatch

`0019_service_material_guards.sql` in the merged `main` is expected to replace the four triggers with these controls:

- positive `quantity_per_service`;
- service, item and warehouse tenant-scope checks;
- active item/warehouse checks;
- service/warehouse branch consistency;
- required warehouse on update.

The production `sqlite_schema` rows instead contained the following reduced logic:

- `service_material_validate_insert`: reject only NULL `warehouse_id`, message `warehouse_id cannot be null`;
- `service_material_validate_update`: reject only NULL `warehouse_id`, same message;
- `service_materials_require_warehouse_insert`: reject only NULL `warehouse_id`, message `warehouse_id required`;
- `service_materials_require_warehouse_update`: reject only NULL `warehouse_id`, same message.

Those definitions do not match migration 0019. Exact SQL searched in all available Git history found no source for these old message strings. Thus the mismatch is present for 0019 as well as 0020; do not consider the inventory-guard migration verified merely because its ledger row exists.

### Published code

Cloudflare Pages reports a successful production deployment of `main` commit `c271c2f3c1665244a69e769ec8a55ab53060a6f1`, which merges PR #4 and includes the branch-membership code. `lib/server/branch-access.ts` queries Drizzle table `branch_memberships`. Since the table is absent, protected operational routes that invoke the helper are at risk of database errors (for example, “no such table”). This impact is a code/schema inference; no authenticated production API operation was issued to verify it.

A public `/login` HTTP 200 is only an availability check; it does not establish operational API health.

## What was and was not verified

- Verified: exact Cloudflare account/database, D1 migration rows, relevant object names and trigger SQL, production Pages commit and deployment status, migration source in merged Git.
- Not verified: why the ledger and schema diverged; who/what altered or restored the schema; historical Cloudflare audit logs; all production data validity; authenticated route behavior; heartbeat delivery; raw log privacy.
- No production data or schema was changed. No migration was reapplied and no migration marker was inserted or removed.
- A Wrangler `d1 migrations list --remote` attempt could not be used because the local Wrangler CLI initiated a fresh OAuth flow requesting broad Cloudflare scopes; it was cancelled. The read-only Cloudflare API query above is the evidence source for the ledger/schema observation.

## Safe recovery direction — proposal only, not executed

1. Keep production unmodified while the owner reviews this mismatch. Do not use migration re-run or manual ledger repair as a shortcut.
2. Confirm the database UUID and re-query the migration ledger and the exact table/trigger definitions immediately before any recovery.
3. Prepare a **new forward corrective migration**, with a new migration ID (for example `0021_reconcile_service_material_and_branch_membership_schema.sql`) rather than editing historical `0019` or `0020` files. The candidate should:
   - recreate all four 0019 triggers exactly to the reviewed intended contract;
   - create `branch_memberships` and indexes idempotently where absent;
   - perform only the intended membership backfill and be safe against duplicate rows if rerun in a local validation environment;
   - avoid deleting or replacing existing tables/data;
   - include explicit pre/post checks for the resulting table, indexes, trigger SQL and membership counts.
4. Test the corrective migration on an isolated local D1 made from the repository migrations, and test a second local fixture simulating the observed drift (migration ledger has 0019/0020 entries, but schema has old triggers and no membership table). This checks repair behavior without copying production data.
5. Have the application owner review the migration SQL/backfill and resulting permission effects before production application. Existing access may fail while the branch-membership table is absent, so coordinate the repair and matching application version as one controlled maintenance step.
6. Only after approval and verified local simulations, apply the **new** corrective migration through the project’s migration tool, not by direct SQL or manual ledger edits. Then verify only schema metadata and aggregate counts.
7. Re-run production smoke tests only after the corrective migration is verified, using a dedicated synthetic tenant and avoiding external message dispatch. Never describe an unverified test as passed.

The previous approval covered the planned merge, application of migrations 0019 then 0020, Pages deployment and synthetic acceptance. The current production state materially contradicts that planned precondition, so this corrective production action was not covered by that approval. Request explicit authorization for the reviewed corrective migration and controlled deployment after presenting its exact SQL and impact.


## Corrective migration 0021 — prepared and locally verified (not published/applied)

Candidate SQL is `drizzle/migrations/0021_reconcile_production_schema_drift.sql` on local branch `fix/production-d1-schema-recovery`, based on merged `origin/main` SHA `c271c2f3c1665244a69e769ec8a55ab53060a6f1`.

It is a forward-only, additive repair:

- `CREATE TABLE IF NOT EXISTS branch_memberships` with the existing Drizzle definition and the three expected indexes (`IF NOT EXISTS`).
- Backfill only active business administrators/owners/admins across their active tenant branches, and active clinicians only to branches evidenced by their schedules. It intentionally does not grant reception/storekeeper access. The existing 0020 rule for a schedule with `branch_id IS NULL` is preserved.
- `INSERT OR IGNORE` plus membership existence/unique checks prevents duplicate assignments if exercised again locally.
- Drop/recreate only the four `service_materials` triggers, with SQL matching the canonical 0019 trigger bodies; no service/material/warehouse rows are updated or deleted.
- It does not alter `d1_migrations`; the Wrangler migration runner records 0021 after successful execution.

### Local validation results

All testing used in-memory SQLite or an isolated `/tmp` Wrangler D1 directory; no production request or write was made.

| Check | Result |
|---|---|
| `python3 scripts/d1_drift_recovery.py` | Pass. The fixture has ledger rows for 0019/0020, the observed old null-only triggers, and no `branch_memberships` table. It checks object creation, least-privilege backfill, exact equality of repaired trigger SQL to canonical 0019, representative rejects for wrong tenant/inactive item/warehouse/branch/quantity, idempotent second execution, foreign keys, and unchanged ledger rows. |
| `npm run test:integration` | Pass. Applies all 22 SQL migrations locally and invokes the drift-recovery fixture. |
| `npm test` | Pass — 50/50 unit tests. |
| `python3 -m py_compile scripts/phase4-integration.py scripts/d1_drift_recovery.py` | Pass. |
| `python3 -m json.tool drizzle/migrations/meta/_journal.json` | Pass; journal contains ordered idx 21/tag `0021_reconcile_production_schema_drift`. |
| Wrangler local migration apply/list | Pass. `0021_reconcile_production_schema_drift.sql` applied in a separate path with `--local`; subsequent local list reported no migrations to apply. This was not `--remote`. |
| `git diff --check` | Pass. |

### Proposed controlled production sequence — approval still required

1. Review the exact SQL file and this report. No commit/PR or production change has been made yet.
2. After explicit approval, publish the local recovery branch through a PR to `main`; require CI and confirm the merge SHA. The code application is already deployed; this patch adds schema migration/tests, not new app behavior. A main merge may trigger the normal Pages build, but do not treat that build as a database repair.
3. Immediately before migration, repeat read-only preflight against D1 UUID `9eeffd92-b58f-43ca-ac88-a8036e9a9646`: confirm 0019/0020 remain recorded, all three membership objects are absent, and the four trigger definitions are still the observed old bodies. If any object/data condition differs, stop and reassess rather than assuming this SQL applies.
4. Apply via the project’s Wrangler migration command only, with no direct SQL and no manual ledger changes. Expected pending work is **only 0021**. Stop if Wrangler reports 0019, 0020, or any unrelated migration pending. Do not set `CI=1` for the remote run.
5. Read-only postflight: confirm the 0021 ledger entry, membership table and indexes, and all four trigger bodies match migration 0019. Query only schema metadata and aggregate membership counts.
6. Only after postflight succeeds, continue the approved synthetic acceptance path; use non-real data and prevent WhatsApp/external dispatch. Record any step not run as unverified.

**Execution constraint:** The local Wrangler CLI currently has no usable remote OAuth session; its read-only `--remote` attempt opened a broad-scope OAuth flow and was cancelled. If final approval is given, use the authorized Wrangler route only after resolving CLI authorization in the official flow (with user takeover if required). Do not bypass this by sending credentials in chat or by executing raw SQL through the API.

**Current state:** candidate prepared and locally tested on a branch; no commit, push, PR, production migration, Pages deployment, or synthetic production data has been performed. The production repair is not yet authorized by the final confirmation requested after this review.
