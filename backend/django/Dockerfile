# The Django API (docs/django-migration/deployment.md).
#
#   docker build -t medlivebd-api-django backend/django
#
# Built from backend/django alone: the API reads nothing outside it. The
# schema is not applied from here; the database's migrations stay the SQL
# ledger in database/migrations, applied by the `migrate` service of
# deploy/docker-compose.yml, which this image does not replace.

FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DJANGO_SETTINGS_MODULE=medlive.settings

WORKDIR /app

# The pinned set, so an image built next month runs what was tested.
COPY requirements.lock.txt ./
RUN pip install -r requirements.lock.txt

COPY manage.py ./
COPY medlive ./medlive

# The uploaded files (`STORAGE_DIR`), owned by the user the API runs as, so
# the volume mounted over it is created with that owner.
RUN useradd --system --uid 10001 --home /app medlive \
    && mkdir -p /data/files \
    && chown medlive:medlive /data/files
USER medlive

EXPOSE 4000

# Readiness, not liveness: `/healthz` answers while the process is up, and a
# container that cannot reach its database would be called healthy. What
# `docker compose ps` shows, and what the web apps and web server wait for.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:4000/readyz', timeout=4).status == 200 else 1)"

# uvicorn itself is the first process, so `docker stop`'s SIGTERM reaches the
# server and a tap in flight is finished, not cut off (FR-QUE-51).
# `--no-proxy-headers`: the client address is decided by TRUST_PROXY_HOPS in
# the pipeline, as Express's `trust proxy` decided it.
CMD ["uvicorn", "medlive.asgi:application", "--host", "0.0.0.0", "--port", "4000", "--no-proxy-headers", "--timeout-graceful-shutdown", "20"]
