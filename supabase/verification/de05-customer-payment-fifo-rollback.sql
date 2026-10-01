-- Review-only recovery. Never automatically run against production.
-- Refuse removal of a used retry journal; preserve every public record/status.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE de05_customer_payments.receipt_requests IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE r text; c text; f record;
BEGIN
  IF EXISTS (SELECT FROM de05_customer_payments.receipt_requests) THEN
    RAISE EXCEPTION 'Customer FIFO rollback refuses receipt request history';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_class WHERE oid='de05_customer_payments.receipt_requests'::regclass
      AND relowner='postgres'::regrole AND relrowsecurity)
     OR EXISTS (SELECT FROM pg_policies WHERE schemaname='de05_customer_payments')
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace='de05_customer_payments'::regnamespace)<>4
     OR EXISTS (SELECT FROM pg_proc WHERE pronamespace='de05_customer_payments'::regnamespace
      AND (prosecdef OR proowner<>'postgres'::regrole)) THEN
    RAISE EXCEPTION 'Customer FIFO rollback refuses changed security configuration';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_schema_privilege(r,'de05_customer_payments','USAGE,CREATE')
       OR has_table_privilege(r,'de05_customer_payments.receipt_requests',
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
      RAISE EXCEPTION 'Customer FIFO rollback refuses changed access';
    END IF;
    FOR c IN SELECT attname FROM pg_attribute WHERE attrelid='de05_customer_payments.receipt_requests'::regclass
      AND attnum>0 AND NOT attisdropped LOOP
      IF has_column_privilege(r,'de05_customer_payments.receipt_requests',c,'SELECT,INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'Customer FIFO rollback refuses changed column access';
      END IF;
    END LOOP;
    FOR f IN SELECT oid FROM pg_proc WHERE pronamespace='de05_customer_payments'::regnamespace LOOP
      IF has_function_privilege(r,f.oid,'EXECUTE') THEN
        RAISE EXCEPTION 'Customer FIFO rollback refuses changed routine access';
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
-- No CASCADE: unexpected future dependencies refuse removal atomically.
DROP FUNCTION de05_customer_payments.post_receipt(uuid,uuid,uuid,uuid,bigint,date,text,uuid,text,text);
DROP FUNCTION de05_customer_payments.recalculate(uuid,uuid,uuid,text);
DROP FUNCTION de05_customer_payments.line_total(integer,bigint,text,numeric);
DROP FUNCTION de05_customer_payments.assert_permission(uuid,uuid,text);
DROP TABLE de05_customer_payments.receipt_requests;
DROP SCHEMA de05_customer_payments;
COMMIT;
