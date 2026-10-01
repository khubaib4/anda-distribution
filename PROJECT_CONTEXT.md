# Doctor's Egg - Project Context

Last refreshed: 2026-10-01. The earlier security/invoice deployment and smoke-test status is confirmed by the project owner. DE-05 inactive-foundation and security-gate SQL deployments and read-only database verification were performed on 2026-10-01. The valuation engine remains approved future behavior.

## Current Project State

- Privacy correction production deployment (2026-10-01): reviewed source commit `274fc6b` was rebuilt with Vercel Production settings and published to the app domain before migration `20260930230547` was applied. Remote history and all 22 restrictive policies/six invoker views/closed browser grants match the approved rehearsal. All 25 table fingerprints and counters were unchanged immediately after migration. Testing owner/staff paid note-only invoice saves passed, with original records/counters preserved and no duplicate payments; staff settings remain restricted. Super-admin platform screens loaded and business pages redirected with/without tenant selection. The browser tool blocked direct API navigation; final human API verification is pending and normal writes remain paused. Costing stays inactive. Production was published from the reviewed branch directly; the owner separately approved fast-forwarding main from `4724d32` to this reviewed release and its deployment notes. See `supabase/verification/platform-admin-business-access.md`.
- Privacy deployment preparation (2026-10-01): independent review passed and the owner approved commit/push and production deployment, then confirmed affected writes paused. Correction commit `274fc6b51cbf2bf1afc247b49fa343931e3dff70` is pushed; main is unchanged. Fresh private public-schema/business-data backup and isolated PostgreSQL 17.6 restore/migration/rollback/reapply passed 88 checks, preserving all 25 table fingerprints and counters. Vercel build and the dry run succeeded. These were predeployment results; the subsequent app-first/database-second release is recorded above. See `supabase/verification/platform-admin-business-access.md`.
- Local privacy correction (2026-10-01): business/settings APIs deny platform super-admins, business dashboard/identity/navigation/fetch paths no longer allow tenant selection, and the new versioned migration adds restrictive table denial, invoker views, browser TRUNCATE/tenant-write closure and a denying DE-05 assertion. Platform setup/plan/status and existing account contact metadata remain available. Passed 121 app tests, 162 corrective PostgreSQL checks, the existing 89 foundation/249 gate checks, TypeScript and the Webpack build; full lint has existing 22 errors/9 warnings and default native build is unavailable. Independent review reported no actionable findings, with 30 additional database checks and client account-switching simulations passed. Commit/push and deployment were approved and have now been performed as recorded above. Review/deployment checklist: `supabase/verification/platform-admin-business-access.md`.
- Authoritative SaaS policy clarified by the project owner on 2026-10-01: the product's platform super-admin must not view or modify tenants' business data. Tenant business access belongs to their owners and permitted staff. Explicit `tenant_id` selection must not grant a platform super-admin business access. This supersedes earlier handoff/skill wording that allowed selected-tenant super-admin operations. The local app/API correction and new migration `20260930230547_deny_platform_admin_business_access.sql` now enforce this denial and pass local tests. Independent review reported no actionable findings; the owner approved commit/push and production deployment. Backup/rehearsal and production deployment are complete; the new denial is deployed and final human live API verification is pending. See `supabase/verification/platform-admin-business-access.md`. Stop positive super-admin business tests. Do not create a super-admin profile merely to enable tenant writes. The synthetic test-sale repair was completed and verified through Testing owner; independent review and approved deployment of the denial correction are now complete, with final live verification recorded above.
- Live-check failure and recovery (2026-10-01): the super-admin edit of synthetic Testing sale `SAL-0009` failed on its missing creator profile after removing its stock movement. Testing owner repaired it through the app; database checks at 03:51–03:52 PKT confirm exactly one two-tray movement, stock back to baseline (Double=0 eggs), unchanged Rs 20 total/paid amount, no duplicate payments, and unchanged original checked records/counters. The temporary stock discrepancy is resolved. Platform super-admin access violates the clarified policy and must be denied; existing nontransactional edit risk remains. No application/profile/FK fix or production SQL write has been performed; costing remains inactive and the security checkpoint is not closed.
- DE-19 permissions foundation is complete.
- DE-SECURITY-01 is deployed and production-verified.
- DE-18 atomic invoice counters are deployed and production-verified.
- Production smoke test on tenant `Testing`: purchase `PUR-0004`, sale `SAL-0008`; `invoice_counters` advanced to purchase=4 and sale=8. These are recorded verification results, not a live counter reading.
- DE-18 maintains independent sale and purchase counters per tenant. Invoice numbers are never reused; gaps are allowed.
- DE-05 inactive schema foundation `20260930180615_de05_inactive_inventory_foundation.sql` is deployed and database-verified in production on 2026-10-01 after explicit approval, a paused-write window, and a private public-schema/business-data backup with restore, migration, and rollback rehearsals. New inventory tables remain empty and closed to app roles; valuation fields are NULL and the sequence is unused. Existing checked business rows, invoice counters, table grants/RLS, policies, triggers, and functions are unchanged. No app write smoke test was run during that deployment; later owner/staff checks are recorded below. See `supabase/verification/de05-foundation.md`. The security-gate SQL foundation is also deployed (see below); costing is not active.
- DE-05 Security Gate Foundation SQL migration `20260930202806_de05_security_gate_foundation.sql` is deployed and database-verified on 2026-10-01 after explicit approval, a confirmed write pause and refreshed private-backup restore/migration/rollback rehearsals. The exact reviewed permission function and two enabled inactive-costing guards are present; checked business records, invoice counters and existing security were unchanged by deployment. No application deployment was performed. Separately authorized owner browser tests passed in Testing: create/edit purchase `PUR-0005` and sale `SAL-0009`, unpaid/partial/paid transitions, paid note edits, isolated customer/supplier payments and ledgers, cash book, opening stock, egg/tray adjustments and insufficient-stock rejection. Original checked Testing records are unchanged; owner checks returned stock and net cash to baseline at that point (the later failed super-admin edit is recorded below). Synthetic invoices/payments/movements remain and counters advanced to purchase=5/sale=9; reports include these Rs 20 invoices. New inventory tables remain empty and valuation fields NULL with sequence unused. Representative staff access and paid note-edit checks passed; two foreign sale/purchase reads were denied to Testing staff after explicit approval, with no invoice details displayed. Super-admin missing/invalid/nonexistent business selection and explicit Testing navigation passed; the edit retry loaded after reauthentication, but a note-only super-admin save failed on the existing creator/profile FK and removed the test sale movement, temporarily overstating Double stock by 60 eggs. Testing owner restored the missing movement and verified stock/payments unchanged at 03:51–03:52 PKT. The partial-write risk remains, and super-admin business access must now be denied under the clarified policy; sale/purchase deletion is unavailable in the current app. The server helper `src/lib/inventory-posting-auth.ts` remains unused by existing routes, and legacy direct-write closure is still required before valuation activation. Source commit `3cafefc` was pushed on `codex/de05-security-gate-foundation`; the subsequent privacy release contains it and the owner approved including it in the main fast-forward. See `supabase/verification/de05-security-gate.md`. The independently reviewed platform privacy correction has since been deployed; final live verification is recorded above. The moving-average engine follows as a separate chunk. Costing remains inactive.
- Existing operational transaction data is test data. The approved DE-05 cutover requires a coordinated test-ledger reset after snapshot, followed by fresh priced opening stock. DE-18 counters must never be reset during cutover.

