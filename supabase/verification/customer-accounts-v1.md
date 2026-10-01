# Customer previous balance and advance payments

Status: implemented and follow-up independent review passed on 2026-10-01. After the owner's explicit commit/push approval, reviewed feature commit `47f608977a927038d50afeb12bfab1534d19fa1d` was committed and pushed to `codex/customer-accounts-v1` in `khubaib4/anda-distribution`. Main remains unchanged. Ready for release preparation and a disconnected rehearsal, with the existing stock concurrency risk kept explicit. The database migration has not been applied to production, accounts have not been activated, and no live customer records have been changed.

## What customers and staff will see

- Customer page: Add previous balance, or Correct previous balance after one exists. Choose Previous due or Previous advance, amount, date and notes. This records money carried over from before the app; it does not create a sale or receive cash today. Corrections preserve the earlier entry and an explanation in the ledger. Correct an existing balance to zero to clear a mistake; any affected allocations are released, while new starting balances still require a positive amount.
- Four separate totals: Total sales, Total received, Balance due and Available advance. A customer can have both due and unused advance. The ledger shows the signed net balance and all the transactions behind it.
- New sale: selecting the customer loads the latest previous balance and available advance. Enter new money in Amount received. Extra money becomes advance automatically.
- Payment applies to defaults to Old balance first: previous due, then oldest unpaid invoices ordered by sale date, creation time and ID. Choose This sale only at checkout, or Selected sale only on the customer page, to leave other debt unchanged.
- Use advance is off initially. Check it and enter how much to use. Advance is used first, then new money, using the selected payment choice. Choose any amount within the available advance and eligible debt.
- Apply advance on the customer page can settle existing debt without a new sale or new receipt. A payment receipt records actual money once; applying its unused part later receives no additional money.
- A4 invoices and 58/80 mm receipts show the invoice's own paid amount, due and advance used. A separate Latest customer balance block shows other unpaid balances, total customer due, available advance and a Pakistan-time timestamp. Downloads and the receipt's Print button fetch fresh balances; reprints show the current position.
- Sale edits preserve saved payment choices. Reducing a settled invoice releases excess to advance; increasing it leaves additional due. Other invoices are not silently paid. Customer reassignment and changing payment fields through sale edit are blocked; use the customer page for payments.

Example: Rs 10,000 sale with Rs 25,000 received leaves Rs 15,000 advance. An Rs 8,000 next sale paid entirely with that advance leaves Rs 7,000 advance and receives no new cash. Choosing This sale only with old dues leaves the old dues visible.

## Access and saving

Owners and staff with Customers access can record/correct previous balances, receive payments and apply advance. Staff with Sales access can select a customer, see the checkout balance and choose payment/advance for that sale, but cannot open the customer ledger or alter its previous balance without Customers access. Platform administrators remain denied all tenant business data.

The app passes the verified signed-in actor to a service-only database function; actor/tenant fields in request JSON cannot impersonate another user. Database permissions are checked again after waiting for the customer lock. Financial tables and helper routines are closed to browser and service-role direct access. Active-account guards block the legacy direct sales/payment write path, including a forged custom setting.

Amounts are validated as whole paisa, including two-decimal rupee input. Sale, items, stock movement, receipt, allocations and counter changes commit together. Customer/category locks serialize customer account and new sale operations. The same request ID and details return the saved result on an uncertain retry; changing details requires a fresh request ID. A failed save never falls back to legacy writes.

The moving-average inventory engine stays inactive. This feature retains the current purchase-average sale cost fields. Purchases, adjustments and category transfers still use their existing writers and do not all take these category locks; this is not a claim of full inventory-engine concurrency safety. Keep the separately planned inventory cutover and its writer closure distinct.

## Files and API contract

Migration: `supabase/migrations/20261001150445_customer_accounts_v1.sql`.
Dormant rollback: `supabase/verification/customer-accounts-v1-rollback.sql`.
Runtime release switch: `CUSTOMER_ACCOUNTS_V1_ENABLED=true`. Unset/false retains legacy app behavior before activation. The example environment file is locally ignored by the repository, so this switch must also be configured explicitly in the deployment environment.

