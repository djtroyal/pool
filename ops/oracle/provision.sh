#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo 'Run this script with sudo.' >&2
  exit 1
fi
if [[ $# -ne 2 ]]; then
  echo 'Usage: sudo FORMAT_DATA_VOLUME=yes ./ops/oracle/provision.sh /dev/oracleoci/oraclevdb ADMIN_IP/32' >&2
  exit 1
fi

data_device=$1
ssh_cidr=$2
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repository_root=$(cd -- "${script_dir}/../.." && pwd)

python3 -c 'import ipaddress,sys; ipaddress.ip_network(sys.argv[1], strict=False)' "${ssh_cidr}"
if [[ ! -b ${data_device} ]]; then
  echo "${data_device} is not a block device. Attach the OCI data volume and use its explicit device path." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y age ca-certificates curl docker-compose-v2 docker.io jq openssl python3-venv sqlite3 ufw unattended-upgrades zstd
systemctl enable --now docker
systemctl enable --now unattended-upgrades

if [[ ! -x /opt/oci-cli/bin/oci ]]; then
  python3 -m venv /opt/oci-cli
  /opt/oci-cli/bin/pip install --upgrade pip oci-cli
fi
ln -sfn /opt/oci-cli/bin/oci /usr/local/bin/oci

filesystem_type=$(blkid -s TYPE -o value "${data_device}" || true)
if [[ -z ${filesystem_type} ]]; then
  if [[ ${FORMAT_DATA_VOLUME:-no} != yes ]]; then
    echo "${data_device} has no filesystem. Re-run with FORMAT_DATA_VOLUME=yes only after verifying this is the empty Breakroom data volume." >&2
    exit 1
  fi
  mkfs.ext4 -L breakroom-data "${data_device}"
  filesystem_type=ext4
fi
if [[ ${filesystem_type} != ext4 ]]; then
  echo "Expected ext4 on ${data_device}; found ${filesystem_type}." >&2
  exit 1
fi

install -d -m 0755 /srv/breakroom
volume_uuid=$(blkid -s UUID -o value "${data_device}")
fstab_entry="UUID=${volume_uuid} /srv/breakroom ext4 defaults,nofail 0 2"
if ! grep -q "UUID=${volume_uuid}" /etc/fstab; then
  printf '%s\n' "${fstab_entry}" >> /etc/fstab
fi
mountpoint -q /srv/breakroom || mount /srv/breakroom
install -d -o 1000 -g 1000 -m 0750 /srv/breakroom/data
install -d -o root -g root -m 0750 /srv/breakroom/runtime /srv/breakroom/backup-staging

install -d -o root -g root -m 0755 /opt/breakroom
install -o root -g root -m 0644 "${repository_root}/compose.production.yaml" /opt/breakroom/compose.production.yaml
if [[ ! -e /opt/breakroom/.env.production ]]; then
  install -o root -g root -m 0600 "${repository_root}/.env.production.example" /opt/breakroom/.env.production
fi

install -d -o root -g root -m 0750 /etc/breakroom
if [[ ! -s /etc/breakroom/passport-master-key ]]; then
  openssl rand -base64 -out /etc/breakroom/passport-master-key 48
fi
chown root:1000 /etc/breakroom/passport-master-key
chmod 0640 /etc/breakroom/passport-master-key
if [[ ! -e /etc/breakroom/backup.env ]]; then
  install -o root -g root -m 0600 "${script_dir}/backup.env.example" /etc/breakroom/backup.env
fi

for utility in breakroom-backup breakroom-deploy breakroom-monitor breakroom-show-url; do
  source_file="${script_dir}/${utility#breakroom-}.sh"
  install -o root -g root -m 0755 "${source_file}" "/usr/local/sbin/${utility}"
done
for unit in breakroom-compose.service breakroom-backup.service breakroom-backup.timer breakroom-monitor.service breakroom-monitor.timer; do
  install -o root -g root -m 0644 "${script_dir}/systemd/${unit}" "/etc/systemd/system/${unit}"
done
install -o root -g root -m 0644 "${script_dir}/sshd-breakroom.conf" /etc/ssh/sshd_config.d/99-breakroom.conf
sshd -t
systemctl reload ssh

ufw default deny incoming
ufw default allow outgoing
ufw allow from "${ssh_cidr}" to any port 22 proto tcp
ufw --force enable

systemctl daemon-reload
echo 'Provisioning complete.'
echo 'Next: edit /opt/breakroom/.env.production and /etc/breakroom/backup.env, log in to GHCR, then run breakroom-deploy with an immutable image digest.'
echo 'Copy /etc/breakroom/passport-master-key to secure offline storage before creating player records.'
