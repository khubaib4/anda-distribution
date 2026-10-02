# Exact peti prices

## Status

Deployed from main source commit `1398f64` after the owner's explicit commit/push and production approval and renewed confirmation that all writers are paused. Only migration `20261002075845` was installed, followed by the matching app. Existing history and security are preserved. The signed-in live sale preview shows Rs 7,000 for one peti at Rs 7,000. Final rollback-only sale/purchase probes await the owner's exception to the write pause; signed-in save/print checks are not complete. Normal writes remain paused. Customer accounts and shared stock protection remain active; costing remains inactive. The earlier unfinished live stock overlap checks remain explicit.

## Business result

Entering Rs 7,000 for one peti must produce a Rs 7,000 invoice. Receiving Rs 7,000 settles it completely, without a false four-paisa advance. Two peti cost Rs 14,000; six trays cost Rs 3,500. Extra trays are priced proportionally, with the complete line rounded once to the nearest paisa. Thirteen trays at Rs 7,000 per peti cost Rs 7,583.33 before discounts.

Previously, the app rounded Rs 7,000 / 12 to Rs 583.33 per tray and multiplied it back, producing Rs 6,999.96. It also displayed some saved paisa amounts as whole rupees. The fix saves the entered peti price and uses it for totals. The per-tray hint is marked approximate.

Sales and purchases, new/edit forms, lists/details, invoice PDFs, thermal receipts, customer/supplier ledgers, balances, payment allocation and revenue/purchase reports use the same calculation. Shared money formatting retains nonzero paisa across cash book, bank accounts, expenses, capital and other app screens. Cash book continues to display actual recorded receipts/payments. Input conversion preserves decimal money; expense and previous-balance editing also preserve the saved amount when opening the form.

## Existing history

No historical invoice, receipt, payment, allocation, stock movement or counter is rewritten by installation. Historical item rows keep a NULL peti price and retain their recorded tray-priced totals. Their original entered peti price was never saved and cannot be recovered reliably from a rounded tray rate. Do not guess that every Rs 6,999.96 invoice originally meant Rs 7,000. Correcting old invoices requires evidence and the existing audited edit workflow; receipts must remain their actual recorded amounts.

The customer balance compatibility view now includes item and invoice discounts consistently with the app. Its displayed totals can therefore correct an old view discrepancy without changing any underlying record. Active account due/advance calculations remain separate and unchanged in meaning.

## Implementation

- Migration: `20261002075845_exact_peti_pricing.sql` adds nullable BIGINT `price_per_peti_paisa` to sale/purchase items, without backfilling.
- JavaScript uses integer paisa and BigInt ratios; PostgreSQL uses exact NUMERIC intermediates. Both round the entire line halfway up, then apply exact item discounts. Whole-peti rates retain every paisa.
- Rounded `price_per_tray_paisa` and discounted tray prices remain compatibility metadata. They are not used to reconstruct a new peti-priced line total.
- Table checks reject inconsistent peti/tray metadata, invalid rates and unsafe totals. App validation also rejects malformed prices. Legacy missing/NULL peti prices retain compatibility behavior.
- Checked function replacements preserve the existing transactional sale/purchase gateways, tenant/module/platform restrictions, stock locks, stale-edit refusal, idempotency and invoice counters. Gateway source fingerprints and permissions are checked before installation; unexpected drift fails the entire migration.
- New pricing helpers are pure invoker functions with an empty search path. Anonymous execution is denied; authenticated/service execution exposes no business records. Existing function/view security is preserved.
- Moving-average costing is not activated. Existing legacy COGS approximation and broader purchase/payment transaction limitations are not changed by this price release.

## Verification completed

- 157 app tests passed, including exact peti inputs/reloads, new and historical prices, discounts, paisa formatting, list/ledger/report/cash-book API checks, real rendered form/receipt content and real A4 PDF text.
- 345 disconnected PostgreSQL checks passed. These include 240 JavaScript/SQL pricing comparisons, saved Rs 7,000 settlement, overpayment and edit allocation release, retry behavior, malformed-price refusals, tenant/platform denial, historical preservation and unchanged existing security metadata.
- 197 customer-account and 142 stock-concurrency database checks passed with this migration installed. Stock checks use real simultaneous transactions in disposable databases.
- TypeScript and whitespace checks passed. New-file lint passed. Comparing changed-file lint against HEAD found no introduced issue; three existing errors and one existing warning remain in those files. Full-project lint was not rerun for this task.
- A fresh temporary Webpack build passed using synthetic settings, enabled customer accounts and local font substitutes. The native Mac Next.js binding remains missing; this is not a normal native-build result.
- Desktop and 320/390-pixel local browser fixture checks passed for the actual sale/purchase row and receipt components. Rs 7,000 totals remain visible, and 58/80 mm receipt previews show Rs 7,000 paid and zero due without content overflow. These are rendered synthetic fixtures, not signed-in saves or physical printer checks.

