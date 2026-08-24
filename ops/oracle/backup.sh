#!/usr/bin/env bash
set -Eeuo pipefail

configuration=${BREAKROOM_BACKUP_CONFIG:-/etc/breakroom/backup.env}
if [[ ! -r ${configuration} ]]; then
  echo "Missing ${configuration}." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "${configuration}"

: "${OCI_REGION:?Set OCI_REGION in ${configuration}}"
: "${OCI_BUCKET_NAME:?Set OCI_BUCKET_NAME in ${configuration}}"
: "${AGE_RECIPIENT:?Set AGE_RECIPIENT in ${configuration}}"

data_root=${DATA_ROOT:-/srv/breakroom}
database=${data_root}/data/breakroom.sqlite
staging=${data_root}/backup-staging
runtime=${data_root}/runtime
oci_cli=${OCI_CLI:-/usr/local/bin/oci}
notification_topic=${OCI_NOTIFICATION_TOPIC_ID:-}

notify() {
  local title=$1 body=$2
  if [[ -n ${notification_topic} ]]; then
    "${oci_cli}" ons message publish --auth instance_principal --region "${OCI_REGION}" \
      --topic-id "${notification_topic}" --title "${title}" --body "${body}" >/dev/null || true
  fi
}

failure() {
  local status=$?
  notify 'Breakroom backup failed' "The Oracle host could not complete its SQLite backup. Exit status: ${status}."
  exit "${status}"
}
trap failure ERR

if [[ ! -s ${database} ]]; then
  echo "SQLite database not found at ${database}." >&2
  exit 1
fi
if [[ ! ${AGE_RECIPIENT} =~ ^age1[0-9a-z]+$ ]]; then
  echo 'AGE_RECIPIENT is not a valid age public recipient.' >&2
  exit 1
fi

install -d -m 0750 "${staging}" "${runtime}"
exec 9>"${runtime}/backup.lock"
flock -n 9 || { echo 'Another backup is already running.' >&2; exit 0; }

temporary=$(mktemp -d "${staging}/backup.XXXXXX")
cleanup() { rm -rf -- "${temporary}"; }
trap cleanup EXIT

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_name="breakroom-${timestamp}.sqlite"
backup_database="${temporary}/${backup_name}"
compressed="${backup_database}.zst"
encrypted="${compressed}.age"
checksum="${encrypted}.sha256"

sqlite3 "${database}" ".timeout 5000" ".backup '${backup_database}'"
integrity=$(sqlite3 "${backup_database}" 'PRAGMA integrity_check;')
if [[ ${integrity} != ok ]]; then
  echo "SQLite integrity check failed: ${integrity}" >&2
  exit 1
fi
zstd --quiet -6 -T1 "${backup_database}" -o "${compressed}"
age --recipient "${AGE_RECIPIENT}" --output "${encrypted}" "${compressed}"
(
  cd "${temporary}"
  sha256sum "$(basename "${encrypted}")" > "$(basename "${checksum}")"
)

object_prefix="daily/$(date -u +%Y/%m)"
"${oci_cli}" os object put --auth instance_principal --region "${OCI_REGION}" --bucket-name "${OCI_BUCKET_NAME}" \
  --name "${object_prefix}/$(basename "${encrypted}")" --file "${encrypted}" --force >/dev/null
"${oci_cli}" os object put --auth instance_principal --region "${OCI_REGION}" --bucket-name "${OCI_BUCKET_NAME}" \
  --name "${object_prefix}/$(basename "${checksum}")" --file "${checksum}" --force >/dev/null

date -u +%s > "${runtime}/last-backup"
chmod 0640 "${runtime}/last-backup"
trap - ERR
echo "Uploaded encrypted backup ${object_prefix}/$(basename "${encrypted}")."
