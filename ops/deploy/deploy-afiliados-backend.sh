#!/usr/bin/env bash

set -Eeuo pipefail

APP_ROOT="/home/netbox/afiliados-backend"
RELEASES_DIR="$APP_ROOT/releases"
CURRENT_LINK="$APP_ROOT/current"
REPO_URL="https://github.com/matheuslufano/afiliados_backend.git"
CONTAINER_NAME="afiliados-backend"
NETWORK_NAME="afiliados-net"
LOCK_FILE="$APP_ROOT/deploy.lock"

export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DOCKER_HOST="unix://$XDG_RUNTIME_DIR/docker.sock"

mkdir -p "$RELEASES_DIR"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Outro deploy do backend ja esta em andamento."
  exit 0
fi

remote_sha="$(git ls-remote "$REPO_URL" refs/heads/main | awk '{print $1}')"
if [ -z "$remote_sha" ]; then
  echo "Nao foi possivel consultar o commit atual da branch main."
  exit 1
fi

if [[ ! "$remote_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "O GitHub retornou um identificador de commit invalido."
  exit 1
fi

current_release="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
current_sha=""
if [ -n "$current_release" ] && [ -d "$current_release/.git" ]; then
  current_sha="$(git -C "$current_release" rev-parse HEAD 2>/dev/null || true)"
fi

if [ "$remote_sha" = "$current_sha" ]; then
  if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1 \
    && curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1; then
    echo "Backend ja esta atualizado em $remote_sha."
    exit 0
  fi

  echo "Commit atual ja esta implantado, mas o backend nao esta saudavel."
  docker restart "$CONTAINER_NAME"

  for attempt in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1; then
      echo "Backend reiniciado com sucesso em $remote_sha."
      exit 0
    fi
    sleep 2
  done

  docker logs --tail 100 "$CONTAINER_NAME" 2>&1 || true
  exit 1
fi

release="$RELEASES_DIR/$remote_sha"
image="afiliados-backend:$remote_sha"

echo "Iniciando deploy do commit $remote_sha."

# A VM usa Docker rootless sob uma cota de 5 GB.
docker builder prune --all --force

rm -rf "$release"
for attempt in 1 2 3; do
  if git clone --depth 1 --branch main "$REPO_URL" "$release"; then
    break
  fi

  rm -rf "$release"
  if [ "$attempt" -eq 3 ]; then
    echo "Falha ao clonar o repositorio apos 3 tentativas."
    exit 1
  fi

  sleep 10
done

runtime_env="$CURRENT_LINK/.env.docker.runtime"
if [ ! -f "$runtime_env" ] && [ -f "$APP_ROOT/.env.docker.runtime" ]; then
  runtime_env="$APP_ROOT/.env.docker.runtime"
fi

if [ ! -f "$runtime_env" ]; then
  echo "Arquivo de ambiente .env.docker.runtime nao encontrado."
  exit 1
fi

cp "$runtime_env" "$release/.env.docker.runtime"
docker build -t "$image" "$release"

previous_image="$(
  docker inspect "$CONTAINER_NAME" --format '{{.Config.Image}}' 2>/dev/null \
    || true
)"
previous_release="$current_release"

rollback() {
  echo "Novo backend nao ficou saudavel; restaurando a versao anterior."
  docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true

  if [ -n "$previous_image" ] \
    && [ -n "$previous_release" ] \
    && [ -f "$previous_release/.env.docker.runtime" ]; then
    docker run -d \
      --name "$CONTAINER_NAME" \
      --restart unless-stopped \
      --network "$NETWORK_NAME" \
      --env-file "$previous_release/.env.docker.runtime" \
      -p 3001:3001 \
      "$previous_image"
    ln -sfn "$previous_release" "$CURRENT_LINK"
  fi

  exit 1
}

docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true

if ! docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --network "$NETWORK_NAME" \
  --env-file "$release/.env.docker.runtime" \
  -p 3001:3001 \
  "$image"; then
  rollback
fi

ln -sfn "$release" "$CURRENT_LINK"

healthy=false
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 2
done

if [ "$healthy" != "true" ]; then
  docker logs --tail 100 "$CONTAINER_NAME" 2>&1 || true
  rollback
fi

mapfile -t backend_images < <(
  docker images afiliados-backend --format '{{.Repository}}:{{.Tag}}'
)
for index in "${!backend_images[@]}"; do
  if [ "$index" -ge 3 ]; then
    docker image rm "${backend_images[$index]}" >/dev/null 2>&1 || true
  fi
done

mapfile -t old_releases < <(ls -1dt "$RELEASES_DIR"/* 2>/dev/null | tail -n +6)
if [ "${#old_releases[@]}" -gt 0 ]; then
  rm -rf -- "${old_releases[@]}"
fi

echo "Deploy do commit $remote_sha concluido com sucesso."
