# DE-05 Moving-Average Costing Engine — review and deployment record

Status on 2026-10-01: implemented and tested locally. Independent review found
three P2 concerns; focused independent re-review confirmed all three resolved
with no new actionable issue. Commit `8acadc8bf7ee25b0e1b62548eeb31d3b4f34c5cc`
is pushed on `codex/de05-moving-average-core`, with local/remote SHA matching.
The owner-approved migration is deployed and read-only verified in production.
Costing remains inactive, with no app integration or access granted. No reset,
opening-stock seed, invoice-counter change or production posting was performed.
Core regression records existed only in synthetic databases. The separately
approved production-copy rehearsal below used a fresh private backup; its
disposable container was removed.

The starting checkout was clean on `codex/de05-security-gate-foundation` at
`7cd669feb5c67637f14a514d11c03b5c4c28455f`; local `main` and `origin/main`
pointed to the same commit. The reviewed source was committed on
`codex/de05-moving-average-core`; local main now includes it and deployment
notes `e3bb7e9` through the owner-approved fast-forward described below.
The owner confirms the security correction is deployed on main at `7cd669f`.
The final manual super-admin stock API check passed through the owner-reported
response, completing the previously outstanding privacy/security checkpoint.
Its evidence and remaining testing limits are recorded below.

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

The schema fixture is not a full production restore. During initial implementation/review, no live app write checks,
production advisors, remote catalog verification or production backup rehearsal
were performed for this chunk. The subsequently authorized production-copy
rehearsal, read-only deployment verification and manual API result are recorded
below; the synthetic suite alone was not used to close the live check.

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
The owner approved commit/push, which is complete. Production deployment was
subsequently approved and completed, with backup/rehearsal and verification
recorded below.

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

## Approved production preparation — 2026-10-01

The owner approved production deployment, confirmed sales/purchases/payments,
stock/category and permission changes paused, and approved a fresh private
public-schema/business-data/roles backup under
`/Users/khubaib/.codex/backups/doctors-egg/de05-core-predeployment-20261001/`.
The backup is in subfolder `backup-0gy_f76f`, outside Git, with directory mode
0700 and file mode 0600. Managed Auth/Storage are excluded; this is not a full
platform clone. Auth UUID stubs and extension prerequisites were supplied only
inside the disposable local restore.

Read-only production verification confirmed PostgreSQL 17.6, the five expected
prior migrations, absent core, empty foundation tables, NULL legacy costing,
unchanged expected permission/inactive-guard function hashes, closed effective
table/column/sequence access for all three app roles, and sequence
last_value=1/is_called=false. The existing security-advisor warnings remain;
no security setting or grant was changed during preparation.

The fresh network-isolated PostgreSQL 17.6 restore matched all 25 paused
production table fingerprints. The exact migration, opened-access atomic
refusal probes, unused rollback and reapplication passed 43 checks. Local
posting against the restored schema confirmed rounding from 30 eggs/1 paisa
to 10 eggs/zero paisa and full depletion; unsupported isolation and revisions
were refused. These postings were rolled back; only the disposable sequence
advanced, and used-state recovery correctly refused. No sequence was reset.
The container was removed and private checksums/diagnostics retained.

The CLI dry run (`--skip-vault`, without seeds or roles) lists only
`20261001093952_de05_moving_average_core.sql`. Its reviewed/rehearsed SHA-256 is
`7ca92bb1600ab09d222edd597e3f97fe1ad44b4325c88d4dc23098585bf2a82e`.

The super-admin login was confirmed in the app's `/admin` panel. Both automated
browser surfaces blocked direct stock API navigation with a client-side block;
this is not evidence of an application denial. The owner has been asked to
open the selected-tenant stock API in normal Chrome and return its response.
At the preparation checkpoint that result was pending and no migration had
been applied. The subsequent manual result and completed deployment follow.


## Approved production deployment — 2026-10-01

The owner reported the selected-tenant stock API response while signed in as
super-admin in normal Chrome:

```json
{"error":"Tenant business access is forbidden"}
```

This completes the previously outstanding manual privacy/security read check,
together with the earlier deployed owner/staff workflow and platform-page
checks. The response was supplied by the owner; the browser tool could not read
that API URL. No live HTTP write-denial probe was performed as super-admin.
Local route/database tests cover those denials; no positive platform business
write was attempted.

Immediately before applying, all 25 production table fingerprints and legacy
security/catalog metadata still matched the paused baseline. The CLI then
applied only `20261001093952_de05_moving_average_core.sql`, with `--skip-vault`
and no seeds or role import. Remote migration history confirms the exact
version/name. Source remains reviewed commit `8acadc8bf7ee25b0e1b62548eeb31d3b4f34c5cc`
on the feature branch. At deployment time main integration had not been
performed; the subsequently approved Git cleanup is recorded below.
No application source or Vercel production deployment was changed.

Read-only post-deployment verification confirmed:

- All 25 pre-existing public table counts/fingerprints, including invoice
  counters, are identical to the paused backup.
- Legacy policies, public functions/owners/grants, views and guard triggers are
  unchanged. Production private core functions, line columns/constraints,
  actor column, RLS and effective access match the restored rehearsal.
- All three foundation tables and private operation lines are empty; legacy
  costing fields remain NULL. Sequence last_value=1/is_called=false. Inspection
  did not call nextval or setval.
- anon/authenticated/service_role have no foundation table/column/sequence
  privileges and no private core schema/table/function access. No activation
  flag or permission grant was added.
- Security advisors have no new warnings/errors. Their new informational
  [RLS-without-policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
  concerns deliberately closed, owner-only `de05_costing.operation_lines`;
  adding app access/policies would contradict this inactive phase. Existing
  role-helper/invoice-allocator and leaked-password-protection warnings remain.

Private backup/rehearsal/apply logs, checksums and before/after evidence are
retained under `backup-0gy_f76f` with private permissions. No production costing
function was invoked, inventory seeded or counter reset. Current sale/purchase
creation and reporting behavior remain unchanged. Normal writes may resume.
Future trusted posting wrappers, payment/FIFO integrations, shared revisions,
reader cutover and activation remain separately scoped work.


## Approved Git release integration — 2026-10-01

The owner approved committing/pushing the deployment notes and merging the
reviewed core branch into main. The three documentation files were committed
as `e3bb7e976b155b82d460f2ee03da8e5b19200e98` and pushed to the existing feature
branch. Local main was then fast-forwarded from `7cd669f` to that commit,
retaining reviewed source `8acadc8` without rewriting commits. This checkpoint
update accompanies the approved publication of main; verify current local and
remote refs before starting later work.

The migration and database tests remain identical to the reviewed/deployed
source; no SQL was rerun and no app source changed during Git cleanup. Existing
617 core checks, 89/249/162 database regressions, 121 app tests and the 43-check
production-copy rehearsal remain the relevant validation. Documentation-only
updates require scope and whitespace checks, not new database posting probes.

The next approved chunk is customer payment/FIFO integration. The existing
TypeScript implementation already uses sale date, creation time and ID for
oldest-first allocation. It saves a receipt separately from invoice-status
updates, leaving a known partial-update risk. The next chunk prepares that
work for the future atomic database posting path; the approved payment order,
current app behavior and inactive costing boundary remain unchanged. No new
customer-payment implementation was included in this release.
