"""The Socket.IO server, and the emitter that publishes through it
(port of `realtime/server.ts`; BACKEND.md §0, §6).

python-socketio speaks the protocol the frontend's `socket.io-client` 4.x
already uses, so the frontend's realtime code is unchanged: the same path
(`/socket.io/`), the same `auth: { token }`, the same events and rooms.

Services publish from worker threads; `SocketIoEmitter` hands each emission
to the event loop in the order it was made, so the order a chamber's
broadcasts are published in is the order a phone receives them.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import socketio
from asgiref.sync import sync_to_async

from ..core.http import dumps
from ..core.links import allowed_origins
from ..core.logging import logger
from . import auth as socket_auth
from .emit import set_emitter
from .handlers import ambient_rooms, authorize_subscription, catch_up, error_envelope, read_session_id
from .rooms import ROOMS

REVOKED_SWEEP_SECONDS = 60
PORTAL_REFRESH_SECONDS = 30


class _Json:
    """Compact JSON with the API's own encoder (dates as JavaScript writes them)."""

    @staticmethod
    def dumps(obj: Any, *args: Any, **kwargs: Any) -> str:
        return dumps(obj)

    @staticmethod
    def loads(s: str | bytes, *args: Any, **kwargs: Any) -> Any:
        return json.loads(s)


# Origins this process has learnt are portals, refreshed off the event loop.
_portal_origins: set[str] = set()


def _origin_allowed(origin: str | None) -> bool:
    """The socket handshake's origin check: the same allowlist as CORS.

    Runs on the event loop, so it must not read the database; a hospital's
    own domain is checked against what the background refresh last read.
    """
    if origin is None:
        return True
    return origin in allowed_origins() or origin in _portal_origins


sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=_origin_allowed,
    cors_credentials=True,
    ping_interval=25,
    ping_timeout=60,
    transports=["websocket", "polling"],
    json=_Json,
    logger=False,
    engineio_logger=False,
)

_loop: asyncio.AbstractEventLoop | None = None
_tasks: list[asyncio.Task[Any]] = []


class SocketIoEmitter:
    def emit(self, room: str, event: str, envelope: dict[str, Any]) -> None:
        loop = _loop
        if loop is None or loop.is_closed():
            return
        coroutine = sio.emit(event, envelope, room=room)
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            loop.create_task(coroutine)
        else:
            asyncio.run_coroutine_threadsafe(coroutine, loop)


class TeeEmitter:
    """Sends, and records what it sent (tests only)."""

    def __init__(self, inner: SocketIoEmitter) -> None:
        from .emit import RecordingEmitter

        self.inner = inner
        self.recorder = RecordingEmitter()

    def emit(self, room: str, event: str, envelope: dict[str, Any]) -> None:
        self.recorder.emit(room, event, envelope)
        self.inner.emit(room, event, envelope)


def _close_from_anywhere(sid: str) -> None:
    loop = _loop
    if loop is None or loop.is_closed():
        return
    coroutine = sio.disconnect(sid)
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if running is loop:
        loop.create_task(coroutine)
    else:
        asyncio.run_coroutine_threadsafe(coroutine, loop)


def attach_loop() -> None:
    """Called at startup, on the event loop: services may now publish."""
    global _loop
    _loop = asyncio.get_running_loop()
    from ..core.env import env

    # Under NODE_ENV=test the emissions are also recorded, for the test seam
    # (`routes/test_seam.py`); everywhere else they are only sent.
    set_emitter(TeeEmitter(SocketIoEmitter()) if env().NODE_ENV == "test" else SocketIoEmitter())
    socket_auth.install_closer(_close_from_anywhere)
    logger.info({"corsOrigins": allowed_origins()}, "realtime attached")


# --- Handlers ---------------------------------------------------------------------


@sio.event
async def connect(sid: str, environ: dict[str, Any], auth: Any = None) -> None:
    session = await sync_to_async(socket_auth.authenticate, thread_sensitive=False)(sid, auth, environ)
    if session is None:
        raise socketio.exceptions.ConnectionRefusedError("unauthorised")
    socket_auth.remember(session)
    sio.start_background_task(_join_ambient, sid)


async def _join_ambient(sid: str) -> None:
    try:
        rooms = await sync_to_async(ambient_rooms, thread_sensitive=False)(sid)
    except Exception:  # noqa: BLE001
        await sio.disconnect(sid)
        return
    session = socket_auth.session_of(sid)
    if session is None:
        return
    for room in rooms:
        await sio.enter_room(sid, room)
        session.rooms.add(room)


@sio.on("session:subscribe")
async def session_subscribe(sid: str, message: Any = None) -> None:
    decision = await sync_to_async(authorize_subscription, thread_sensitive=False)(sid, message)
    if decision.get("disconnect"):
        await sio.disconnect(sid)
        return
    if "error" in decision:
        await sio.emit("error.occurred", decision["error"], to=sid)
        return
    session = socket_auth.session_of(sid)
    if session is None:
        return
    # Join first, then read: a broadcast made between the two reaches this
    # client, which folds by `seq` (SY-01).
    await sio.enter_room(sid, decision["room"])
    session.rooms.add(decision["room"])
    result = await sync_to_async(catch_up, thread_sensitive=False)(
        sid, message, decision["sessionId"], decision["staff"]
    )
    if "error" in result:
        await sio.emit("error.occurred", result["error"], to=sid)
        return
    for event, payload in result["emits"]:
        await sio.emit(event, payload, to=sid)


@sio.on("session:unsubscribe")
async def session_unsubscribe(sid: str, message: Any = None) -> None:
    session_id = read_session_id(message)
    if session_id is None:
        return
    session = socket_auth.session_of(sid)
    for room in (ROOMS.session(session_id), ROOMS.session_staff(session_id)):
        await sio.leave_room(sid, room)
        if session is not None:
            session.rooms.discard(room)


@sio.event
async def disconnect(sid: str, reason: Any = None) -> None:
    logger.debug({"socketId": sid}, "socket disconnected")
    socket_auth.forget_socket(sid)


# --- Background --------------------------------------------------------------------


async def _every(seconds: float, work: Any, label: str) -> None:
    while True:
        try:
            await sync_to_async(work, thread_sensitive=False)()
        except Exception as error:  # noqa: BLE001
            logger.error({"task": label}, "realtime background task failed", exc=error)
        await asyncio.sleep(seconds)


def _refresh_portal_origins() -> None:
    from ..services.portal import _recorded_domains

    recorded = _recorded_domains()
    _portal_origins.clear()
    for host in recorded.by_host:
        _portal_origins.add(f"https://{host}")


def start_realtime_tasks() -> None:
    loop = asyncio.get_running_loop()
    _tasks.append(loop.create_task(_every(PORTAL_REFRESH_SECONDS, _refresh_portal_origins, "portal-origins")))

    async def sweep_later() -> None:
        await asyncio.sleep(REVOKED_SWEEP_SECONDS)
        await _every(REVOKED_SWEEP_SECONDS, socket_auth.sweep_revoked, "revoked-sweep")

    _tasks.append(loop.create_task(sweep_later()))


async def stop_realtime_tasks() -> None:
    for task in _tasks:
        task.cancel()
    _tasks.clear()
    # Tell every connected console and phone to reconnect elsewhere now,
    # rather than after a ping timeout (PRD.md §3.2).
    for session in socket_auth.all_sessions():
        try:
            await sio.disconnect(session.sid)
        except Exception:  # noqa: BLE001
            pass


__all__ = ["attach_loop", "error_envelope", "sio", "start_realtime_tasks", "stop_realtime_tasks"]
