#!/usr/bin/env bash
set -Eeuo pipefail

force=0
if [[ ${1:-} == --force ]]; then
  force=1
  shift
fi
if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo 'Usage: sudo breakroom-deploy [--force] IMAGE@sha256:DIGEST [VERSION]' >&2
  exit 1
fi

image=$1
version=${2:-sha256-${image##*@sha256:}}
version=${version:0:32}
if [[ ! ${image} =~ ^.+@sha256:[0-9a-fA-F]{64}$ ]]; then
  echo 'The image must use an immutable sha256 digest.' >&2
  exit 1
fi
if [[ ! ${version} =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo 'VERSION may contain only letters, digits, dots, underscores, and hyphens.' >&2
  exit 1
fi

compose_dir=/opt/breakroom
compose_file=${compose_dir}/compose.production.yaml
environment_file=${compose_dir}/.env.production
if [[ ! -f ${compose_file} || ! -f ${environment_file} ]]; then
  echo 'Production Compose files are not installed. Run the Oracle provisioner first.' >&2
  exit 1
fi
if [[ ! -s /etc/breakroom/passport-master-key ]]; then
  echo 'The passport master key is missing or empty.' >&2
  exit 1
fi
backup_configuration=/etc/breakroom/backup.env
if [[ ! -r ${backup_configuration} ]] \
  || grep -q 'YOUR_HOME_REGION\|REPLACE_WITH' "${backup_configuration}" \
  || ! grep -Eq '^OCI_BUCKET_NAME=.+$' "${backup_configuration}"; then
  echo "Complete ${backup_configuration} before deploying; automated backups are mandatory." >&2
  exit 1
fi

compose=(docker compose --env-file "${environment_file}" -f "${compose_file}")
health_url=http://127.0.0.1:3001/health

if health=$(curl --silent --show-error --max-time 4 "${health_url}" 2>/dev/null); then
  active_rooms=$(jq -er '.activeRooms // 0 | numbers' <<<"${health}" 2>/dev/null || echo 0)
  if (( active_rooms > 0 && force == 0 )); then
    echo "Deployment refused: ${active_rooms} room(s) are still active. Retry later or use --force." >&2
    exit 2
  fi
fi

read_value() {
  local key=$1
  sed -n "s/^${key}=//p" "${environment_file}" | tail -n 1
}

write_value() {
  local key=$1 value=$2 temporary
  temporary=$(mktemp "${compose_dir}/.env.production.XXXXXX")
  awk -v key="${key}" -v value="${value}" '
    BEGIN { replaced = 0 }
    $0 ~ "^" key "=" { print key "=" value; replaced = 1; next }
    { print }
    END { if (!replaced) print key "=" value }
  ' "${environment_file}" > "${temporary}"
  chmod 0600 "${temporary}"
  mv "${temporary}" "${environment_file}"
}

previous_image=$(read_value APP_IMAGE)
previous_version=$(read_value APP_VERSION)
write_value APP_IMAGE "${image}"
write_value APP_VERSION "${version}"

rollback() {
  if [[ -n ${previous_image} && ${previous_image} =~ @sha256:[0-9a-fA-F]{64}$ ]]; then
    echo "Rolling back to ${previous_image}." >&2
    write_value APP_IMAGE "${previous_image}"
    write_value APP_VERSION "${previous_version:-rollback}"
    "${compose[@]}" up -d --no-deps app
  fi
}

if ! "${compose[@]}" pull app; then
  write_value APP_IMAGE "${previous_image}"
  write_value APP_VERSION "${previous_version}"
  exit 1
fi
if ! "${compose[@]}" up -d --no-deps app; then
  rollback
  exit 1
fi

healthy=0
for _attempt in $(seq 1 45); do
  if curl --silent --fail --max-time 3 "${health_url}" | jq -e '.ok == true' >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done
if (( healthy == 0 )); then
  echo 'The candidate did not become healthy.' >&2
  rollback
  exit 1
fi

if [[ -z $("${compose[@]}" ps -q cloudflared) ]]; then
  "${compose[@]}" up -d cloudflared
fi
systemctl enable breakroom-compose.service breakroom-backup.timer breakroom-monitor.timer >/dev/null
systemctl start breakroom-backup.timer breakroom-monitor.timer

echo "Deployed ${image}."
/usr/local/sbin/breakroom-show-url --wait 60 || true
