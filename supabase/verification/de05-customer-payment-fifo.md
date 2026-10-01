# DE-05 customer payment/FIFO — local review packet

Status: reviewed source `d8c6a0f5ea5981dda66256b857a14bd0f3a8fbd8` is committed
and pushed on `codex/de05-customer-payment-fifo`, based on main `4e0cb53`.
After explicit production approval, a fresh private backup and successful
restore rehearsal, migration `20261001112505` was deployed and read-only verified
on 2026-10-01. This remains an inactive private building block: the live payment
API and inventory costing have not been switched to it. Implementation and
independent review used synthetic databases only; the approved deployment
rehearsal used a private production copy as recorded below.

## Problem and scope

The current app already applies all customer receipts to the oldest invoices
first: sale date, creation time, then invoice ID. The payment API inserts the
receipt before updating invoice statuses through separate requests. An allocation
failure leaves a recorded receipt and may leave partially updated statuses; it
returns HTTP 201 with a warning. That current behavior is unchanged here.

The new private path records a standalone customer receipt, updates the affected
invoice paid amounts/statuses, and saves the retry result in one database
transaction. A failed statement or an aborted outer transaction undoes all of
those writes. A private recalculation routine can later be included in a trusted
atomic sale wrapper. No wrapper, public RPC, app wiring or role grants are added
in this chunk. Supplier payments, revisions, automatic-payment replacement,
cash-book redesign, payment UX and inventory activation remain separate work.

Files:

- `supabase/migrations/20261001112505_de05_customer_payment_fifo.sql`
- `tests/de05-customer-payment-db.mjs`
- `supabase/verification/de05-customer-payment-fifo-rollback.sql`
- this review packet and the current checkpoint in `PROJECT_CONTEXT.md`

## Preserved accounting behavior

- Sum tenant/customer receipts and allocate the total in the existing FIFO order.
  The payment date does not change that order. Extra credit remains unallocated
  and becomes available when a future invoice is posted/recalculated.
- Line percentage discounts round once at the line total. Fixed discounts remain
  **PKR per peti**, converted using 12 trays per peti. Header discount is clamped
  to the subtotal. NULL line discount metadata means undiscounted line price;
  the old rounded unit-price column is not a new total authority.
- Exact NUMERIC integer-ratio arithmetic avoids floating-point and finite
  division precision errors at half-paisa boundaries. Prices/receipt amounts
  remain BIGINT paisa; the result returns monetary totals as decimal strings.
  Future wrappers must preserve those strings, not silently coerce unsafe JS numbers.
- Preserve the existing zero-total invoice result: zero allocation is `unpaid`.
  Only changed paid amount/status rows get `updated_at=now()`.
- Invalid source metadata, cross-tenant item/category links, missing/nonfinite
  FIFO dates or a customer receipt/invoice total exceeding BIGINT abort the
  transaction. No repairs or backfills are performed. Before future activation,
  check real legacy records for these conditions under separate read-only approval.

## Security and locking contract

`de05_customer_payments` is a non-exposed schema. All four functions are owner-only
SECURITY INVOKER with an empty search path and qualified relations. The retry
table has RLS enabled and no policies. PUBLIC, anon, authenticated and service_role
have no schema/table/function access, including effective inherited/default access.
Actor/tenant arguments are for a future verified trusted wrapper; this migration
does not allow a browser or service-role caller to impersonate an actor.

Owner/staff membership is checked for the exact tenant. Platform super-admins are
denied even with owner membership. Standalone receipts require the **customers**
module, matching `/api/payments`; future sale recalculation uses **sales**. The
module is fixed by the trusted wrapper, not chosen by an end user. Staff default,
canonical-key precedence and malformed-value denial match DE-19. READ COMMITTED
is required before any lock/write; checks repeat after material lock waits.

Lock order for `post_receipt`: tenant/request journal row, customer row, optional
bank row, existing receipts by ID, invoice headers by ID, item rows by ID and
referenced categories by ID. FIFO reading happens after header locks, in a fresh
statement; locking order is separate from accounting order. Bank/category SHARE
locks prevent reassignment/deletion while those references are checked. Customer
locks serialize concurrent new-path receipts; request locks serialize retries.