All new writes require `request_id` (UUID). Rupee UI amounts become integer `amount_paisa`; `allocation_mode` is `old_first` or `sale_only`.

- GET `/api/customers/:id/account-summary?module=sales` permits checkout with Sales access; omit the parameter for Customers access. Returns `accounts_enabled: false` while the feature is off.
- POST `/api/customers/:id/opening-balance`: `balance_type` (`due`/`advance`), `amount_paisa`, `entry_date`, `notes`. A correction also requires `expected_updated_at` from the latest opening balance and may use zero to clear a mistake.
- POST `/api/customers/:id/apply-advance`: `amount_paisa`, `allocation_mode`, and `sale_id` for selected sale only.
- POST `/api/payments`: customer, receipt amount/date/method/bank/reference/notes and allocation choice; selected sale only requires a sale belonging to that customer.
- POST `/api/sales`: normal sale items/discounts plus `amount_received_paisa`, `advance_paisa`, allocation choice and receipt method/bank. Payment status is calculated from saved allocations.
- PATCH `/api/sales/:id`: `expected_updated_at` plus permitted sale edits. Changing customer/payment values is rejected.

Dates for previous entries, receipts and sales must be valid and no later than today in Pakistan. Each action accepts only its own date: `entry_date` for previous balances, `payment_date` for receipts, and `sale_date` for sales; unrelated date fields are rejected, even when null. Payment `due_date` belongs only to sales and may be in the future. Existing invoice IDs/numbers and historical cash receipts are retained. There is one current previous-balance record per customer; corrections are audited rather than appending another starting balance.

## Verification

Run these against synthetic local data only:

```sh
node --test tests/*.test.mjs
node tests/customer-accounts-db.mjs
npx tsc --noEmit
git diff --check
```

The database suite uses disposable PostgreSQL 17.6 containers with no network and no project credentials. It exercises activation/refusal, dormant rollback/reapplication, examples, source/target bounds, exact money/discounts, atomic rollback, retries, corrections, permissions, forged direct writes and concurrent advance use. App tests exercise exact money, preview choices, trusted actor boundaries, retry keys and invoice/receipt layout bounds. Existing customer-payment, moving-average, foundation, security-gate and platform-admin suites are also run as regressions.

The normal build on this Mac is blocked by its existing missing native Next.js dependency. A Webpack build is checked in a temporary copy using synthetic environment values and local font substitutes, with the feature enabled. Isolated Chrome checks use mocked API responses for desktop and 320/390 px phone viewports; they check checkout, forms, retry protection, fresh printed balances and both receipt widths. These do not certify real phone devices or physical printers.

Full-project lint retains existing errors unrelated to this feature; changed standalone files pass focused lint. Record final counts and browser/build outcomes in PROJECT_CONTEXT.md.

## Independent review fixes — local verification, 2026-10-01

The independent review found four release-blocking issues. All four have local fixes:

1. Incorrect previous dues/advances can now be corrected to zero. The current record ID and previous history remain, and affected allocations are released without automatically paying another invoice. Tests cover both balance types, settled balances, ledger deltas and rejecting a new zero starting balance.
2. Shared JavaScript discount helpers use exact decimal ratios and integer half-up rounding, matching the database for item and whole-invoice discounts. Checkout, invoice lists and profit reports use those helpers and display nonzero paisa. The six-tray/Rs 100-per-tray/Rs 1.13-per-peti example now totals Rs 599.43; paying that amount or using that advance leaves no one-paisa residue. API and database checks cover this reproduction and rounding boundaries.
3. Activation rejects any existing non-null receipt bank reference whose account belongs to another business or cannot be resolved. Tests verify refusal before backfill, unchanged old receipts and inactive state.
4. Action-specific date checks reject the past-entry-date/future-sale-date bypass and unrelated date fields. Tests preserve invoice and stock dates after refused edits and verify a valid sale-date edit updates both.

Current checks: 140 app tests and 197 customer-account PostgreSQL checks pass, along with the existing 326 payment, 617 costing, 89 foundation, 249 security-gate and 162 platform-security checks. TypeScript, focused lint and whitespace checks pass. Mocked desktop and 320/390 px phone checks pass for zero corrections, exact checkout/advance amounts, invoice lists and reports. Full lint retains 22 existing errors/8 warnings. The temporary Webpack build passed with synthetic environment settings, the feature enabled and local font substitutes. The normal native Mac build still has its existing missing-dependency limitation.

