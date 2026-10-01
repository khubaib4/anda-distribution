# DE-05 Moving-Average Costing Engine — local review packet

Status on 2026-10-01: implemented and tested locally. Independent review found
three P2 concerns; focused independent re-review confirmed all three resolved
with no new actionable issue. The owner approved commit and push; production
deployment and verification remain pending.
Costing remains inactive. No production SQL, data reset, opening-stock seed or
production deployment was performed. Commit/push is now authorized. Synthetic
costing records existed only inside new disposable, network-isolated test
databases, which were removed afterward.

The starting checkout was clean on `codex/de05-security-gate-foundation` at
`7cd669feb5c67637f14a514d11c03b5c4c28455f`; local `main` and `origin/main`
pointed to the same commit. Work is now on local branch
`codex/de05-moving-average-core`; this packet accompanies the approved commit.
The owner confirms the security correction is deployed on main at `7cd669f`.
The final manual super-admin API check is still pending. The security checkpoint
is **not closed**; these local tests do not substitute for that check.

## Review files

- Migration: `supabase/migrations/20261001093952_de05_moving_average_core.sql`.
- Database tests: `tests/de05-moving-average-db.mjs`.
- Guarded, unused-only recovery: `supabase/verification/de05-moving-average-core-rollback.sql`.
- Approved rules: `PROJECT_CONTEXT.md` section 18 and the `doctors-egg-inventory` skill.
- Deployed security status: `supabase/verification/platform-admin-business-access.md`.
  Earlier foundation/gate notes describe historical stages; the corrected
  platform-admin denial is the rule used by this core.

## Business behavior implemented

The core keeps exact whole eggs and exact total inventory value in integer paisa
for each tenant/category. It derives the moving average from that pair, without
saving a rounded unit cost as the authority.

| Operation | Local core behavior |
| --- | --- |
| Purchase | Add exact eggs and the supplied exact purchase total. |
| Opening stock | Require a positive explicit total and a never-valued empty balance. |
| Adjustment in | Use a positive explicit total, or inherit a known positive average from before the operation. |
| Adjustment out | Remove value using the immediately preceding moving average. |
| Sale | Remove value using that average and save the exact cost allocated to each original line. |

Normal purchases/sales require whole trays (eggs divisible by 30). Manual
operations accept exact whole eggs. Journal line tray metadata is generated:
whole trays when divisible by 30, otherwise NULL. One peti is still 360 eggs;
there is no separate peti column or transfer implementation.

Rounding uses exact integer quotient/remainder arithmetic, with half a paisa
rounded up. Intermediate products use PostgreSQL NUMERIC, and stored quantities
and values are checked against BIGINT limits. This avoids both floating-point
money and rounding errors from finite decimal division near large half boundaries.
Full depletion removes all remaining value. Positive eggs may have zero value
following rounding, and those eggs can later be removed at zero cost. An
unpriced adjustment cannot inherit from a zero-value balance.

Each outbound category is costed once. Line costs use cumulative proportional
allocation in original input order, so they remain nonnegative and sum exactly
to the category cost. For 90 eggs costing 2 paisa, three 30-egg sale lines receive
1, 0 and 1 paisa. Later purchases leave those saved costs unchanged.
For an adjustment containing explicit and inherited lines, inherited lines share
one rounded total calculated from the pre-operation average; explicit lines
retain their supplied totals. An explicit line does not establish a new average
for another unpriced line in that same operation.

## Private interface and transaction boundary

Three owner-only SECURITY INVOKER routines live in private schema `de05_costing`:

- `round_ratio(numeric,numeric)` — exact rounding with range checks.
- `transition(bigint,bigint,bigint,bigint,text)` — pure quantity/value calculation.
- `post(uuid,uuid,text,date,jsonb,uuid,bigint)` — permission-checked, locked
  costing journal/balance update. This is an internal subroutine, not an app RPC.

`post` takes verified actor, tenant, operation type, Karachi business date,
ordered lines, optional source-document UUID and a reserved `p_supersedes`
argument that must be NULL. Any non-NULL value is rejected with SQLSTATE `0A000`;
the shared revision engine belongs to a later chunk.
A line contains `egg_category_id`, `quantity_eggs`, and optionally
`cost_total_paisa`; quantities/costs may be integer JSON numbers or decimal
integer strings. Unknown fields, missing/zero/fractional quantities, explicit
zero costs and caller-supplied outbound costs are rejected. The line array has
1–1000 entries. Clients should eventually send large integers as strings.
No current app code calls this interface.

