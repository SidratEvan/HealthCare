# syntax=docker/dockerfile:1
#
# MedLiveBD — every service from one image definition (pilot step 26,
# `FR-SEC-07`: a hospital's own server in Bangladesh). `deploy/docker-compose.yml`
# builds three targets from it:
#
#   api       the API, the realtime socket and the hourly jobs, compiled to
#             JavaScript in an image with production dependencies only (plan
#             I1); also runs the one-shot `pnpm db:migrate && pnpm db:role`
#             before the API starts
#   console   the staff console (Next.js)
#   patient   the patient app (Next.js)
#
# The web apps bake their API address in at build time (`NEXT_PUBLIC_*`), so
# those two targets take it as build arguments; a changed domain is a rebuild.
#
# None of the three runs as root (plan 1.7). The image is built as root and
# handed to `node`, the unprivileged account the base image ships: the code is
# readable and not writable, and only the folders a service must write to are
# its own — the uploaded files, and Next's cache.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    # Where corepack keeps the pnpm it fetched. Its default is the home folder
    # of whoever ran it — root's, at build time — and the account the services
    # run as would look in its own, find nothing, and try to download pnpm
    # again on every start.
    COREPACK_HOME=/corepack
RUN corepack enable
WORKDIR /app

# --- the workspace, installed once ---------------------------------------------
FROM base AS deps
COPY . .
RUN pnpm install --frozen-lockfile \
    && chown -R node:node /corepack
# The dependencies were installed and checked against the lockfile when this
# image was built. Left on, pnpm checks them again before every `pnpm run` —
# and to do it re-marks files in node_modules, which the account the services
# run as does not own and may not touch: the first start as that account
# stopped here, before a single migration ran.
ENV pnpm_config_verify_deps_before_run=false

# --- the API, compiled -----------------------------------------------------------
#
# TypeScript to JavaScript, for the API and the two shared packages it reads
# (plan I1). Done here, where the whole workspace and its tools are installed,
# and then left behind: the image that runs carries the output and none of
# what made it.
FROM deps AS api-build
RUN pnpm build:api

# --- the API -------------------------------------------------------------------
#
# From `base`, not from `deps`: no compiler, no test runner, no linter, no
# browser driver and neither web app's framework. Only what the API and the
# database scripts are run with (`--prod`, and only those two packages and
# what they depend on).
#
# The server runs as compiled JavaScript (`start:compiled`). What runs once
# and exits still runs from source through `tsx`, which is a dependency of the
# two packages for that reason: the migrations and the API's role before the
# server starts (`pnpm db:migrate && pnpm db:role`), and the commands an
# operator types (`pnpm staff:create`, DEPLOY.md S3). A second or two of
# start-up matters to none of them, and they keep one name on a laptop and on
# a hospital's server.
FROM base AS api
ENV NODE_ENV=production \
    pnpm_config_verify_deps_before_run=false
COPY . .
RUN pnpm install --frozen-lockfile --prod \
      --filter "@platform/api..." --filter "@platform/database..." \
    && chown -R node:node /corepack
COPY --from=api-build /app/shared/domain/dist shared/domain/dist
COPY --from=api-build /app/shared/i18n/dist shared/i18n/dist
COPY --from=api-build /app/backend/api/dist backend/api/dist
# The uploaded files (`STORAGE_DIR`). Owned here so that the volume mounted
# over it is created with the same owner; a volume made by an earlier,
# root-run version needs handing over once (DEPLOY.md §S4).
RUN mkdir -p /data/files && chown node:node /data/files
USER node
EXPOSE 4000
# Readiness, not liveness: `/healthz` answers as long as the process is up,
# and a container that cannot reach its database would be reported healthy.
# Nothing restarts on this — it is what `docker compose ps` shows, and what the
# web apps and the web server wait for before they start.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# `node` itself, not `pnpm start:compiled`: the first process in a container
# is the one `docker stop` signals. Under pnpm, pnpm took the SIGTERM and went,
# and the server was killed behind it without running its shutdown, so a tap
# in flight was cut off instead of finished (`server.ts`, FR-QUE-51). The same
# command as `start:compiled`. The working folder stays /app, where the
# `migrate` service's and an operator's `pnpm` commands are run from.
CMD ["node", "--conditions=compiled", "backend/api/dist/server.js"]

# --- the web apps ----------------------------------------------------------------
FROM deps AS web
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SOCKET_URL
# The platform's own domain, when it has one: the patient app reads a
# hospital's portal address with it (FR-BRD-07). Empty is the ordinary state.
ARG NEXT_PUBLIC_PLATFORM_DOMAIN=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL \
    NEXT_PUBLIC_PLATFORM_DOMAIN=$NEXT_PUBLIC_PLATFORM_DOMAIN

FROM web AS console
RUN pnpm --filter @platform/console build \
    && chown -R node:node frontend/console/.next
ENV NODE_ENV=production
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@platform/console", "start"]

FROM web AS patient
RUN pnpm --filter @platform/patient build \
    && chown -R node:node frontend/patient/.next
ENV NODE_ENV=production
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@platform/patient", "start"]