The documented sale-versus-adjustment inventory race remains unresolved and outside these four fixes. Production rehearsal, live checks and physical devices/printers remain pending. No source commit/push, production write, migration application or activation was performed.

## Follow-up independent review — passed, 2026-10-01

The owner supplied the follow-up review report: all four findings are resolved, with no new actionable customer-account bug. The reviewer independently confirmed audited zero corrections and targeted allocation release, matching app/SQL discounts (including 560 additional discount cases), activation refusal for foreign/missing receipt bank references without partial backfill, and rejection of unrelated dates, future sale dates and stale edits.

The report records 140 app tests, 197 customer-account database checks and 1,162 additional independent assertions passing, plus the existing 326 payment, 617 costing, 89 foundation, 249 security and 162 platform-access checks. TypeScript, whitespace checks, new-file lint and a fresh temporary synthetic Webpack build passed. Desktop and 320/390 px browser checks passed, including fresh balances, avoiding double-counting and 58/80 mm print layouts. Full-project lint and the normal native Mac build were not repeated in this review; their previously recorded limitations remain. These are reviewer-reported results, not checks rerun during this documentation update.

The reviewer again reproduced the existing stock race with disposable data: 10 available trays, an 8-tray sale and an 8-tray manual adjustment can both succeed and leave minus 6 trays. The adjustment checks availability separately from its insert; sale category locks alone do not protect non-cooperating stock writers. All outbound writers need shared transaction protection before full stock concurrency safety can be claimed.

Release preparation and a disconnected rehearsal can proceed. Production backup/restore rehearsal, real-data activation reconciliation, live signed-in workflows and physical phone/printer testing remain unverified. Production activation still requires the rehearsal and approval steps below. Recording this report changed documentation only; it did not commit, deploy, apply a migration or activate customer accounts or inventory costing.

## Production release steps — pending

1. Review the complete source/migration and request deployment approval. Confirm the moving-average and private FIFO prerequisite migrations and the trusted invoice counter are present. Do not activate their inventory/payment posting engines, reset transaction data or counters, or seed stock as part of this release.
2. Pause affected writes across owners/staff/jobs and retain a fresh private database backup. Restore it into a disconnected rehearsal database. Compare effective privileges/security, existing business-table fingerprints, counters, saved invoice totals and receipts before/after the dormant migration. Rehearse the guarded dormant rollback and reapplication. Keep private data and credentials out of source/control logs.
3. Run `SELECT customer_accounts.activate();` as the database owner **only in that rehearsal**. It reconstructs existing FIFO allocations in one transaction and refuses any saved payment amount/status or tenant-reference mismatch, including receipts with bank accounts from another business. Investigate a refusal; do not edit old records or suppress validation merely to enable it. Verify unchanged old invoices/items/stock/receipts/counters and correct customer totals/ledger balances.
4. With production writes still paused, deploy this app with the runtime switch unset/false. Apply only the reviewed dormant migration; verify history, effective grants and unchanged business records/counters. At this stage the guarded rollback remains available while all new records are empty.
5. Separately approve the production activation after the rehearsal succeeds. Call `SELECT customer_accounts.activate();` as the database owner during the same pause; verify allocation reconciliation and all invoice/cash/stock/counter preservation. Activation is a single transaction and aborts fully on a mismatch.
6. Set `CUSTOMER_ACCOUNTS_V1_ENABLED=true` and deploy/restart the app while writes remain paused. Test reads first, then explicitly approved owner/permitted-staff writes in Testing: previous due, advance, overpayment, both allocation choices, selected invoice, correction, edit release, bank/cash counted once, fresh invoice/receipt and retry. Verify forbidden staff/platform/foreign-tenant access. Resume writes only after the app and database are both confirmed active and reconciled.

Rollback script is for an inactive, unused installation only. After activation do not disable the switch and resume old financial writers: active guards intentionally block them. If an active release fails, pause writes, keep all history, and repair forward or use an explicitly approved coordinated full restore that accounts for every later transaction. Never automatically delete allocations/receipts or reset counters.
