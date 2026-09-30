# DE-05 Security Gate Foundation

Policy clarification from the project owner on 2026-10-01: platform super-admins
must not view or modify tenant business data. Earlier selected-tenant super-admin
permissions/tests in this document describe the implemented historical behavior,
not the required SaaS policy. API authorization, database read policies and the
deployed DE-05 permission assertion require the local correction documented in
[platform-admin-business-access.md](platform-admin-business-access.md). It has
passed local tests and awaits independent review and production deployment.
Positive super-admin tenant-write testing has stopped. Do not add a profile to
enable those forbidden writes. The synthetic sale was repaired as Testing owner;
next security work is review and approved deployment of that denial correction.

Status: SQL migration deployed and database-verified on 2026-10-01. Owner workflows and representative staff checks passed. The failed synthetic super-admin sale edit was repaired through Testing owner and database-verified at 03:51–03:52 PKT; stock/payments are reconciled. Platform super-admin business access still conflicts with the newly clarified SaaS policy and requires correction; do not close the security checkpoint. The existing nontransactional edit risk also remains. The server helper remains unused by existing routes and no application deployment was performed. Costing remains inactive.
This document is a review/deployment plan, not approval to execute production SQL.

## What this chunk does

- Adds `assert_inventory_posting_permission_de05(uuid,uuid,text,text)`, a read-only
  permission assertion callable only by `service_role` (the trusted server).
- Requires a verified actor and a non-NULL, existing tenant on every check.
  Owners retain full access. Staff use DE-19 sales, purchases, or stock permissions.
  Staff deletion stays forbidden regardless of stored `canDeleteRecords` values.
- Matches `resolvePermissions`: canonical keys take priority over module names;
  malformed recognized values deny; missing/non-object JSON retains defaults.
  Membership and super-admin rows are read fresh, and ambiguous membership denies.
- Adds the server-only `authorizeInventoryPosting` helper. It gets identity from
  verified Auth through `authorizeApi`, never from request JSON. Ordinary members
  use their membership tenant; super-admins must explicitly select a valid tenant
  in `tenant_id`, even if they also have a membership. Missing/error RPC results deny.
- Adds two database triggers keeping the new sale cost and stock valuation fields
  NULL. Legacy rows remain editable/deletable. Valued rows cannot be introduced,
  cleared, edited, or deleted through row writes, including service-role writes.
  The triggers inspect final rows after any BEFORE triggers.
- Adds no inventory table/sequence grants, RLS policies, posting endpoints,
  posting functions, valuation calculations, or cutover/reset behavior.

Migration: `supabase/migrations/20260930202806_de05_security_gate_foundation.sql`.
Rollback: `supabase/verification/de05-security-gate-rollback.sql`.

## Trust boundary and future integration

The server-only helper is currently unused by existing routes. It is a preflight,
not a reusable authorization token and not an atomic posting operation. The SQL
assertion uses SECURITY INVOKER and performs only reads; it grants no write capability.

Ordinary database roles cannot supply a forged actor to the assertion: they have
no EXECUTE permission. The trusted server must derive the actor from verified
Auth. SQL receives an explicit tenant, but cannot prove that a browser selected
it; enforcing that selection belongs to `authorizeApi` in the trusted server path.
Super-admin browser/session RPC access is denied, just like other authenticated users.

Future trusted posting must repeat this assertion inside the same database
transaction as document, item, movement, and locked balance writes. It must validate
all referenced records against the selected tenant. A separate reviewed migration
must close legacy direct write paths and introduce the narrow posting capability
before replacing these inactive-field guards. Successful permission checks alone
cannot enable costing or solve stock concurrency. Do not add a caller-controlled
session setting or flag to bypass the guards.

Existing sale/purchase header writers, item/movement writers, payment/capital
sync, permission defaults, stock conversions, reports, and invoice allocation are
unchanged. Existing legacy direct writes are not fully secured by this chunk;
their grants/policies are deliberately preserved for current workflows. The
DE-18 counters must never be reset during future cutover.
The row guards do not remove any existing legacy TRUNCATE privileges. Restricting
all legacy inventory writes and table-wide privileges belongs to the future
trusted-posting migration before valued data can exist.

## Migration and recovery safety

The migration is transactional with bounded lock/statement waits. It refuses an
already used foundation, inventory policies, disabled inventory RLS, effective
table/column/sequence access (including inherited grants), or ordinary writes to
membership/super-admin authorization sources. It changes no existing grants,
policies, constraints, foreign keys, counters, or business rows. Only the assertion,
guard function, and two guard triggers are added. No new SECURITY DEFINER function
or default-privilege changes are introduced. Function EXECUTE grants are explicit.

