# DE-SECURITY-01 deployment and verification

This migration has **not** been run against production. Review the SQL and
test it on a disposable copy of the live schema before scheduling rollout.
Apply `supabase/migrations/20260930000000_de_security_01_write_hardening.sql`
before `20260930000001_de18_invoice_counters.sql`. Keep every protected business
write paused through both migrations and the compatible application rollout.
The migration is one PostgreSQL transaction and aborts on unexpected
membership or invitation roles, missing read helpers, unexpected role checks,
or retained effective ordinary write grants. It also bounds service-role
payment privileges and installs service-role-only atomic staff-invitation
consumption and reconciliation RPCs.

## Protected deployment pause and drain

1. Prepare the compatible server-route build and rehearse it in staging.
2. Pause all protected business writes: sale create/edit, purchase create/edit, member management writes, and invitation issuance/acceptance. Block direct Data API writers too.
3. Pause standalone customer and supplier payments and every FIFO/status refresh request. No old payment route or sale-origin payment insert may run after payment-table write revocation.
4. Pause tenant creation and provisioning.
5. Drain all in-flight requests across these workflows.
6. Quiesce or remove old application instances that still use authenticated direct writes, including old payment routes and sale-origin payment inserts.
7. Deploy the compatible server-route build while writes remain paused.
8. Apply DE-SECURITY-01.
9. Verify effective privileges, read-only policies, role constraints, identity triggers, both invitation RPCs, and trusted routes with the checks below.
10. Re-run the tenant roster and invoice high-water preflight in the DE-18 runbook. No new tenant may appear between this approved preflight and the DE-18 seed.
11. Apply DE-18.
12. Verify counters and allocator authorization using the DE-18 runbook.
13. Exercise controlled sale, purchase, member, invitation, customer payment, and supplier payment smoke tests, including FIFO-derived statuses.
14. Resume writes only after all checks pass and no old instance can accept a write.

## Read-only preflight

Confirm the current policies and role checks still match the reviewed live
contract. A changed policy or constraint needs another review before applying
the migration. Inspect the write routes and ensure the version to deploy uses
the server-only admin client for protected writes.

```sql
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('tenant_members', 'invitations', 'sales', 'purchases',
                    'customer_payments', 'supplier_payments')
ORDER BY tablename, policyname;

SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN ('public.tenant_members'::regclass, 'public.invitations'::regclass)
  AND contype = 'c'
ORDER BY table_name, conname;

SELECT 'tenant_members' AS table_name, role, count(*) FROM public.tenant_members GROUP BY role
UNION ALL
SELECT 'invitations', role, count(*) FROM public.invitations GROUP BY role;

SELECT id, role, expires_at, accepted_at
FROM public.invitations
WHERE accepted_at IS NULL
ORDER BY id;
```

The reviewed snapshot had only owner/staff members and staff invitations, with
one active pending staff invitation. The migration invalidates every pending
token. Tell affected owners to issue fresh staff invitations after rollout.
Accepted invitation history remains intact.

### Confirmed payment direct-write exposure

Production preflight confirmed that `anon` and `authenticated` have INSERT,
UPDATE, DELETE, and TRUNCATE on both payment tables. Each has an authenticated
`ALL` policy allowing the user's tenant or a super-admin, and neither has a
user trigger. Direct Data API writes can therefore bypass the payment route
permissions. This migration revokes ordinary writes and replaces `ALL` with
SELECT-only policies using the same read condition. Confirm the reviewed
state before applying:

```sql
SELECT actor, tbl, privilege,
       has_table_privilege(actor, 'public.' || tbl, privilege) AS allowed
FROM (VALUES ('anon'), ('authenticated')) AS actors(actor)
CROSS JOIN (VALUES ('customer_payments'), ('supplier_payments')) AS tables(tbl)
CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('TRIGGER'), ('REFERENCES')) AS privileges(privilege)
ORDER BY actor, tbl, privilege;

SELECT tbl, privilege,
       has_table_privilege('service_role', 'public.' || tbl, privilege) AS allowed
FROM (VALUES ('customer_payments'), ('supplier_payments')) AS tables(tbl)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                   ('TRUNCATE'), ('TRIGGER'), ('REFERENCES')) AS privileges(privilege)
ORDER BY tbl, privilege;

SELECT actor, c.relname AS table_name, a.attname AS column_name,
       has_column_privilege(actor, c.oid, a.attnum, 'INSERT') AS can_insert,
       has_column_privilege(actor, c.oid, a.attnum, 'UPDATE') AS can_update
FROM (VALUES ('anon'), ('authenticated')) AS actors(actor)
CROSS JOIN pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_attribute AS a ON a.attrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relname IN ('customer_payments', 'supplier_payments')
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY actor, table_name, a.attnum;

SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('customer_payments', 'supplier_payments')
ORDER BY tablename, policyname;

SELECT c.relname AS table_name, c.relowner::regrole AS table_owner,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('customer_payments', 'supplier_payments');

SELECT tgrelid::regclass AS table_name, tgname, tgenabled,
       tgtype, tgfoid::regprocedure AS trigger_function
FROM pg_trigger
WHERE tgrelid IN ('public.customer_payments'::regclass,
                  'public.supplier_payments'::regclass)
  AND NOT tgisinternal;
```

