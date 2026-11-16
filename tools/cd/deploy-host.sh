#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run as root'; exit 1; }
source /etc/camerai/deploy.conf
: "${APP_ENV:?}" "${AWS_REGION:?}" "${RELEASE_BUCKET:?}" "${BACKUP_BUCKET:?}" "${ECR_REGISTRY:?}"
export AWS_DEFAULT_REGION="$AWS_REGION"
export AWS_PAGER=''
release=${1:?release ID required}
mode=${2:-apply}
[[ $release =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]] || exit 2
[[ $mode == apply || $mode == rollback ]] || exit 2
[[ $APP_ENV == staging || $APP_ENV == production ]] || exit 2
exec 9>/opt/camerai/deploy.lock
flock -n 9 || { echo 'Another deploy is running'; exit 3; }
root=/opt/camerai
candidate="$root/releases/$release"
previous=$(readlink -f "$root/current" || true)

dc() {
  local directory=$1
  shift
  APP_ENV="$APP_ENV" RUNTIME_ENV_FILE="$directory/runtime.env" \
    docker compose --project-name "camerai-$APP_ENV" \
    --env-file "$directory/runtime.env" --env-file "$directory/release.env" \
    -f "$directory/deploy/compose.yml" "$@"
}

smoke() {
  local directory=$1
  dc "$directory" exec -T web node --input-type=module -e '
    const r = await fetch("http://orchestrator:3001/api/v1/health");
    if (!r.ok || (await r.json()).version !== process.argv[1]) process.exit(1);
  ' "$(basename "$directory")"
  dc "$directory" exec -T web node --input-type=module -e '
    const r = await fetch("http://orchestrator:3001/api/v1/auth/config");
    if (!r.ok || !["jwt", "cognito"].includes((await r.json()).provider)) process.exit(1);
  '
}

if [[ $mode == apply ]]; then
  [[ ! -e $candidate ]] || { echo 'Release directory exists; inspect prior attempt'; exit 4; }
  install -d -m 700 "$candidate"
  aws s3 cp "s3://$RELEASE_BUCKET/releases/$release/bundle.tgz" "$candidate/bundle.tgz"
  aws s3 cp "s3://$RELEASE_BUCKET/releases/$release/bundle.sha256" "$candidate/bundle.sha256"
  (cd "$candidate" && sha256sum -c bundle.sha256 && tar -xzf bundle.tgz)
  aws ssm get-parameter --name "/camerai/$APP_ENV/runtime-env" --with-decryption \
    --query Parameter.Value --output text > "$candidate/runtime.env"
  chmod 600 "$candidate/runtime.env"
else
  [[ -f $candidate/succeeded && -f $candidate/runtime.env ]] || {
    echo 'Rollback target must be a previously successful retained release'; exit 4;
  }
fi

aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"
dc "$candidate" config --quiet
dc "$candidate" pull orchestrator web

if [[ $mode == apply ]]; then
  if [[ ! -f $root/bootstrapped ]]; then
    dc "$candidate" up -d --wait --wait-timeout 180 postgres redis caddy
    touch "$root/bootstrapped"
  fi
  dc "$candidate" exec -T postgres sh -c \
    'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
    > "$root/backups/$release.dump"
  aws s3 cp "$root/backups/$release.dump" \
    "s3://$BACKUP_BUCKET/$APP_ENV/$release.dump"
  dc "$candidate" run --rm --no-deps migrate
fi

if dc "$candidate" up -d --no-deps --wait --wait-timeout 240 orchestrator web caddy \
  && smoke "$candidate"; then
  ln -sfn "$candidate" "$root/current"
  touch "$candidate/succeeded"
  echo "SUCCESS $APP_ENV $release ($mode)"
else
  echo "FAILED $APP_ENV $release ($mode)"
  if [[ $mode == apply && -n $previous && -f $previous/succeeded ]]; then
    echo 'Restoring previous application release; database is unchanged'
    dc "$previous" up -d --no-deps --wait --wait-timeout 240 orchestrator web caddy
    smoke "$previous"
  fi
  exit 1
fi
