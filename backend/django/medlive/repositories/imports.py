"""CSV import batches, their rows, undo and the mapping profiles (port of `repositories/import.repo.ts`;
FR-IMP-01..22)."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from ..core import db
from ..domain.time import from_datetime

IMPORT_TABLES = frozenset(
    {"departments", "doctor_hospitals", "session_templates", "wards", "beds", "staff_users", "patients", "bookings"}
)


def _j(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _table(table: str) -> str:
    # Kysely's sql.table: an identifier, never text a caller wrote.
    if table not in IMPORT_TABLES:
        raise ValueError(f"not an import table: {table}")
    return f'"{table}"'


def _ref(column: str) -> str:
    return '"' + column.replace('"', '""') + '"'


def _iso(value: datetime | None) -> str | None:
    return None if value is None else from_datetime(value)


def _to_batch(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r["id"],
        "hospitalId": r["hospital_id"],
        "setKind": r["set_kind"],
        "fileName": r["file_name"],
        "fileSha256": r["file_sha256"],
        "state": r["state"],
        "counts": {"add": 0, "update": 0, "skip": 0, "error": 0, **(r["counts"] or {})},
        "createdBy": r["created_by"],
        "createdByName": r["created_by_name"],
        "createdAt": from_datetime(r["created_at"]),
        "committedByName": r["committed_by_name"],
        "committedAt": _iso(r["committed_at"]),
        "undoneByName": r["undone_by_name"],
        "undoneAt": _iso(r["undone_at"]),
    }


_BATCH_SELECT = """
  SELECT b.id, b.hospital_id, b.set_kind::text AS set_kind, b.file_name, b.file_sha256,
         b.state::text AS state, b.counts, b.created_by, c.full_name AS created_by_name, b.created_at,
         m.full_name AS committed_by_name, b.committed_at, u.full_name AS undone_by_name, b.undone_at
    FROM import_batches b
    LEFT JOIN staff_users c ON c.id = b.created_by
    LEFT JOIN staff_users m ON m.id = b.committed_by
    LEFT JOIN staff_users u ON u.id = b.undone_by
"""


def batches_of(hospital_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        _BATCH_SELECT + " WHERE b.hospital_id = %s ORDER BY b.created_at DESC LIMIT 100", [hospital_id]
    )
    return [_to_batch(r) for r in rows]


def batch_of(hospital_id: str, batch_id: str, *, for_update: bool = False) -> dict[str, Any] | None:
    lock = " FOR UPDATE OF b" if for_update else ""
    row = db.fetch_one(_BATCH_SELECT + " WHERE b.id = %s AND b.hospital_id = %s" + lock, [batch_id, hospital_id])
    return None if row is None else _to_batch(row)


def create_batch(
    *,
    hospital_id: str,
    set_kind: str,
    file_name: str,
    file_sha256: str,
    counts: dict[str, int],
    created_by: str,
    rows: list[dict[str, Any]],
) -> str:
    batch_id = db.fetch_value(
        """
        INSERT INTO import_batches (hospital_id, set_kind, file_name, file_sha256, counts, created_by)
        VALUES (%s, %s::import_set, %s, %s, %s::jsonb, %s)
        RETURNING id
        """,
        [hospital_id, set_kind, file_name, file_sha256, _j(counts), created_by],
    )
    if batch_id is None:
        raise RuntimeError("import_batches returned no id")
    for start in range(0, len(rows), 200):
        batch = rows[start : start + 200]
        if not batch:
            continue
        values = ", ".join(
            "(%s::uuid, %s::int, %s::jsonb, %s, %s::jsonb, %s::external_kind, %s::uuid)" for _ in batch
        )
        params: list[Any] = []
        for row in batch:
            params += [
                batch_id,
                row["rowNumber"],
                _j(row["raw"]),
                row["action"],
                _j(row["errors"]),
                row["targetKind"],
                row["targetId"],
            ]
        db.execute(
            f"INSERT INTO import_rows (batch_id, row_number, raw, action, errors, target_kind, target_id) VALUES {values}",
            params,
        )
    return batch_id


def rows_of(batch_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT id, row_number, raw, action, errors, target_kind::text AS target_kind, target_id, previous
          FROM import_rows WHERE batch_id = %s ORDER BY row_number
        """,
        [batch_id],
    )
    return [
        {
            "id": r["id"],
            "rowNumber": r["row_number"],
            "raw": r["raw"],
            "action": r["action"],
            "errors": r["errors"],
            "targetKind": r["target_kind"],
            "targetId": r["target_id"],
            "previous": r["previous"],
        }
        for r in rows
    ]


