#!/usr/bin/env bash
set -Eeuo pipefail

configuration=${BREAKROOM_BACKUP_CONFIG:-/etc/breakroom/backup.env}
[[ -r ${configuration} ]] || exit 0
# shellcheck disable=SC1090
source "${configuration}"

data_root=${DATA_ROOT:-/srv/breakroom}
runtime=${data_root}/runtime
notification_topic=${OCI_NOTIFICATION_TOPIC_ID:-}
oci_cli=${OCI_CLI:-/usr/local/bin/oci}
install -d -m 0750 "${runtime}"

notify() {
  local title=$1 body=$2
  if [[ -n ${notification_topic:-} && -n ${OCI_REGION:-} ]]; then
    "${oci_cli}" ons message publish --auth instance_principal --region "${OCI_REGION}" \
      --topic-id "${notification_topic}" --title "${title}" --body "${body}" >/dev/null || true
  else
    logger -t breakroom-monitor "${title}: ${body}"
  fi
}

issues=()
if ! health=$(curl --silent --show-error --fail --max-time 4 http://127.0.0.1:3001/health 2>/dev/null); then
  issues+=('application health check failed')
elif [[ $(jq -r '.ok' <<<"${health}") != true ]]; then
  issues+=('application reports unhealthy')
fi

disk_use=$(df -P "${data_root}" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')
if [[ ${disk_use:-100} -ge 80 ]]; then
  issues+=("data volume is ${disk_use:-unknown}% full")
fi

if [[ -r ${runtime}/last-backup ]]; then
  last_backup=$(<"${runtime}/last-backup")
  if (( $(date -u +%s) - last_backup > 108000 )); then
    issues+=('latest successful object backup is older than 30 hours')
  fi
else
  issues+=('no successful object backup has been recorded')
fi

state=healthy
if (( ${#issues[@]} > 0 )); then state=$(IFS='; '; echo "${issues[*]}"); fi
previous_state=
if [[ -r ${runtime}/monitor-state ]]; then previous_state=$(<"${runtime}/monitor-state"); fi
if [[ ${state} != "${previous_state}" ]]; then
  if [[ ${state} == healthy ]]; then
    notify 'Breakroom recovered' 'The Oracle host, application, disk, and backup checks are healthy.'
  else
    notify 'Breakroom needs attention' "${state}"
  fi
  printf '%s\n' "${state}" > "${runtime}/monitor-state"
  chmod 0640 "${runtime}/monitor-state"
fi

public_url=$(/usr/local/sbin/breakroom-show-url 2>/dev/null || true)
previous_url=
if [[ -r ${runtime}/public-url ]]; then previous_url=$(<"${runtime}/public-url"); fi
if [[ -n ${public_url} && ${public_url} != "${previous_url}" ]]; then
  printf '%s\n' "${public_url}" > "${runtime}/public-url"
  chmod 0640 "${runtime}/public-url"
  notify 'Breakroom public URL changed' "The current temporary game URL is ${public_url}"
fi