All future sale/payment create/edit/delete writers must take the customer lock
**before** changing sources or taking invoice/inventory locks and cooperate with
this order. `recalculate` is the composition helper for those future sale wrappers;
do not call `post_receipt` after taking customer/header/balance locks, reversing
its request-first order. Future multi-customer revisions need ordered customer
locks and their own reviewed operation-retry boundary; none are implemented here.

The current multi-request app writers remain available and do not all follow this
protocol. This chunk does **not** claim atomicity or safe concurrent mixing with
those legacy workflows. All competing writes and trusted wrapper permissions
must be reviewed/closed before activating this path. Merely granting access to
these routines is not an approved deployment or activation strategy.

## Retry behavior

The caller must persist one UUID per intended standalone receipt and reuse it
after a lost response. `(tenant_id, request_id)` identifies the retry. The exact
SQL-normalized payload binds actor, customer, amount, date, method, bank, reference
and notes. Reusing a key with different arguments fails, including a different
actor/customer. SQL NULL and empty text are distinct; future wrappers must
normalize consistently. Existing payment methods remain unchanged.

The first successful call saves the payment ID and its original allocation result.
An identical retry returns that same result without inserting another receipt or
reallocating later invoices. This original result is not a current balance report.
Current membership/permission and customer ownership are still checked on replay;
revoked permission denies it. An aborted transaction leaves neither receipt nor
request row, allowing the same request to succeed after the cause is fixed.

The receipt FK prevents deleting a journaled receipt and silently losing its retry
identity. Future revisions/cutover must explicitly account for this history;
the existing notes-based automatic-payment replacement is not integrated here.
There is no journal expiration or reset, and no invoice-counter change.

## Local validation

Run `node tests/de05-customer-payment-db.mjs`. It uses a new disconnected,
port-free PostgreSQL 17.6 container with synthetic data and the captured metadata
fixture, then applies the deployed privacy correction/core and this migration.
The container is removed afterward. It is not a fresh production restore.

Passed **326 new database assertions**, covering FIFO ties, discounts, full/partial
payments, unallocated credit, exact amounts above JS safe integer, near-half
rounding, malformed sources, tenant/bank/category denial, owner/staff/platform
permissions, request mismatch/replay, concurrent receipts/identical and conflicting
retries, injected allocation failure, outer rollback, and future transaction
composition. Revocation during customer/receipt/invoice/item/bank/category waits
denies the writer. Unsupported isolation refuses before waiting or writing.

Migration/unused rollback/reapply preserve every public table's synthetic records,
public policies/grants/functions/triggers and counters. Opened/inherited defaults
abort migration atomically. Opened table/column/function access and changed
RLS/security mode block rollback atomically; used retry history also blocks it.
Core tables remain empty, valuation sequence unused and costing fields NULL.

Existing suites passed: 617 moving-average checks, 89 foundation assertions,
249 historical gate checks, 162 privacy checks and 121 app tests. TypeScript and
new-file lint passed. Full lint retains 22 errors/9 warnings in unchanged files.
Default build in a temporary copy with synthetic configuration reproduced the
missing native compiler/Turbopack limitation. The Webpack fallback passed in that
temporary copy with mocked Google fonts and synthetic configuration. No live
browser workflow or production check was run.

Independent review reported no actionable findings after checking all five files
and the exact branch/base. It reran 326 payment/FIFO assertions, 617/89/249/162
existing database checks, 121 app tests, TypeScript, focused lint and whitespace
checks. Another 260 synthetic probes covered exact money, retry waits, permission
removal, platform-admin denial, tenant reassignment, refreshed FIFO ordering and
combined sale/costing/payment transactions. The reviewer did not rerun the build
and accessed neither production nor private backups. This confirms local readiness
as a closed inactive building block; production readiness was still unverified
at that review checkpoint. The later deployment result is recorded below.

## Production deployment checkpoint — 2026-10-01