The trigger query should show no user triggers in the reviewed preflight. The
migration requires one authenticated `ALL` policy on each payment table and
service-role INSERT access on both. The reviewed service role had all seven
listed table privileges. Stop and review if deployed policies,
owners, column grants, or trigger state
differs from the confirmed snapshot.

## Read-only verification after hardening

All effective INSERT, UPDATE, DELETE, TRUNCATE, and TRIGGER values below must
be false for ordinary roles. Record their REFERENCES separately; ordinary
REFERENCES is unchanged. `authenticated`
SELECT should remain true for each business table, including both payment
tables. A table grant does not by itself grant access to a row; check the RLS
policies separately. Confirm no
column-level INSERT or UPDATE grants survived, especially on `super_admins`
and the attestation table.

```sql
SELECT actor, tbl, privilege,
       has_table_privilege(actor, 'public.' || tbl, privilege) AS allowed
FROM (VALUES ('anon'), ('authenticated')) AS actors(actor)
CROSS JOIN (VALUES
  ('tenant_members'), ('invitations'), ('sales'), ('purchases'),
  ('customer_payments'), ('supplier_payments'), ('super_admins'),
  ('de_security_01_attestation')
) AS tables(tbl)
CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('TRIGGER'), ('REFERENCES')) AS privileges(privilege)
ORDER BY actor, tbl, privilege;

SELECT tbl, privilege,
       has_table_privilege('service_role', 'public.' || tbl, privilege) AS allowed
FROM (VALUES ('customer_payments'), ('supplier_payments')) AS tables(tbl)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                   ('TRUNCATE'), ('TRIGGER'), ('REFERENCES')) AS privileges(privilege)
ORDER BY tbl, privilege;

SELECT c.relname AS table_name, a.attname AS column_name,
       has_column_privilege('service_role', c.oid, a.attnum, 'SELECT') AS can_select,
       has_column_privilege('service_role', c.oid, a.attnum, 'INSERT') AS can_insert,
       has_column_privilege('service_role', c.oid, a.attnum, 'UPDATE') AS can_update,
       has_column_privilege('service_role', c.oid, a.attnum, 'REFERENCES') AS can_reference
FROM pg_class AS c
JOIN pg_attribute AS a ON a.attrelid = c.oid
WHERE c.oid IN ('public.customer_payments'::regclass, 'public.supplier_payments'::regclass)
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY c.relname, a.attnum;

SELECT a.attrelid::regclass AS table_name, a.attname AS column_name,
       acl.privilege_type, acl.is_grantable
FROM pg_attribute AS a
CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
WHERE a.attrelid IN ('public.customer_payments'::regclass, 'public.supplier_payments'::regclass)
  AND a.attnum > 0 AND NOT a.attisdropped
  AND acl.grantee = 'service_role'::regrole::oid
  AND acl.privilege_type IN ('INSERT', 'UPDATE', 'REFERENCES');

SELECT actor, c.relname AS table_name, a.attname AS column_name,
       has_column_privilege(actor, c.oid, a.attnum, 'INSERT') AS can_insert,
       has_column_privilege(actor, c.oid, a.attnum, 'UPDATE') AS can_update
FROM (VALUES ('anon'), ('authenticated')) AS actors(actor)
CROSS JOIN pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_attribute AS a ON a.attrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relname IN ('tenant_members', 'invitations', 'sales', 'purchases',
                    'customer_payments', 'supplier_payments', 'super_admins',
                    'de_security_01_attestation')
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY actor, table_name, a.attnum;

SELECT c.relname AS table_name, c.relowner::regrole AS table_owner,
       pg_has_role('anon', c.relowner, 'MEMBER') AS anon_can_assume_owner,
       pg_has_role('authenticated', c.relowner, 'MEMBER') AS authenticated_can_assume_owner
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('tenant_members', 'invitations', 'sales', 'purchases',
                    'customer_payments', 'supplier_payments', 'super_admins',
                    'de_security_01_attestation')
ORDER BY c.relname;

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('customer_payments', 'supplier_payments')
ORDER BY c.relname;

SELECT privilege,
       has_table_privilege('service_role', 'public.de_security_01_attestation', privilege) AS allowed
FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
             ('TRIGGER'), ('REFERENCES'))
  AS privileges(privilege);

SELECT a.attname AS column_name,
       has_column_privilege('service_role', a.attrelid, a.attnum, 'INSERT') AS can_insert,
       has_column_privilege('service_role', a.attrelid, a.attnum, 'UPDATE') AS can_update
FROM pg_attribute AS a
WHERE a.attrelid = 'public.de_security_01_attestation'::regclass
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;

SELECT actor, rpc, has_function_privilege(actor, rpc, 'EXECUTE') AS can_execute
FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS actors(actor)
CROSS JOIN (VALUES
  ('public.consume_staff_invitation_de_security_01(text,text,uuid,uuid,text)'),
  ('public.read_staff_invitation_acceptance_de_security_01(text,text,uuid,uuid)')
) AS functions(rpc);

SELECT tbl,
       has_table_privilege('authenticated', 'public.' || tbl, 'SELECT') AS can_select
FROM (VALUES ('tenant_members'), ('invitations'), ('sales'), ('purchases'),
             ('customer_payments'), ('supplier_payments'), ('super_admins'))
  AS tables(tbl);

SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('tenant_members', 'invitations', 'sales', 'purchases',
                    'customer_payments', 'supplier_payments')
ORDER BY tablename, policyname;

SELECT conrelid::regclass AS table_name, conname, convalidated,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE (conrelid = 'public.tenant_members'::regclass
       AND conname = 'tenant_members_role_owner_staff_check')
   OR (conrelid = 'public.invitations'::regclass
       AND conname = 'invitations_role_staff_only_check');

SELECT tgrelid::regclass AS table_name, tgname, tgenabled,
       tgtype, tgattr, tgqual, tgfoid::regprocedure AS trigger_function
FROM pg_trigger
WHERE tgname IN (
  'sales_invoice_identity_immutable_de_security_01',
  'purchases_invoice_identity_immutable_de_security_01'
);

SELECT tgrelid::regclass AS table_name, tgname, tgenabled,
       tgtype, tgfoid::regprocedure AS trigger_function
FROM pg_trigger
WHERE tgrelid IN ('public.customer_payments'::regclass,
                  'public.supplier_payments'::regclass)
  AND NOT tgisinternal;

SELECT att.version,
       pg_get_constraintdef(member_check.oid) = att.member_role_check AS member_check_unchanged,
       pg_get_constraintdef(invitation_check.oid) = att.invitation_role_check AS invitation_check_unchanged,
       guard.prosrc = att.guard_function_source AS guard_unchanged,
       invite_rpc.prosrc = att.invite_consume_source AS invite_rpc_unchanged,
       invite_read.prosrc = att.invite_read_source AS invite_read_unchanged,
       customer_policy.qual = att.customer_payment_read_qual AS customer_read_unchanged,
       supplier_policy.qual = att.supplier_payment_read_qual AS supplier_read_unchanged
FROM public.de_security_01_attestation AS att
JOIN pg_constraint AS member_check
  ON member_check.conrelid = 'public.tenant_members'::regclass
  AND member_check.conname = 'tenant_members_role_owner_staff_check'
JOIN pg_constraint AS invitation_check
  ON invitation_check.conrelid = 'public.invitations'::regclass
  AND invitation_check.conname = 'invitations_role_staff_only_check'
JOIN pg_proc AS guard
  ON guard.oid = 'public.prevent_invoice_identity_update_de_security_01()'::regprocedure
JOIN pg_proc AS invite_rpc
  ON invite_rpc.oid = 'public.consume_staff_invitation_de_security_01(text,text,uuid,uuid,text)'::regprocedure
JOIN pg_proc AS invite_read
  ON invite_read.oid = 'public.read_staff_invitation_acceptance_de_security_01(text,text,uuid,uuid)'::regprocedure
JOIN pg_policies AS customer_policy
  ON customer_policy.schemaname = 'public' AND customer_policy.tablename = 'customer_payments'
  AND customer_policy.policyname = 'customer_payments_tenant_select_de_security_01'
JOIN pg_policies AS supplier_policy
  ON supplier_policy.schemaname = 'public' AND supplier_policy.tablename = 'supplier_payments'
  AND supplier_policy.policyname = 'supplier_payments_tenant_select_de_security_01';

SELECT id, role, expires_at, accepted_at
FROM public.invitations
WHERE accepted_at IS NULL AND expires_at > now();
```

