"""The clock's work, run once each against the test database (`services/jobs.py`;
BACKEND.md §8, FR-QUE-30, FR-PAY-08, FR-IMP-08). The loops themselves are
started only where `RUN_BACKGROUND_JOBS` is on, which the test settings are not.
"""

from __future__ import annotations


def test_an_hour_of_jobs_goes_through_and_says_so() -> None:
    from medlive.services import heartbeat, jobs

    heartbeat.reset()
    heartbeat.register("hourly", jobs.HOURLY_SECONDS * 1000)
    assert jobs.run_hourly() is True
    beat = next(entry for entry in heartbeat.snapshot() if entry["worker"] == "hourly")
    assert beat["lastOkAt"] is not None
    assert beat["lastFailedAt"] is None


def test_looking_for_lapsed_offers_answers_with_a_count() -> None:
    from medlive.services import jobs

    assert jobs.lapse_due_offers() >= 0


def test_a_tick_of_each_timer_reports_to_the_heartbeat() -> None:
    from medlive.services import heartbeat, jobs

    heartbeat.reset()
    for worker in ("offers", "payments"):
        heartbeat.register(worker, 30_000)
    jobs._run_offers()
    jobs._run_payments()
    beats = {entry["worker"]: entry for entry in heartbeat.snapshot()}
    assert beats["offers"]["lastOkAt"] is not None
    assert beats["payments"]["lastOkAt"] is not None


def test_the_loops_start_and_stop() -> None:
    from medlive.services import jobs, notification_sender

    jobs._stop.clear()
    thread = jobs._loop("probe", 3600, lambda: None, now_first=True)
    assert thread.is_alive()
    jobs._stop.set()
    thread.join(timeout=5)
    assert not thread.is_alive()
    jobs._stop.clear()
    notification_sender.stop_sender()
