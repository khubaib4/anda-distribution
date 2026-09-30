# Platform administrator business privacy correction

Status (2026-10-01): implemented and tested locally on
`codex/de05-security-gate-foundation`. Independent review reported no actionable
findings; the owner approved commit/push and production deployment. Production
still has the old access rules while backup/rehearsal and deployment are prepared.

Platform administrators may manage business setup, plans, status and the existing
account/membership contact metadata used by platform management. They must not
open business dashboards, settings or business records, or post business changes.
Tenant selection and coincidental owner/staff membership do not grant an exception.
Private server infrastructure credentials remain separate from this human role.

## Changes

- `authorizeApi` denies platform administrators before any business query. Owner
  settings also deny them, including snapshots with both owner and platform flags.
- Platform identity has no business tenant or business permissions. `/api/me`
  ignores tenant selectors for that role. Dashboard server rendering redirects to
  `/admin`; client identity revalidation clears cached business data and redirects
  before mounting business children. Navigation/fetch helpers also deny business
  access. The platform tenant page no longer offers impersonation.
- Sale/purchase creation keeps ordinary authenticated invoice allocation; the
  former platform-admin trusted allocator branch is removed. Counters are unchanged.
- New migration `20260930230547_deny_platform_admin_business_access.sql` adds
  restrictive deny policies on 22 business/access tables. These combine with,
  rather than replace, existing tenant and trusted-write policies. A permissive
  policy or tenant membership cannot override the platform denial.
- Six existing business views use `security_invoker=true`, preserving their
  columns/calculations while enforcing the caller's underlying RLS. This also
  closes their existing anonymous and cross-tenant data exposure.
- Browser roles lose TRUNCATE on the protected tables because TRUNCATE bypasses
  RLS. They lose direct tenant INSERT/UPDATE/DELETE/TRUNCATE, including cascading
  deletion; existing platform and owner-settings APIs use the private server path.
- `is_super_admin()` retains its narrowly required definer lookup with an empty
  search path and qualified references. The service-role-only DE-05 assertion now
  explicitly denies a platform actor. Its grants and owner/staff permissions stay
  the same. Existing valuation guards, invoice functions and business rows remain.
- CODEX.md and the inventory skill now state the corrected privacy policy.

## Evidence

Production inspection used read-only catalog SELECT queries for tables, views,
policies, functions, columns/constraints and function ownership. No business
records were exported or production writes made. The committed test fixture contains schema/security metadata only. All test
records and Auth identities are synthetic, inside disposable network-isolated
PostgreSQL 17.6 containers.

- `node --test tests/*.test.mjs`: 121 tests passed. The new test executes every
  exported business/settings route handler and proves platform denial before
  database access or request-body parsing, including conflicting membership flags.
  Existing invoice/payment and owner/staff regressions also pass.
- `node tests/platform-admin-access-db.mjs`: 162 assertions passed. Covers all
  protected tables, blocked direct writes/TRUNCATE, all six views, anonymous view
  denial, owner view quantities/balances, owner/staff stock create/edit/delete,
  cross-tenant denial, platform owner/staff membership, permissive-policy override,
  trusted assertion checks, staff deletion/module denial, metadata access,
  untouched rows/counters/sequence, drift refusal and exact rollback/reapply.
- Existing foundation suite: 89 assertions plus concurrency/preservation passed.
- Existing original gate suite: 249 assertions passed against its historical
  migration. The corrective suite separately verifies the new denial behavior.
- TypeScript passed. Webpack fallback production build passed. Default build
  fails because native compiler bindings are unavailable on this Mac.
- Full lint: existing 22 errors and 9 warnings. New test/helper/provider code
  passes targeted lint; existing lint issues in changed admin/business pages
  predate this correction. `git diff --check` passes.

## Independent review

The owner supplied the separate review result on 2026-10-01: no actionable
findings. It reported the same 121 app/162 corrective/89 foundation/249 historical
gate checks, plus 30 additional checks for invoice allocation, function permissions,
staff views and inactive costing. Account-switching simulation, stale responses,
cache clearing and navigation/fetch checks passed. No files were changed by review.
Real browser switching/workflows and a fresh production-copy rehearsal remain.

## Review and deployment

1. Independently review the application and new SQL migration together. Review
   the human platform/account metadata boundary and owner/staff compatibility.
2. Obtain explicit commit/push and production deployment approval. Use a fresh
   private backup and rehearse the exact migration and rollback against it, with
   approved access. The synthetic suite is not a production restore rehearsal.
3. Deploy the reviewed application correction first, then the reviewed database
   migration in a coordinated window. Neither deployment alone closes the
   checkpoint: old APIs use a server client that bypasses RLS; old browser rules
   allow direct database reads. Do not apply older migrations retroactively.
4. Verify remote migration history and restrictive policies, all six view options,
   helper definitions/grants, revoked browser TRUNCATE/tenant writes, unchanged
   business records/counters, empty new inventory tables and unused sequence.
5. Using existing signed-in accounts, check platform `/admin` and setup/plan/status
   screens remain available; all business URLs and API reads/writes are denied
   with and without `tenant_id`. Test owner and permitted staff workflows in
   Testing only, with separately authorized synthetic writes. Check browser
   account switching clears business caches. No positive platform business test.
6. Close the policy checkpoint only after both deployed layers and live role
   checks pass. Costing stays inactive. The existing nontransactional sale/
   purchase edit risk is still pending the approved atomic posting work.

Emergency rollback is in `platform-admin-business-access-rollback.sql`. It restores
the prior access policies/view behavior and therefore reopens the privacy defect.
Prefer a reviewed forward fix. Do not run that rollback without explicit approval;
do not roll the app back alone. The local suite proves prior metadata/rows restore
exactly and reapplying the correction closes access again.