def mark_row_written(
    row_id: str, *, target_kind: str, target_id: str, previous: dict[str, Any] | None, action: str | None = None
) -> None:
    db.execute(
        """
        UPDATE import_rows SET target_kind = %s::external_kind, target_id = %s,
               previous = %s::jsonb,
               action = coalesce(%s::text, action)
         WHERE id = %s
        """,
        [target_kind, target_id, None if previous is None else _j(previous), action, row_id],
    )


def undo_fingerprint(table: str, row_id: str) -> str | None:
    row = db.fetch_one(
        f"""
        SELECT encode(extensions.digest(to_jsonb(t)::text, 'sha256'), 'hex') AS fingerprint
          FROM {_table(table)} t WHERE t.id = %s::uuid FOR UPDATE
        """,
        [row_id],
    )
    if table == "staff_users" and row is not None:
        roles = db.fetch_value(
            """
            SELECT encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb)::text,
                   'sha256'), 'hex') AS fingerprint
              FROM staff_roles r WHERE r.staff_user_id = %s::uuid
            """,
            [row_id],
        )
        return f"{row['fingerprint']}:{roles or ''}"
    return None if row is None else row["fingerprint"]


def lock_writes(hospital_id: str) -> None:
    db.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", [f"import:{hospital_id}"])


def lock_undo_templates(ids: list[str]) -> None:
    db.execute("SELECT id FROM session_templates WHERE id = ANY(%s::uuid[]) ORDER BY id FOR UPDATE", [list(ids)])


def lock_undo_sessions(template_ids: list[str], booking_ids: list[str]) -> None:
    db.execute(
        """
        SELECT s.id FROM sessions s
         WHERE s.template_id = ANY(%s::uuid[])
            OR s.id IN (SELECT session_id FROM bookings WHERE id = ANY(%s::uuid[]))
         ORDER BY s.id FOR UPDATE OF s
        """,
        [list(template_ids), list(booking_ids)],
    )


def set_state(batch_id: str, state: str, by: str) -> None:
    if state == "committed":
        db.execute(
            "UPDATE import_batches SET state = 'committed', committed_by = %s, committed_at = now() WHERE id = %s",
            [by, batch_id],
        )
    elif state == "undone":
        db.execute(
            "UPDATE import_batches SET state = 'undone', undone_by = %s, undone_at = now() WHERE id = %s", [by, batch_id]
        )
    else:
        db.execute("UPDATE import_batches SET state = 'discarded' WHERE id = %s", [batch_id])
        purge_rows(batch_id)


def purge_rows(batch_id: str) -> None:
    db.execute("UPDATE import_rows SET raw = NULL, previous = NULL WHERE batch_id = %s", [batch_id])
    db.execute("UPDATE import_batches SET rows_purged_at = now() WHERE id = %s", [batch_id])


def purge_expired() -> int:
    rows = db.fetch_all(
        """
        WITH due AS (
          UPDATE import_batches SET rows_purged_at = now()
           WHERE rows_purged_at IS NULL AND state IN ('committed', 'undone')
             AND coalesce(undone_at, committed_at) < now() - interval '30 days'
          RETURNING id
        )
        UPDATE import_rows SET raw = NULL, previous = NULL WHERE batch_id IN (SELECT id FROM due)
        RETURNING batch_id AS id
        """
    )
    return len({r["id"] for r in rows})


