"""Lab and pharmacy request shapes (port of `schemas/lab.schema.ts`; FR-LAB-*, FR-PHA-*)."""

from __future__ import annotations

from ...core.schema import z
from ..lab import LAB_ACTIONS
from .booking import scope_code
from .queue import queue_command_envelope

uuid = z.string().uuid()

lab_command_envelope = queue_command_envelope

TEST_CODE_MAX = 32
TEST_NAME_MAX = 120

create_test_orders_body = lab_command_envelope.extend(
    {
        "bookingId": uuid,
        "tests": z.array(
            z.object(
                {
                    "testCode": z.string().trim().min(1).max(TEST_CODE_MAX),
                    "testName": z.string().trim().min(1).max(TEST_NAME_MAX).optional(),
                }
            )
        )
        .min(1)
        .max(20),
        "idempotencyKey": uuid,
    }
)

test_order_params = z.object({"id": uuid})

test_order_state_body = lab_command_envelope.extend({"action": z.enum(list(LAB_ACTIONS)), "idempotencyKey": uuid})

REPORT_FILE_TYPES = ("application/pdf", "image/jpeg", "image/png", "image/webp")
REPORT_MAX_BYTES = 10 * 1024 * 1024

upload_report_body = lab_command_envelope.extend(
    {
        "fileType": z.enum(list(REPORT_FILE_TYPES)),
        "fileName": z.string().trim().min(1).max(200).optional(),
        "content": z.string().min(1),
        "idempotencyKey": uuid,
    }
)

lab_queue_query = z.object(
    {
        "state": z.enum(["open", "reported", "all"]).default("open"),
        "days": z.coerce.number().int().min(1).max(90).default(7),
    }
)

stock_flags_body = lab_command_envelope.extend(
    {
        "flags": z.array(
            z.object(
                {
                    "medicineId": uuid,
                    "inStock": z.boolean(),
                    "expectedUpdatedAt": z.string().datetime().nullable(),
                }
            )
        )
        .min(1)
        .max(200),
        "idempotencyKey": uuid,
    }
)

medicine_search_query = z.object(
    {
        "scope": scope_code.optional(),
        "q": z.string().trim().min(2).max(80),
        "lat": z.coerce.number().min(-90).max(90).optional(),
        "lng": z.coerce.number().min(-180).max(180).optional(),
        "limit": z.coerce.number().int().min(1).max(50).default(20),
    }
)