Expect only SELECT policies on the six protected read tables, two validated role
constraints, and two enabled invoice identity triggers with `tgtype = 19`,
empty `tgattr`, and null `tgqual`. The attestation query must return one `v1`
row with all seven checks true. Both payment tables must have RLS enabled, one
authenticated SELECT policy each, and no user triggers. The attestation must
grant `service_role` SELECT only: its six other privilege booleans and every
column write boolean must be false. Both invitation RPCs must be executable
only by `service_role` among the three app roles. The pending-invitation query
must return no rows. Compare accepted invitation rows with the preflight snapshot;
their `expires_at` and `accepted_at` must be unchanged.

The migration revokes `TRIGGER` from PUBLIC, anon, and authenticated because
that grant allows creating or replacing a trigger on a table (given function
EXECUTE); dropping a trigger additionally requires table ownership. Check
effective `TRIGGER` after rollout, including inherited grants. `REFERENCES`
is recorded and preserved for ordinary roles.
Ordinary roles must not own the protected tables;
ownership is outside grant revocation. Both `can_assume_owner` columns must be
false for the hardened tables.

### Minimal service-role payment contract

On **both** payment tables, effective SELECT and INSERT must be true; effective
UPDATE, DELETE, TRUNCATE, TRIGGER, and REFERENCES must be false. The repository
payment workflows only read and create rows, and the migration audit found no
payment foreign-key DDL requiring REFERENCES as `service_role`. The migration
removes all explicit service-role table grants, removes explicit column INSERT,
UPDATE, and REFERENCES grants, then grants only table SELECT and INSERT.
PostgreSQL has no column-level DELETE privilege. Effective column SELECT and
INSERT remain true through the table grants; column UPDATE and REFERENCES must
be false. The raw column ACL query above must return **no rows**.