Before any separately approved production deployment:

1. Review this migration and rollback against the authoritative live catalog.
   Confirm the deployed inactive foundation and DE-SECURITY-01 protections remain
   intact. Obtain a private restorable backup and schedule a paused-write window.
2. Rehearse migration/rollback using a disposable database restored from that
   backup. These automated tests use a reduced synthetic fixture, not the full
   production schema; unknown live triggers/cascades still require review.
3. Confirm all inventory tables are empty, the valuation sequence is unused with
   `last_value = 1`, and all new valuation fields are NULL. Record existing business
   rows, counters, grants, RLS policies, triggers, and functions for comparison.
4. Apply only after explicit approval. Verify the new routine is callable only by
   the trusted server, both AFTER guard triggers are enabled, inventory remains
   closed/empty, counters and business rows are unchanged, and old security objects
   are unchanged. Run security advisors as part of the approved deployment review.
5. With separately authorized test writes, smoke-test owner/staff/super-admin sale
   and purchase create/edit/delete, including paid/partial/unpaid records and their
   payments/ledgers. Check staff module denials, staff deletion denial, cross-tenant
   references, and super-admin missing/invalid/explicit tenant selection. Check
   opening stock and egg/tray adjustments still follow current legacy behavior.
   Confirm new valuation fields remain NULL and invoice allocation is unchanged.

Rollback removes only this chunk's two triggers and two functions, leaving the
inactive schema in place. It refuses saved valuation, nonempty inventory, a consumed
sequence, or changed inventory table/column grants/RLS/policies/sequence privileges.
It never resets a sequence or counter. No CASCADE is used. Before rollback, inspect
and remove any future application/posting callers: PostgreSQL does not automatically
track every dependency in PL/pgSQL function bodies. Foundation rollback, if ever
approved, must happen after this gate rollback because the guards depend on its fields.

## Production preparation — 2026-10-01

Read-only production preflight passed at 01:59:59 PKT. PostgreSQL is 17.6.
All three inventory tables are empty with RLS enabled and no policies or effective
app-role table/column grants. The valuation sequence remains `1`/unused with no
app-role access. New movement/sale cost fields are NULL. The trusted role can read
tenants/members/super-admin sources and bypasses RLS; ordinary roles have no
effective table/column writes to the membership or super-admin sources. Required
column types match the migration, and no conflicting guard functions or noninternal
triggers exist on the affected inventory/item/movement tables.

Remote history contains only the deployed security, invoice-counter, and inactive
foundation migrations. CLI `db push --skip-vault --dry-run` lists exactly this gate
migration, with no seeds or role-file changes. No production migration was applied.
Business-row and existing security fingerprints were captured privately; refresh
those baselines after the separately confirmed write pause before deployment.

Supabase reported no available backup entry and PITR disabled. After explicit
approval for the payload/destination, fresh public business schema/data and role
definitions were exported privately outside Git under
`~/.codex/backups/doctors-egg/de05-security-gate-predeployment-20261001-u91uz13h/`.
The folder is mode 0700 and backup files are mode 0600; checksums are recorded.
This covers public business data, not managed Auth/Storage or a full platform clone.

The backup restored to a new network-isolated PostgreSQL 17.6 container, with
managed Auth/extension prerequisites supplied locally. The exact gate migration,
guarded rollback, and reapplication passed against that restored production
schema/data. Original business-row fingerprints and invoice counters stayed
unchanged. Legacy service-role item/movement row updates worked; an attempt to
set new sale costing was rejected. Two guard triggers and service-only assertion
access were verified. The rehearsal container was removed. Production app
write smoke tests remain pending; local restore checks do not establish those.

The migration SHA-256 is `e662581d19923c09613682094ca92412d4062ab8f7880f58155f458b62c3ebe4`.
The user subsequently approved the migration deployment and confirmed affected
writes paused. Production workflow smoke tests remain pending. The new server
helper remains unused by existing routes.

## Production deployment — 2026-10-01

After explicit approval and confirmation that sales, purchases, stock adjustments,
category changes and permission changes were paused, the public business backup
was refreshed in the same approved private folder. Both snapshots are retained.
The refreshed backup again passed local restore, exact migration, guarded rollback
and reapplication checks in an isolated PostgreSQL 17.6 container, then that
container was removed.