def refs_of(hospital_id: str) -> dict[str, str]:
    rows = db.fetch_all(
        "SELECT kind::text AS kind, external_ref, entity_id FROM external_refs WHERE hospital_id = %s", [hospital_id]
    )
    return {f"{r['kind']}:{r['external_ref']}": r["entity_id"] for r in rows}


def upsert_ref(*, hospital_id: str, kind: str, external_ref: str, entity_id: str, batch_id: str) -> None:
    db.execute(
        """
        INSERT INTO external_refs (hospital_id, kind, external_ref, entity_id, batch_id)
        VALUES (%s, %s::external_kind, %s, %s, %s)
        ON CONFLICT (hospital_id, kind, external_ref) DO UPDATE SET entity_id = excluded.entity_id
        """,
        [hospital_id, kind, external_ref, entity_id, batch_id],
    )


def drop_refs_of(batch_id: str) -> None:
    db.execute("DELETE FROM external_refs WHERE batch_id = %s", [batch_id])


def restore_ref_target(*, hospital_id: str, external_ref: str, current_id: str, previous_id: str) -> bool:
    rows = db.fetch_all(
        """
        UPDATE external_refs SET entity_id = %s::uuid
         WHERE hospital_id = %s AND kind = 'schedule'
           AND external_ref = %s AND entity_id = %s::uuid
        RETURNING id
        """,
        [previous_id, hospital_id, external_ref, current_id],
    )
    return len(rows) == 1


def alias_users(batch_id: str, ids: list[str]) -> list[str]:
    rows = db.fetch_all(
        """
        SELECT DISTINCT entity_id FROM external_refs
         WHERE entity_id = ANY(%s::uuid[]) AND batch_id <> %s::uuid
        """,
        [list(ids), batch_id],
    )
    return [r["entity_id"] for r in rows]


def audit(
    *,
    actor_staff_id: str,
    hospital_id: str,
    batch_id: str,
    event: str,
    meta: dict[str, Any],
    ip: str | None,
    user_agent: str | None,
) -> None:
    db.execute(
        """
        INSERT INTO audit_log (actor_staff_id, hospital_id, action, subject_table, subject_id, ip, user_agent, meta)
        VALUES (%s, %s, 'IMPORT', 'import_batches', %s, %s::inet, %s, %s::jsonb)
        """,
        [actor_staff_id, hospital_id, batch_id, ip, user_agent, _j({"event": event, **meta})],
    )


def current_values(table: str, row_id: str, columns: list[str]) -> dict[str, Any]:
    pairs = ", ".join(f"%s::text, t.{_ref(column)}" for column in columns)
    row = db.fetch_one(
        f"""
        SELECT jsonb_build_object({pairs}) AS values FROM {_table(table)} t
         WHERE t.id = %s AND t.deleted_at IS NULL FOR UPDATE
        """,
        [*columns, row_id],
    )
    if row is None:
        raise RuntimeError("Import target is no longer active")
    return row["values"]


def restore_values(table: str, row_id: str, values: dict[str, Any]) -> None:
    columns = list(values.keys())
    if not columns:
        return
    listed = ", ".join(_ref(column) for column in columns)
    db.execute(
        f"""
        UPDATE {_table(table)} AS t SET ({listed}) =
          (SELECT {listed} FROM jsonb_populate_record(NULL::{_table(table)}, %s::jsonb))
         WHERE t.id = %s
        """,
        [_j(values), row_id],
    )


def soft_delete(table: str, ids: list[str]) -> None:
    if not ids:
        return
    db.execute(
        f"UPDATE {_table(table)} SET deleted_at = now() WHERE id = ANY(%s::uuid[]) AND deleted_at IS NULL", [list(ids)]
    )


