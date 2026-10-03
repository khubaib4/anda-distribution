# New sale — Counter layout

The owner selected the Counter design and approved applying it to production on 3 October 2026 (PKT).

## Changes

- Customer/date, egg items and payment are three clear sections.
- Previous due and available advance appear beside the selected customer.
- Available stock is a compact line above the egg entry fields.
- Desktop egg entry puts category, peti, extra trays and the exact peti price in one row. Phone layouts stack the fields with larger touch targets.
- A separate sale summary shows this sale, previous due, new money received, advance used and the customer's resulting due/advance. It stays beside the desktop form and follows the form on phones.
- Old-balance-first and this-sale-only are labeled radio choices. Existing cash, bank transfer, Easypaisa and JazzCash choices remain.
- Due date, overall discount and notes sit in an expandable section. Both item and overall percentage/fixed discounts remain available.
- The new invoice preview is an unsaved draft. It assigns no invoice number, writes no records, and uses the existing exact pricing helpers. The native dialog supports keyboard focus and Escape.

The existing sale submit validation, API payload, account request/retry identity, fresh-balance lookup, tenant navigation guard and database posting remain unchanged. The shared item component's Counter layout is opt-in; sale editing keeps its existing layout. This is an app-only release: no migration, data repair, feature-flag change or costing activation.

## Verification before publication

- All 157 app tests passed; TypeScript, focused lint and whitespace checks passed.
- A fresh temporary synthetic Webpack production build passed. It used fake Supabase settings and local font substitutes; the existing missing native Mac binding remains a local environment limitation.
- An isolated browser rendered the actual page/components with synthetic data at 1440, 1024, 768, 390 and 320 px, without horizontal overflow or clipped controls.
- Seventeen browser checks passed: the five layouts/draft previews, exact unpaid save payload, old due/overpayment, optional advance without new cash, paisa item/overall discounts and bank selection, legacy paid/partial/unpaid flows, retained request identity on uncertain retry, stale-save error, failed balance lookup, insufficient stock, and adding/removing rows.
- One peti at Rs 7,000 remains Rs 7,000. Six trays at Rs 100/tray with Rs 1.13 discount/peti remain Rs 599.43. Using Rs 7,000 from Rs 15,000 advance leaves Rs 8,000 and creates no new cash in the payload.

The browser save checks used a local stub response, not production records. Production deployment and read-only signed-in verification are recorded separately after completion. No physical device/printer check is implied.