## 1. Project Overview

Doctor's Egg is a Next.js application for managing an egg distribution business. The codebase supports business workflows for sales, purchases, suppliers, customers, stock, expenses, cash book, bank accounts, partner capital, alerts, reports, PDF invoices, and customer ledger PDFs.

Confirmed business domain: egg distribution management. Evidence: `src/app/layout.tsx` sets the description to "Egg distribution management system"; stock and sales/purchase logic use egg categories, trays, and peti quantities.

Confirmed tenancy model: multi-tenant. Most business tables are scoped with a `tenant_id` column in API queries and writes. Tenant membership is loaded through `tenant_members` in `src/lib/tenant.ts`; tenants are managed through super-admin routes under `src/app/api/admin/tenants`.

Confirmed app name: Doctor's Egg. Evidence: `package.json` has `"name": "doctors-egg"`, `src/app/layout.tsx` sets the title to "Doctor's Egg", and login/admin UI uses "Doctor's Egg". The repository path is `anda-distribution`, but I did not find active source text confirming "Anda Distribution" as an old in-app brand. Needs confirmation.

## 2. Tech Stack

- Framework: Next.js `16.2.9`, App Router under `src/app`.
- Language: TypeScript `^5`, React `19.2.4`, React DOM `19.2.4`.
- Backend/database client: Supabase via `@supabase/supabase-js` `^2.108.2` and `@supabase/ssr` `^0.12.0`.
- Auth provider: Supabase Auth. Login uses `supabase.auth.signInWithPassword` in `src/app/(auth)/login/page.tsx`.
- Styling: Tailwind CSS `^3.4.19`, global component classes in `src/app/globals.css`, config in `tailwind.config.ts`.
- UI/icons: local components plus `lucide-react` `^1.21.0`.
- Forms/validation packages: `react-hook-form` `^7.80.0`, `@hookform/resolvers` `^5.4.0`, `zod` `^4.4.3`. Some current forms use direct React state rather than these packages.
- Data/client state: `@tanstack/react-query` `^5.101.1` is installed; several hooks use custom `window.fetch` or `useCachedFetch`.
- Charts: `recharts` `^3.9.0`.
- PDF/export: `jspdf` `^4.2.1`.
- Package manager evidence: `package-lock.json` exists, so npm is the confirmed package manager.
- Deployment platform evidence: README is the default create-next-app README and mentions Vercel. No `vercel.json` was found. Vercel is likely but not configured in repo files. Needs confirmation.
- Scripts from `package.json`: `npm run dev` -> `next dev`; `npm run build` -> `next build`; `npm run start` -> `next start`; `npm run lint` -> `eslint`.

## 3. Repository Structure

