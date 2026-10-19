"""Every path goes to the pipeline, which routes it the way Express did
(`core/router.py`): one ordered table, so the order of the TypeScript routes,
and therefore which route answers an ambiguous path, is kept exactly.

Under ASGI, Django runs a synchronous view on one thread for the whole
process (`thread_sensitive=True`), which would answer one request at a time
and let a request waiting on a lock hold up every other. The Node API
interleaves requests, so this entry runs each request on a worker thread of
its own instead, and hands that thread's database connection back to the
pool when the request is done: Django's own end-of-request close runs on a
different thread and would not reach it. The pool bounds how many requests
touch the database at once, as Node's pool does.
"""

from __future__ import annotations

from typing import Any

from asgiref.sync import sync_to_async
from django.http import HttpRequest, HttpResponse
from django.urls import re_path

from .core.pipeline import ApiView

_api_view = ApiView.as_view()


def _answer(request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
    from django.db import connection

    try:
        return _api_view(request, *args, **kwargs)
    finally:
        connection.close()


async def api_entry(request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
    return await sync_to_async(_answer, thread_sensitive=False)(request, *args, **kwargs)


urlpatterns = [re_path(r"^.*$", api_entry)]
