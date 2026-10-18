"""The test seam: what the Node API suite needs to see of this process
(mounted only when NODE_ENV=test; `routes/__init__.py`).

The Node suite asserts on its in-process recording emitter. Run against this
server, it reads this process's recording instead (`tests/node_suite/emit-shim.ts`).
"""

from __future__ import annotations

from ..core.http import ApiRequest, Reply, ok
from ..core.router import Router
from ..realtime.emit import RecordingEmitter, emitter

routes = Router()


def _recorder() -> RecordingEmitter | None:
    current = emitter()
    if isinstance(current, RecordingEmitter):
        return current
    return getattr(current, "recorder", None)


def emitted(req: ApiRequest) -> Reply:
    recorder = _recorder()
    return ok([] if recorder is None else recorder.all())


def reset(req: ApiRequest) -> Reply:
    recorder = _recorder()
    if recorder is not None:
        recorder.clear()
    return ok(True)


routes.get("/__test__/emitted", emitted)
routes.post("/__test__/emitted/reset", reset)