Applied exactly `20260930202806_de05_security_gate_foundation.sql` using
`supabase db push --skip-vault --yes`. Only this migration was pending/applied;
no seed, role file, vault update, application deployment, reset or live test record
was included. Its SHA-256 remains the reviewed value recorded above. The source
commit is `3cafefc347fa6d943b8cea452bab32ec8c2fa8c0` on
`codex/de05-security-gate-foundation`; it is pushed, not merged into main.

Read-only database verification completed at 02:10:25 PKT:

- Remote migration version matches the local version; all four expected migrations
  are recorded, with no history repair.
- Both new functions match the exact reviewed bodies, use SECURITY INVOKER and an
  empty search path. Assertion EXECUTE is available to service_role and denied to
  PUBLIC/anon/authenticated; the guard function has no direct app-role EXECUTE.
- The two expected row guards are enabled AFTER INSERT/UPDATE/DELETE triggers on
  sale_items and stock_movements.
- Inventory tables remain empty, RLS enabled with no policies, and no effective
  app-role table/column/sequence privileges. Sequence remains `1` and unused;
  all new costing/valuation fields are NULL. Authorization sources remain protected.
- Original-row counts and fingerprints match before deployment: 47 sales,
  18 purchases, 47 sale items, 20 purchase items, 71 stock movements, 20 categories,
  eight invoice counter rows, six membership rows and one super-admin row.
- Existing relation grants/RLS, policies, noninternal triggers and public function
  definitions/grants match their before-deployment fingerprints.
- No production create/edit/delete test, invoice allocation, or valuation posting
  was run. These catalog/data checks do not establish live app workflow behavior.
  The user was told normal writes may resume. Costing remains inactive.

