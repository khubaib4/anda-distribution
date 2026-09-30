# DE-05 Security Gate Foundation

Status: implemented locally; not deployed or production-verified. Costing remains inactive.
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
Deployment approval, a confirmed write pause, and production workflow smoke tests
remain pending. The new server helper remains unused by existing routes.

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
