"""What a message leaves behind (port of `smsRedaction.test.ts`; PLATFORM_PLAN.md 1.9,
CLAUDE.md §7, DATABASE.md §8).

The Node file watches the Node process's console and logger and calls Node's
own adapter and notification service, so against Django it tested Node.
Here the Python ones are watched: the log adapter writes neither the number
nor the text, keeps nothing, and still reports a cost; a booking's
confirmation still carries the link to the patient while the table and the
log keep none; the words of a message are cleared after ninety days.
"""

from __future__ import annotations

import json
import random
import uuid
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest

from .conftest import Api, create_queue_fixture

PHONE = "+8801712345678"
BODY = "সিরিয়াল ১২ — লাইভ দেখুন: https://app.example.test/s?b=1&t=a-working-token"


class Written:
    """Everything the process writes: the logger's arguments, before any
    redaction, and both streams."""

    def __init__(self, capsys: pytest.CaptureFixture[str]) -> None:
        self.calls: list[Any] = []
        self.capsys = capsys

    def text(self) -> str:
        out, err = self.capsys.readouterr()
        return "\n".join([*(json.dumps(call, default=str, ensure_ascii=False) for call in self.calls), out, err])


@pytest.fixture
def written(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> Written:
    from medlive.core import logging as medlive_logging

    capture = Written(capsys)
    original = medlive_logging.Logger._log

    def keep(self: Any, level: int, fields: Any, message: str | None, exc: Any) -> None:
        capture.calls.append({"bound": self._bound, "fields": fields, "message": message})
        original(self, level, fields, message, exc)

    monkeypatch.setattr(medlive_logging.Logger, "_log", keep)
    return capture


class RecordingSmsAdapter:
    name = "recording"
    reports_delivery = False

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    def send(self, *, to: str, body: str, notification_id: str, template_key: str, sensitive: bool = False) -> Any:
        from medlive.adapters.sms import SmsResult

        self.sent.append({"to": to, "body": body, "notificationId": notification_id, "templateKey": template_key})
        return SmsResult(ok=True, provider_ref=f"recording:{notification_id}", cost_poisha=0)

    def verify_receipt(self, raw_body: str, signature: str | None) -> bool:
        return False

    def read_receipt(self, body: Any) -> None:
        return None


@pytest.fixture(autouse=True)
def _sms_adapter() -> Any:
    from medlive.adapters import sms

    yield
    sms.reset_sms_adapter()


def _guest_phone() -> str:
    return f"+88019{random.randint(10_000_000, 99_999_999)}"


def _book_as_guest(api: Api, session_id: str, phone: str) -> dict[str, Any]:
    answer = api.call(
        "POST",
        "/bookings",
        body={
            "sessionId": session_id,
            "method": "at_hospital",
            "guest": {"name": "রহিমা খাতুন (ডেমো)", "phone": phone, "ageYears": 34, "sex": "female"},
        },
    )
    assert answer.status == 201, answer.body
    return answer.body["data"]


def _confirmation_rows(booking_id: str) -> list[dict[str, Any]]:
    from medlive.core import db

    return db.fetch_all(
        """
        SELECT params, phone, state::text AS state FROM notifications
         WHERE template_key = 'booking.confirmed' AND params ->> 'bookingId' = %s
        """,
        [booking_id],
    )


def _settled() -> None:
    from medlive.services import notification

    assert notification.settled(), "the sender did not settle"


# --- the log provider (SMS_PROVIDER=log) ----------------------------------


def test_the_log_provider_writes_neither_the_number_nor_the_text(written: Written) -> None:
    from medlive.adapters.sms import LogSmsAdapter

    result = LogSmsAdapter().send(to=PHONE, body=BODY, notification_id="notification-1", template_key="booking.confirmed")
    everything = written.text()
    assert PHONE not in everything
    assert "01712345678" not in everything
    assert "a-working-token" not in everything
    assert "সিরিয়াল" not in everything
    # Still a log provider: one line saying which message, and nothing about whose.
    assert "notification-1" in everything
    assert "booking.confirmed" in everything
    assert result.ok is True


def test_the_log_provider_keeps_nothing_once_the_message_is_handed_over() -> None:
    from medlive.adapters.sms import LogSmsAdapter

    adapter = LogSmsAdapter()
    for index in range(3):
        adapter.send(to=PHONE, body=BODY, notification_id=f"notification-{index}", template_key="booking.confirmed")
    held = json.dumps(vars(adapter), default=str, ensure_ascii=False)
    assert PHONE not in held
    assert "a-working-token" not in held
    assert not hasattr(adapter, "all")


def test_the_log_provider_still_reports_what_a_message_would_cost() -> None:
    from medlive.adapters.sms import LogSmsAdapter

    result = LogSmsAdapter().send(to=PHONE, body=BODY, notification_id="notification-1", template_key="booking.confirmed")
    assert result.ok is True
    assert result.provider_ref == "log:notification-1"
    assert result.cost_poisha > 0


# --- a booking's confirmation (FR-PAT-22, FR-GST-05) ------------------------


def test_a_booking_confirmation_still_sends_the_patient_the_link(api: Api) -> None:
    from medlive.adapters import sms
    from medlive.services import notification

    notification.forget_templates()
    fixture = create_queue_fixture(3)
    outbox = RecordingSmsAdapter()
    sms.set_sms_adapter(outbox)
    phone = _guest_phone()
    booked = _book_as_guest(api, fixture.session_id, phone)
    _settled()
    sent = [message for message in outbox.sent if message["templateKey"] == "booking.confirmed"]
    assert len(sent) == 1
    assert sent[0]["to"] == phone
    assert booked["trackingUrl"] in sent[0]["body"]


def test_a_booking_confirmation_leaves_no_link_in_the_table(api: Api) -> None:
    from medlive.adapters import sms
    from medlive.core import db
    from medlive.services import notification

    notification.forget_templates()
    fixture = create_queue_fixture(3)
    sms.set_sms_adapter(RecordingSmsAdapter())
    booked = _book_as_guest(api, fixture.session_id, _guest_phone())
    token = parse_qs(urlsplit(booked["trackingUrl"]).query).get("t", [""])[0]
    assert len(token) > 20
    rows = _confirmation_rows(booked["bookingId"])
    assert rows
    for row in rows:
        stored = json.dumps(row["params"], ensure_ascii=False)
        assert token not in stored
        assert booked["trackingUrl"] not in stored
        assert "link" not in row["params"]
        assert "{link}" in str(row["params"]["body"])
        assert "http://" not in str(row["params"]["body"]) and "https://" not in str(row["params"]["body"])
    holding = db.fetch_value(
        "SELECT count(*)::int FROM notifications WHERE params ? 'link' OR params ->> 'body' ~ 'https?://'"
    )
    assert holding == 0


def test_a_booking_confirmation_leaves_no_link_and_no_number_in_the_log(api: Api, written: Written) -> None:
    from medlive.services import notification

    notification.forget_templates()
    fixture = create_queue_fixture(3)
    phone = _guest_phone()
    booked = _book_as_guest(api, fixture.session_id, phone)
    token = parse_qs(urlsplit(booked["trackingUrl"]).query).get("t", [""])[0]
    _settled()
    everything = written.text()
    assert token not in everything
    assert phone not in everything
    assert phone.replace("+88", "") not in everything
    assert [row["state"] for row in _confirmation_rows(booked["bookingId"])] == ["sent"]


# --- what is kept of a message (for_the_record) ---------------------------


def test_the_record_keeps_the_words_and_leaves_the_link_as_its_placeholder() -> None:
    from medlive.services.notification import for_the_record

    kept = for_the_record("সিরিয়াল {serial}। লাইভ দেখুন: {link}", {"serial": "১২", "link": "https://app.example.test/s?b=1&t=a-working-token"})
    assert kept["body"] == "সিরিয়াল ১২। লাইভ দেখুন: {link}"
    assert kept["params"] == {"serial": "১২"}


def test_the_record_does_not_claim_a_link_was_sent_when_none_was() -> None:
    from medlive.services.notification import for_the_record

    kept = for_the_record("সিরিয়াল {serial}। {link}", {"serial": "১২", "link": ""})
    assert kept["body"] == "সিরিয়াল ১২। "
    assert kept["params"] == {"serial": "১২"}


# --- ninety days on (DATABASE.md §8) --------------------------------------


def _queue_one(fixture: Any) -> str:
    from medlive.core import db
    from medlive.services import notification

    with db.transaction():
        batch = notification.queue_for(fixture.session_id, notification.plan_booking_confirmed(fixture.booking_ids[0], None))
    assert batch["ids"], "the fixture should have produced a message"
    return batch["ids"][0]


def _age_to(notification_id: str, days: int) -> None:
    from medlive.core import db

    db.execute("UPDATE notifications SET queued_at = now() - (%s::int * interval '1 day') WHERE id = %s", [days, notification_id])


def _row_of(notification_id: str) -> dict[str, Any]:
    from medlive.core import db

    row = db.fetch_one("SELECT params, template_key, state::text AS state FROM notifications WHERE id = %s", [notification_id])
    assert row is not None
    return row


def test_a_message_older_than_ninety_days_loses_its_words_and_keeps_what_it_was_about() -> None:
    from medlive.services import notification

    fixture = create_queue_fixture(3)
    notification_id = _queue_one(fixture)
    _age_to(notification_id, 91)
    before = _row_of(notification_id)
    assert "body" in before["params"] and "serial" in before["params"]
    assert notification.clear_expired_bodies() >= 1
    row = _row_of(notification_id)
    assert row["params"] == {"bookingId": fixture.booking_ids[0]}
    assert row["template_key"] == "booking.confirmed"
    assert row["state"] == before["state"]


def test_a_message_of_eighty_nine_days_is_left_as_it_was() -> None:
    from medlive.services import notification

    fixture = create_queue_fixture(3)
    notification_id = _queue_one(fixture)
    _age_to(notification_id, 89)
    before = _row_of(notification_id)
    notification.clear_expired_bodies()
    assert _row_of(notification_id) == before
    assert "body" in before["params"]


def test_there_is_nothing_left_to_clear_the_second_time() -> None:
    from medlive.services import notification

    fixture = create_queue_fixture(3)
    notification_id = _queue_one(fixture)
    _age_to(notification_id, 120)
    notification.clear_expired_bodies()
    assert notification.clear_expired_bodies() == 0
