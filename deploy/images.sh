#!/bin/sh
# Images built somewhere else, so an update does not build on the server
# (DEPLOY.md §S4; MARKS readiness, C "pre-built images").
#
# `up -d --build` on the server compiles the API and both web apps while the
# old containers wait, and a small server is slow at it and short of memory
# while it does. Built on any other machine with Docker instead, the server
# only loads them and restarts: the API is away for as long as the migrations
# and its start take, which is seconds.
#
# On the build machine, from the repository root, at the commit to deploy,
# with a copy of the server's deploy/.env (the web apps bake API_ORIGIN and
# PLATFORM_DOMAIN in; nothing secret is built into any image):
#
#   sh deploy/images.sh build deploy/.env medlivebd-images.tar.gz
#
# writes the archive, a .sha256 beside it, and a .commit naming the commit.
# Copy all three to the server (scp), then on the server, at the same commit:
#
#   sh deploy/images.sh install medlivebd-images.tar.gz deploy/.env
#
# which checks the archive, refuses it if it was built from another commit
# than the one checked out here (the compose file and the backup scripts come
# from the checkout, the code from the images, and they must agree), loads it
# and starts the stack without building anything.

set -eu

COMPOSE_FILE="$(dirname "$0")/docker-compose.yml"
IMAGES="medlivebd-api medlivebd-console medlivebd-patient"

usage() {
  echo "usage: images.sh build <env-file> <out.tar.gz>" >&2
  echo "       images.sh install <archive.tar.gz> <env-file>" >&2
  exit 1
}

head_commit() {
  git -C "$(dirname "$0")" rev-parse HEAD 2>/dev/null || echo unknown
}

build() {
  env_file="$1"
  out="$2"
  [ -f "$env_file" ] || { echo "no such env file: $env_file" >&2; exit 1; }
  if [ -n "$(git -C "$(dirname "$0")" status --porcelain 2>/dev/null)" ]; then
    echo "the checkout has uncommitted changes; build from a commit, so the server can check it has the same one" >&2
    exit 1
  fi
  # The servers are x86-64; a build on an ARM laptop would not run there.
  DOCKER_DEFAULT_PLATFORM="${DOCKER_DEFAULT_PLATFORM:-linux/amd64}" \
    docker compose -f "$COMPOSE_FILE" --env-file "$env_file" build migrate console patient
  # shellcheck disable=SC2086 # three names, split on purpose
  docker save $IMAGES | gzip > "$out.partial"
  mv "$out.partial" "$out"
  head_commit > "$out.commit"
  (cd "$(dirname "$out")" && sha256sum "$(basename "$out")" > "$(basename "$out").sha256")
  echo "built $out from $(cat "$out.commit"); copy it, $out.sha256 and $out.commit to the server"
}

install() {
  archive="$1"
  env_file="$2"
  [ -f "$archive" ] || { echo "no such archive: $archive" >&2; exit 1; }
  [ -f "$env_file" ] || { echo "no such env file: $env_file" >&2; exit 1; }
  [ -f "$archive.sha256" ] || { echo "$archive.sha256 is missing: copy it with the archive" >&2; exit 1; }
  (cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256" > /dev/null) \
    || { echo "$archive does not match its checksum: copy it again" >&2; exit 1; }

  built_from="$(cat "$archive.commit" 2>/dev/null || echo unknown)"
  here="$(head_commit)"
  if [ "$built_from" != "$here" ]; then
    echo "the images were built from $built_from, and this checkout is at $here." >&2
    echo "check out $built_from here first (git fetch && git checkout $built_from)." >&2
    exit 1
  fi

  gunzip -c "$archive" | docker load
  docker compose -f "$COMPOSE_FILE" --env-file "$env_file" up -d --no-build
  echo "installed the images of $here; 'docker compose ... ps' shows each service's health"
}

case "${1:-}" in
  build) [ $# -eq 3 ] || usage; build "$2" "$3" ;;
  install) [ $# -eq 3 ] || usage; install "$2" "$3" ;;
  *) usage ;;
esac