def department_id_by_code(hospital_id: str, code: str) -> str | None:
    return db.fetch_value(
        "SELECT id FROM departments WHERE hospital_id = %s AND code = %s AND deleted_at IS NULL", [hospital_id, code]
    )


def doctor_hospital_for(*, hospital_id: str, doctor_id: str, department_id: str) -> str | None:
    return db.fetch_value(
        """
        SELECT id FROM doctor_hospitals
         WHERE hospital_id = %s AND doctor_id = %s AND department_id = %s AND deleted_at IS NULL
        """,
        [hospital_id, doctor_id, department_id],
    )


def bed_id_by_label(hospital_id: str, label: str) -> str | None:
    return db.fetch_value(
        "SELECT id FROM beds WHERE hospital_id = %s AND lower(label) = lower(%s) AND deleted_at IS NULL",
        [hospital_id, label],
    )


def staff_id_by_email(hospital_id: str, email: str) -> str | None:
    return db.fetch_value(
        "SELECT id FROM staff_users WHERE hospital_id = %s AND lower(email) = lower(%s) AND deleted_at IS NULL",
        [hospital_id, email],
    )


def chamber_for(
    *, hospital_id: str, doctor_id: str, department_id: str, date: str, start_time: str | None
) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT s.id, s.fee_poisha FROM sessions s
         WHERE s.hospital_id = %(h)s AND s.doctor_id = %(doctor)s
           AND s.department_id = %(dep)s AND s.session_date = %(date)s::date
           AND s.deleted_at IS NULL AND s.status NOT IN ('cancelled', 'ended')
           AND (%(start)s::time IS NULL OR
                (%(start)s::time >= (s.planned_start AT TIME ZONE 'Asia/Dhaka')::time
                 AND %(start)s::time < (s.planned_end AT TIME ZONE 'Asia/Dhaka')::time))
         ORDER BY s.planned_start
         LIMIT 1
        """,
        {"h": hospital_id, "doctor": doctor_id, "dep": department_id, "date": date, "start": start_time},
    )
    return None if row is None else {"id": row["id"], "feePoisha": row["fee_poisha"]}


def serial_held(session_id: str, serial: int, except_booking_id: str | None) -> bool:
    return (
        db.fetch_one(
            """
            SELECT 1 AS one FROM bookings
             WHERE session_id = %(s)s AND serial_number = %(serial)s AND deleted_at IS NULL
               AND (%(except)s::uuid IS NULL OR id <> %(except)s::uuid)
            """,
            {"s": session_id, "serial": serial, "except": except_booking_id},
        )
        is not None
    )


def insert_hospital_patient(
    *,
    hospital_id: str,
    full_name: str,
    date_of_birth: str | None,
    age_years: int | None,
    sex: str,
    phone: str | None,
    blood_group: str | None,
) -> str:
    patient_id = db.fetch_value(
        """
        INSERT INTO patients (owner_hospital_id, full_name, date_of_birth, age_years, sex, phone, blood_group,
                              relationship, is_primary)
        VALUES (%s, %s, %s::date, %s, %s::sex, %s, %s, 'self', false)
        RETURNING id
        """,
        [hospital_id, full_name, date_of_birth, age_years, sex, phone, blood_group],
    )
    if patient_id is None:
        raise RuntimeError("patients insert returned no id")
    return patient_id


def update_hospital_patient(
    patient_id: str,
    *,
    full_name: str,
    date_of_birth: str | None,
    age_years: int | None,
    sex: str,
    phone: str | None,
    blood_group: str | None,
) -> None:
    db.execute(
        """
        UPDATE patients SET full_name = %s, date_of_birth = %s::date,
               age_years = %s, sex = %s::sex, phone = %s,
               blood_group = %s, updated_at = now()
         WHERE id = %s
        """,
        [full_name, date_of_birth, age_years, sex, phone, blood_group, patient_id],
    )


def update_imported_booking(booking_id: str, *, serial: int, paid: bool) -> None:
    db.execute(
        """
        UPDATE bookings SET serial_number = %s,
               intake = jsonb_set(intake, '{import}', %s::jsonb),
               updated_at = now()
         WHERE id = %s
        """,
        [serial, _j({"paid": paid}), booking_id],
    )


_HELD_BY_OTHERS = {
    "department": """
        SELECT DISTINCT department_id AS id FROM doctor_hospitals
         WHERE department_id = ANY(%(ids)s::uuid[]) AND deleted_at IS NULL AND NOT (id = ANY(%(own)s::uuid[]))
    """,
    "doctor": """
        SELECT DISTINCT dh.id FROM doctor_hospitals dh
          JOIN sessions s ON s.doctor_id = dh.doctor_id AND s.department_id = dh.department_id
                         AND s.hospital_id = dh.hospital_id AND s.deleted_at IS NULL
          JOIN bookings b ON b.session_id = s.id AND b.deleted_at IS NULL
         WHERE dh.id = ANY(%(ids)s::uuid[]) AND NOT (b.id = ANY(%(own)s::uuid[]))
    """,
    "schedule": """
        SELECT DISTINCT s.template_id AS id FROM sessions s
         WHERE s.template_id = ANY(%(ids)s::uuid[]) AND s.deleted_at IS NULL
           AND (s.status <> 'scheduled' OR EXISTS (
             SELECT 1 FROM bookings b WHERE b.session_id = s.id AND b.deleted_at IS NULL
               AND NOT (b.id = ANY(%(own)s::uuid[]))
           ))
    """,
    "ward": """
        SELECT DISTINCT ward_id AS id FROM beds
         WHERE ward_id = ANY(%(ids)s::uuid[]) AND deleted_at IS NULL AND NOT (id = ANY(%(own)s::uuid[]))
    """,
    "bed": """
        SELECT b.id FROM beds b
         WHERE b.id = ANY(%(ids)s::uuid[])
           AND (b.state <> 'out_of_service' OR EXISTS (SELECT 1 FROM bed_events e WHERE e.bed_id = b.id))
    """,
    "staff": """
        SELECT id FROM staff_users WHERE id = ANY(%(ids)s::uuid[]) AND last_login_at IS NOT NULL
    """,
    "patient": """
        SELECT p.id FROM patients p
         WHERE p.id = ANY(%(ids)s::uuid[])
           AND (EXISTS (SELECT 1 FROM bookings b WHERE b.patient_id = p.id AND b.deleted_at IS NULL
                                                  AND NOT (b.id = ANY(%(own)s::uuid[])))
                OR EXISTS (SELECT 1 FROM visits v WHERE v.patient_id = p.id)
                OR EXISTS (SELECT 1 FROM test_orders x WHERE x.patient_id = p.id)
                OR EXISTS (SELECT 1 FROM patient_documents x WHERE x.patient_id = p.id)
                OR EXISTS (SELECT 1 FROM consents x WHERE x.patient_id = p.id)
                OR EXISTS (SELECT 1 FROM emergency_cases x WHERE x.patient_id = p.id)
                OR EXISTS (SELECT 1 FROM bed_requests x WHERE x.patient_id = p.id)
                OR EXISTS (SELECT 1 FROM admissions x WHERE x.patient_id = p.id)
                OR EXISTS (SELECT 1 FROM referrals x WHERE x.patient_id = p.id)
                OR EXISTS (SELECT 1 FROM blood_requests x WHERE x.patient_id = p.id))
    """,
    "appointment": """
        SELECT id FROM bookings
         WHERE id = ANY(%(ids)s::uuid[]) AND (status <> 'booked' OR payment_id IS NOT NULL)
    """,
}


def held_by_others(*, kind: str, ids: list[str], own: list[str]) -> list[str]:
    if not ids:
        return []
    query = _HELD_BY_OTHERS.get(kind)
    if query is None:
        return []
    return [r["id"] for r in db.fetch_all(query, {"ids": list(ids), "own": list(own)})]


def insert_imported_booking(
    *, session_id: str, patient_id: str, serial: int, fee_poisha: int, paid: bool, created_by: str
) -> str:
    booking_id = db.fetch_value(
        """
        INSERT INTO bookings (session_id, patient_id, serial_number, source, fee_poisha, intake, created_by)
        VALUES (%s, %s, %s, 'import', %s, %s::jsonb, %s)
        RETURNING id
        """,
        [session_id, patient_id, serial, fee_poisha, _j({"import": {"paid": paid}}), created_by],
    )
    if booking_id is None:
        raise RuntimeError("bookings insert returned no id")
    return booking_id


def session_of_booking(booking_id: str) -> str | None:
    return db.fetch_value("SELECT session_id FROM bookings WHERE id = %s", [booking_id])


def retire_staff(staff_id: str) -> None:
    db.execute("UPDATE staff_roles SET deleted_at = now() WHERE staff_user_id = %s AND deleted_at IS NULL", [staff_id])
    db.execute("UPDATE sessions_auth SET revoked_at = now() WHERE subject_id = %s AND revoked_at IS NULL", [staff_id])
    db.execute("UPDATE staff_users SET deleted_at = now(), is_active = false WHERE id = %s", [staff_id])


def revive_template(template_id: str) -> None:
    db.execute("UPDATE session_templates SET deleted_at = NULL WHERE id = %s", [template_id])


def find_mapping_profile(*, hospital_id: str, set_kind: str, header_sha256: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT row_type, mapping
          FROM import_mapping_profiles
         WHERE hospital_id = %s
           AND set_kind = %s::import_set
           AND header_sha256 = %s
        """,
        [hospital_id, set_kind, header_sha256],
    )
    if row is None:
        return None
    mapping: dict[str, int | None] = {}
    if isinstance(row["mapping"], dict):
        for field, column in row["mapping"].items():
            mapping[field] = _integer_or_none(column)
    return {"rowType": row["row_type"], "mapping": mapping}


