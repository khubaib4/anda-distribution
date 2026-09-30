---
name: doctors-egg-inventory
description: "Apply Doctor’s Egg inventory and accounting rules to stock movements/adjustments, inventory-affecting purchases/sales, COGS, moving-average costing, opening stock, valuation, concurrency, transaction safety, category transfers, Peti/tray/egg conversions, and inventory reports. Excludes unrelated UI, authentication, generic settings, emails, and copywriting."
---

# Doctor’s Egg Inventory

## Context and source of truth

Before substantial Doctor’s Egg inventory/accounting work, read the repository-root [PROJECT_CONTEXT.md](../../../PROJECT_CONTEXT.md), then relevant current code and existing migrations/schema assumptions. Current repository code and production-verified migrations override stale context when they conflict. Distinguish implemented behavior from the approved DE-05 target; legacy behavior is not permission to discard these business rules. Surface conflicts rather than treating an unimplemented target as deployed.

Keep transient production values, tenant IDs, test invoices, temporary bugs, and historical audit notes in PROJECT_CONTEXT.md or the current task. Do not duplicate the context document here.

## Quantity

- 1 tray = 30 eggs; 1 peti = 12 trays = 360 eggs.
- Exact authoritative inventory quantity is whole eggs. Normal sales and purchases use positive whole trays.
- Manual adjustments may accept eggs or trays, but must normalize to an exact positive whole-egg count.
- For new `stock_movements`, `quantity_eggs` is authoritative. `quantity_trays` is truthful compatibility metadata: store exact whole trays only when eggs are divisible by 30; otherwise store NULL after the DE-05 schema migration. Never represent 15 eggs as `quantity_trays = 1`.
- Future Peti UI converts `peti × 360` to eggs; no dedicated peti inventory column is required.

## Money and moving weighted-average costing

Money is integer paisa; avoid floating-point money calculations. Exact integer total inventory value is authoritative. PostgreSQL NUMERIC may support intermediate multiplication/division, followed by explicit range and rounding checks before BIGINT storage. Never reconstruct an exact total from rounded unit cost when that total exists.

DE-05 uses **moving weighted average**, maintaining conceptual state per **tenant + egg category**: exact on-hand eggs `Q` and exact inventory value `V` in integer paisa. Average cost is derived as `V / Q`, not a rounded stored authority.

| Operation | Quantity and value rule |
| --- | --- |
| Purchase | Add exact quantity and exact purchase value. |
| New opening stock | New opening stock is only valid as the first valued operation for an empty tenant/category balance and requires explicit positive cost; add exact quantity and value. |
| Adjustment in | Accept explicit positive cost, or inherit the current known moving average. Reject inheritance if no positive known average exists. |
| Adjustment out | Remove stock at the current moving-average value. |
| Sale | Remove stock at the moving-average value immediately before the sale; permanently save exact sale COGS. Later purchases must never restate earlier sale COGS. |

Full depletion removes all remaining inventory value, including rounding residual. Zero eggs implies zero inventory value. Quantity and value must remain nonnegative.

## Outbound allocation and rounding

Compute one exact outbound cost per category first. When multiple sale lines use that category, use cumulative proportional allocation so line totals sum exactly to the category outbound total. Never allow a negative residual; final depletion receives any remaining rounding residual. Do not independently round several line shares and blindly assign a possibly negative residual to the final line.

## Chronological posting

The first DE-05 release uses conservative chronological posting and tail-only inventory revisions. For each tenant/category:

- Reject an out-of-order stock-changing create and an edit before a later valuation event.
- Do not replay later movements in v1 or automatically restate historical saved sale COGS.
- Reject future business dates where the approved workflow requires current/past Karachi business dates.

## Transactions and concurrency

Inventory correctness requires database transaction boundaries. Do not approve a read-stock → calculate → separate-insert pattern when concurrent writers can both pass the read.

For active DE-05 posting, use database-owned locked inventory state. Lock affected tenant/category balances in deterministic order, read balances after acquiring locks, then validate availability. Write the document, items, movements, and balance atomically; concurrent outbound operations must serialize.

DE-05 includes the minimum required DE-03/DE-09 transaction/concurrency slice. Do not claim broader financial atomicity unless it is actually implemented.

## Tenant security and invoice continuity

- Scope every inventory state and operation to the authorized tenant. Related customer, supplier, category, and account references must belong to that tenant.
- Preserve DE-19 module permissions and DE-SECURITY-01 trusted-write boundaries. Do not bypass RLS or security functions to make tests pass.
- Platform super-admins must never view or modify tenant business data, including inventory operations, even with explicit tenant selection or tenant membership. Owners and permitted staff use authorized tenant paths; platform setup/plan/status management remains separate.
- DE-18 is deployed: invoice allocation is atomic and per tenant, with independent sale/purchase counters; numbers are never reused and gaps are allowed. Never reintroduce `COUNT(*)` or `MAX()+1` issuance.
- DE-05 may later call the SQL allocator within transactional posting. DE-05 cutover must never reset invoice counters.

## Future category transfers

Category transfers are outside initial DE-05 scope; preserve architectural compatibility without implementing them unless explicitly requested. A future transfer (for example Large → Medium) moves exact eggs and exact inventory value in one atomic operation: lock source and destination, remove exact value from the source, and add the identical integer-paisa value to the destination. Create no revenue, COGS, or profit/loss.

## Workflow

For substantial inventory/database work:

1. Read PROJECT_CONTEXT.md, relevant current code, and existing migrations/schema assumptions.
2. Prefer a small, independently reviewable implementation chunk. For relevant schema, migration, locking, RLS, and SQL design, apply the Supabase and Supabase Postgres Best Practices skills when available.
3. Add meaningful tests; prefer real PostgreSQL/database tests for behavior that depends on SQL locking, constraints, grants, RLS, or transactions.
4. Run focused tests and full regression checks; report assumptions, unverified behavior, and production checks still required.
5. Do not commit or push unless explicitly requested. Do not execute production SQL unless explicitly requested.
