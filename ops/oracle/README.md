# Oracle Always Free deployment

This deployment runs the existing application as one ARM64-compatible container with SQLite on a detachable block volume. A Cloudflare Quick Tunnel supplies HTTPS and WebSocket access without opening a public application port.

Quick Tunnels are an evaluation mechanism: the `trycloudflare.com` address changes when `cloudflared` or the VM restarts, Cloudflare offers no uptime guarantee, and the service has a 200 in-flight request ceiling. Application-only releases preserve the running tunnel. A later named Tunnel can replace this one without changing the app or its data.

## 1. Create the Oracle resources

In the tenancy home region, create a `breakroom-prod` compartment and the following Always Free Eligible resources:

1. An Ubuntu 24.04 ARM64 `VM.Standard.A1.Flex` instance with 2 OCPUs, 12 GB RAM, and the default approximately 50 GB boot volume.
2. A 50 GB block volume attached to the instance. Do not place application data on the boot volume.
3. A private Standard-tier Object Storage bucket named `breakroom-backups`. Add a lifecycle rule that deletes objects after eight days.
4. An OCI Notifications topic with an email subscription for the administrator.
5. A weekly scheduled backup policy on the 50 GB data volume, retaining four backups.
6. A $1 monthly budget alert. Do not permit scripts or operators to substitute a paid compute shape automatically.

The network security group should allow TCP 22 only from the administrator's current public CIDR. Do not add ingress rules for 80, 443, or 3001. The bootstrap script applies the same rule with UFW.

After the instance exists, create a dynamic group matching its instance OCID. Grant only these capabilities in the production compartment, narrowing the object rule to the backup bucket and the notification rule to its topic where the tenancy policy editor supports conditions:

```text
Allow dynamic-group BreakroomBackupHost to {OBJECT_CREATE, OBJECT_INSPECT} in compartment breakroom-prod where target.bucket.name='breakroom-backups'
Allow dynamic-group BreakroomBackupHost to use ons-topics in compartment breakroom-prod
```

The VM cannot read, overwrite, or delete uploaded backups. Restores use an administrator OCI identity. The bucket lifecycle service expires old objects.

## 2. Prepare secrets and the host

Create the `age` recovery identity on a trusted workstation, not on the Oracle VM:

```bash
age-keygen -o breakroom-backup.agekey
```

Keep that private file offline and copy only the printed `age1...` recipient to the VM configuration. Losing it makes the encrypted Object Storage backups unreadable.

Attach the data volume, verify its exact device using `lsblk -f`, clone this repository onto the VM, and run the provisioner. `FORMAT_DATA_VOLUME=yes` deliberately authorizes formatting only the explicit device argument:

```bash
sudo FORMAT_DATA_VOLUME=yes ./ops/oracle/provision.sh /dev/oracleoci/oraclevdb YOUR.PUBLIC.IP/32
```

Before creating any player profiles, securely copy `/etc/breakroom/passport-master-key` to an offline password manager or encrypted archive. This key is independent from the `age` identity and is required to resume encrypted player passports after a restore.

Edit `/etc/breakroom/backup.env` and set the OCI home region, bucket, notification topic OCID, and `age` recipient. Edit `/opt/breakroom/.env.production` to replace the GitHub owner; `breakroom-deploy` will insert the image digest and version.

## 3. Build and deploy

Push the project to a GitHub repository. The `Verify and publish` workflow runs lint, type checking, unit tests, Chromium E2E tests, and a production build before publishing an ARM64/AMD64 image with provenance and an SBOM. Copy the immutable `ghcr.io/...@sha256:...` value from the workflow summary.

For a private package, create a GitHub token with only `read:packages` and log the root Docker client into GHCR:

```bash
printf '%s' "$GHCR_READ_TOKEN" | sudo docker login ghcr.io --username YOUR_GITHUB_USER --password-stdin
```

Remove the token from the shell afterward. Deploy the exact digest:

```bash
sudo breakroom-deploy ghcr.io/YOUR_GITHUB_OWNER/YOUR_REPOSITORY@sha256:DIGEST GIT_SHORT_SHA
```

The deployer refuses to replace the application while rooms exist. `--force` is available for urgent security work and sends connected clients a maintenance warning. A failed health check restores the prior digest. The current public URL is printed after deployment and can be retrieved later with:

```bash
sudo breakroom-show-url
```

The monitoring timer emails a new address whenever the Quick Tunnel restarts. Confirm the timers and containers:

```bash
systemctl list-timers 'breakroom-*'
sudo docker compose --env-file /opt/breakroom/.env.production -f /opt/breakroom/compose.production.yaml ps
curl --fail http://127.0.0.1:3001/health
```

## 4. Verify and restore backups

Run and inspect the first backup before inviting users:

```bash
sudo systemctl start breakroom-backup.service
sudo journalctl -u breakroom-backup.service --no-pager
```

Once a month, download one `.age` object and its `.sha256` companion to a trusted workstation. Verify and decrypt it there:

```bash
sha256sum --check breakroom-TIMESTAMP.sqlite.zst.age.sha256
age --decrypt --identity breakroom-backup.agekey --output breakroom-restored.sqlite.zst breakroom-TIMESTAMP.sqlite.zst.age
zstd --decompress breakroom-restored.sqlite.zst --output breakroom-restored.sqlite
sqlite3 breakroom-restored.sqlite 'PRAGMA integrity_check;'
```

For a real restore, stop `breakroom-compose.service`, preserve the current `/srv/breakroom/data` directory, install the verified database as `/srv/breakroom/data/breakroom.sqlite` owned by UID/GID 1000, restore the matching passport master key, and start the service. Do not copy live SQLite WAL/SHM files or overwrite the only current database without first preserving it.

## Capacity acceptance

Before announcing the preview, run 20 clients in 10 rooms for 30 minutes with aim presence and staggered shots. The acceptance target is no server errors or disconnects, p95 non-shot acknowledgements below 500 ms, p95 authoritative shot processing below two seconds, memory below 8 GB, and responsive health checks. If the VM misses those targets, reduce the advertised room cap rather than weakening authoritative simulation.
