# Shared stock write protection

Implemented and tested locally on 2026-10-02 PKT. After the owner's explicit commit/push request, source commit `c7c30f5fd3365da361dd56b690a4d5e3ad6a8508` was published on `codex/shared-stock-write-protection` in `khubaib4/anda-distribution`. Fresh remote refs confirm the feature branch and main unchanged at `41d2cd741df00fb2a5c3784df9097d35322d57b1`. Main integration and the coordinated app/database release remain pending; production still has the previously reported race until this release is installed. The Git-only publication retains the previous test results and passed staged whitespace checks; no production SQL or deployment command was run.

With 10 trays available, an 8-tray sale and an 8-tray stock-out adjustment now take turns when saving. The first entry saves. The second sees the remaining 2 trays and is refused with an insufficient-stock message. It saves no invoice, payment or stock change. Purchase corrections that would remove stock already used by a sale are also refused without damaging the purchase.

## Implementation

- Migration `20261001204536_shared_stock_write_protection.sql` protects INSERT, UPDATE and DELETE on the existing stock movement ledger with statement transition tables. It includes bulk requests and removal/reduction of incoming stock. It locks affected business/category rows in sorted order, then checks exact whole-egg balances using fresh READ COMMITTED queries. NO KEY UPDATE locks serialize writers while remaining compatible with foreign-key key-share locks. Other isolation levels and TRUNCATE are refused.
- The active customer-account gateway retains its reviewed body except for one checked lock block: sale edits lock both old and new categories in sorted order. New sales use the same locks. A refused save rolls back invoice issuance, items, payments and account events.
- Purchase PATCH uses the service-only `edit_purchase_stock_v1` routine. The verified session supplies actor/business, and the server's tenant-scoped read supplies the purchase version. The database locks the purchase, validates items/references, locks all affected categories and rechecks membership/permissions after waiting. Header, items and stock changes commit together. Incoming replacements are inserted before the old rows are removed under those locks, allowing a consumed purchase to keep/increase its quantity without a false intermediate shortage. A matching legacy NULL version is accepted once and replaced with a real timestamp. A competing edit committed while this request waits is refused.
- Standalone stock POST enforces Stock permission. Its preview remains useful, but the database makes the final decision. Known shortages and lock conflicts return HTTP 409 with a plain message. Purchase saves with uncertain responses ask the user to reload; they do not fall back to separate writes.
- New manual adjustments store exact eggs and whole trays only when divisible by 30; other quantities store NULL trays. The existing shape constraint is extended only for these unvalued partial-tray rows. Legacy rounded/trays-only records and the valued-row requirements remain supported.
- Existing table grants/RLS policies stay unchanged. Private helper access is closed to all app roles; only service_role can execute the purchase gateway. Platform admins and foreign businesses remain denied. Browser permissions are rechecked after category waits, and direct deletion of stock history requires an owner. Migration gates refuse permission/gateway source or access drift.

No historical records are rewritten, invoice counters reset, customer-account allocations changed or costing activated. Existing negative history remains visible; positive corrections are permitted. The guard refuses further reductions that leave a category negative.

Supplier payment allocation still refreshes after a successful purchase transaction using the existing trusted writer. A failed refresh retains the saved purchase and returns the existing warning against repeating the edit. This release does not claim broader financial atomicity, complete stale-form conflict detection, chronological inventory revisions or active moving-average costing.

## Local verification

- `node tests/stock-concurrency-db.mjs`: 142 real PostgreSQL checks in a disposable container with no network or project credentials. Includes the original race in both orders, ten concurrent adjustments, purchase/sale and purchase/adjustment races in both orders, update/delete bypasses, bulk rollback, opposite category sale edits, paid/partial purchase preservation, stale/NULL versions, permission revocation while waiting, tenant/platform denial, exact partial trays, preservation, unsafe-installation refusal and rollback/reapplication.
- `node --test tests/*.test.mjs`: 144 app tests. New route checks cover stock conflicts, truthful egg/tray quantities, trusted purchase arguments, atomic failure paths, uncertain responses and payment-refresh warnings.
- `node tests/customer-accounts-db.mjs`: all 197 checks pass with this new stock migration installed over active accounts. Existing reconciliation: 63; payment FIFO: 326; costing: 617; foundation: 89; inventory security: 249; platform access: 162.
- TypeScript, changed-file ESLint and whitespace checks pass. Full ESLint still reports the existing 22 errors/8 warnings. A fresh Webpack build passes in a temporary source copy using synthetic settings, enabled customer accounts and local font substitutes. The normal native Mac build still fails because the native Next.js binding is missing. Neither build uses production credentials.

Live authenticated checks and deployment rehearsal against a fresh restored production backup remain pending. Local testing does not establish a production result.

## Coordinated release

1. Obtain approval for this stock release and a fresh pause of sales, purchases, customer payments and all stock writers/jobs. The earlier customer-account release pause has ended.
2. Take a private backup containing public, customer_accounts, customer_accounts_legacy_archive and the inactive inventory/costing schemas. Restore it into a disconnected database. Inspect current gateway/permission definitions, grants, policies and existing negative balances; replay this exact migration and preservation/concurrency probes there. Preserve all counters and records.
3. Review the app build and the exact migration-only deployment preview. Publish the matching app first while writes remain paused. Until the database migration is present, purchase edits fail closed because their new gateway is unavailable; partial-tray requests may also be refused by the older constraint. Do not resume writes in this mixed state.
4. Apply only migration `20261001204536`. It changes protection immediately; it has no separate activation switch. Verify source/owner/search_path/grants, enabled transition-table triggers, unchanged business-table fingerprints/counters/account balances and empty/inactive costing state. Keep `CUSTOMER_ACCOUNTS_V1_ENABLED=true`.
5. With separately authorized marked test data, verify owner/permitted-staff sale and adjustment races, purchase reduction refusal, unchanged purchase details after refusal, partial eggs, customer advance/payment preservation and denied restricted-staff/platform/foreign-business requests. Confirm the app displays each refusal and remains usable for a valid retry.
6. Confirm release checks, then resume normal writes. Record verified results rather than treating local results as live evidence.

## Recovery

Prefer a forward repair with writers paused. Never disable or roll back active customer accounts, erase new payments, reset invoice counters or activate costing to recover from this release.

`shared-stock-write-protection-rollback.sql` is a manual, paused-write recovery script for the matching app version. It preserves business rows and restores the original customer-account gateway lock block, constraint and existing security. It refuses gateway drift and refuses removal after any new unvalued NULL-tray record exists, since the old constraint cannot represent those exact quantities. It uses explicit object removal without CASCADE. Installation/rollback/reapplication and refusal have been tested with active customer accounts in the disconnected synthetic database.

Removing this protection reopens the stock race. Keep writes paused and resolve the release forward before resuming; the rollback script is not an automatic runtime fallback.