Both migrations check effective table and column privileges after revocation,
including inherited or PUBLIC grants. If any forbidden capability remains,
DE-SECURITY-01 aborts and rolls back, and DE-18 rejects the prerequisite. Keep
writes paused, record the role/table/column/privilege from the error, and stop
for a separate inheritance/grant review. Do not change Supabase role inheritance
globally or describe the payment privilege boundary as active. A successful
REVOKE statement alone does not establish this contract.

## Disposable staging denial and route checks

Use a fresh disposable copy of the relevant schema and data. As `authenticated`
with a test user's JWT claims, attempt direct membership INSERT, self-role or
permission UPDATE, sale INSERT with a supplied invoice number, and purchase
INSERT with a supplied invoice number. All must be denied by table privileges.
Try direct DELETE and TRUNCATE as well. Confirm ordinary membership creation
and invoice issuance cannot bypass the HTTP routes.

With an ordinary authenticated JWT in disposable staging, attempt direct
customer and supplier payment INSERT, UPDATE, and DELETE through the Data API.
Every attempt must be denied by effective privileges, regardless of an
otherwise matching tenant ID. Confirm ordinary TRUNCATE is denied. Then use
authorized Customers and Suppliers payment POST routes and verify one payment
is saved for the authorized tenant, FIFO status refresh runs, and a failed FIFO
refresh still returns a saved payment with `allocation_warning`. A caller with
Customers but no Sales may make a standalone customer payment; Suppliers but
no Purchases may make a standalone supplier payment. The converse must be
denied. Sale-origin automatic customer payment must continue under Sales.
As `service_role`, also attempt payment UPDATE, DELETE, TRUNCATE, and trigger
creation in separate rollback-only staging transactions; all must be denied by
privileges. Recheck effective REFERENCES and column UPDATE/REFERENCES as false.

