# syntax=docker/dockerfile:1
#
# HealthWealthBD — every service from one image definition (pilot step 26,
# `FR-SEC-07`: a hospital's own server in Bangladesh). `deploy/docker-compose.yml`
# builds three targets from it:
#
#   api       the API, the realtime socket and the hourly jobs; also runs the
#             one-shot `pnpm db:migrate` before the API starts
#   console   the staff console (Next.js)
#   patient   the patient app (Next.js)
#
# The web apps bake their API address in at build time (`NEXT_PUBLIC_*`), so
# those two targets take it as build arguments; a changed domain is a rebuild.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# --- the workspace, installed once ---------------------------------------------
FROM base AS deps
COPY . .
RUN pnpm install --frozen-lockfile

# --- the API -------------------------------------------------------------------
FROM deps AS api
ENV NODE_ENV=production
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@platform/api", "start"]

# --- the web apps ----------------------------------------------------------------
FROM deps AS web
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SOCKET_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL

FROM web AS console
RUN pnpm --filter @platform/console build
ENV NODE_ENV=production
EXPOSE 3100
CMD ["pnpm", "--filter", "@platform/console", "start"]

FROM web AS patient
RUN pnpm --filter @platform/patient build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@platform/patient", "start"]