Posting requires **READ COMMITTED** isolation. The routine rejects Read
Uncommitted, Repeatable Read and Serializable with SQLSTATE `0A000` before
permissions, locks, sequence consumption or journal/balance writes. The
after-wait permission check needs a fresh statement snapshot; Repeatable Read
and Serializable retain an earlier transaction snapshot. See the
[PostgreSQL 17 isolation rules](https://www.postgresql.org/docs/17/transaction-iso.html).

Purchases/sales require an existing same-tenant source header with the same
business date; it may have been created or updated earlier in the same future
posting transaction. Manual operation references must be NULL. A document may
have only one active valuation; duplicate calls fail rather than double-post.
There is no retry token or full-document idempotency contract in this chunk.

The core locks the source header first, then creates/locks every affected
balance in sorted category UUID order. It reads quantities and values after
locking, rechecks permissions after lock waits, and obtains the PostgreSQL-owned
valuation sequence only after all balance locks. Concurrent outbound writers
therefore use the latest balance, and one must fail if both would oversell.
A failure rolls back operations, snapshots, lines and balance writes together.
Sequence gaps after rollback are intentional and do not change inventory.

The core adds `actor_user_id` to the empty operations table and saves exact
per-line costs/sources in `de05_costing.operation_lines`. Actor UUIDs are audit
snapshots, not cascading Auth/profile links. Existing category snapshots record
exact before/after balances and prior valuation markers. Core calls do not
rewrite old quantities, values or line costs. This chunk creates new operations
only and never updates supersession pointers. The existing foundation
supersession columns are preserved for the later revision engine.
Database-owner operators remain privileged; journal protection for application
roles comes from closed grants, the private schema and RLS.

Creates reject dates before the category's latest valuation and future Karachi
dates. Same-day operations are ordered by the database sequence. The approved
tail-only revision policy remains a future requirement; no replacement-category,
before-state reversal, supersession, replay, edit or deletion implementation is
included in this core chunk.

## Why production costing stays inactive

The migration exposes no schema, table, routine or sequence access to anon,
authenticated or service_role. It adds no SECURITY DEFINER capability, activation
setting, posting route, view, app policy or change to legacy grants. Existing
sale-item/stock-movement inactive guards remain unchanged and enabled. The
migration checks their exact function bodies, expected trigger shape/table,
corrected permission assertion, closed inventory privileges/RLS and unused
sequence before creating the core. It aborts on unknown inventory triggers,
unexpected permissions, used valuation or changed sequence definition.

Current source documents, items, stock movements, payments, capital sync,
reports, UI and invoice issuance are unchanged. Core sale costs are saved only
in its private line history; `sale_items.cost_total_paisa` and movement valuation
fields remain NULL. The current simple-average report behavior still applies.

Future integration must derive the actor from verified Auth, preserve DE-19 and
platform-admin denial, validate all related customers/suppliers/accounts/items,
and atomically write the whole document, items, movements, payments and relevant
capital records together with this core. Each wrapper must call the core once
for its entire category set, use READ COMMITTED isolation and a consistent source-header/balance lock
order. Multiple separate core calls inside one transaction must not be assumed
to have globally ordered locks. No broader financial atomicity is claimed here.
Legacy direct inventory writes must be closed before activation; simply granting
EXECUTE or bypassing the inactive guards is not a cutover plan. The later wrapper
also needs to respect narrower legacy item/movement column ranges.
DE-18 invoice counters must never be reset or replaced with COUNT/MAX issuance.

## Local verification

Run the core suite with `node tests/de05-moving-average-db.mjs`. It accepts no
production connection, reads no environment file and uses the preexisting image
`ghcr.io/supabase/postgres:17.6.1.171` with `--pull=never`, `--network none`, no
exposed port and a newly initialized database. It uses the captured schema-only
fixture plus the exact corrected security migration and synthetic identities.
It does not apply the production invoice seed or load production business data.

Results on 2026-10-01:

- Corrected core: **617 PostgreSQL checks passed**, including exact rounding against an
  independent BigInt reference and 36 successive actual operations against a
  separate integer inventory model; weighted purchases; allocation; zero-value
  depletion; inherited/explicit adjustments; exact tray metadata; range/input
  failures; actor/module/tenant denial; Karachi dates and document-date agreement;
  rejection of all non-NULL revision arguments; preserved old costs; multi-category failure and
  rollback gaps; concurrent first writes/outbound removals/opposite category
  orders; permission revocation during a Read Committed lock wait; and refusal
  of unsupported isolation settings, including stale permission snapshots under
  Repeatable Read/Serializable while another transaction holds a balance lock.
- Migration preserves existing rows, grants, RLS, public functions, legacy guard
  triggers and counters. App roles cannot access core state/functions/sequence.
  Unused rollback/reapply passes; changed access, dependent objects and used
  valuation cause atomic refusal. Effective table/column privileges on all three
  foundation tables and private lines, and sequence privileges, are checked for
  anon/authenticated/service_role, including PUBLIC and inherited grants. Tests
  verify failure preserves every row, the sequence, existing grants and core
  objects. No legacy guard bypass setting is accepted.
- Existing database regressions: 89 foundation assertions, 249 historical
  gate-foundation checks and 162 corrected platform-denial checks passed. The
  historical gate suite tests that earlier migration in isolation; the core
  suite applies the deployed correction and rejects platform-admin actors.
- App regression suite: 121 passed, zero failed. TypeScript and new-runner ESLint
  passed. The initial implementation and independent review passed the Webpack
  build; these SQL/test-only corrections do not change application source.
- Repository lint still has the existing 22 errors/9 warnings in untouched app
  files. Default `npm run build` cannot load native SWC on this Mac and reports
  unsupported Turbopack WASM; the supported Webpack fallback passed.

The schema fixture is not a full production restore. No live app write checks,
production advisors, remote catalog verification or production backup rehearsal
were performed for this chunk. The final manual super-admin API check remains
pending and cannot be closed by these tests.

## Independent review and later deployment

Review the branch against `7cd669f`, including all five files in this chunk.
Before the approved commit, four files were untracked (`git diff` alone did not
show them). Review exact arithmetic and range
checks; grouped line allocation; locks before sequencing; Read Committed and
after-wait permissions; source/date/tenant checks; immutable prior costs;
revision rejection; transaction failures; rollback's effective privilege checks
and atomic refusal; and closed privileges/inactive guards. Run the core suite
and compare the migration with the deployed foundation/correction definitions.
The initial independent review reproduced the original 323 core checks and
identified three P2 concerns: stale permissions under unsupported isolation,
missing foundation-access rollback guards, and premature revision scope.
Those concerns have been corrected locally. Focused independent re-review
confirmed all three resolved and found no new actionable issue. It independently
reran 617 core checks, existing 89/249/162 database checks, 121 app tests,
TypeScript, focused lint and whitespace checks, using only synthetic databases;
it made no repository changes. The build was not rerun for the corrections.
The owner approved commit/push. Production deployment approval, rehearsal and
verification remain pending.

Before any separately authorized deployment, finish the outstanding manual
security API check, inspect the current catalog/ownership/default privileges,
obtain a fresh restorable backup, rehearse migration and guarded rollback against
an isolated restored copy, and arrange the required paused-write window. The
migration has a 5-second lock timeout and 60-second statement timeout. No automatic
reset, seed, invoice-counter change or activation is part of that deployment.
Read-only post-deployment checks must confirm empty core/inventory tables,
unchanged business rows/counters/security, NULL legacy valuation fields, unused
sequence and no app access; do not use nextval/setval to inspect a sequence.

Rollback is review-only and refuses any core/inventory row, saved legacy
valuation, consumed sequence or opened core/foundation table, column or sequence
access (including effective PUBLIC/inherited grants). It removes only this chunk,
with no CASCADE and no sequence/counter reset. Known dependency failures roll back
the entire recovery. PostgreSQL does not track every PL/pgSQL body dependency;
review future callers before using the recovery script. Once valuation has been
used, preserve history and prepare a separately reviewed forward recovery.