As `service_role` in staging, attempt an UPDATE changing `invoice_number` and
an UPDATE changing `tenant_id` on each of `sales` and `purchases`. Each must
raise SQLSTATE `23514`; no-op updates that leave those fields unchanged should
succeed. Roll back these test transactions. Try an unexpected role insert into
`tenant_members` and `invitations`; both must fail the new constraints.

Exercise the authorized routes with owner, staff, and selected super-admin
sessions:

1. Owner edits a staff member and promotes an existing staff member through the owner-only PATCH route. Cross-tenant targets and self-deletion stay denied. Permission edits on an owner target and a concurrent staff-to-owner change stay denied.
2. Owner issues a staff invitation; owner and super-admin invitation roles are rejected. A fresh staff invite can be accepted and creates only staff membership. A stored non-staff role is rejected before account creation. A second POST with the same token creates no new Auth user or membership and leaves `accepted_at` unchanged.
3. Create and edit a sale and purchase. The server writes headers after authorization, keeps the authorized tenant ID, preserves allocated invoice numbers, and scopes privileged updates and cleanup deletes by `id` and `tenant_id`.
4. Record customer and supplier payments, then verify FIFO-derived header status and amount, totals, balances, stock, and the existing allocation warning behavior. Check paid, partial, and unpaid flows.

On a separate old-schema staging copy, DE-18 must abort with a
`DE-18 prerequisite DE-SECURITY-01 missing` error before creating counters.
After hardening and verification, DE-18 may proceed. Use the DE-18 runbook for
counter seeding, concurrency, and authorization tests. Do not run DE-18 as a
trial against production.

For the DE-18 prerequisite contract, use a fresh disposable hardened staging
copy for each mutation below. Confirm every altered copy aborts before
`invoice_counters` exists, then discard it:

1. Replace the member role check with one also allowing `super_admin` or another role. Replace the invitation check with one also allowing `owner`.
2. Disable either invoice identity trigger; replace either with an AFTER, statement-level, column-scoped, conditional, or wrong-function trigger.
3. Replace the guard function body with a no-op that returns `NEW` while keeping the same function name. The protected attestation must detect the changed `prosrc`.
4. Restore ordinary INSERT/UPDATE/DELETE or a write-capable RLS policy on either payment table. Alter either payment SELECT policy to broaden its read condition. The DE-18 gate must reject each change.
5. Restore ordinary or service-role mutation rights on the attestation, or grant either invitation RPC to `authenticated`. Replace the reconciliation RPC source or its SECURITY DEFINER/volatile/search-path contract. The DE-18 gate must reject each change.
6. Restore service-role UPDATE, DELETE, TRUNCATE, TRIGGER, or REFERENCES on either payment table, one privilege per disposable copy. Repeat with column UPDATE/REFERENCES and with an inherited excess grant on an isolated test role. The gate must reject each excess effective capability; do not alter shared Supabase role inheritance. An explicit column INSERT grant must also be rejected, although effective column INSERT from the approved table grant is expected.

For invitation atomicity, expire, accept, delete, or change an invite to a
non-staff role between its route read and RPC call on separate disposable
copies. Force a membership uniqueness conflict. In every case, the RPC must
leave no new membership or profile and must not commit a new `accepted_at`.
The RPC locks the invitation before sampling the database clock; include a
lock-wait scenario where it expires while another transaction holds that row.
After a consume error or false result, the route must reconcile to recognize a
committed acceptance. If success cannot be confirmed, it must preserve its newly
created Auth user and return a controlled reconciliation 503. Follow the cases below.

On an unchanged hardened staging copy, DE-18 should pass this gate and continue
to its normal tenant/high-water checks. These scenarios have not been run here;
the repository tests inspect the migration contract without executing SQL.

## Invitation response-loss reconciliation

The server-only read RPC takes the same invitation row lock as consumption,
waiting for a consume that already holds that lock before reading invitation,
membership, profile, and Auth-user state. It returns a token-match boolean,
not the token. This lock does **not** fence a delayed consume that acquires the
lock after the snapshot. Once consumption has been dispatched, no snapshot
authorizes automatic Auth deletion; reconciliation is only used to confirm
committed success or classify unresolved state.

Reconciliation uses this attempt's invitation ID/token, tenant ID, newly created
Auth user ID, intended email, and expected staff role, plus inviter and profile
identity. Verify these three cases on separate disposable staging fixtures:

