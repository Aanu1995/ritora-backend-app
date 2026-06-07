# Workers Production Deployment

Ritora production workers run on the `ritoraWorkers` Hetzner VPS as one systemd
service. The service starts the compiled worker runner:

```bash
node dist/scripts/start-workers.js
```

That runner starts:

- account deletion worker
- account monitoring worker
- Skin Journal analysis worker
- Skin Journal insight worker
- Smart Picks generation worker
- ingredient product analysis worker

## Server Setup

Run once on `ritoraWorkers` as `root`.

```bash
apt update && apt upgrade -y
apt install -y git curl build-essential ca-certificates postgresql-client
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

adduser --disabled-password --gecos "" deploy
mkdir -p /opt/ritora/workers/releases /etc/ritora
chown -R deploy:deploy /opt/ritora/workers
```

Copy the service file to systemd:

```bash
cp deploy/ritora-workers.service /etc/systemd/system/ritora-workers.service
systemctl daemon-reload
systemctl enable ritora-workers
```

Allow the deploy user to restart only this service:

```bash
cat >/etc/sudoers.d/ritora-workers-deploy <<'EOF'
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart ritora-workers, /usr/bin/systemctl is-active --quiet ritora-workers, /usr/bin/systemctl status ritora-workers
EOF
chmod 440 /etc/sudoers.d/ritora-workers-deploy
visudo -c
```

Create `/etc/ritora/workers.env`. It can mostly mirror
`/etc/ritora/backend.env`, including database, AWS, SQS, OpenAI, Resend, JWT,
media, encryption, legal, and queue settings.

```bash
nano /etc/ritora/workers.env
chown root:deploy /etc/ritora/workers.env
chmod 640 /etc/ritora/workers.env
```

At minimum, keep these values aligned with backend production:

```env
NODE_ENV=production
DATABASE_HOST=10.10.0.5
DATABASE_PORT=5432
DATABASE_NAME=ritora
DATABASE_USER=ritora
DATABASE_PASSWORD=...
DATABASE_SSL=false
DATABASE_SSL_REJECT_UNAUTHORIZED=false
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=eu-north-1
```

## GitHub Secrets

Add these secrets to the backend repository production environment:

```text
HETZNER_WORKERS_HOST
HETZNER_WORKERS_USER
HETZNER_WORKERS_SSH_KEY
```

`HETZNER_WORKERS_USER` can be `deploy`.

The public half of `HETZNER_WORKERS_SSH_KEY` must be in:

```text
/home/deploy/.ssh/authorized_keys
```
