# Doctor's Egg: rules for Codex and Cursor

## Project overview

Doctor's Egg is a multi-tenant egg distribution system for sales, purchases, customers, suppliers, inventory, payments, expenses, cash and bank accounts, partner capital, reports, and PDFs. Read `PROJECT_CONTEXT.md` before substantial work; it is the project source of truth. If it is untracked, read it but do not modify or commit it unless asked.

## Tech stack

- Next.js 16 App Router in `src/app`, React 19, and TypeScript 5.
- Supabase Auth, database, and storage via `@supabase/supabase-js` and `@supabase/ssr`.
- Tailwind CSS 3, local UI components, and `lucide-react`; npm with `package-lock.json`.
- Before changing Next.js code, inspect the existing route/component patterns in this repo. If framework behavior is unclear, verify against the installed Next.js version and official Next.js documentation before implementing.

## Important business rules

- Money is stored and calculated as integer paisa; convert to PKR only for display or input boundaries. Keep discounts, totals, balances, and cost calculations in paisa.
- 1 tray = 30 eggs. 1 peti = 12 trays = 360 eggs. Preserve these conversions across forms, API handlers, reports, and stock calculations.
- Treat `customer_payments`, `supplier_payments`, `sales`, `purchases`, `stock_movements`, and `capital_transactions` as protected business records. Changes to one can affect ledgers, cash book, bank statements, reports, or inventory.
- Enforce business rules in server handlers as well as the UI. Client validation and hidden navigation are not authorization or data integrity controls.

## Tenant isolation rules

- Authenticate and authorize every business API request. Scope every read, write, update, delete, and related-record lookup to the intended `tenant_id`.
- Verify referenced customers, suppliers, categories, accounts, partners, and parent records belong to the same tenant before using their IDs.
- Handle super-admin access with an explicit tenant scope where business data is involved; never allow an absent or optional tenant filter to broaden access accidentally.
- The admin Supabase client can bypass row-level security. Do not assume RLS, database constraints, or cascades exist: their definitions are not in this repository. Enforce access in server code and review database policy implications.
- Check API permissions for staff and owners; UI-only permission checks are insufficient.

## Financial safety rules

- Do not create duplicate payments. On sale or purchase create, edit, retry, and delete paths, reconcile the intended payment with existing payment records before inserting or replacing anything.
- Keep sale and purchase totals, paid amounts, customer and supplier balances, cash book entries, account statements, and partner capital entries consistent. Cover paid, partial, and unpaid states.
- Be careful with multi-step writes and replacement flows: header, items, movements, payments, and capital entries may be written separately. Plan failure handling so partial writes do not corrupt ledgers.
- Existing automatic payment and capital synchronization may match `notes` text, which is fragile. Inspect those paths before changing them; do not assume a stable foreign-key link.
- For any financial change, explain the risks and the manual tests performed or still needed.

## Stock safety rules

- Stock is derived from `stock_movements`; do not treat a separate displayed quantity as the source of truth.
- Purchases add `purchase_in` movements; sales add `sale_out` movements. Adjustments and opening stock also affect availability. Keep movements aligned with their source records on create, edit, and delete.
- Do not make stock negative. Validate availability on the server for outbound movements and for edits that reduce or replace prior stock-in, including affected egg categories.
- Validate quantities and tray/peti/egg conversions on the server, including exact egg quantities where applicable. Do not rely only on form limits.
- For any stock change, explain the risks and manually test conversions, category changes, edits, and insufficient-stock cases.

## Cursor/Codex workflow rules

- Inspect nearby code and existing patterns before editing, especially `src/lib/tenant-api.ts`, `src/lib/utils.ts`, and relevant API handlers.
- Make small, reviewable changes. Do not make broad rewrites or change unrelated files. Do not add libraries unless explicitly approved.
- Preserve existing user changes. Check `git status` before work and review the final diff for scope.
- Keep secrets in `.env.local` private. For schema or database changes, provide a migration and rollback plan and review constraints and RLS.
- Keep `PROJECT_CONTEXT.md` aligned after major authorized architecture or business-rule changes, but do not edit an untracked copy unless asked.

## Files and routes to handle carefully

- Auth and tenancy: `src/proxy.ts`, `src/lib/tenant.ts`, `src/lib/tenant-api.ts`, `src/lib/permissions.ts`, `src/lib/supabase/admin.ts`, `/api/me`, `/api/admin/*`, `/api/settings/members/*`.
- Financial and stock writes: `/api/sales/*`, `/api/purchases/*`, `/api/payments`, `/api/supplier-payments`, `/api/stock/*`, `/api/capital`, `/api/expenses/*`.
- Derived views and calculations: `/api/customers/*/ledger`, `/api/suppliers/*/ledger`, `/api/cash-book`, `/api/accounts/*/statement`, `/api/reports/pl`, `src/lib/utils.ts`, and `src/lib/stock-availability.ts`.

## Testing expectations

- For code changes, run `npm run lint` and `npm run build` before shipping; report failures. There is no confirmed automated test suite or `test` script in `package.json`.
- Manually check affected workflows with tenant owner, staff, and super-admin roles, including cross-tenant access attempts where relevant.
- For financial changes, test paid, partial, and unpaid records through create, edit, and delete; check ledgers, cash book, bank statements, capital, and reports.
- For stock changes, test purchase and sale creation/editing, adjustments, tray/peti/egg conversions, category changes, and prevention of negative stock. State any tests that could not be run.

## Commit expectations

- Do not commit unless the user explicitly asks. Stage only intended files when a commit is authorized; never include unrelated changes, untracked `PROJECT_CONTEXT.md` without permission, or secrets.
- Before an authorized commit, review `git status` and the staged diff, run relevant checks, and use a concise message describing the change.