- `src/app/` - Next.js App Router pages, layouts, route groups, and API route handlers.
- `src/app/(auth)/` - login and invitation acceptance pages.
- `src/app/(dashboard)/` - tenant dashboard pages for operations.
- `src/app/(admin)/` - super-admin pages.
- `src/app/api/` - route handlers for business data, auth context, tenant settings, invitations, and admin tenant management.
- `src/components/` - reusable UI components, sidebar/navigation, modals, form components, sales/purchase item rows, PDF generation component.
- `src/hooks/` - client fetch hooks for sales, purchases, stock, customers, suppliers, expenses, capital, accounts, and egg categories.
- `src/lib/` - Supabase clients, tenant helpers, permission helpers, formatting and calculation utilities, PDF helpers, partner-name enrichment, cache helper, bank list.
- `src/lib/supabase/` - browser, server, and admin Supabase client factories.
- `src/types/` - shared TypeScript interfaces and union types.
- `public/` - static icons and favicon assets.
- `.env.example` - environment variable names with placeholder values.
- `README.md` - default create-next-app README; not project-specific.
- `supabase/migrations/` - versioned DE-SECURITY-01, DE-18, and DE-05 inactive-foundation SQL migrations.
- `supabase/verification/` - security, invoice-counter, and inventory-foundation verification/recovery procedures.
- Config files: `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `tsconfig.json`.

## 4. Routing Structure

Public/auth routes:

- `/login` - Supabase email/password login. File: `src/app/(auth)/login/page.tsx`.
- `/invite/[token]` - staff invitation acceptance flow. Page: `src/app/(auth)/invite/[token]/page.tsx`; API: `src/app/api/invite/[token]/route.ts`.

Tenant dashboard routes:

- `/` - dashboard summary for sales, expenses, receivables, stock, recent sales, alerts. Files: `src/app/(dashboard)/page.tsx`, `src/app/api/dashboard/route.ts`.
- `/stock` - current stock and stock movements/adjustments. Files: `src/app/(dashboard)/stock/page.tsx`, `src/app/api/stock/route.ts`, `src/app/api/stock/movements/route.ts`.
- `/purchases` - purchase list. Files: `src/app/(dashboard)/purchases/page.tsx`, `src/app/api/purchases/route.ts`.
- `/purchases/new` - create purchase. File: `src/app/(dashboard)/purchases/new/page.tsx`.
- `/purchases/[id]/edit` - edit purchase and rewrite purchase items/stock movements. Files: `src/app/(dashboard)/purchases/[id]/edit/page.tsx`, `src/app/api/purchases/[id]/route.ts`.
- `/suppliers` - supplier balances/list. Files: `src/app/(dashboard)/suppliers/page.tsx`, `src/app/api/suppliers/route.ts`.
- `/suppliers/[id]` - supplier detail, ledger, and supplier payments. Files: `src/app/(dashboard)/suppliers/[id]/page.tsx`, `src/app/api/suppliers/[id]/route.ts`, `src/app/api/suppliers/[id]/ledger/route.ts`, `src/app/api/supplier-payments/route.ts`.
- `/sales` - sales list and detail modal. Files: `src/app/(dashboard)/sales/page.tsx`, `src/app/api/sales/route.ts`.
- `/sales/new` - create sale. File: `src/app/(dashboard)/sales/new/page.tsx`.
- `/sales/[id]/edit` - edit sale and rewrite sale items/stock movements/payment sync. Files: `src/app/(dashboard)/sales/[id]/edit/page.tsx`, `src/app/api/sales/[id]/route.ts`.
- `/customers` - customer balances/list. Files: `src/app/(dashboard)/customers/page.tsx`, `src/app/api/customers/route.ts`.
- `/customers/[id]` - customer detail, payment entry, ledger, ledger PDF. Files: `src/app/(dashboard)/customers/[id]/page.tsx`, `src/app/api/customers/[id]/route.ts`, `src/app/api/customers/[id]/ledger/route.ts`, `src/app/api/payments/route.ts`.
- `/expenses` - expenses list/create/edit/delete. Files: `src/app/(dashboard)/expenses/page.tsx`, `src/app/api/expenses/route.ts`, `src/app/api/expenses/[id]/route.ts`.
- `/capital` - partner capital summaries and transactions. Files: `src/app/(dashboard)/capital/page.tsx`, `src/app/api/capital/route.ts`.
- `/cash-book` - daily cash-in/out view from payments and expenses. Files: `src/app/(dashboard)/cash-book/page.tsx`, `src/app/api/cash-book/route.ts`.
- `/alerts` - overdue/due-today sales. Files: `src/app/(dashboard)/alerts/page.tsx`, `src/app/api/alerts/route.ts`.
- `/accounts` - bank account balances. Files: `src/app/(dashboard)/accounts/page.tsx`, `src/app/api/accounts/route.ts`.
- `/accounts/[id]` - bank account statement. Files: `src/app/(dashboard)/accounts/[id]/page.tsx`, `src/app/api/accounts/[id]/route.ts`, `src/app/api/accounts/[id]/statement/route.ts`.
- `/reports` - profit and loss report. Files: `src/app/(dashboard)/reports/page.tsx`, `src/app/api/reports/pl/route.ts`.
- `/settings` - tenant business name/logo, members, invites. Files: `src/app/(dashboard)/settings/page.tsx`, `src/app/api/settings/route.ts`.

Super-admin routes:

- `/admin` - admin dashboard summary of tenants. Files: `src/app/(admin)/admin/page.tsx`, `src/app/api/admin/tenants/route.ts`.
- `/admin/tenants` - list/edit tenant plan/status. Files: `src/app/(admin)/admin/tenants/page.tsx`, `src/app/api/admin/tenants/route.ts`, `src/app/api/admin/tenants/[id]/route.ts`.
- `/admin/tenants/new` - create tenant, owner user, member row, profile, default egg/expense categories. Files: `src/app/(admin)/admin/tenants/new/page.tsx`, `src/app/api/admin/tenants/route.ts`.
- `/admin/tenants/[id]` - tenant detail, members, pending invitations. File: `src/app/(admin)/admin/tenants/[id]/page.tsx`.
- `/admin/tenants/[id]/edit` - tenant edit page. File: `src/app/(admin)/admin/tenants/[id]/edit/page.tsx`.

Other API routes:

- `/api/me` - current tenant/user context.
- `/api/admin/setup` - one-time super admin setup using `ADMIN_SETUP_SECRET`.
- `/api/egg-categories` and `/api/expenses/categories` - category lists.
- `/api/profiles` - profile access. File exists but should be inspected before changing.
- `/api/partners` - unified profile-partner/simple-partner options and simple partner creation.

## 5. Authentication and Authorization

Login:

- Client login uses Supabase email/password in `src/app/(auth)/login/page.tsx`.
- After login, the client calls `/api/me` to decide whether to route to `/admin` or `/`.
- Logout is done through `supabase.auth.signOut()` in sidebar/header components.

Session loading:

- Server session access is through `createClient()` in `src/lib/supabase/server.ts`, using `@supabase/ssr` cookies.
- Browser client is in `src/lib/supabase/client.ts`.
- Admin/service-role client is in `src/lib/supabase/admin.ts`.

Route protection:

- `src/proxy.ts` is the Next 16 Proxy file. It redirects unauthenticated users to `/login`, lets `/login`, `/invite/*`, `/api/invite/*`, and `/api/admin/setup` through, redirects logged-in users away from `/login`, and guards `/admin` paths by checking `super_admins`.
- API auth helpers live in `src/lib/tenant.ts` and `src/lib/tenant-api.ts`.
- `getTenantContext()` checks Supabase Auth user, then uses the admin client to read `tenant_members` and `super_admins`.
- `authorizeApi()` requires a tenant or super-admin status. For super admins, it can scope reads/writes by `tenant_id` query parameter.

Roles and permissions:

- Confirmed roles in code: `owner`, `staff`, `super_admin` for tenant context; `profiles.role` is typed as `partner | staff`.
- `src/lib/permissions.ts` defines default owner and staff permissions.
- Sidebar/mobile navigation hides some links based on permissions.
- Some pages return `<AccessDenied />` client-side when permissions disallow viewing, for example capital, reports, accounts, cash book, settings.

Current permission and write protection foundation:

- DE-19 is complete. `resolvePermissions()` applies stored staff module overrides to defaults; owner and super-admin permissions retain their role defaults. API module checks use `authorizeApi(request, { permission })`.
- Tenant business APIs require tenant scope. Super admins must select a validated tenant; `tenantEq()` rejects missing scope.
- DE-SECURITY-01 hardened direct ordinary writes to protected `tenant_members`, `invitations`, `sales`, `purchases`, `customer_payments`, and `supplier_payments`.
- Trusted server writes use the server-only Supabase admin client in `src/lib/supabase/admin.ts`. Authorization and tenant validation must precede privileged writes.
- `tenant_members.role` permits only `owner` and `staff`; `super_admin` is a separate platform role. Invitations are staff-only. `profiles.role` is a separate profile classification.
- `invoice_number` and `tenant_id` are immutable on sale/purchase updates.
- Versioned security migrations document specific protections; they are not a complete baseline dump of the production schema.

## 6. Database / Supabase Architecture

Versioned migrations are present:

- `supabase/migrations/20260930000000_de_security_01_write_hardening.sql` - protected writes, membership/invitation role constraints, and invoice identity immutability.
- `supabase/migrations/20260930000001_de18_invoice_counters.sql` - atomic invoice allocation and per-tenant counters.
- `supabase/migrations/20260930180615_de05_inactive_inventory_foundation.sql` - inactive exact inventory/costing state and journal storage; deployed 2026-10-01 without activating valuation.
- `supabase/migrations/20260930202806_de05_security_gate_foundation.sql` - trusted permission assertion and inactive-costing guards; deployed 2026-10-01.
- All four SQL migrations are deployed and database-verified. Verification procedures are in `supabase/verification/de-security-01.md`, `supabase/verification/de18.md`, `supabase/verification/de05-foundation.md`, and `supabase/verification/de05-security-gate.md`. DE-05 owner workflows, representative staff access/edit checks and two cross-tenant read denials passed; super-admin selection checks also passed, but the sale edit failed on an existing creator/profile FK after partial writes. The test sale is now repaired and verified; super-admin access-policy correction and legacy partial-write follow-up remain pending, so the security checkpoint is not closed.

A complete baseline schema and generated database types are not supplied by these migrations. The remaining table descriptions are inferred from source interfaces and queries; do not treat them as an exhaustive schema.

Common scoping:

- Most business tables include `tenant_id` in API writes and are filtered by `tenant_id` in reads.
- `tenants`, `tenant_members`, `super_admins`, and `invitations` support multi-tenant auth/admin behavior.
- `created_by`, `created_at`, and `updated_at` appear on many entities, but exact defaults/constraints are unknown.

Discovered tables:

- `invoice_counters` - independent sale/purchase allocation state per tenant; columns include `tenant_id`, `counter_type`, `last_number`. Counter state must survive ledger resets.
- `tenants` - business tenant/company. Important columns seen: `id`, `name`, `slug`, `owner_id`, `plan`, `is_active`, `logo_url`, `created_at`, `updated_at`.
- `tenant_members` - links Supabase Auth users to tenants. Columns seen: `id`, `tenant_id`, `user_id`, `role`, `permissions`, `invited_by`, `joined_at`, `created_at`, `updated_at`.
- `super_admins` - identifies super admin users. Column seen: `user_id`.
- `profiles` - user profile records. Columns seen: `id`, `tenant_id`, `full_name`, `role`, `phone`, `created_at`, `updated_at`.
- `invitations` - pending/accepted invites. Columns seen: `id`, `tenant_id`, `email`, `role`, `token`, `invited_by`, `accepted_at`, `expires_at`, `created_at`.
- `egg_categories` - tenant egg categories. Columns seen: `id`, `tenant_id`, `name`, `display_order`, `is_active`, `created_at`.
- `customers` - customer records. Columns seen: `id`, `tenant_id`, `business_name`, `contact_name`, `phone`, `address`, `area`, `customer_type`, `notes`, `is_active`, `created_at`, `updated_at`.
- `suppliers` - supplier records. Columns seen: `id`, `tenant_id`, `name`, `phone`, `address`, `notes`, `is_active`, `created_at`, `updated_at`.
- `sales` - sale headers. Columns seen: `id`, `tenant_id`, `customer_id`, `sale_date`, `invoice_number`, `notes`, `payment_status`, `due_date`, `amount_paid_paisa`, `discount_type`, `discount_value`, `discount_amount_paisa`, `paid_by`, `paid_by_partner_id`, `paid_by_partner_source`, `created_by`, `created_at`, `updated_at`.
- `sale_items` - sale line items. Columns seen: `id`, `tenant_id`, `sale_id`, `egg_category_id`, `quantity_trays`, `price_per_tray_paisa`, `discount_type`, `discount_value`, `discounted_price_paisa`, `cost_per_tray_paisa`, `created_at`.
- `purchases` - purchase headers. Columns seen: `id`, `tenant_id`, `supplier_id`, `supplier_name_snapshot`, `purchase_date`, `invoice_number`, `notes`, `payment_status`, `amount_paid_paisa`, `paid_by`, `paid_by_partner_id`, `paid_by_partner_source`, `created_by`, `created_at`, `updated_at`.
- `purchase_items` - purchase line items. Columns seen: `id`, `tenant_id`, `purchase_id`, `egg_category_id`, `quantity_trays`, `price_per_tray_paisa`, `total_paisa`, `created_at`.
- `stock_movements` - stock ledger. Columns seen: `id`, `tenant_id`, `egg_category_id`, `movement_type`, `quantity_trays`, `quantity_eggs`, `reason`, `price_per_egg_paisa`, `reference_id`, `notes`, `movement_date`, `created_by`, `created_at`.
- `customer_payments` - customer receipt records. Columns seen: `id`, `tenant_id`, `customer_id`, `amount_paisa`, `payment_date`, `payment_method`, `reference`, `notes`, `bank_account_id`, `created_by`, `created_at`.
- `supplier_payments` - supplier payment records. Columns seen: `id`, `tenant_id`, `supplier_id`, `amount_paisa`, `payment_date`, `payment_method`, `reference`, `notes`, `bank_account_id`, `created_by`, `created_at`.
- `expense_categories` - tenant expense categories. Columns seen: `id`, `tenant_id`, `name`, `icon`, `created_at`.
- `expenses` - operating expenses. Columns seen: `id`, `tenant_id`, `category_id`, `amount_paisa`, `expense_date`, `description`, `vehicle`, `odometer_km`, `worker_name`, `labor_type`, `notes`, `bank_account_id`, `paid_by`, `paid_by_partner_id`, `paid_by_partner_source`, `created_by`, `created_at`, `updated_at`.
- `capital_transactions` - partner capital ledger. Columns seen: `id`, `tenant_id`, `partner_id`, `partner_profile_id`, `type`, `amount_paisa`, `reference`, `notes`, `transaction_date`, `created_by`, `created_at`, `updated_at`.
- `partners` - simple partner records separate from auth profiles. Columns seen: `id`, `tenant_id`, `full_name`, `phone`, `is_active`, `created_at`.
- `bank_accounts` - bank/cash accounts. Columns seen: `id`, `tenant_id`, `bank_name`, `account_holder`, `account_number`, `nickname`, `is_active`, `created_by`, `created_at`, `updated_at`.
- Supabase Storage bucket `logos` - used by `src/app/api/settings/logo/route.ts` for tenant logo uploads.

Relationships inferred from selects:

- `sales.customer_id -> customers.id`.
- `sale_items.sale_id -> sales.id`.
- `sale_items.egg_category_id -> egg_categories.id`.
- `purchases.supplier_id -> suppliers.id`.
- `purchase_items.purchase_id -> purchases.id`.
- `purchase_items.egg_category_id -> egg_categories.id`.
- `stock_movements.egg_category_id -> egg_categories.id`; `reference_id` points to sale or purchase IDs depending on `movement_type`, but no FK is visible.
- `customer_payments.customer_id -> customers.id`.
- `supplier_payments.supplier_id -> suppliers.id`.
- `expenses.category_id -> expense_categories.id`.
- `capital_transactions.partner_id -> profiles.id` via `capital_transactions_partner_id_fkey`.
- `capital_transactions.partner_profile_id -> partners.id` via `capital_transactions_partner_profile_id_fkey`.
- `tenant_members.user_id -> profiles.id` is implied by joined selects.

Indexes, constraints, and RLS:

- The security and counter migrations define relevant constraints, RLS policies, triggers, and allocation functions.
- For tables outside those migrations, inspect the authoritative schema before changing constraints, indexes, foreign keys, or cascade behavior.

## 7. Business Modules

### Customers

- Files: `src/app/(dashboard)/customers/page.tsx`, `src/app/(dashboard)/customers/[id]/page.tsx`, `src/app/api/customers/route.ts`, `src/app/api/customers/[id]/route.ts`, `src/app/api/customers/[id]/ledger/route.ts`, `src/app/api/payments/route.ts`, `src/components/customers/*`.
- Data model: `customers`, `sales`, `customer_payments`.
- Workflows: create/update customers, list active customers, calculate customer balance as sale totals minus customer payments, record payments, view ledger, export customer ledger PDF.
- Customer types in code: `shop`, `restaurant`, `wholesaler`, `other`.

### Suppliers

- Files: `src/app/(dashboard)/suppliers/page.tsx`, `src/app/(dashboard)/suppliers/[id]/page.tsx`, `src/app/api/suppliers/route.ts`, `src/app/api/suppliers/[id]/route.ts`, `src/app/api/suppliers/[id]/ledger/route.ts`, `src/app/api/supplier-payments/route.ts`, `src/components/suppliers/*`.
- Data model: `suppliers`, `purchases`, `supplier_payments`.
- Workflows: create/update suppliers, compute balances from purchases minus supplier payments, record supplier payments, view supplier ledger.

### Sales

- Files: `src/app/(dashboard)/sales/page.tsx`, `src/app/(dashboard)/sales/new/page.tsx`, `src/app/(dashboard)/sales/[id]/edit/page.tsx`, `src/app/api/sales/route.ts`, `src/app/api/sales/[id]/route.ts`, `src/components/sales/*`.
- Data model: `sales`, `sale_items`, `stock_movements`, `customer_payments`, sometimes `capital_transactions`.
- Workflows: create sale with items, discounts, payment status, bank account/payment method, due date; list/filter sales; edit sale; generate invoice PDF.
- DE-18 allocates `SAL-` invoice numbers atomically using a per-tenant sale counter. Numbers are never reused; gaps are allowed.

### Purchases

- Files: `src/app/(dashboard)/purchases/page.tsx`, `src/app/(dashboard)/purchases/new/page.tsx`, `src/app/(dashboard)/purchases/[id]/edit/page.tsx`, `src/app/api/purchases/route.ts`, `src/app/api/purchases/[id]/route.ts`, `src/components/purchases/*`.
- Data model: `purchases`, `purchase_items`, `stock_movements`, sometimes `capital_transactions`.
- Workflows: create purchase from supplier or supplier name snapshot, add item lines, increase stock, mark payment status, optionally mark paid by partner.
- DE-18 allocates `PUR-` invoice numbers atomically using a per-tenant purchase counter, independent of the sale counter. Numbers are never reused; gaps are allowed.

### Stock / Inventory

- Files: `src/app/(dashboard)/stock/page.tsx`, `src/app/api/stock/route.ts`, `src/app/api/stock/movements/route.ts`, `src/components/stock/adjustment-modal.tsx`, `src/lib/utils.ts`.
- Data model: `stock_movements`, `egg_categories`.
- Workflows: purchases create `purchase_in` movements; sales create `sale_out` movements; manual movements can be `adjustment_in`, `adjustment_out`, or `opening_stock`.
- Current stock is derived by summing movements. No current-stock table was found.

### Cash Book

- Files: `src/app/(dashboard)/cash-book/page.tsx`, `src/app/api/cash-book/route.ts`.
- Data model: `customer_payments`, `supplier_payments`, `expenses`.
- Workflow: daily cash-in is customer payments; cash-out is expenses plus supplier payments; net is cash-in minus cash-out.

### Bank Accounts

- Files: `src/app/(dashboard)/accounts/page.tsx`, `src/app/(dashboard)/accounts/[id]/page.tsx`, `src/app/api/accounts/route.ts`, `src/app/api/accounts/[id]/route.ts`, `src/app/api/accounts/[id]/statement/route.ts`, `src/components/accounts/*`.
- Data model: `bank_accounts`, linked from `customer_payments`, `supplier_payments`, and `expenses`.
- Workflow: account balance is customer receipts minus supplier payments minus expenses.

### Capital / Partners

- Files: `src/app/(dashboard)/capital/page.tsx`, `src/app/api/capital/route.ts`, `src/app/api/partners/route.ts`, `src/lib/expense-partners.ts`.
- Data model: `capital_transactions`, `profiles`, `partners`.
- Workflows: create contribution/withdrawal; summarize capital by partner; automatically create/update capital contribution records when a purchase, sale, or expense is marked as paid by partner.
- Important: there are two partner sources, `profiles` and `partners`, distinguished by `source: 'profile' | 'partner'`.

### Expenses

- Files: `src/app/(dashboard)/expenses/page.tsx`, `src/app/api/expenses/route.ts`, `src/app/api/expenses/[id]/route.ts`, `src/app/api/expenses/categories/route.ts`, `src/components/expenses/*`.
- Data model: `expenses`, `expense_categories`, `capital_transactions`.
- Workflows: create/edit/delete expenses; optional vehicle, odometer, worker, labor type, bank account, paid-by-partner fields.

### Reports

- Files: `src/app/(dashboard)/reports/page.tsx`, `src/app/api/reports/pl/route.ts`.
- Data model: `sales`, `sale_items`, `expenses`, `purchases`.
- Workflow: profit/loss report with revenue, COGS, gross profit, expenses, net profit, purchases. COGS is based on stored `cost_per_tray_paisa` in sale items.

### Alerts

- Files: `src/app/(dashboard)/alerts/page.tsx`, `src/app/api/alerts/route.ts`.
- Workflow: lists overdue and due-today sales based on `due_date` and `payment_status`.

### PDF Invoices and Statements

- Files: `src/components/sales/invoice-pdf.ts`, `src/lib/customer-ledger-pdf.ts`, `src/lib/pdf-logo.ts`.
- Library: `jspdf`.
- Workflows: sale invoice PDF from sale detail modal; customer statement PDF from customer detail page.

### Settings / Admin / SaaS

- Tenant settings: `src/app/(dashboard)/settings/page.tsx`, `src/app/api/settings/route.ts`, `src/app/api/settings/logo/route.ts`, `src/app/api/settings/invite/route.ts`, `src/app/api/settings/members/[id]/route.ts`.
- Super admin tenant management: `src/app/(admin)/admin/*`, `src/app/api/admin/*`.
- SaaS plan field exists as `tenants.plan` with values shown in UI such as `trial`, `basic`, `pro`, but no billing/subscription integration was found. Needs confirmation.

## 8. Financial Logic

Money storage:

- Money is represented as integer paisa in the code (`amount_paisa`, `price_per_tray_paisa`, `discount_amount_paisa`, `cost_per_tray_paisa`, etc.).
- User-facing formatting converts paisa to PKR in `src/lib/utils.ts`.
- This avoids floating-point currency storage in most server-side data.

Sale totals and payments:

- Sale totals are calculated from sale items using `effectiveItemLineTotalPaisa()` and `computeSaleTotalPaisa()` in `src/lib/utils.ts`.
- Item-level discounts use `discounted_price_paisa`; overall sale discounts use `discount_amount_paisa`.
- `computeSalePaymentBreakdown()` treats `paid` as full total paid, `partial` as `amount_paid_paisa`, and `unpaid` as zero.
- Creating a paid or partial sale inserts a `customer_payments` row in `src/app/api/sales/route.ts`.
- Editing a sale can delete and recreate auto-generated customer payment rows by matching `notes` text such as `Payment for SAL-0001`.

Customer ledger:

- Customer debit is computed from sales; customer credit is computed from `customer_payments`.
- Ledger running balance is built in `src/app/api/customers/[id]/ledger/route.ts`.

Supplier ledger:

- Supplier debit is computed from purchases; credit is computed from `supplier_payments`.
- Ledger running balance is built in `src/app/api/suppliers/[id]/ledger/route.ts`.

Cash book:

- Cash-in comes from `customer_payments`.
- Cash-out comes from `expenses` plus `supplier_payments`.
- Bank account statement uses the same source records, with customer payments as credits and expenses/supplier payments as debits.

Profit/loss:

- Revenue is from sale item effective totals minus overall sale discount.
- COGS is `quantity_trays * cost_per_tray_paisa` on sale items.
- Sale item cost is set from a simple average of purchase item prices by category at sale creation/edit time.

Critical risks:

- Multi-step writes are not wrapped in visible database transactions. Sales and purchases create header, item, stock movement, payment, and sometimes capital rows in separate Supabase calls.
- Manual cleanup on failure usually deletes only the header row. Depending on database cascade settings, orphan item/payment/stock rows may be possible. Cascades are not visible in repo. Needs confirmation.
- Auto payment sync for sales deletes rows by matching notes text, not by a stable `sale_id` foreign key. This is fragile if notes collide or are edited outside the flow.
- Expenses paid by partner create capital entries by notes text. Expense delete does not visibly remove matching capital transactions.
- Sale/purchase edits delete and recreate item and stock movement rows. If insert fails after delete, the record can be left without its prior items/movements.
- Current COGS uses a simple average purchase price by category. DE-05 will replace this with moving weighted-average inventory valuation and permanently saved exact sale COGS totals.
- Several calculations aggregate all history by querying raw rows in API handlers; no database views/materialized summaries were found.

## 9. Stock / Egg Quantity Logic

Confirmed unit rules:

- 1 tray = 30 eggs. Evidence: `traysToEggs(trays) => trays * 30` and `eggsToTrays(eggs) => eggs / 30` in `src/lib/utils.ts`.
- 1 peti = 12 trays = 360 eggs. Evidence: `formatQty()` and item row components use `quantity_peti * 12 + quantity_tray`.

Stock-in/out:

- Purchases insert `purchase_in` stock movements.
- Sales insert `sale_out` stock movements.
- Manual stock movements can be `adjustment_in`, `adjustment_out`, or `opening_stock`.
- `src/app/api/stock/route.ts` treats `purchase_in`, `adjustment_in`, and `opening_stock` as inbound; everything else is outbound.

Adjustment logic:

- `src/components/stock/adjustment-modal.tsx` can submit either eggs or trays.
- If input is eggs, API stores exact eggs and uses `Math.ceil(eggs / 30)` for tray count.
- If input is trays, API stores trays and computes eggs as trays * 30.

Risks/unclear areas:

- Sale and purchase movements often store `quantity_trays` but not `quantity_eggs`; stock APIs derive eggs from trays.
- Server-side stock availability validation exists in `src/lib/stock-availability.ts` and is called before sale creation. Atomic protection against concurrent stock operations remains an implementation concern for DE-05.
- Peti/tray UI limits tray remainder to 0-11 in item row components, but server handlers accept `quantity_trays` directly and do not revalidate peti/tray decomposition.
- No batch/lot tracking or expiry logic was found.

## 10. PDF / Print / Export Logic

- Sale invoice PDFs are generated client-side using `jsPDF` in `src/components/sales/invoice-pdf.ts`.
- Customer ledger PDFs are generated in `src/lib/customer-ledger-pdf.ts`.
- Branding/logo helpers are in `src/lib/pdf-logo.ts`; tenant logo URL is loaded through `/api/me` and settings upload.
- Sale invoice PDF filename is `invoice_<invoice_number_or_id>.pdf`.
- Customer statement filename is based on customer contact name and current date.
- No CSV/Excel export code was found.
- No browser print helper was found beyond PDF generation. Needs confirmation if printing is handled manually by downloaded PDF.

## 11. UI and Design System

- Layout uses a desktop sidebar and mobile header/bottom navigation for tenant dashboard: `src/app/(dashboard)/layout.tsx`, `src/components/sidebar.tsx`, `src/components/mobile-header.tsx`, `src/components/mobile-bottom-nav.tsx`.
- Super admin layout has a desktop-only admin sidebar: `src/app/(admin)/layout.tsx`, `src/components/admin/admin-sidebar.tsx`.
- Styling is Tailwind plus global component classes in `src/app/globals.css`.
- Common classes include `.card`, `.input`, `.select`, `.textarea`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.table`, `.badge-*`, `.modal-*`, `.stat-card`.
- Icons come from `lucide-react`.
- Page pattern: `.page-header`, `.page-title`, stat cards, table containers, empty states, modals.
- Mobile pattern: dashboard content gets top padding for the mobile header and bottom padding for mobile nav.
- Responsive caveat: admin layout is `hidden lg:block`; the super-admin UI appears intentionally unavailable on mobile.

## 12. Environment Variables

Environment variable names used by configuration and Supabase client files (values intentionally excluded):

Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional/conditional:

- `ADMIN_SETUP_SECRET` - required only for `/api/admin/setup` one-time setup.

Unknown:

- No other environment variables were found in source.

Secret handling:

- Do not expose real `.env.local` values.
- `NEXT_PUBLIC_*` variables are intentionally public in browser bundles.
- `SUPABASE_SERVICE_ROLE_KEY` must remain server-only.

## 13. Deployment

Confirmed:

- Build command: `npm run build`.
- Start command: `npm run start`.
- Development command: `npm run dev`.
- Lint command: `npm run lint`.
- App requires Supabase environment variables listed above.

Likely but not fully confirmed:

- Vercel is mentioned by the default README, and Next.js is commonly deployed there, but no project-specific `vercel.json` or deployment config was found. Needs confirmation.

## 14. Current Known Issues / Risks

- DE-05 valuation/posting is approved but unimplemented; the inactive schema is deployed, and the security-gate SQL foundation is deployed and database-verified. Owner workflows, representative staff access/edit checks and two cross-tenant read denials passed; super-admin selection checks also passed, but the sale edit failed on an existing creator/profile FK after partial writes. The test sale is now repaired and verified; super-admin access-policy correction and legacy partial-write follow-up remain pending, so the security checkpoint is not closed. Current simple-average COGS and rounded adjustment tray storage are legacy behavior, not the approved accounting model.
- Invoice allocation is atomic, but multi-step financial and stock posting is not thereby made transactional.
- Sale/purchase edit flows delete and recreate items/movements, creating partial-update risk.
- Concurrent stock operations need atomic inventory state protection; availability prechecks alone do not ensure this.
- Auto-generated customer payment and capital synchronization uses notes text rather than stable foreign keys; expense deletion does not visibly clean up related partner capital entries.
- Versioned hardening migrations exist, but a complete baseline schema is still needed to assess all cascades, constraints, and policies.
- No automated test script is configured in `package.json`; README remains generic create-next-app documentation.

## 15. Development Workflow and Rules

- Follow: audit -> small implementation -> independent review -> manual/database test -> commit -> next chunk.
- Current checkpoint: DE-05 Security Gate Foundation SQL deployed and database-verified; authorized owner workflows, representative staff access/edit checks and two cross-tenant read denials passed, with super-admin selection checks passed but a High creator/profile FK and partial-sale-edit blocker found. Test-sale owner repair passed. The platform super-admin denial correction is now locally implemented/tested and awaits independent review/deployment; the existing partial-write risk remains; do not close the security checkpoint. Source is pushed on its feature branch, not yet merged into main. Deploy and production-verify the local denial correction before continuing to the moving-average engine. Future trusted transactional posting and costing activation require separate work and deployment approval.
- Read relevant guides in `node_modules/next/dist/docs/` before writing Next.js code, as required by `AGENTS.md`.
- Preserve DE-18 counters through any test-ledger reset; never reuse invoice numbers.
- Inspect existing patterns first, especially `src/lib/tenant-api.ts`, `src/lib/utils.ts`, and nearby API handlers.
- Do not rewrite large areas unnecessarily; make small, reviewable changes.
- Preserve tenant isolation on every read and write.
- Do not rely on client-side permission hiding for security-sensitive changes; enforce access in API handlers and/or RLS.
- Do not break financial ledgers, payment posting, stock movements, or capital transaction synchronization.
- Database changes require an explicit migration plan, rollback plan, and RLS/constraint review.
- Financial changes require tests or a manual verification checklist covering paid, partial, unpaid, edit, and delete paths.
- Stock changes require checks for tray/peti/egg conversion and negative-stock behavior.
- Do not change unrelated files.
- Do not expose secrets from `.env.local`.
- Prefer small phases and chunks for major accounting/tenant/security work.
- Update `PROJECT_CONTEXT.md` after major architecture, schema, route, or business-rule changes.

## 16. Testing and Quality

Existing setup:

- ESLint is configured through `eslint.config.mjs` using `eslint-config-next/core-web-vitals` and TypeScript rules.
- TypeScript strict mode is enabled in `tsconfig.json`.
- No `test`, `typecheck`, Jest, Vitest, Playwright, or Cypress scripts were found in `package.json`.
- Automated Node regression tests are present in `tests/`; run `node --test tests/*.test.mjs`. DE-05 has a separate real PostgreSQL test runner: `node tests/de05-foundation-db.mjs`, using a disposable Docker container and synthetic data.
- DE-05 security-gate database checks: `node tests/de05-security-gate-db.mjs`, also restricted to a new network-isolated disposable Docker container and synthetic data.

Recommended manual checklist:

- Login as super admin, tenant owner, and staff.
- Verify staff cannot access restricted pages or APIs that should be owner-only.
- Create a tenant and confirm default egg/expense categories.
- Create customer, sale unpaid/partial/paid, and verify customer balance, cash book, bank account, stock, invoice PDF, and alerts.
- Edit a sale and verify sale items, stock movements, customer payments, and capital entries stay consistent.
- Create supplier purchase unpaid/partial/paid and verify stock, supplier balance, capital, and reports.
- Edit a purchase and verify stock movements are replaced correctly.
- Create/edit/delete expenses, especially paid-by-partner expenses, and verify capital/cash book/account effects.
- Add bank accounts and verify account statements.
- Upload tenant logo and verify invoice/statement branding.
- Run `npm run lint` and `npm run build` before shipping.

## 17. Pending Questions

- What is the complete authoritative baseline database schema, including constraints, indexes, cascades, triggers, and RLS outside the checked-in migrations?
- Should payment and partner capital entries be linked by stable foreign keys instead of notes text?
- How should edit/delete operations reverse or replace related payments, stock movements, and capital transactions while preserving the approved DE-05 costing rules?
- Are `partners` and `profiles` both permanent concepts, or should they be unified?
- Is Vercel the production deployment platform?
- Are SaaS plans (`trial`, `basic`, `pro`) informational only, or should they enforce limits/features?

Costing method, invoice gap policy, and staff permission override behavior are settled decisions, not pending questions.

## 18. DE-05 Approved Inventory Costing Architecture

Status: fully approved. The inactive schema and security-gate SQL foundations are deployed and database-verified; super-admin selection checks passed, but the failed synthetic sale is repaired, while super-admin access-policy correction and legacy partial-write follow-up remain required, and the valuation engine and integrations remain unimplemented. Production still uses current stock behavior. The rules below describe the target.

### Authoritative inventory and costing

- Use moving weighted-average inventory cost.
- Maintain inventory state per tenant and egg category.
- Exact authoritative quantity is eggs; exact authoritative inventory value is integer paisa.
- Quantity and value must remain nonnegative. Zero eggs requires zero value; remaining eggs may have zero value after integer-paisa rounding.
- Save each sale's COGS permanently as an exact total. Later purchases never restate prior sale COGS.
- Do not automatically restate historical COGS.

### Stock operation rules

- New opening stock is only valid as the first valued operation for an empty tenant/category balance and requires explicit positive cost; add exact quantity and value.
- Adjustment-in requires explicit positive cost or may inherit a known moving average.
- Adjustment-out removes inventory value at the current moving average.
- The first release rejects out-of-order/backdated stock operations.
- Store truthful `quantity_trays`: a whole tray count only when eggs are divisible by 30; otherwise NULL. Current `Math.ceil(eggs / 30)` adjustment storage must be replaced during implementation.

### Future units and transfers

- Future Peti support uses 1 peti = 12 trays = 360 eggs. Existing UI conversions use this unit relationship; DE-05 inventory authority remains eggs.
- A future category transfer must be an atomic source/destination operation preserving exact inventory value and producing no P&L effect.

### Coordinated cutover

- Existing operational transaction data is test data.
- Snapshot before a coordinated test-ledger reset, then seed fresh priced opening stock.
- Never reset DE-18 invoice counters during cutover. Previously allocated invoice numbers remain consumed even when test-ledger records are removed.
- This is an approved future cutover direction, not an instruction to execute a reset during this documentation refresh.

## 19. Public-Safe Documentation Boundary

This document is suitable for Git tracking. It retains architecture, source paths, environment variable names, migration references, and the requested smoke-test invoice results. It excludes secret values, credential-bearing database URLs, invitation/auth tokens, personal email addresses, and production UUIDs/project identifiers. Keep credentials and private operational access details outside tracked documentation.