Commands: `node --test tests/*.test.mjs`, `node tests/peti-pricing-db.mjs`, `node tests/customer-accounts-db.mjs`, `node tests/stock-concurrency-db.mjs`, and `tsc --noEmit`. Database runners use disposable network-isolated PostgreSQL with synthetic records, never production credentials.

## Coordinated deployment

1. Obtain approval to publish/deploy this price release. Reconfirm that all sales, purchases, payments, stock writers and jobs remain paused. Do not infer a current pause from an older checkpoint.
2. Take a fresh private backup of all business/private schemas, including active customer accounts, the legacy archive and shared stock guards. Restore it into a disconnected database and rehearse this exact migration. Verify current gateway sources, security, original rows, counters and account reconciliation before/after. Keep credentials and production data outside Git.
3. Review the exact migration-only deployment preview. Apply only `20261002075845`, with no seed/role/vault changes. **Database first, matching app second:** the new app selects the new columns and must not be published before they exist. The old app remains able to read legacy prices during this paused interval. Do not resume writers in a mixed release.
4. Publish the matching app. Keep customer accounts enabled and costing inactive. Verify migration history, exact function definitions/security, unchanged original business records/counters and unchanged payment/allocation reconciliation.
5. Obtain any required marked-test exception to the pause. Through signed-in owner/permitted-staff workflows, save a Rs 7,000 sale with Rs 7,000 received, a paid Rs 7,000 purchase, a partial-tray sale, discounts and a stale/retried edit. Check lists, both ledgers, cash book, bank statement where applicable, reports and fresh A4/58/80 mm invoices. Verify foreign/restricted/platform access refusal. Do not claim a local fixture proves these live workflows.
6. Finish the earlier stock release's outstanding live checks or obtain the owner's explicit decision to stop them. Report release checks, then resume normal writes only when that is authorized.

## Production evidence — 2026-10-02 PKT

- Source `1398f64d28deecd16c3b232b5140fb3321cb7f7e` is pushed to `codex/exact-peti-pricing` and main. GitHub records successful Production deployment `8e1eciVyxevtr4eKdJ2mrZX2kf2R`, with the production URL `https://anda-distribution-3ulzptf2c-doctor-s-egg.vercel.app`. The app domain's sign-in page responds with HTTP 200.
- Fresh owner-only backup: `/Users/khubaib/.codex/backups/doctors-egg/exact-peti-predeployment-20261002/backup-atjdmud7/`. It includes the six business/private schemas and roles, excluding managed Auth/Storage identities and credentials. Network-isolated restoration, installation, opened-access refusal, reinstall refusal and rolled-back synthetic invoice/purchase checks passed 329 assertions. All 35 original table fingerprints, grants/policies and existing routine security match the checkpoint.
- The migration-only dry run and installation list only `20261002075845_exact_peti_pricing.sql`, with no vault, seed or role updates. Remote migration history confirms that version. The original 35 table fingerprints still match immediately after installation, excluding only the added NULL fields when comparing historical item rows. No original invoice, payment, allocation, stock movement or counter changed.
- Both added columns and validated constraints are present. All five changed routine source hashes match the disconnected rehearsal exactly. Pure pricing functions retain invoker mode, empty search path and anonymous execution denial. Existing gateway/private access is unchanged. Four shared stock guards remain enabled; customer accounts remain active and costing operations stay zero.
- Live database calculations return Rs 7,000 for a complete peti, Rs 3,500 for six trays and Rs 7,583.33 for thirteen trays. The historical six-tray/Rs 1.13 discount case remains Rs 599.43. Applied-payment mismatch, sale overallocation and receipt overallocation counts are all zero. Security/performance advisor findings and counts match the pre-install baseline.
- Signed-in Testing Haris live form: selecting Large, entering one peti and Rs 7,000 shows line/subtotal/grand total Rs 7,000 and an approximate Rs 583.33/tray hint. Nothing was saved. Native scrolling failed and the Mac subsequently locked, so final signed-in save, receipt and purchase-screen checks are not claimed.
- Active post-install backup: `/Users/khubaib/.codex/backups/doctors-egg/exact-peti-active-20261002/backup-7s5j53oo/`. Its disconnected restore/preservation/refusal and rolled-back synthetic checks passed 201 assertions, recorded in private `restore-check.json`. Production remains unchanged by that check.
- A separate question asks permission for one Rs 7,000 sale and one Rs 7,000 purchase in Testing, both with unconditional rollback. Until that exception is approved, neither live probe will run. Earlier unfinished live stock overlap checks and physical device/printer checks also remain unverified. Keep normal writers paused.

## Recovery

Repair forward with writes paused. Do not remove populated peti-price columns, restore old pricing readers over new invoices, disable active accounts, reset counters or rewrite cash receipts. Reverting only the app can display incorrect tray-derived totals for new rows. The older shared-stock rollback intentionally refuses the changed sale gateway source; do not bypass that refusal. Preserve the backup and exact entered rates before any reviewed recovery migration.
