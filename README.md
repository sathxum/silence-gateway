<p align="center"><img src="public/logo.png" alt="Silence Gateway logo" width="120" /></p>

# Silence Gateway — self-hosted LLM gateway (one command)

100% self-hosted gateway: app + database + auth + REST + API gateway + public
HTTPS, all inside **your own VPS**. No external SaaS. Public access works
through a **Cloudflare tunnel** — no open ports, no load balancer, no domain
needed.

## Install — one single command

Run this on a **fresh Ubuntu 22.04 / 24.04 (or Debian 12) VPS, as root**:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/sathxum/silence-gateway/main/install.sh)"
```

That's it. The installer is fully animated — it shows every step and live
download progress (Docker, Supabase images, npm packages, everything), then:

1. installs Docker + cloudflared + everything else it needs
2. pulls the latest code from this repo
3. generates all secrets (JWT keys, DB password, AES-256-GCM encryption key)
4. deploys a hardened self-hosted Supabase stack (Postgres 17 + GoTrue +
   PostgREST + nginx api-gw) — docker-network only, no host ports
5. applies the database schema (tables + row level security)
6. builds the app inside a node:22 container (locked npm versions)
7. **asks you for the admin email, then the admin password** (always, one by
   one, hidden input) — these are the credentials you'll log in with
8. starts the app, wires the Cloudflare tunnel, prints your **public HTTPS
   URL** in a final summary box

Safe to re-run any time: finished stages are skipped, your data and secrets
are kept, and it always re-asks the admin email + password (and syncs them
onto the account — that's also how you change them later).

Full log: `/var/log/silence-install.log`

## Requirements

| | |
|---|---|
| OS | Ubuntu 22.04 / 24.04 (Debian 12 works too) |
| Arch | x86_64 |
| RAM | ≥ 1.5 GB (installer adds swap automatically if low) |
| Disk | ≥ 6 GB free |
| Ports | none opened publicly except SSH — the gateway binds to 127.0.0.1 only |

## What gets deployed

```
                    Cloudflare quick tunnel (public HTTPS URL)
                                    │
                        ┌───────────▼───────────┐
                        │  api-gw (nginx)       │  127.0.0.1:8000 only
                        │  /auth/v1 → GoTrue    │  apikey allow-list
                        │  /rest/v1 → PostgREST │  apikey allow-list
                        │  /        → app       │
                        └───────────┬───────────┘
              ┌─────────────────────┼──────────────────────┐
              │                     │                      │
      ┌───────▼──────┐      ┌───────▼──────┐      ┌────────▼───────┐
      │ silence-app  │      │ silence-auth │      │ silence-rest   │
      │ TanStack SSR │      │ GoTrue       │      │ PostgREST      │
      │ node:22      │      └───────┬──────┘      └────────┬───────┘
      │ (no ports)   │              │   docker network     │
      └──────────────┘              └──────────┬───────────┘
                                    ┌──────────▼───────────┐
                                    │ silence-db           │
                                    │ supabase/postgres:17 │
                                    │ (no ports, no host)  │
                                    └──────────────────────┘
