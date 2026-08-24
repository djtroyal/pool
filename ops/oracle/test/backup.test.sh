#!/usr/bin/env bash
set -Eeuo pipefail

test_dir=$(mktemp -d /tmp/breakroom-backup-test.XXXXXX)
cleanup() { rm -rf -- "${test_dir}"; }
trap cleanup EXIT

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
data_root=${test_dir}/data-root
install -d "${data_root}/data" "${test_dir}/uploads"
sqlite3 "${data_root}/data/breakroom.sqlite" "CREATE TABLE verification(value TEXT NOT NULL); INSERT INTO verification VALUES ('ready');"
printf '%s\n' \
  'OCI_REGION=us-test-1' \
  'OCI_BUCKET_NAME=breakroom-test' \
  'OCI_NOTIFICATION_TOPIC_ID=' \
  'AGE_RECIPIENT=age1testrecipient' \
  "DATA_ROOT=${data_root}" \
  "OCI_CLI=${script_dir}/bin/oci" > "${test_dir}/backup.env"

PATH="${script_dir}/bin:${PATH}" \
FAKE_OCI_UPLOADS="${test_dir}/uploads" \
BREAKROOM_BACKUP_CONFIG="${test_dir}/backup.env" \
  "${script_dir}/../backup.sh" >/dev/null

[[ -s ${data_root}/runtime/last-backup ]]
[[ $(find "${test_dir}/uploads" -maxdepth 1 -type f | wc -l) -eq 2 ]]
checksum=$(find "${test_dir}/uploads" -name '*.sha256' -type f -print -quit)
encrypted=$(find "${test_dir}/uploads" -name '*.age' -type f -print -quit)
(
  cd "${test_dir}/uploads"
  sha256sum --check "$(basename "${checksum}")" >/dev/null
)
[[ -s ${encrypted} ]]
printf 'oracle_backup_test=passed\n'
