# Platform administrator business privacy correction

Status (2026-10-01): implemented and tested locally on
`codex/de05-security-gate-foundation`. Independent review reported no actionable
findings; the owner approved commit/push and production deployment. Commit `274fc6b51cbf2bf1afc247b49fa343931e3dff70` is pushed; the working tree
was clean after the commit. The reviewed app and database migration are now deployed;
owner/staff live saves passed. Super-admin page checks passed; the final human API check remains pending.

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
policies, functions, columns/constraints and function ownership. During implementation, no business
records were exported or production writes made. The later approved deployment
backup and live Testing writes are recorded below. The committed test fixture contains schema/security metadata only. All test
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
The fresh production-copy rehearsal and owner/staff browser saves are now complete;
platform-account switching/page-denial checks passed; the final human API check remains pending below.

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

## Approved deployment preparation — 2026-10-01

The owner approved commit/push and production deployment and confirmed sales,
purchases, payments, stock/category changes and permission changes paused.
Source commit `274fc6b` is pushed on the existing feature branch; local/remote SHA
matched and main was unchanged. GitHub reports its Vercel build succeeded.

A fresh public schema/business-data/roles backup was saved in a mode 0700
subfolder of the previously approved private backup destination:
`~/.codex/backups/doctors-egg/de05-security-gate-predeployment-20261001-u91uz13h/privacy-predeployment-20261001-kbc7n8xo/`.
Files are mode 0600, outside Git; checksums and diagnostics are retained privately.
It excludes managed Auth/Storage and is not a full platform clone.

The restored backup matched all 25 paused production table fingerprints.
An isolated PostgreSQL 17.6 rehearsal passed 88 checks for the exact migration,
platform denial, owner/staff reads, legacy trusted writes, inactive-cost rejection,
rollback and reapplication. Original rows/counters stayed unchanged and the
valuation sequence remained unused. Managed Auth/extension prerequisites were
supplied only to the local copy; no production Auth change occurred. The disposable
container was removed.

The initial rollback comparison detected pg_dump omitting redundant owner-only
ACL entries on the three closed inventory tables. The subsequent comparison
normalized default ACL representation and verified identical effective privileges,
policy definitions, views and function definitions after rollback. No migration
or application fix was required by this finding.

Migration SHA-256:
`5f89350dee6d834666a1709833bed9a5f7d9efb2fea60b00adaab21d952862c6`.
The remote dry run lists only this migration, with no seeds/roles/vault update.
At this preparation checkpoint no production migration or application deployment
had occurred. The subsequent approved deployment is recorded below.

## Approved production deployment — 2026-10-01

Vercel rebuilt reviewed source commit `274fc6b51cbf2bf1afc247b49fa343931e3dff70`
using the Production environment, then aliased the Ready deployment
`GDMj8TQwkr9vm3XT9Sm5zk2JYaCX` to `anda-distribution.vercel.app` at about
05:05 PKT. This was a direct promotion from the reviewed branch. The release
also fast-forwards main from `4724d32` to the same reviewed code plus these
deployment notes, using a normal non-force push. No unrelated commits, rebase
or source changes are included. Vercel may rebuild that documentation commit;
the application and migration files remain identical to reviewed `274fc6b`.

After the deployed Testing owner stock page loaded, the CLI applied only
`20260930230547_deny_platform_admin_business_access.sql`, with no seed, roles or
vault update. Remote migration history confirms the version. Immediately after
application, all 25 public table counts/fingerprints matched the paused backup,
including invoice counters. No business records changed during migration.

Production metadata matches the rehearsal for policies, functions, triggers and
all six invoker views. The sole serialized relation difference is the existing
sequence's redundant explicit postgres-only ACL versus pg_dump's implicit default;
effective access is identical, and anon/authenticated/service_role still cannot
use or advance the sequence. All 46 checked browser-table grants deny TRUNCATE;
public tenant writes are denied. The 22 restrictive policies are present.
The three inventory tables remain empty, costing fields NULL, and sequence
last_value=1/is_called=false. The six definer-view errors and mutable search-path
warning no longer appear in security advisors. Existing narrowly scoped role-helper/
invoice allocator executable-function warnings and leaked-password-protection
warning remain; no new advisor finding appeared.

Testing owner and existing Testing staff each successfully saved note-only edits
to existing synthetic `SAL-0009` and `PUR-0005` through the deployed app. Both
invoices remain two trays/Rs 20, fully paid, with exactly one matching movement
and two payments each. No new invoices, payments or counter allocations were made.
Staff settings still display Access Restricted. User-controlled owner-to-staff
account switching worked. Only the expected synthetic invoice notes/timestamps
and replacement child/movement IDs changed. A separate network-isolated backup
restore compared all 25 fingerprints after excluding just these two test headers
and their children/movements; all original records and counters match.

Super-admin platform dashboard, Testing tenant metadata and plan/status editor
loaded successfully. Business dashboard/settings/stock/sale/purchase URLs
redirected to `/admin`, including stock and sale URLs with explicit Testing
selection. No business form or record was shown. Staff-to-platform account
switching showed only platform metadata; no stale business view remained. No
super-admin business save was attempted. The existing admin layout is hidden
below its desktop breakpoint; a temporary desktop viewport allowed the check.

The browser tool refused direct navigation to the business API URL with a client
block, so that attempt is not counted as an API denial. The owner was asked to
open the selected-tenant stock API manually while signed in as super-admin and
report its response. That live API check remains pending; the synthetic route
handler tests cover write denial, but no live HTTP write-denial probe was made.
Normal business writes remain paused until the final check completes.
The existing nontransactional edit risk remains; this correction does not activate
DE-05 valuation or implement future posting functions.