def _integer_or_none(value: Any) -> int | None:
    # Number.isInteger: a JSON number with no fraction, never a boolean.
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def save_mapping_profile(
    *,
    hospital_id: str,
    set_kind: str,
    header_sha256: str,
    row_type: str | None,
    mapping: dict[str, int | None],
    sources: dict[str, str],
    approved_by: str,
    audit_ip: str | None,
    audit_user_agent: str | None,
    audit_batch_id: str,
    audit_fields: dict[str, dict[str, str]],
    audit_not_imported: list[str],
) -> None:
    with db.transaction():
        db.execute(
            """
            INSERT INTO import_mapping_profiles
              (hospital_id, set_kind, header_sha256, row_type, mapping, sources, approved_by, approved_at)
            VALUES (%s, %s::import_set, %s, %s, %s::jsonb, %s::jsonb, %s, now())
            ON CONFLICT (hospital_id, set_kind, header_sha256) DO UPDATE
              SET row_type = EXCLUDED.row_type,
                  mapping = EXCLUDED.mapping,
                  sources = EXCLUDED.sources,
                  approved_by = EXCLUDED.approved_by,
                  approved_at = now()
            """,
            [hospital_id, set_kind, header_sha256, row_type, _j(mapping), _j(sources), approved_by],
        )
        db.execute(
            """
            INSERT INTO audit_log (actor_staff_id, hospital_id, action, subject_table, subject_id, ip, user_agent, meta)
            VALUES (%s, %s, 'SETTINGS_CHANGE', 'import_batches', %s, %s::inet, %s, %s::jsonb)
            """,
            [
                approved_by,
                hospital_id,
                audit_batch_id,
                audit_ip,
                audit_user_agent,
                _j(
                    {
                        "change": "import_mapping_confirmed",
                        "set": set_kind,
                        "rowType": row_type,
                        "headerSha256": header_sha256,
                        "fields": audit_fields,
                        "notImported": audit_not_imported,
                    }
                ),
            ],
        )