1. **Committed:** consume commits, but a server test proxy/fault injection drops
   its PostgREST response or throws after the database commit. Reconciliation
   finds accepted invitation plus exactly one matching staff membership and
   profile and the matching Auth email/ID. POST reconstructs the normal 200
   success. There is no Auth deletion, second consume, or duplicate insert.
2. **Pending / no commit appears likely:** force a consume error, timeout,
   unknown result, rollback, or expiry while the invitation is pending and
   matching, with no membership or profile for the new user. POST must return
   reconciliation 503 and preserve Auth. Pending state cannot prove that an
   in-flight consume will never commit. Logs classify this snapshot as
   `pending_without_access_state`; they must not claim rollback or cleanup.
3. **Ambiguous:** test accepted invite without the expected membership/profile,
   pending invite with membership, missing invite, unexpected/multiple rows,
   mismatched identity/role, or failed trusted read. POST returns a controlled
   temporary 503 and preserves Auth. Server logs contain invitation ID, tenant
   ID, new user ID, and a reason; never token, password, or service-role secret.

For missing-state/identity fixtures, use isolated copies with deliberate fixture
changes; do not weaken constraints on a shared staging environment. A preexisting
Auth user's createUser rejection must return before consume/reconciliation or
cleanup. Never delete that user. A second POST after committed success must be
rejected without creating Auth/profile/membership state or changing accepted_at.

The route performs input and invitation validation before Auth creation. There
is no necessary cleanup operation between successful Auth creation and RPC
dispatch, so the invitation route has no automatic Auth deletion path. A future
pre-dispatch cleanup would require proof that the user was created by that
request and no consume could be in flight; do not add such a path for post-RPC
errors. An unresolved account may need manual/fix-forward reconciliation, even
when it currently appears orphaned.

### Dangerous ordering: consume starts after the pending snapshot

Use one fresh staff invitation on an isolated staging fixture. Use a disposable
server transport proxy/barrier; do not change the production route or install a
database fencing mechanism. This scenario is documented but has not been run here.

1. Start one HTTP acceptance request and let it create a new Auth user. Record
   only the invitation, tenant, and newly created Auth user IDs as test evidence.
2. Let the route dispatch its consume RPC, but buffer that outbound request in
   the proxy **before PostgreSQL acquires the invitation lock**. Return a
   transport error/timeout to the route while retaining the delayed request.
   Keep its token and credentials out of logs.
3. Allow the trusted reconciliation RPC to run normally. Confirm that its first
   snapshot observes the matching pending invitation and no membership/profile.
   Keep the consume request buffered until the route returns reconciliation 503.
   Verify the Auth user is still present and no Auth deletion was requested.
4. Release the already dispatched consume request after that snapshot/response.
   Let the real consume acquire the invitation lock and commit. Use the original
   user ID and invocation arguments; do not send another acceptance POST.
5. Verify accepted_at is set, exactly one matching staff membership and profile
   exist, and the same Auth user remains intact after the delayed commit. The
   earlier route response stays a temporary failure because success was not yet
   provable at that time. Inspect safe reconciliation logs and verify no cleanup
   success was claimed.
6. Verify a later POST of the accepted token is rejected without new Auth,
   membership, or profile state and without changing accepted_at. Remove all
   fault injection and discard the disposable fixture afterwards.

Repeat with inconsistent state and a failed reconciliation read; both must
preserve Auth. This ordering specifically tests a consume that starts after
the read lock has been released, which the ordinary lock-wait race alone does
not cover.

## Real concurrent invitation acceptance in disposable staging

This is a required **real PostgreSQL** test. It has not been executed here.
Use an isolated staging clone, the hardened migration, and the compatible server
build. Keep tokens and credentials out of shared logs. A mock or a sequential
second acceptance is insufficient to prove the row-lock behavior.

### Verify the live membership uniqueness constraint

Run this read-only check against the staging database before the race:

```sql
SELECT c.conname, c.convalidated, c.condeferrable,
       ix.indisunique, ix.indisvalid, pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint AS c
JOIN pg_index AS ix ON ix.indexrelid = c.conindid
WHERE c.conrelid = 'public.tenant_members'::regclass AND c.contype = 'u'
  AND (
    SELECT array_agg(a.attname::text ORDER BY a.attname)
    FROM unnest(c.conkey) AS key(attnum)
    JOIN pg_attribute AS a ON a.attrelid = c.conrelid AND a.attnum = key.attnum
  ) = ARRAY['tenant_id', 'user_id']::text[];
```

