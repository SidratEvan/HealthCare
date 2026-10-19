"""Clinical request shapes (port of `shared/domain/src/schemas/clinical.schema.ts`)."""

from __future__ import annotations

import math
from typing import Any

from ...core.schema import NEVER, TransformCtx, z
from ..documents import DOCUMENT_CONTENT_TYPES, DOCUMENT_KINDS, MAX_DOCUMENT_BYTES
from ..enums import SYMPTOM_SIGNALS
from ..prescription import MAX_DURATION_DAYS, MAX_PRESCRIPTION_ROWS, read_schedule, schedule_text

uuid = z.string().uuid()


def _schedule(raw: str, ctx: TransformCtx) -> Any:
    read = read_schedule(raw)
    if read is None:
        ctx.add_issue("must be a schedule such as 1+0+1")
        return NEVER
    return schedule_text(read)


prescribed_medicine = z.object(
    {
        "medicineId": uuid.optional(),
        "name": z.string().trim().min(1).max(200),
        "strength": z.string().trim().max(60).optional(),
        "schedule": z.string().trim().transform(_schedule).optional(),
        "durationDays": z.number().int().min(1).max(MAX_DURATION_DAYS).optional(),
        "instructionBn": z.string().trim().max(300).optional(),
    }
)

formulary_query = z.object({"q": z.string().trim().min(2).max(60)})

_iso_date = z.string().regex(r"^\d{4}-\d{2}-\d{2}$", "must be a date as YYYY-MM-DD")

create_visit_body = z.object(
    {
        "bookingId": uuid,
        "patientId": uuid.optional(),
        "sessionId": uuid.optional(),
        "expectedRevision": z.string().max(200).nullable().optional(),
        "diagnosisText": z.string().trim().max(2000).optional(),
        "adviceTextBn": z.string().trim().max(4000).optional(),
        "followUpDate": _iso_date.optional(),
        "symptomSignal": z.enum(list(SYMPTOM_SIGNALS)).nullable().optional(),
        "medicines": z.array(prescribed_medicine).max(MAX_PRESCRIPTION_ROWS).optional(),
        "sign": z.boolean().default(False),
        "idempotencyKey": uuid,
    }
)

records_query = z.object({"booking": uuid.optional()})

#: How long a consent code shown in a chamber stays good (`FR-PAT-63`).
CONSENT_OFFER_TTL_SECONDS = 180

consent_scope = z.enum(["visit", "hospital", "doctor", "full"])

create_consent_body = z.object(
    {"hospitalId": uuid, "scope": consent_scope.default("visit"), "idempotencyKey": uuid}
)

redeem_consent_body = z.object({"code": z.string().trim().min(16).max(1024), "idempotencyKey": uuid})

upload_document_body = z.object(
    {
        "patientId": uuid,
        "contentType": z.enum(list(DOCUMENT_CONTENT_TYPES)),
        "dataBase64": z.string().min(1).max(math.ceil(MAX_DOCUMENT_BYTES / 3) * 4),
        "docType": z.enum(list(DOCUMENT_KINDS)),
        "docDate": _iso_date.optional(),
        "doctorName": z.string().trim().max(120).optional(),
        "idempotencyKey": uuid,
    }
)

documents_query = z.object({"patient": uuid})
document_id_params = z.object({"id": uuid})
document_url_params = z.object({"id": uuid, "docId": uuid})