The owner explicitly approved production deployment, confirmed sales/purchases/
payments/stock/category/permission writes paused, and approved a fresh private
backup of public/de05_costing schemas, business records and role definitions.
Backup is outside Git with folder access 0700 and files 0600:
`/Users/khubaib/.codex/backups/doctors-egg/de05-customer-fifo-predeployment-20261001/backup-fzthpv0l/`.
Managed Auth/Storage are excluded; this is not a full managed-project disaster
recovery backup. Restore used FK identity stand-ins and managed-role stand-ins
in a disconnected PostgreSQL 17.6 container, removed afterward. Diagnostics and
verification metadata remain private in that backup folder.

The fresh restore matched all 25 existing public table fingerprints and the
deployed costing core. Exact migration/guarded rollback/reapplication, opened
access refusal, receipt retries, injected allocation failure, unsupported
isolation refusal and counter/sequence preservation passed **95 checks**.
Normalized effective public security matched production exactly. Local restore
bootstrap/search-path differences were corrected only in the private harness;
no reviewed SQL, production role or existing permission was changed.

The final predeployment read confirmed the paused production state still matched
the backup. CLI dry run listed only this migration. The deployment applied only
`20261001112505_de05_customer_payment_fifo.sql`, without seeds, custom-role or
vault updates. Exact applied source SHA-256:
`95bd657109b77f4125822ee5e45e5e4e43c649cd2427de0082d9ebeb78c5c97c`.
Remote history now includes version `20261001112505` / `de05_customer_payment_fifo`.

Postdeployment read-only verification at 17:50 PKT confirmed all 25 public table
fingerprints, invoice counters, existing functions/policies/triggers/grants and
the costing core unchanged. The private schema owner, four invoker function
bodies/configuration/ACLs, table columns/constraints/indexes/RLS and effective
schema/table/column/routine access match the rehearsal. Retry storage is empty;
anon/authenticated/service_role have no access. Inventory tables/private costing
lines remain empty, old costing fields NULL and sequence `1 / is_called=false`.

Security/performance advisors reported no new WARN/ERROR findings. The only new
notice is the expected INFO for [RLS enabled without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
on the closed retry table. Existing notices remain unchanged.

No app deployment, positive production receipt through the new path, reset,
seed, inventory activation or invoice-counter reset occurred. Normal business
writes may resume. Live use and safe coexistence/closure of competing writers
remain future work; this deployment does not fix the current multi-request
payment/sale workflows.

The owner also approved publishing these two deployment notes and integrating
the reviewed branch into main. Local and remote main were fast-forwarded from
`4e0cb53` to deployment-note commit
`9a7e5d8b8983becafaddd0ad0e88f9c9f31176fe`, preserving reviewed source `d8c6a0f`.
Both remote branches matched at that checkpoint. This final documentation update
records the completed integration; verify current refs before future work. No
SQL or app source changed during Git cleanup.

## Review and later deployment

Review the full five-file change, including untracked files. Prioritize tenant
boundaries, effective grants/RLS, rounding/FIFO preservation, retry binding,
transaction rollback, lock waits and future wrapper composition. Check that no
existing app writer, costing guard, COGS, stock or invoice counter was changed.

Only after independent review and explicit commit/deployment approval: verify
the exact deployed core/security metadata, obtain an approved fresh private backup
and stable write window, restore it into a disconnected disposable database,
rehearse this exact migration and guarded rollback/reapply, and compare all
business records/security/counters/valuation state. Apply only this migration
without seeds/activation, then read-only verify empty private retry storage,
owner-only invoker routines, closed effective access and unchanged existing state.
No positive payment through this new production path is approved in this phase.

Rollback removes only this chunk's private routines/schema and an empty retry
table, with no CASCADE. It never deletes or rewrites public payments or invoice
statuses. If someone directly used standalone recalculation, those resulting
public statuses are preserved rather than undone. If retry history exists,
rollback refuses: preserve the records and use a reviewed forward fix. Future
dependent wrappers also prevent removal through normal dependency checks.
