# DE-05 inactive inventory foundation

This chunk prepares storage for later inventory costing. It does not switch it on.
Migration: `supabase/migrations/20260930180615_de05_inactive_inventory_foundation.sql`.
No production mutation, commit, or push is authorized by this document.

## Production facts used

The read-only catalog preflight on 2026-09-30 established PostgreSQL 17.6, UUID
tenant/category IDs, and no existing DE-05 tables, costing columns, or public
sequences. `egg_categories.id` is unique but there is no tenant/category composite
key. Legacy tenant IDs are often nullable; this migration does not rewrite them.
`stock_movements.quantity_trays` is integer, non-null, with a positive check;
`quantity_eggs` is nullable integer with default zero. There are no stock triggers.
Existing item/category references are not coupled to tenant IDs. Stock
`reference_id` is polymorphic and has no foreign key. No item `total_paisa` column
was found, despite the old TypeScript description.

Protected header/member/payment grants and the invoice-counter triggers/functions
remain unchanged. Existing legacy stock/item grants include TRUNCATE, which RLS
does not filter. That is an existing security risk, not repaired by this chunk;
it remains an activation blocker until the trusted-write gate addresses it.
Production default grants expose new tables and sequences to app roles. Each new
object is explicitly revoked from PUBLIC, anon, authenticated, and service_role.
The migration aborts if unexpected inherited privileges keep an object accessible.

## What is prepared

- `inventory_balances`: one exact BIGINT egg/value balance per tenant/category,
  nonnegative values, zero eggs implies zero value, last sequence/date. Positive
  eggs may have zero remaining value after integer-paisa rounding.
  An unvalued balance must be empty; depletion retains its last valuation marker.
- `inventory_operations`: BIGINT valuation sequence, tenant, type, business date,
  optional source-document UUID, same-tenant forward/backward revision links.
- `inventory_operation_categories`: exact before/after quantity/value snapshots,
  prior valuation markers, same-tenant operation/category links.
- Tenant-coupled category uniqueness/FKs, including balance and movement links to
  the corresponding category journal. No cascading history deletion is added.
- Nullable exact movement cost/sequence/source/supersession and sale-item cost.
  NULL means not valued; no invented zero-cost historical backfill.
- A non-cycling PostgreSQL BIGINT sequence owned by the operations column. App
  roles cannot consume or reset it. Sequence gaps are expected.
- RLS enabled with no policies or app grants on the three empty new tables.

Stock tray compatibility is deliberately conditional. Legacy writes omit all
valuation metadata and retain a positive tray count, including existing rounded
egg adjustments and trays-only records. Valued records require complete metadata,
positive exact eggs, and `quantity_trays = eggs / 30` when divisible by 30; otherwise
trays must be NULL. Partial valuation metadata is rejected. The existing positive
tray check is retained. The app and its readers are unchanged.

## Responsibilities still deferred

No balance maintenance, posting RPC, permission gate, costing algorithm,
opening-stock eligibility check, immutable-history enforcement, or revision
implementation is included. No inventory is seeded and no counters are reset.

Future trusted posting must enforce module permissions and explicit super-admin
tenant selection, protect the new fields on legacy tables, and close inappropriate
direct stock/item writes. Existing table grants still cover added columns; these
columns must not become authoritative before that gate is implemented and tested.

The engine must lock balances in deterministic order **before** obtaining a
valuation sequence, then read and validate locked state. Sequence allocation alone
does not serialize inventory. It must atomically reconcile documents, movements,
category snapshots, balance quantities/values, business dates, and exact saved
sale COGS. FKs validate identity, not agreement between those values or dates.
`updated_at` is a storage field; future posting must set it on balance updates.

New opening stock is only the first valued operation for an empty tenant/category
balance and requires explicit positive cost. Keep the last sequence/date after
depletion so an empty balance is not mistaken for a never-valued balance. Revisions
must journal the union of original/replacement categories, including categories
removed from the replacement, to preserve same-category supersession links.
Reciprocal revision links and immutable superseded history need future posting
enforcement. Source-document UUIDs remain polymorphic; future posting must validate
document ownership/type. Valuation source labels are nonblank text; allowed sources
and their cost semantics belong to that posting phase.

## Local verification

Run `node tests/de05-foundation-db.mjs` with Docker available and the existing image
`ghcr.io/supabase/postgres:17.6.1.171`. The runner uses `--pull=never`, creates its
own container with `--network none`, no exposed port, no production credentials,
and removes it afterward. It does not read `.env.local`. The reduced synthetic
fixture is a test input, not a production baseline or an app integration test.

Tests cover legacy data/grant/policy/trigger/function preservation, unchanged
legacy insert shapes, closed new privileges/RLS, same-tenant/category constraints,
BIGINT precision/ranges, zero/value invariants, history markers, exact tray
compatibility, revision links, concurrent sequence allocation and rollback gaps,
atomic migration failure, inherited-grant rejection, and guarded rollback.
The rounding regression checks 30 eggs costing 1 paisa, removal of 20 eggs at
1 paisa rounded cost, and a remaining balance of 10 eggs/zero paisa. A subsequent
snapshot and full depletion must also accept the zero-valued remaining eggs.
Run existing regression tests with `node --test tests/*.test.mjs`.

Local results recorded on 2026-09-30; database, regression, and runner lint checks
refreshed on 2026-10-01 after the rounding correction:

- PostgreSQL 17.6: 89 database assertions plus legacy-state preservation and 12
  concurrent sequence allocations passed. Test containers were removed.
- Existing Node regression suite: 114 passed, zero failed.
- Independent review: no remaining actionable foundation findings.
- New test runner ESLint: passed. Repository-wide lint: 22 errors and nine warnings
  in unchanged application files; no unrelated lint fixes were made.
- Default build could not load native SWC on this Mac. The supported fallback,
  `npm run build -- --webpack`, passed with network access for the existing fonts.

## Later deployment and verification

Deployment requires separate explicit approval. Take a recoverable snapshot and
pause/drain stock and item/category writes for the short schema change. The
migration is transactional with a five-second lock timeout and a 60-second
statement timeout. It creates a category unique index and scans existing stock
for new constraints; if the timeout is exceeded, investigate and rehearse rather
than increasing limits blindly. Do not run a database reset: this repository does
not contain the complete production baseline.

After an approved deployment, inspect the new catalog definitions/grants and
confirm all three new tables remain empty, existing valuation/cost columns remain
NULL, legacy records/counters/grants/triggers are unchanged, and old sale,
purchase, and adjustment workflows still work. Controlled app smoke tests require
separate write authorization. No deployment or production smoke test has been done
for this foundation. Catalog verification must not call `nextval` or `setval`.

## Recovery

A failure before COMMIT rolls the migration back. If applied but unused, the
reviewable recovery script is `supabase/verification/de05-foundation-rollback.sql`;
it is not an automatically applied migration. Rehearse and obtain approval first.
It refuses removal if any new table/metadata has been used, a NULL tray record
exists, or the valuation sequence has been consumed. It restores tray non-nullability
and removes only these foundation objects without CASCADE. Any later dependency
also prevents removal. Once used, preserve history and prepare a forward recovery.
Invoice counters are never touched. Handle migration-history bookkeeping only
under a separately reviewed recovery procedure; do not run migration repair here.
