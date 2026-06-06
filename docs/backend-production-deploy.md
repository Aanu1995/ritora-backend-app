# Backend Production Deployment

Ritora backend production runs on the `ritoraBackend` Hetzner VPS as a systemd
service. GitHub Actions uploads each release over SSH, installs dependencies,
builds, runs migrations, and restarts the API.

## Server Setup

Run once on `ritoraBackend` as `root`.

```bash
apt update && apt upgrade -y
apt install -y git curl build-essential ca-certificates postgresql-client
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

adduser --disabled-password --gecos "" deploy
mkdir -p /opt/ritora/backend/releases /etc/ritora
chown -R deploy:deploy /opt/ritora/backend
```

Install the service:

```bash
cp /opt/ritora/backend/current/deploy/ritora-backend.service /etc/systemd/system/ritora-backend.service
systemctl daemon-reload
systemctl enable ritora-backend
```

If the repo is not on the server yet, copy `deploy/ritora-backend.service` from
your Mac or install it after the first GitHub Actions upload.

Allow the deploy user to restart only this service:

```bash
cat >/etc/sudoers.d/ritora-backend-deploy <<'EOF'
deploy ALL=(root) NOPASSWD: /bin/systemctl restart ritora-backend, /bin/systemctl is-active --quiet ritora-backend, /bin/systemctl status ritora-backend
EOF
chmod 440 /etc/sudoers.d/ritora-backend-deploy
```

Create `/etc/ritora/backend.env` with production variables. Keep permissions
tight:

```bash
nano /etc/ritora/backend.env
chown root:deploy /etc/ritora/backend.env
chmod 640 /etc/ritora/backend.env
```

For the Hetzner private database:

```env
NODE_ENV=production
API_PORT=3001
DATABASE_HOST=10.10.0.5
DATABASE_PORT=5432
DATABASE_NAME=ritora
DATABASE_USER=ritora
DATABASE_PASSWORD=...
DATABASE_SSL=false
DATABASE_SSL_REJECT_UNAUTHORIZED=false
```

## GitHub Secrets

Add these secrets to the backend repository production environment:

```text
HETZNER_BACKEND_HOST
HETZNER_BACKEND_USER
HETZNER_BACKEND_SSH_KEY
```

`HETZNER_BACKEND_USER` can be `deploy`.

The public half of `HETZNER_BACKEND_SSH_KEY` must be in:

```text
/home/deploy/.ssh/authorized_keys
```

## Caddy

Install Caddy on `ritoraBackend` and proxy the public API domain to the local
NestJS process:

```caddyfile
api.getritora.com {
  reverse_proxy 127.0.0.1:3001
}
```

Then reload:

```bash
systemctl reload caddy
```
