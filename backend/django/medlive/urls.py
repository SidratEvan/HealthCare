"""Every path goes to the pipeline, which routes it the way Express did
(`core/router.py`): one ordered table, so the order of the TypeScript routes,
and therefore which route answers an ambiguous path, is kept exactly."""

from django.urls import re_path

from .core.pipeline import ApiView

urlpatterns = [re_path(r"^.*$", ApiView.as_view())]