```

Everything talks over an internal docker network. **No database port, no app
port, nothing is reachable from the internet** — the only way in is the
Cloudflare tunnel URL.

## After install — where everything is

| Path | What |
|---|---|
| `/opt/silence/README.md` | server-side docs (tunnel URL in every section) |
| `/opt/silence/credentials.txt` | admin email + password + URLs (chmod 600) |
| `/opt/silence/status.sh` | one-shot health check of the whole stack |
| `/opt/silence/tunnel_url` | current public URL |
| `/opt/silence/app/` | the code (git clone of this repo) |
| `/opt/silence/supabase-stack/` | Supabase compose + `.env` secrets (chmod 600) |
| `/var/log/silence-install.log` | installer log |

## Cloudflare tunnel (public URL)

The installer creates a systemd service `silence-tunnel` that keeps a
Cloudflare **quick tunnel** running to the api-gw. The public URL is printed
in the final summary, saved to `/opt/silence/tunnel_url`, and written into
every doc on the server.

The quick-tunnel URL **changes if the tunnel restarts**. Recover it:

```bash
sudo journalctl -u silence-tunnel --no-pager | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1
```

The app is tunnel-agnostic: the browser client resolves the Supabase API on
whatever origin serves it (`SAME_ORIGIN` patch), so a new URL works instantly
with zero reconfiguration. If you want a **fixed** URL, put your domain on
Cloudflare and replace the quick tunnel with a named tunnel — the app and
docs don't need any change.

## Admin dashboard

- Open `<public-url>/admin` and log in with the admin email + password you
  entered during install (also in `/opt/silence/credentials.txt`).
- The first admin account is bootstrapped automatically from the credentials
  you entered (the app's `bootstrapFirstAdmin` runs once, then disables
  itself).
- Signups are **disabled** — nobody can create an account from outside.
- Forgot/changed your mind? Re-run the single install command and enter the
  new email/password — they get synced onto the admin account.

## Using the gateway API

Create provider connections and API keys (`sk-silence-...`) in the admin UI,
then call the gateway from any client:

```bash
# OpenAI-compatible
curl <public-url>/v1/chat/completions \
  -H "Authorization: Bearer sk-silence-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"<your-model>","messages":[{"role":"user","content":"hi"}]}'

# Anthropic-compatible
curl <public-url>/v1/messages \
  -H "x-api-key: sk-silence-..." \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"<your-model>","max_tokens":1024,"messages":[{"role":"user","content":"hi"}]}'
```

Provider credentials are stored **AES-256-GCM encrypted** in the local
Postgres (`PROVIDER_ENC_KEY`), never in plain text.

## Security model

- No host ports except SSH: db / auth / rest / app communicate only on the
  internal docker network.
- api-gw serves exactly `/auth/v1`, `/rest/v1` and `/` — everything else 403.
- GoTrue auth: signups disabled, tight rate limits, no anonymous users.
- Postgres RLS enforced on all tables; service key never leaves the server.
- Secrets live only in `/opt/silence/supabase-stack/.env` and
  `/opt/silence/credentials.txt` (both chmod 600, never logged).
- The installer runs a leak check at the end (grep for secrets in logs).

## Day-to-day operations

```bash
sudo bash /opt/silence/status.sh                 # health check
sudo docker restart silence-app                  # restart app
sudo systemctl restart silence-tunnel            # restart tunnel (URL changes!)
sudo docker logs -f silence-app                  # app logs
sudo docker exec silence-db pg_dump -U supabase_admin -d postgres > backup.sql
```

Update to the latest code — just re-run the single install command:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/sathxum/silence-gateway/main/install.sh)"
```

## Self-host patches (already applied in this repo)

This repo contains two small patches that make the TanStack Start app run
self-hosted:

1. `vite.config.ts` — nitro `node-server` preset (the default is a Cloudflare
   worker, which can't run on a normal VPS).
2. `src/integrations/supabase/client.ts` — `VITE_SUPABASE_URL=SAME_ORIGIN`
   support: the browser talks to the Supabase API on the same origin it's
   served from, so the tunnel URL can change freely.

The `deploy/supabase/` directory holds the full hardened Supabase compose
(Postgres + GoTrue + PostgREST + nginx api-gw) the installer uses.

## Troubleshooting

| Problem | Fix |
|---|---|
| install interrupted | just re-run the same command — it resumes |
| tunnel URL stopped working | recover URL (command above); it changed on restart |
| want a permanent URL | use a Cloudflare named tunnel with your own domain |
| app returns 502 | `sudo docker restart silence-app && sudo bash /opt/silence/status.sh` |
| build fails | `cd /opt/silence/app && sudo docker run --rm -v /opt/silence/app:/app -w /app node:22-bookworm npm ci && sudo docker run --rm -v /opt/silence/app:/app -w /app node:22-bookworm npm run build` |
| full installer log | `sudo less /var/log/silence-install.log` |
