"""Tamper-evident audit log hash chain, immutability triggers, and MFA step-up tracking.

Revision ID: 0004
Revises: 0003
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_COMPUTE_HASH_BODY = """
    SELECT COALESCE(
        pg_catalog.string_agg(
            pg_catalog.octet_length(pg_catalog.convert_to(k, 'UTF8'))::text
            || ':' || k || '='
            || pg_catalog.octet_length(pg_catalog.convert_to(COALESCE(v, ''), 'UTF8'))::text
            || ':' || COALESCE(v, ''),
            E'\\n' ORDER BY k COLLATE "C"
        ),
        ''
    )
    INTO v_meta
    FROM pg_catalog.jsonb_each_text(COALESCE(v_metadata, '{}'::jsonb)) AS kv(k, v);

    v_seq := v_seq_num::text;
    v_prev := pg_catalog.encode(v_prev_bytes, 'hex');
    v_id := v_row_id::text;
    v_created := pg_catalog.to_char(v_created_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    v_account := COALESCE(v_account_id::text, '');
    v_session := COALESCE(v_session_id::text, '');
    v_ip := COALESCE(pg_catalog.host(v_ip_addr), '');
    v_ua := COALESCE(v_user_agent, '');

    v_payload := 'v1' || E'\\n'
        || pg_catalog.octet_length(pg_catalog.convert_to(v_seq, 'UTF8'))::text || ':' || v_seq || E'\\n'
        || pg_catalog.octet_length(pg_catalog.convert_to(v_prev, 'UTF8'))::text || ':' || v_prev || E'\\n'
        || pg_catalog.octet_length(pg_catalog.convert_to(v_id, 'UTF8'))::text || ':' || v_id || E'\\n'
        || pg_catalog.octet_length(pg_catalog.convert_to(v_created, 'UTF8'))::text || ':' || v_created || E'\\n'
        || pg_catalog.octet_length(pg_catalog.convert_to(v_event_type, 'UTF8'))::text || ':' || v_event_type || E'\\n'
        || pg_catalog.octet_length(pg_catalog.convert_to(v_account, 'UTF8'))::text || ':' || v_account || E'\\n'
        || pg_catalog.octet_length(pg_catalog.convert_to(v_session, 'UTF8'))::text || ':' || v_session || E'\\n'
        || pg_catalog.octet_length(pg_catalog.convert_to(v_ip, 'UTF8'))::text || ':' || v_ip || E'\\n'
        || pg_catalog.octet_length(pg_catalog.convert_to(v_ua, 'UTF8'))::text || ':' || v_ua || E'\\n'
        || pg_catalog.octet_length(pg_catalog.convert_to(v_meta, 'UTF8'))::text || ':' || v_meta;

    v_hash := pg_catalog.sha256(pg_catalog.convert_to(v_payload, 'UTF8'));
"""


def upgrade() -> None:
    op.add_column(
        "user_sessions",
        sa.Column("mfa_reauthenticated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.add_column("audit_events", sa.Column("seq", sa.BigInteger(), nullable=True))
    op.add_column("audit_events", sa.Column("prev_hash", sa.LargeBinary(), nullable=True))
    op.add_column("audit_events", sa.Column("event_hash", sa.LargeBinary(), nullable=True))

    op.execute(
        f"""
        DO $$
        DECLARE
            rec RECORD;
            v_seq_num BIGINT := 0;
            v_prev_bytes BYTEA := pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex');
            v_hash BYTEA;
            v_meta TEXT;
            v_payload TEXT;
            v_seq TEXT;
            v_prev TEXT;
            v_id TEXT;
            v_created TEXT;
            v_account TEXT;
            v_session TEXT;
            v_ip TEXT;
            v_ua TEXT;
            v_row_id UUID;
            v_created_ts TIMESTAMPTZ;
            v_event_type TEXT;
            v_account_id UUID;
            v_session_id UUID;
            v_ip_addr INET;
            v_user_agent TEXT;
            v_metadata JSONB;
        BEGIN
            FOR rec IN
                SELECT id, created_at, event_type, account_id, session_id, ip_address, user_agent, metadata
                FROM audit_events
                ORDER BY created_at ASC, id ASC
            LOOP
                v_seq_num := v_seq_num + 1;
                v_row_id := rec.id;
                v_created_ts := rec.created_at;
                v_event_type := rec.event_type;
                v_account_id := rec.account_id;
                v_session_id := rec.session_id;
                v_ip_addr := rec.ip_address;
                v_user_agent := rec.user_agent;
                v_metadata := COALESCE(rec.metadata, '{{}}'::jsonb);
                {_COMPUTE_HASH_BODY}
                UPDATE audit_events
                SET seq = v_seq_num,
                    prev_hash = v_prev_bytes,
                    event_hash = v_hash
                WHERE id = rec.id;
                v_prev_bytes := v_hash;
            END LOOP;
        END $$;
        """
    )

    op.alter_column("audit_events", "seq", nullable=False)
    op.alter_column("audit_events", "prev_hash", nullable=False)
    op.alter_column("audit_events", "event_hash", nullable=False)

    op.create_unique_constraint(op.f("uq_audit_events_seq"), "audit_events", ["seq"])
    op.create_check_constraint("seq_positive", "audit_events", "seq >= 1")
    op.create_check_constraint("prev_hash_length", "audit_events", "octet_length(prev_hash) = 32")
    op.create_check_constraint("event_hash_length", "audit_events", "octet_length(event_hash) = 32")

    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION audit_events_chain_insert()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = pg_catalog
        AS $$
        DECLARE
            v_lock_schema INTEGER;
            v_last_seq BIGINT;
            v_last_hash BYTEA;
            v_seq_num BIGINT;
            v_prev_bytes BYTEA;
            v_hash BYTEA;
            v_meta TEXT;
            v_payload TEXT;
            v_seq TEXT;
            v_prev TEXT;
            v_id TEXT;
            v_created TEXT;
            v_account TEXT;
            v_session TEXT;
            v_ip TEXT;
            v_ua TEXT;
            v_row_id UUID;
            v_created_ts TIMESTAMPTZ;
            v_event_type TEXT;
            v_account_id UUID;
            v_session_id UUID;
            v_ip_addr INET;
            v_user_agent TEXT;
            v_metadata JSONB;
        BEGIN
            v_lock_schema := ('x' || pg_catalog.substr(pg_catalog.md5(TG_TABLE_SCHEMA), 1, 8))::bit(32)::int;
            PERFORM pg_catalog.pg_advisory_xact_lock(720241103, v_lock_schema);

            EXECUTE pg_catalog.format(
                'SELECT seq, event_hash FROM %I.%I ORDER BY seq DESC LIMIT 1',
                TG_TABLE_SCHEMA,
                TG_TABLE_NAME
            ) INTO v_last_seq, v_last_hash;

            IF v_last_seq IS NULL THEN
                v_seq_num := 1;
                v_prev_bytes := pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex');
            ELSE
                v_seq_num := v_last_seq + 1;
                v_prev_bytes := v_last_hash;
            END IF;

            NEW.created_at := COALESCE(NEW.created_at, pg_catalog.now());
            NEW.metadata := COALESCE(NEW.metadata, '{{}}'::jsonb);

            v_row_id := NEW.id;
            v_created_ts := NEW.created_at;
            v_event_type := NEW.event_type;
            v_account_id := NEW.account_id;
            v_session_id := NEW.session_id;
            v_ip_addr := NEW.ip_address;
            v_user_agent := NEW.user_agent;
            v_metadata := NEW.metadata;
            {_COMPUTE_HASH_BODY}

            NEW.seq := v_seq_num;
            NEW.prev_hash := v_prev_bytes;
            NEW.event_hash := v_hash;
            RETURN NEW;
        END;
        $$;
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION audit_events_prevent_mutation()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SET search_path = pg_catalog
        AS $$
        BEGIN
            RAISE EXCEPTION 'audit_events is append-only; UPDATE and DELETE are forbidden'
                USING ERRCODE = '55000';
        END;
        $$;
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION audit_events_prevent_truncate()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SET search_path = pg_catalog
        AS $$
        BEGIN
            RAISE EXCEPTION 'audit_events is append-only; TRUNCATE is forbidden'
                USING ERRCODE = '55000';
        END;
        $$;
        """
    )

    op.execute(
        """
        CREATE TRIGGER trg_audit_events_chain_insert
        BEFORE INSERT ON audit_events
        FOR EACH ROW
        EXECUTE FUNCTION audit_events_chain_insert();
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_audit_events_prevent_mutation
        BEFORE UPDATE OR DELETE ON audit_events
        FOR EACH ROW
        EXECUTE FUNCTION audit_events_prevent_mutation();
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_audit_events_prevent_truncate
        BEFORE TRUNCATE ON audit_events
        FOR EACH STATEMENT
        EXECUTE FUNCTION audit_events_prevent_truncate();
        """
    )

    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gm_app') THEN
                REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_events FROM gm_app;
                GRANT SELECT, INSERT ON TABLE audit_events TO gm_app;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gm_audit_writer') THEN
                REVOKE ALL ON TABLE audit_events FROM gm_audit_writer;
                GRANT INSERT ON TABLE audit_events TO gm_audit_writer;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gm_app') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE audit_events TO gm_app;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gm_audit_writer') THEN
                REVOKE ALL ON TABLE audit_events FROM gm_audit_writer;
            END IF;
        END $$;
        """
    )
    op.execute("DROP TRIGGER IF EXISTS trg_audit_events_prevent_truncate ON audit_events")
    op.execute("DROP TRIGGER IF EXISTS trg_audit_events_prevent_mutation ON audit_events")
    op.execute("DROP TRIGGER IF EXISTS trg_audit_events_chain_insert ON audit_events")
    op.execute("DROP FUNCTION IF EXISTS audit_events_prevent_truncate()")
    op.execute("DROP FUNCTION IF EXISTS audit_events_prevent_mutation()")
    op.execute("DROP FUNCTION IF EXISTS audit_events_chain_insert()")

    op.drop_constraint("event_hash_length", "audit_events", type_="check")
    op.drop_constraint("prev_hash_length", "audit_events", type_="check")
    op.drop_constraint("seq_positive", "audit_events", type_="check")
    op.drop_constraint(op.f("uq_audit_events_seq"), "audit_events", type_="unique")

    op.drop_column("audit_events", "event_hash")
    op.drop_column("audit_events", "prev_hash")
    op.drop_column("audit_events", "seq")
    op.drop_column("user_sessions", "mfa_reauthenticated_at")