Security advisor findings are unchanged from immediately before deployment: the
[intentional RLS-without-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
existing [security-definer views](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view),
[mutable helper search path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable),
[anonymous](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
and [authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
security-definer helper execution, and
[disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
No new advisor finding was introduced. Existing concerns remain for their separate
security work; intentional invoice-allocation execution must be preserved.

The owner subsequently authorized live workflow tests at
`https://anda-distribution.vercel.app/` and signed into Testing. Results below are
separate from migration-time preservation checks; test writes consumed invoice
numbers normally. Do not reset counters or claim all role checks passed.

## Owner live workflow checks — 2026-10-01

Authorized synthetic records were entered through the production app, not SQL.
Created isolated `DE05 Smoke 20261001 Customer` and
`DE05 Smoke 20261001 Supplier` to keep FIFO allocations away from existing parties.

- Created unpaid purchase `PUR-0005` and sale `SAL-0009`, each initially one Double
  tray at Rs 10, then edited each to two trays / Rs 20. Invoice identities stayed
  unchanged. Their final purchase-in/sale-out movements each contain two trays.
- Recorded Rs 5 then Rs 15 cash payments for each isolated party. Both invoices
  moved unpaid → partial → paid; partial outstanding was Rs 15 and final balance
  is zero. Paid note-only edits passed without duplicate payments: exactly two
  customer and two supplier payments, Rs 20 per party. Partial-state edits were
  not separately exercised. No actual money was transferred.
- Cash book on 2026-10-01 shows Rs 20 in, Rs 20 out, net zero; no partner capital
  entry was created. No bank/account payment or report-value test was performed.
- Added 15 Double eggs as legacy opening stock at Rs 1/egg. A 16-egg outbound
  request failed with `Insufficient stock` and created no movement; removing the
  exact 15 succeeded. Added one tray via adjustment-in, verified 30 eggs, then
  removed 30 eggs. Outbound reasons carry `DE05-SMOKE-20261001`; the inbound form
  has no notes field, so those two rows are identified by this recorded workflow.
- Legacy storage is deliberately unchanged: sale/purchase movements retain zero
  `quantity_eggs` and whole trays; the 15-egg manual rows store `quantity_trays=1`.
  Readers use their positive exact egg quantity. This is preserved legacy behavior,
  not compliance with future DE-05 truthful tray metadata or opening eligibility.
- Read-only verification at 02:39–02:40 PKT matched all original Testing row counts
  and fingerprints in sales, purchases, sale_items, purchase_items, stock_movements,
  customer_payments, supplier_payments and capital_transactions against the
  02:23:01 PKT baseline, excluding newly created rows by baseline timestamp.
- Final Testing counts: nine sales/items, five purchases/items, 20 movements,
  nine customer payments, two supplier payments, zero capital transactions.
  Counters advanced normally from sale=8/purchase=4 to sale=9/purchase=5.
  Stock returned to Double=0, Large=15450, Medium=1080, Small=0 eggs.
- All three new inventory tables remain empty, new cost/valuation fields remain
  NULL, and the valuation sequence remains `1`/unused across production.

Test records remain as an audit trail; invoices, payments and movements were not
deleted and counters were not reset. Although stock, isolated receivables/payables
and net cash returned to their starting amounts, test revenue, purchases and
legacy reports still include the Rs 20 invoices.

Remaining: enforcement of the clarified super-admin denial policy, the legacy
nontransactional write risk, and the
unexercised variants listed below. Existing Testing staff has empty stored
permission overrides, so sales/purchases/stock use allowed defaults; a denied
module scenario cannot be established by that account without changing permissions.
No permissions or Auth accounts were changed to manufacture a test scenario.
The live app has no sale/purchase DELETE endpoint or delete screen; those checks
are unavailable through current UI. Automated local gate tests cover deletion
denial and module denials, but are not live browser evidence. The unused server
helper cannot be exercised through current app routes; its integration remains
future work. No claim is made that this foundation closes existing direct writes.

## Staff live checks — 2026-10-01

The user switched the same browser to the existing Testing staff account.
Its navigation showed permitted stock, purchase, sale, customer, supplier and
cash-book modules, and omitted Accounts, Capital, Reports and Settings. Direct
navigation to Settings showed `Access Restricted`. This verifies the existing
page boundary; it does not prove every related API enforces that permission.

The staff account opened and saved note-only edits on the same paid test sale
`SAL-0009` and purchase `PUR-0005`. Read-only database verification at 03:12:54 PKT
confirmed both saved notes, both invoices still paid at Rs 20, exactly two payments
per test party, unchanged invoice counters and stock, NULL Testing valuation fields,
and unchanged original Testing row fingerprints. No new invoice or payment was
created in this staff check. Staff create/payment/adjustment flows, paid-at-create
variants, and partial-state edits were not separately exercised.

Automatic approval review initially rejected a read-only query for one sale ID
and one purchase ID outside Testing because the live-test authorization covered
Testing records only. No IDs/data were returned by that rejected call and no
workaround was used. The user subsequently explicitly approved the limited
read-only cross-business ID/access check.

At approximately 03:17 PKT, queried one existing foreign sale ID and one existing
foreign purchase ID without other business fields, then opened their edit pages
as Testing staff. Both pages failed to load the record with
`Cannot coerce the result to a single JSON object`; no foreign invoice details or
editable form appeared. This matches the existing tenant-scoped GET lookups and
their generic error handling. It verifies denial for these two foreign record
reads, not a live PATCH/related-reference write attack or an exhaustive tenant
audit. No records, permissions or counters changed. The raw error is an existing
UI/error-handling limitation, not a newly introduced gate finding. Foreign IDs
are deliberately omitted from these shared notes.

## Super-admin live checks — 2026-10-01

The user signed into the existing super-admin account. The admin layout was blank
at the browser panel's narrow width, matching the existing `hidden lg:block`
layout. A temporary 1280×900 viewport exposed the admin controls; the viewport
was reset to its default before handing sign-in back to the user. No UI code changed.

- Opening the business dashboard with no `tenant_id` showed `Select a tenant`
  and no business dashboard.
- A malformed `tenant_id=invalid` showed `Invalid tenant selection`.
- A syntactically valid all-zero UUID showed `Tenant unavailable`.
- Chose Testing through the admin tenant list and `Open dashboard as tenant`.
  The dashboard showed `Testing Admin`; its business links carried the explicit
  selected tenant, and navigating to Sales preserved that selection and displayed
  the expected Testing invoices, including paid `SAL-0009`.
- Clicking Edit on `SAL-0009` unexpectedly redirected to sign-in with the tenant
  query retained. A subsequent visit to `/admin` also redirected to sign-in,
  confirming the session was no longer accepted. No edit form loaded and no save
  was attempted. Recent captured browser logs contained no diagnostic entries;
  the cause and repeatability are unknown. The user was asked to sign in again
  for one retry. This is an unfinished live app check, not evidence of a gate SQL
  defect or a confirmed new High/Critical finding.

After user reauthentication, the sale edit page loaded on the single retry with
the correct Testing selection. The sign-in redirect did not recur in that retry;
its cause remains unknown and no auth fix was made. A note-only save of `SAL-0009`
then failed with `stock_movements_created_by_fkey`.

Read-only production verification at 03:30:51 PKT established:

- The existing FK is `stock_movements.created_by → public.profiles(id)` with
  `ON DELETE SET NULL`. The sole super-admin account lacks its profile row.
- The sale header note was saved and its item recreated (two trays, still paid
  at 2000 paisa), but its sale-out movement count became zero. Testing Double stock
  therefore rose from zero to 60 eggs. This is partial mutation, not a failed
  request with no effect. The attempted note's "verified" text is not a test result
  and will be corrected during repair.
- The existing sale PATCH path deletes/recreates items and movements before
  returning an insertion error, without an encompassing transaction. It supplies
  the authenticated actor as `created_by`; a missing profile triggers this FK.
  The purchase edit uses the same creator assignment/replacement pattern, so it
  was not attempted after the sale failure. Purchase failure is inferred, not
  independently reproduced.
- At 03:33:00 PKT all eight original Testing business-table fingerprints still
  matched baseline; invoice counters stayed sale=9/purchase=5. Other category
  quantities remained unchanged. The observed damage is confined to this new
  synthetic sale's missing movement.

Further super-admin writes were stopped immediately. The user was asked to avoid
Testing sales/stock changes and switch to Testing owner so the existing two-tray,
Rs 20 test sale can be resaved through the already successful app path. This
repair was subsequently completed and verified, as recorded below.
No profile, FK, permission, application code or production SQL write was changed
to make this test pass. The existing FK/nonatomic edit problem is a High blocker
for live super-admin inventory writes, not evidence that the inactive gate SQL
introduced it. Source review and migration-time preservation show the gate did
not alter that FK or those write handlers. No rollback or architecture redesign
was performed. The owner's subsequent policy clarification forbids platform
super-admin tenant business access; follow-up must deny that access, not create a
profile to enable it. Failure-safe posting for legitimate tenant actors remains
required by the approved transactional inventory direction.

## Owner repair of synthetic sale — 2026-10-01

The user explicitly returned to Testing owner. Resaved only `SAL-0009` through the
existing app edit screen with the same category, date, two trays and Rs 20 total.
Corrected its note to record the failed super-admin test and owner restoration;
no new sale, adjustment, payment or invoice was created. The app returned to Sales
and displayed the same paid invoice. This restores a legacy movement; it is not a
new valued inventory operation.

Read-only database verification at 03:51:41 PKT confirmed one sale item and exactly
one two-tray sale-out movement, with a valid creator/profile link. Invoice total
and amount paid remain 2000 paisa, with exactly two customer payments totaling
2000 paisa. Customer ledger remains settled. Stock returned to Double=0,
Large=15450, Medium=1080, Small=0 eggs. All eight original Testing business-table
counts/fingerprints match baseline; counters remain purchase=5/sale=9.
The owner cash-book screen also confirmed Rs 20 in, Rs 20 out and net zero.

At 03:52:42 PKT, all three inventory tables remained empty, all new sale/movement
valuation fields remained NULL globally, and the valuation sequence remained
`1`/unused. `PUR-0005` remained paid at 2000 paisa with two supplier payments
totaling 2000 paisa. No production SQL write, profile/permission/schema/code change,
commit or push was made during repair. The temporary test-sale stock discrepancy
is resolved; the super-admin access-policy and partial-write issues are unresolved.

## Local verification

Run from the repository root:

```sh
node --test tests/*.test.mjs
node tests/de05-security-gate-db.mjs
node tests/de05-foundation-db.mjs
npx eslint src/lib/inventory-posting-auth.ts tests/inventory-posting-auth.test.mjs tests/de05-security-gate-db.mjs
npx tsc --noEmit
npm run lint
npm run build
```

The database runners start separate disposable PostgreSQL 17.6 containers using
synthetic data, with Docker networking disabled. They do not read `.env` files or
accept production connection parameters. The gate runner verifies actor spoofing
denial, actual grants/RLS, SQL/TypeScript permission parity, fresh revocations,
cross-tenant denial, legacy item/movement create/edit/delete, inactive-field guards,
preserved rows/security/counters, rollback/reapplication, and atomic refusal on drift.

2026-10-01 local results: all 119 Node regression tests and 249 security-gate
PostgreSQL checks passed; the existing foundation runner passed its 89 database
assertions and preservation/concurrency checks. Changed-file lint and TypeScript
passed. Full lint has 22 existing errors
and 9 warnings in unchanged code. Default build cannot run with this machine's
missing native compiler bindings; `npm run build -- --webpack` passed using the
installed fallback. No production database changes or production write smoke tests
were performed. No commit/push was made during the initial implementation checkpoint.