Require a validated, valid unique constraint on exactly `(tenant_id, user_id)`.
Stop if it is absent or invalid; report that schema discrepancy for review.
Do not infer uniqueness solely from successful mock inserts.

### Two overlapping RPC acceptance transactions, one invitation

Issue **one fresh unaccepted staff invitation** for a disposable email. Create
one disposable Auth user with that exact email using the trusted Auth admin API;
record its UUID. Do not call the HTTP acceptance route for this precreated user,
because that route correctly rejects existing accounts. The two SQL sessions
below exercise the service-only consume RPC directly with the **same** invitation
and user, including real lock contention and uniqueness enforcement.

In both psql sessions, set local `invitation_id`, `invitation_token`, `tenant_id`,
and `user_id` variables from that fixture. Before starting, an administrator
observer must verify: invite role staff, accepted_at NULL, unexpired on the DB
clock, no membership for tenant/user, no profile for user, exactly one matching
Auth account. Use distinct session application names so lock waiting can be
observed without selecting SQL text or tokens.

**Session A (winner candidate):**

```sql
SET application_name = 'de_security_01_invite_a';
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.consume_staff_invitation_de_security_01(
  :'invitation_id', :'invitation_token', :'tenant_id'::uuid,
  :'user_id'::uuid, 'Concurrent Staff'
) AS accepted;
-- Require true. Save the winner timestamp BEFORE the losing attempt finishes.
SELECT accepted_at FROM public.invitations WHERE id::text = :'invitation_id'
\gset winner_
-- Leave this transaction open while starting B.
```

**Session B (start while A is still open):**

```sql
SET application_name = 'de_security_01_invite_b';
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.consume_staff_invitation_de_security_01(
  :'invitation_id', :'invitation_token', :'tenant_id'::uuid,
  :'user_id'::uuid, 'Concurrent Staff'
) AS accepted;
-- This must wait for A's invitation row lock.
```

While B is blocked, the administrator observer checks:

```sql
SELECT application_name, state, wait_event_type, wait_event,
       cardinality(pg_blocking_pids(pid)) AS blocker_count
FROM pg_stat_activity
WHERE application_name = 'de_security_01_invite_b';
```

Require B to be waiting on a Lock with a blocker. Commit A, then let B's RPC
finish: A accepted true; B must return false, without an insert or timestamp
change. Commit B. This controlled overlap keeps both acceptance attempts in
flight before the winner commits.

After B finishes, run in session A (with its saved `winner_accepted_at`):

```sql
SELECT accepted_at IS NOT NULL AS accepted,
       accepted_at = :'winner_accepted_at'::timestamptz AS timestamp_unchanged
FROM public.invitations WHERE id::text = :'invitation_id';
```

Both booleans must be true. As the administrator observer, assert exactly one
staff membership for tenant/user, exactly one matching staff profile by user ID,
and the original Auth user still present with its intended email. Check the
stored inviter and profile name too. The two outcomes must be exactly one true
and one false. Retain the saved timestamp and result counts as non-secret test
evidence; discard the isolated fixture afterwards.

### Concurrent HTTP route attempts and winner-account safety

With a separate fresh staff invitation and an email that does **not** yet have
an Auth user, launch two POSTs to the same token simultaneously from a staging
test client, for example with `Promise.all([accept(), accept()])`. Use a staging
barrier after the initial invite read if needed to make both requests overlap.
Exactly one must return normal success; the loser must fail safely. Auth email
uniqueness can reject the loser before the RPC, so this HTTP race supplements
the SQL lock test above.

Read accepted_at when the winner response arrives while the loser is still
in flight (hold the loser's response with a disposable staging test barrier if
necessary); record it as T. After the loser completes, compare accepted_at to T
exactly. Require one Auth user, one profile, one membership for the winning
user/tenant, accepted_at non-null and unchanged, and no Auth deletion targeting
the winning user. Repeat the HTTP race with the winner's consume response lost
after commit: reconciliation must return success and both requests must leave
the winning account intact. Remove any fault injection before other smoke tests.

## Recovery

If DE-SECURITY-01 fails before COMMIT, PostgreSQL rolls back the transaction;
inspect the reported state and retry only after review. If application rollout
fails after hardening, keep business writes paused and fix forward or deploy a
compatible server-route version. Do not restore ordinary direct grants or old
write policies after DE-18 activation: doing so reopens membership escalation
and invoice-counter bypass. Preserve accepted invitation history and counter
history during any later schema change.
