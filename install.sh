#!/usr/bin/env bash
#===============================================================================
#  SILENCE GATEWAY — one-command self-hosted installer
#
#  Usage (fresh Ubuntu 22.04/24.04 or Debian 12 VPS, as root):
#    sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/sathxum/silence-gateway/main/install.sh)"
#
#  What it does:
#    - installs Docker, cloudflared and everything else it needs
#    - deploys a hardened self-hosted Supabase stack (Postgres + GoTrue +
#      PostgREST + nginx api-gw) — no host ports, docker-network only
#    - builds the Silence Gateway app (TanStack Start, node-server preset)
#    - asks YOU for the admin email + password (always, every run)
#    - wires a Cloudflare quick tunnel and prints the public HTTPS URL
#    - writes docs + credentials to /opt/silence (chmod 600)
#
#  Safe to re-run: finished stages are skipped, but the admin email and
#  password are ALWAYS asked and are applied to the gateway.
#===============================================================================
set -Eeuo pipefail

REPO_URL="https://github.com/sathxum/silence-gateway.git"
RAW_BASE="https://raw.githubusercontent.com/sathxum/silence-gateway/main"
BASE="/opt/silence"
APP="$BASE/app"
STACK="$BASE/supabase-stack"
LOG="/var/log/silence-install.log"
DONE="$BASE/.done"
TOTAL=13
STEP=0

#-----------------------------------------------------------------------------
# UI helpers (colors + spinner + progress)
#-----------------------------------------------------------------------------
if [ -t 1 ]; then
  C_G=$'\033[1;32m'; C_R=$'\033[1;31m'; C_Y=$'\033[1;33m'; C_B=$'\033[1;36m'
  C_D=$'\033[2m'; C_0=$'\033[0m'; C_M=$'\033[1;35m'
else
  C_G=""; C_R=""; C_Y=""; C_B=""; C_D=""; C_0=""; C_M=""
fi
FRAMES=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")

step()  { STEP=$((STEP+1)); printf "\n${C_B}──[%2d/%d] %s${C_0}\n" "$STEP" "$TOTAL" "$*"; echo "[$(date '+%F %T')] STEP $STEP: $*" >> "$LOG"; }
ok()    { printf "  ${C_G}✔${C_0} %s\n" "$*"; }
info()  { printf "  ${C_D}·${C_0} %s\n" "$*"; }
warn()  { printf "  ${C_Y}!${C_0} %s\n" "$*"; }
fail()  { printf "  ${C_R}✘ %s${C_0}\n" "$*" >&2; }

banner() {
  printf "${C_M}"
  cat <<'EOB'
   ███████╗██╗██╗     ███████╗███╗   ██╗ ██████╗███████╗
   ██╔════╝██║██║     ██╔════╝████╗  ██║██╔════╝██╔════╝
   ███████╗██║██║     █████╗  ██╔██╗ ██║██║     ███████╗
   ╚════██║██║██║     ██╔══╝  ██║╚██╗██║██║     ╚════██║
   ███████║██║███████╗███████╗██║ ╚████║╚██████╗███████║
   ╚══════╝╚═╝╚══════╝╚══════╝╚═╝  ╚═══╝ ╚═════╝╚══════╝
                    G A T E W A Y   ·   installer
EOB
  printf "${C_0}\n"
}

# spin "label" -- command...   (runs cmd in bg, animates, shows % if found)
spin() {
  local label="$1"; shift; [ "${1:-}" = "--" ] && shift
  local logf; logf="$(mktemp)"
  "$@" >"$logf" 2>&1 & local pid=$!
  local i=0 t0=$SECONDS f pct
  printf "  ⠋ %s" "$label"
  while kill -0 "$pid" 2>/dev/null; do
    f="${FRAMES[$((i++ % 10))]}"
    pct="$(grep -oaE '[0-9]+\.[0-9]+%' "$logf" 2>/dev/null | tail -1 || true)"
    printf "\r  %s %s ${C_D}%s${C_0}" "$f" "$label" "${pct:+$pct}"
    sleep 0.12
  done
  wait "$pid"; local rc=$?
  cat "$logf" >> "$LOG" 2>/dev/null; rm -f "$logf"
  if [ "$rc" -eq 0 ]; then
    printf "\r  ${C_G}✔${C_0} %s ${C_D}(%ds)${C_0}\n" "$label" "$((SECONDS-t0))"
    return 0
  fi
  printf "\r  ${C_R}✘ %s${C_0}\n" "$label"
  fail "step failed — full log: $LOG (last 15 lines below)"
  tail -15 "$LOG" >&2 || true
  exit 1
}

# wait_http "label" url [tries]
wait_http() {
  local label="$1" url="$2" tries="${3:-60}" i=0 f
  printf "  ⠋ %s" "$label"
  while [ "$i" -lt "$tries" ]; do
    i=$((i+1)); f="${FRAMES[$((i % 10))]}"
    if curl -sf -o /dev/null --max-time 3 "$url"; then
      printf "\r  ${C_G}✔${C_0} %s ${C_D}(up after %d checks)${C_0}\n" "$label" "$i"
      return 0
    fi
    printf "\r  %s %s ${C_D}(%d/%d)${C_0}" "$f" "$label" "$i" "$tries"
    sleep 1
  done
  printf "\r  ${C_R}✘ %s (timeout)${C_0}\n" "$label"
  fail "service did not become healthy — log: $LOG"
  exit 1
}

mark()  { mkdir -p "$DONE"; date '+%F %T' > "$DONE/$1"; }
have()  { [ -f "$DONE/$1" ]; }

#-----------------------------------------------------------------------------
# Traps / pre-flight
#-----------------------------------------------------------------------------
trap 'fail "installer interrupted at step $STEP — re-run the SAME command to resume"; exit 130' INT TERM

if [ "$(id -u)" -ne 0 ]; then
  echo "This installer must run as root. Re-invoking with sudo ..."
  TMP="$(mktemp /tmp/silence-install.XXXXXX.sh)"
  if [ -f "${BASH_SOURCE[0]}" ] && [ -s "${BASH_SOURCE[0]}" ]; then
    exec sudo bash "${BASH_SOURCE[0]}"
  fi
  curl -fsSL "$RAW_BASE/install.sh" -o "$TMP"
  exec sudo bash "$TMP"
fi

mkdir -p "$BASE" "$DONE"
touch "$LOG" && chmod 600 "$LOG"
exec 9>>"$LOG"

banner
echo "  ${C_D}log: $LOG   ·   re-running the same command is safe (it resumes)${C_0}"

RESUME=0
[ -f "$DONE/07_build" ] && RESUME=1 && echo "  ${C_Y}existing installation detected — completed stages will be skipped.${C_0}"

#-----------------------------------------------------------------------------
# STEP 01 — pre-flight
#-----------------------------------------------------------------------------
step "Pre-flight checks"
if have 01_preflight; then ok "already done, skipping"; else
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) info "OS: ${PRETTY_NAME:-$ID}" ;;
    *) fail "unsupported OS '$ID' — use Ubuntu 22.04/24.04 or Debian 12"; exit 1 ;;
  esac
  [ "$(uname -m)" = "x86_64" ] || { fail "need x86_64 (got $(uname -m))"; exit 1; }
  DISK_FREE=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
  [ "$DISK_FREE" -ge 6 ] || { fail "need >=6GB free disk (have ${DISK_FREE}GB)"; exit 1; }
  ok "disk: ${DISK_FREE}GB free"
  RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
  if [ "$RAM_MB" -lt 1400 ]; then
    warn "RAM ${RAM_MB}MB is low — adding 2GB swap to be safe"
    if ! swapon --show=NAME | grep -q '/swapfile'; then
      fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
      grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
    ok "swap active"
  else
    ok "RAM: ${RAM_MB}MB"
  fi
  if ss -tln 2>/dev/null | grep -qE ':(8000)\b'; then
    fail "port 8000 is already in use — Silence Gateway needs it on 127.0.0.1"
    exit 1
  fi
  ok "port 8000 free (gateway binds to 127.0.0.1 only)"
  ok "pre-flight passed"
  mark 01_preflight
fi

#-----------------------------------------------------------------------------
# STEP 02 — system packages (docker, cloudflared, git, curl)
#-----------------------------------------------------------------------------
step "Installing system packages (Docker, cloudflared, git)"
if have 02_packages; then ok "already done, skipping"; else
  export DEBIAN_FRONTEND=noninteractive
  spin "Updating package index" -- apt-get update -qq
  spin "Installing base tools" -- apt-get install -y -qq curl git ca-certificates openssl python3
  if ! command -v docker >/dev/null 2>&1; then
    spin "Installing Docker Engine (get.docker.com)" -- curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh
    rm -f /tmp/get-docker.sh
    systemctl enable --now docker >/dev/null 2>&1 || true
  fi
  docker compose version >/dev/null 2>&1 || { fail "docker compose plugin missing"; exit 1; }
  ok "docker: $(docker --version | cut -d, -f1)"
  if ! command -v cloudflared >/dev/null 2>&1; then
    spin "Installing cloudflared (Cloudflare tunnel)" -- bash -c 'curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb && dpkg -i /tmp/cloudflared.deb >/dev/null && rm -f /tmp/cloudflared.deb'
  fi
  ok "cloudflared: $(cloudflared --version 2>/dev/null | head -1)"
  systemctl enable --now cron >/dev/null 2>&1 || true
  mark 02_packages
fi

#-----------------------------------------------------------------------------
# STEP 03 — source code
#-----------------------------------------------------------------------------
step "Fetching Silence Gateway source code"
if [ ! -d "$APP/.git" ]; then
  spin "Cloning repository" -- git clone --depth 1 "$REPO_URL" "$APP"
else
  spin "Updating to latest main" -- git -C "$APP" fetch origin main
  git -C "$APP" reset --hard origin/main >/dev/null
fi
GITSHA=$(git -C "$APP" rev-parse --short HEAD)
ok "code ready at $APP (${GITSHA})"
mark 03_code

#-----------------------------------------------------------------------------
# STEP 04 — secrets + API keys (never printed, never logged)
#-----------------------------------------------------------------------------
step "Generating secrets (JWT, DB password, encryption key)"
SENV="$STACK/.env"
if [ ! -s "$SENV" ]; then
  JWT_SECRET="$(openssl rand -hex 32)"
  PGPASS="$(openssl rand -hex 16)"
  ENC_KEY="$(openssl rand -hex 32)"
  B64U() { openssl base64 -A | tr '+/' '-_' | tr -d '=\n'; }
  mk_jwt() {
    local role="$1" now; now=$(date +%s)
    local h p s
    h=$(printf '{"alg":"HS256","typ":"JWT"}' | B64U)
    p=$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$role" "$now" "$((now+315360000))" | B64U)
    s=$(printf '%s.%s' "$h" "$p" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | B64U)
    printf '%s.%s.%s' "$h" "$p" "$s"
  }
  ANON_KEY=$(mk_jwt anon)
  SERVICE_KEY=$(mk_jwt service_role)
  mkdir -p "$STACK"
  umask 077
  cat > "$SENV" <<EOF
# Silence Gateway — self-hosted Supabase secrets (root-only, chmod 600)
POSTGRES_PORT=5432
POSTGRES_DB=postgres
POSTGRES_PASSWORD=$PGPASS
JWT_SECRET=$JWT_SECRET
JWT_EXPIRY=3600
ANON_KEY=$ANON_KEY
SERVICE_ROLE_KEY=$SERVICE_KEY
API_EXTERNAL_URL=http://127.0.0.1:8000/auth/v1
SITE_URL=http://localhost:3000
ADDITIONAL_REDIRECT_URLS=
DISABLE_SIGNUP=true
ENABLE_EMAIL_SIGNUP=true
ENABLE_ANONYMOUS_USERS=false
ENABLE_EMAIL_AUTOCONFIRM=false
SMTP_ADMIN_EMAIL=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_SENDER_NAME=
PGRST_DB_SCHEMAS=public
PGRST_DB_MAX_ROWS=1000
PGRST_DB_EXTRA_SEARCH_PATH=public
API_GW_HTTP_PORT=8000
EOF
  umask 022
  chmod 600 "$SENV"
  # stash for later steps (root-only)
  printf 'ANON=%s\nSERVICE=%s\nENC=%s\nJWT_SECRET=%s\nPGPASS=%s\n' \
    "$ANON_KEY" "$SERVICE_KEY" "$ENC_KEY" "$JWT_SECRET" "$PGPASS" > "$BASE/.gen_secrets"
  chmod 600 "$BASE/.gen_secrets"
  ok "JWT secret + anon/service keys generated (HS256, 10y)"
  ok "DB password + AES-256-GCM encryption key generated"
else
  ok "secrets already exist, keeping them ($SENV)"
  [ -s "$BASE/.gen_secrets" ] && . "$BASE/.gen_secrets"
  ANON_KEY="$(grep -oP '^ANON_KEY=\K.*' "$SENV" || true)"
  SERVICE_KEY="$(grep -oP '^SERVICE_ROLE_KEY=\K.*' "$SENV" || true)"
  ENC_KEY="${ENC:-}"
  if [ -z "$ENC_KEY" ]; then
    ENC_KEY="$(grep -oP '^PROVIDER_ENC_KEY=\K.*' "$APP/.env" 2>/dev/null || true)"
  fi
  if [ -z "$ENC_KEY" ]; then
    ENC_KEY="$(openssl rand -hex 32)"
    { [ -s "$BASE/.gen_secrets" ] && printf 'ENC=%s\n' "$ENC_KEY" >> "$BASE/.gen_secrets"; } \
      || { umask 077; printf 'ENC=%s\n' "$ENC_KEY" > "$BASE/.gen_secrets"; umask 022; }
  fi
fi
export ANON_KEY SERVICE_KEY ENC_KEY
mark 04_secrets

#-----------------------------------------------------------------------------
# STEP 05 — self-hosted Supabase stack (DB + GoTrue + PostgREST + api-gw)
#-----------------------------------------------------------------------------
step "Deploying self-hosted Supabase (Postgres, auth, REST, api-gw)"
mkdir -p "$STACK"
cp -f "$APP/deploy/supabase/docker-compose.yml" "$STACK/"
cp -f "$APP/deploy/supabase/gateway.conf.template" "$STACK/"
mkdir -p "$STACK/volumes/db"
cp -f "$APP/deploy/supabase/volumes/db/"*.sql "$STACK/volumes/db/"
if ! docker network inspect silence-supabase_default >/dev/null 2>&1; then
  spin "Pulling images (postgres, gotrue, postgrest, nginx)" -- docker compose -f "$STACK/docker-compose.yml" --project-name silence-supabase pull
fi
if ! docker ps --format '{{.Names}}' | grep -q '^silence-db$'; then
  spin "Starting Postgres 17 (data at $STACK/data/db)" -- docker compose -f "$STACK/docker-compose.yml" --project-name silence-supabase up -d db
  local_tries=0
  printf "  ⠋ Waiting for Postgres to accept connections"
  while [ "$local_tries" -lt 60 ]; do
    local_tries=$((local_tries+1))
    if docker exec silence-db pg_isready -U postgres -h localhost >/dev/null 2>&1; then
      printf "\r  ${C_G}✔${C_0} Postgres accepting connections ${C_D}(%d checks)${C_0}\n" "$local_tries"; break
    fi
    printf "\r  %s Waiting for Postgres to accept connections ${C_D}(%d/60)${C_0}" "${FRAMES[$((local_tries % 10))]}" "$local_tries"
    sleep 2
  done
  [ "$local_tries" -lt 60 ] || { fail "postgres not healthy"; exit 1; }
fi
if ! docker ps --format '{{.Names}}' | grep -q '^silence-auth$'; then
  spin "Starting GoTrue (auth) + PostgREST (rest)" -- docker compose -f "$STACK/docker-compose.yml" --project-name silence-supabase up -d auth rest
fi
if ! docker ps --format '{{.Names}}' | grep -q '^silence-api-gw$'; then
  spin "Starting nginx api-gw (127.0.0.1:8000)" -- docker compose -f "$STACK/docker-compose.yml" --project-name silence-supabase up -d api-gw
fi
wait_http "Waiting for api-gw health endpoint" "http://127.0.0.1:8000/health" 60
for c in silence-db silence-auth silence-rest silence-api-gw; do
  st=$(docker inspect -f '{{.State.Health.Status}}{{if not .State.Health}}{{.State.Status}}{{end}}' "$c" 2>/dev/null || echo missing)
  case "$st" in healthy|running) ok "$c: $st" ;; *) fail "$c: $st"; exit 1 ;; esac
done
mark 05_supabase

#-----------------------------------------------------------------------------
# STEP 06 — database schema
#-----------------------------------------------------------------------------
step "Applying database schema (tables, RLS policies)"
PSQL_USER=""
for u in supabase_admin postgres; do
  if docker exec silence-db psql -U "$u" -d postgres -tAc "SELECT 1" >/dev/null 2>&1; then PSQL_USER="$u"; break; fi
done
[ -n "$PSQL_USER" ] || { fail "cannot connect to postgres as supabase_admin/postgres"; exit 1; }
ok "psql user: $PSQL_USER"
if docker exec silence-db psql -U "$PSQL_USER" -d postgres -tAc "SELECT to_regclass('public.user_roles')" | grep -q user_roles; then
  ok "schema already applied, skipping"
else
  spin "Loading schema.sql (599 lines)" -- bash -c "docker exec -i silence-db psql -v ON_ERROR_STOP=1 -U $PSQL_USER -d postgres < '$APP/supabase/schema.sql' >> '$LOG' 2>&1"
  docker exec silence-db psql -U "$PSQL_USER" -d postgres -tAc "SELECT to_regclass('public.user_roles')" | grep -q user_roles || { fail "schema verification failed"; exit 1; }
  ok "schema verified (user_roles, admins, api_keys, providers ...)"
fi
mark 06_schema

#-----------------------------------------------------------------------------
# STEP 07 — build the app (inside node:22 container, no host node needed)
#-----------------------------------------------------------------------------
step "Building Silence Gateway app (npm + vite, node:22)"
# build-time env: vite bakes VITE_* into the browser bundle (SAME_ORIGIN keeps
# the app working no matter which public tunnel URL serves it)
umask 077
if [ ! -s "$APP/.env" ] || ! grep -q '^VITE_SUPABASE_URL=SAME_ORIGIN$' "$APP/.env"; then
  cat > "$APP/.env" <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
SUPABASE_URL=http://silence-api-gw:8000
SUPABASE_PUBLISHABLE_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY
SUPABASE_PROJECT_ID=silence-selfhosted
VITE_SUPABASE_URL=SAME_ORIGIN
VITE_SUPABASE_PUBLISHABLE_KEY=$ANON_KEY
VITE_SUPABASE_PROJECT_ID=silence-selfhosted
PROVIDER_ENC_KEY=$ENC_KEY
BOOTSTRAP_ADMIN_EMAIL=
BOOTSTRAP_ADMIN_PASSWORD=
EOF
  chmod 600 "$APP/.env"
  ok "build-time env written (VITE_SUPABASE_URL=SAME_ORIGIN baked into bundle)"
fi
umask 022
if [ -f "$APP/.output/server/index.mjs" ] && [ -n "$(find "$APP/.output/server/index.mjs" -newer "$APP/package.json" 2>/dev/null)" ]; then
  ok "fresh build already present, skipping"
else
  spin "Pulling node:22-bookworm (build + runtime image)" -- docker pull node:22-bookworm
  if [ -f "$APP/package-lock.json" ]; then
    spin "Installing dependencies (npm ci — locked versions)" -- docker run --rm -v "$APP:/app" -w /app node:22-bookworm npm ci --no-audit --no-fund
  else
    spin "Installing dependencies (npm install)" -- docker run --rm -v "$APP:/app" -w /app node:22-bookworm npm install --no-audit --no-fund
  fi
  spin "Compiling server bundle (vite build — nitro node-server)" -- docker run --rm -v "$APP:/app" -w /app node:22-bookworm npm run build
  [ -f "$APP/.output/server/index.mjs" ] || { fail "build produced no .output/server/index.mjs"; exit 1; }
  ok "build complete → $APP/.output"
fi
mark 07_build

#-----------------------------------------------------------------------------
# STEP 08 — admin email + password (ALWAYS asked, one by one)
#-----------------------------------------------------------------------------
step "Admin account — your email and password (always asked)"
info "these credentials log you into the dashboard at /admin"

while true; do
  printf "  ${C_B}?${C_0} Admin email  : "
  read -r ADMIN_EMAIL
  if [[ "${ADMIN_EMAIL:-}" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then break; fi
  warn "that doesn't look like a valid email — try again (e.g. owner@mydomain.com)"
done

while true; do
  printf "  ${C_B}?${C_0} Admin password ${C_D}(min 12 chars, needs upper + lower + digit; input hidden)${C_0}: "
  read -rs ADMIN_PASSWORD; echo
  PW="${ADMIN_PASSWORD:-}"
  if [ "${#PW}" -lt 12 ] || [[ "$PW" != *[A-Z]* ]] || [[ "$PW" != *[a-z]* ]] || [[ "$PW" != *[0-9]* ]]; then
    warn "too weak — use at least 12 characters mixing UPPER, lower and digit"
    continue
  fi
  printf "  ${C_B}?${C_0} Confirm password: "
  read -rs ADMIN_PASSWORD2; echo
  if [ "$PW" = "$ADMIN_PASSWORD2" ]; then break; fi
  warn "passwords do not match — try again"
done
unset PW ADMIN_PASSWORD2
ok "credentials accepted (kept out of all logs)"
mark 08_prompts

#-----------------------------------------------------------------------------
# STEP 09 — app runtime env + container
#-----------------------------------------------------------------------------
step "Starting Silence Gateway app (docker, internal network only)"
umask 077
cat > "$APP/.env" <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
SUPABASE_URL=http://silence-api-gw:8000
SUPABASE_PUBLISHABLE_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY
SUPABASE_PROJECT_ID=silence-selfhosted
VITE_SUPABASE_URL=SAME_ORIGIN
VITE_SUPABASE_PUBLISHABLE_KEY=$ANON_KEY
VITE_SUPABASE_PROJECT_ID=silence-selfhosted
PROVIDER_ENC_KEY=$ENC_KEY
BOOTSTRAP_ADMIN_EMAIL=$ADMIN_EMAIL
BOOTSTRAP_ADMIN_PASSWORD=$ADMIN_PASSWORD
EOF
chmod 600 "$APP/.env"
umask 022
ok "runtime env written ($APP/.env, chmod 600)"

docker rm -f silence-app >/dev/null 2>&1 || true
spin "Launching app container (node:22, no host ports)" -- docker run -d --name silence-app \
  --restart unless-stopped \
  --network silence-supabase_default \
  -v "$APP:/app" -w /app \
  --env-file "$APP/.env" \
  node:22-bookworm-slim node .output/server/index.mjs >/dev/null
wait_http "App (SSR) is up" "http://127.0.0.1:8000/" 90
mark 09_app

#-----------------------------------------------------------------------------
# STEP 10 — Cloudflare quick tunnel
#-----------------------------------------------------------------------------
step "Cloudflare quick tunnel (public HTTPS URL)"
cat > /etc/systemd/system/silence-tunnel.service <<'EOF'
[Unit]
Description=Silence Gateway Cloudflare quick tunnel
After=network-online.target docker.service
Wants=network-online.target

[Service]
ExecStart=/usr/bin/cloudflared tunnel --url http://127.0.0.1:8000 --no-autoupdate
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
if ! systemctl is-active --quiet silence-tunnel; then
  spin "Starting cloudflared tunnel service" -- systemctl enable --now silence-tunnel
else
  ok "tunnel service already running"
fi
printf "  ⠋ Requesting public URL from Cloudflare"
TUNNEL_URL=""
for i in $(seq 1 60); do
  TUNNEL_URL="$(journalctl -u silence-tunnel --no-pager 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)"
  [ -n "$TUNNEL_URL" ] && break
  printf "\r  %s Requesting public URL from Cloudflare ${C_D}(%d/60)${C_0}" "${FRAMES[$((i % 10))]}" "$i"
  sleep 2
done
[ -n "$TUNNEL_URL" ] || { printf "\n"; fail "no tunnel URL — check: journalctl -u silence-tunnel"; exit 1; }
printf "\r  ${C_G}✔${C_0} tunnel up: ${C_G}%s${C_0}\n" "$TUNNEL_URL"
echo "$TUNNEL_URL" > "$BASE/tunnel_url"
chmod 644 "$BASE/tunnel_url"
wait_http "Public URL responding" "$TUNNEL_URL/" 45
mark 10_tunnel

#-----------------------------------------------------------------------------
# STEP 11 — admin account bootstrap / update + login proof
#-----------------------------------------------------------------------------
step "Applying admin account (bootstrap)"
PSQL_USER=""
for u in supabase_admin postgres; do
  if docker exec silence-db psql -U "$u" -d postgres -tAc "SELECT 1" >/dev/null 2>&1; then PSQL_USER="$u"; break; fi
done
dbq() { docker exec silence-db psql -U "$PSQL_USER" -d postgres -tAc "$1" 2>/dev/null | head -1; }
json_esc() { printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'; }
sq_esc() { printf '%s' "$1" | sed "s/'/''/g"; }

# payload files (root-only, deleted right after)
PJ="$(mktemp /tmp/sg-payload.XXXXXX.json)"; chmod 600 "$PJ"
printf '{"email":%s,"password":%s,"email_confirm":true}\n' "$(json_esc "$ADMIN_EMAIL")" "$(json_esc "$ADMIN_PASSWORD")" > "$PJ"

# a GET of /admin makes the app run its own first-admin bootstrap (idempotent)
curl -s -m 120 -o /dev/null "http://127.0.0.1:8000/admin" || true
sleep 2
CNT="$(dbq "SELECT count(*) FROM public.user_roles WHERE role='admin'" | tr -dc '0-9')"

if [ "${CNT:-0}" -ge 1 ]; then
  AUID="$(dbq "SELECT user_id FROM public.user_roles WHERE role='admin' ORDER BY created_at ASC LIMIT 1")"
  ok "admin already exists — syncing your credentials onto it"
  spin "Updating admin email + password (GoTrue admin API)" -- curl -s -m 60 -o /dev/null -X PUT \
    "http://127.0.0.1:8000/auth/v1/admin/users/$AUID" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
    -H 'Content-Type: application/json' --data @"$PJ"
  spin "Syncing admins table email mirror" -- curl -s -m 60 -o /dev/null -X PATCH \
    "http://127.0.0.1:8000/rest/v1/admins?id=eq.$AUID" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
    -H 'Content-Type: application/json' -H 'Prefer: return=minimal' \
    -d "{\"email\":$(json_esc "$ADMIN_EMAIL")}"
else
  info "no admin yet — creating it via GoTrue admin API"
  RCODE="$(curl -s -m 60 -o /tmp/sg-create.out -w '%{http_code}' -X POST \
    "http://127.0.0.1:8000/auth/v1/admin/users" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
    -H 'Content-Type: application/json' --data @"$PJ" || echo 000)"
  if [ "$RCODE" != "200" ] && [ "$RCODE" != "201" ] && [ "$RCODE" != "422" ]; then
    fail "GoTrue user creation failed (HTTP $RCODE) — see $LOG"; rm -f "$PJ"; exit 1
  fi
  rm -f /tmp/sg-create.out
  AUID="$(dbq "SELECT id FROM auth.users WHERE email='$(sq_esc "$ADMIN_EMAIL")' LIMIT 1")"
  [ -n "$AUID" ] || { fail "user created but not found in DB"; rm -f "$PJ"; exit 1; }
  spin "Granting admin role" -- curl -s -m 60 -o /dev/null -X POST "http://127.0.0.1:8000/rest/v1/user_roles" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
    -H 'Content-Type: application/json' -H 'Prefer: return=minimal' \
    -d "{\"user_id\":\"$AUID\",\"role\":\"admin\"}"
  spin "Creating admin profile row" -- curl -s -m 60 -o /dev/null -X POST "http://127.0.0.1:8000/rest/v1/admins" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
    -H 'Content-Type: application/json' -H 'Prefer: return=minimal' \
    -d "{\"id\":\"$AUID\",\"email\":$(json_esc "$ADMIN_EMAIL")}"
fi
rm -f "$PJ"

# proof: real login with the exact credentials entered above
LCODE="$(curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:8000/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
  -d "{\"email\":$(json_esc "$ADMIN_EMAIL"),\"password\":$(json_esc "$ADMIN_PASSWORD")}" || echo 000)"
if [ "$LCODE" = "200" ]; then
  ok "login verified (HTTP 200) — your email + password work"
else
  warn "login test returned HTTP $LCODE — check credentials via /admin"
fi
mark 11_admin

#-----------------------------------------------------------------------------
# STEP 12 — docs + credentials (tunnel URL written everywhere it belongs)
#-----------------------------------------------------------------------------
step "Writing docs + credentials (tunnel URL everywhere)"
umask 077
cat > "$BASE/credentials.txt" <<EOF
=== Silence Gateway credentials (root-only, chmod 600) ===
Installed : $(date '+%F %T')  ·  installer commit $GITSHA

PUBLIC URL          : $TUNNEL_URL
ADMIN UI            : $TUNNEL_URL/admin
ADMIN EMAIL         : $ADMIN_EMAIL
ADMIN PASSWORD      : $ADMIN_PASSWORD

API (OpenAI-compatible)   : $TUNNEL_URL/v1/chat/completions
API (Anthropic-compatible): $TUNNEL_URL/v1/messages
API keys are created in the admin UI (they look like sk-silence-...)

DB (docker net only)      : silence-db:5432  db=postgres  user=supabase_admin
Service/anon keys + JWT   : $STACK/.env (chmod 600)
NOTE: quick-tunnel URL changes if the tunnel restarts. Recover:
  sudo journalctl -u silence-tunnel --no-pager | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1
EOF
chmod 600 "$BASE/credentials.txt"
umask 022

cat > "$BASE/README.md" <<EOF
# Silence Gateway — self-hosted on this VPS

## Public URL (Cloudflare quick tunnel) — use THIS everywhere
$TUNNEL_URL

- Dashboard/Admin UI : $TUNNEL_URL/admin
- Gateway API (OpenAI-compatible)    : $TUNNEL_URL/v1/chat/completions
- Gateway API (Anthropic-compatible) : $TUNNEL_URL/v1/messages
- Login: admin email + password in /opt/silence/credentials.txt (chmod 600)

The quick-tunnel URL changes on tunnel restart. Recover it:
  sudo journalctl -u silence-tunnel --no-pager | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1
(current URL is also in /opt/silence/tunnel_url)

## Architecture — 100% self-hosted, everything inside this VPS
- silence-app    : gateway app (TanStack Start SSR, node:22 docker, NO host ports)
- silence-api-gw : nginx edge on 127.0.0.1:8000 only — /auth/v1 + /rest/v1 (apikey
                   allow-list) + / -> app; every other backend path is 403
- silence-auth   : Supabase GoTrue (signups DISABLED — accounts only via admin)
- silence-rest   : Supabase PostgREST (RLS enforced)
- silence-db     : supabase/postgres:17 — data at $STACK/data/db,
                   docker-network only (no host ports, not reachable from internet)
- silence-tunnel : cloudflared systemd service -> the public URL above

Public exposure is ONLY: Cloudflare tunnel -> api-gw -> app/db (internal).
Provider keys are stored AES-256-GCM encrypted (PROVIDER_ENC_KEY) in local Postgres.

## Daily operations
Status:
  sudo bash $BASE/status.sh
Restart app:            sudo docker restart silence-app
Restart backend stack:  sudo docker compose -f $STACK/docker-compose.yml --project-name silence-supabase restart
Restart tunnel (URL changes — recover as shown above):
  sudo systemctl restart silence-tunnel
Logs:
  sudo docker logs -f silence-app
  sudo journalctl -u silence-tunnel -f
Database backup:
  sudo docker exec silence-db pg_dump -U supabase_admin -d postgres > $BASE/db-backup-\$(date +%F).sql

## Update to the latest GitHub main
  sudo bash -c "\$(curl -fsSL $RAW_BASE/install.sh)"
The installer resumes: it re-pulls code, rebuilds, keeps your data and secrets,
and always re-asks the admin email + password (and syncs them onto the account).

## Change admin email / password
Re-run the installer command above and enter the new values at the prompt.

## Security model
- No host ports except SSH: db/auth/rest/app talk on the internal docker network.
- api-gw enforces an apikey allow-list (anon + service_role JWTs signed by the
  local JWT secret) on /auth/v1 + /rest/v1; everything else is 403.
- Signups disabled; rate limits tight (GoTrue); RLS enforced in Postgres.
- Secrets only in $STACK/.env and $BASE/credentials.txt (both chmod 600).
EOF
ok "docs: $BASE/README.md (tunnel URL in every section)"
ok "creds: $BASE/credentials.txt (chmod 600)"

cat > "$BASE/status.sh" <<'EOF'
#!/usr/bin/env bash
# Silence Gateway status — run: sudo bash /opt/silence/status.sh
echo "=== Silence Gateway status $(date '+%F %T') ==="
echo "--- containers ---"
docker ps --format '{{.Names}}  {{.Status}}' | grep -E 'silence-' || true
echo "--- health codes ---"
echo -n "app     http://127.0.0.1:8000/             : "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 http://127.0.0.1:8000/
echo -n "admin   http://127.0.0.1:8000/admin       : "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 http://127.0.0.1:8000/admin
echo -n "auth    /auth/v1/health                    : "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 http://127.0.0.1:8000/auth/v1/health
TUN="$(cat /opt/silence/tunnel_url 2>/dev/null)"
if [ -n "$TUN" ]; then
  echo -n "public  $TUN/ : "
  curl -s -o /dev/null -w '%{http_code}\n' --max-time 25 "$TUN/"
else
  echo "public URL missing — recover: sudo journalctl -u silence-tunnel --no-pager | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1"
fi
echo "--- public listeners ---"
ss -tln | grep -E '0\.0\.0\.0|\[::\]' || true
EOF
chmod 755 "$BASE/status.sh"
ok "status: $BASE/status.sh"
mark 12_docs

#-----------------------------------------------------------------------------
# STEP 13 — verification + secret-leak check + summary
#-----------------------------------------------------------------------------
step "Final verification + secret-leak check"
V1=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:8000/")
V2=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:8000/admin")
V3=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://127.0.0.1:8000/auth/v1/health")
V4=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$TUNNEL_URL/")
V5=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:8000/auth/v1/settings" 2>/dev/null || echo 000)
ok "local app /          → $V1"
ok "local /admin         → $V2"
ok "local auth health    → $V3"
ok "public tunnel /      → $V4"
if [ "$V1" = "200" ] && [ "$V2" = "200" ] && [ "$V3" = "200" ] && [ "$V4" = "200" ]; then
  ok "all endpoints healthy"
else
  warn "some endpoints not 200 — check: sudo bash $BASE/status.sh"
fi
if [ "$V5" = "403" ]; then ok "auth without apikey rejected (403) — gateway locked"; fi

LEAKS=0
for SECRET in "$ADMIN_PASSWORD" "$SERVICE_KEY" "$JWT_SECRET" "$PGPASS"; do
  [ -n "$SECRET" ] || continue
  if docker logs silence-app 2>&1 | grep -qF "$SECRET" \
     || journalctl -u silence-tunnel --no-pager 2>/dev/null | grep -qF "$SECRET" \
     || grep -qF "$SECRET" "$LOG"; then
    LEAKS=1; warn "SECRET MATERIAL FOUND IN LOGS — investigate!"
  fi
done
[ "$LEAKS" -eq 0 ] && ok "leak check clean (password/keys absent from all logs)"
mark 13_verify

#-----------------------------------------------------------------------------
# Summary
#-----------------------------------------------------------------------------
echo
printf "${C_G}╔══════════════════════════════════════════════════════════════╗${C_0}\n"
printf "${C_G}║              ✔  SILENCE GATEWAY IS LIVE                       ║${C_0}\n"
printf "${C_G}╚══════════════════════════════════════════════════════════════╝${C_0}\n"
printf "  ${C_B}Public URL${C_0}   : %s\n" "$TUNNEL_URL"
printf "  ${C_B}Admin UI${C_0}     : %s/admin\n" "$TUNNEL_URL"
printf "  ${C_B}Admin email${C_0}  : %s\n" "$ADMIN_EMAIL"
printf "  ${C_B}Admin password${C_0}: %s\n" "$ADMIN_PASSWORD"
printf "  ${C_B}Gateway API${C_0}  : %s/v1/chat/completions  (OpenAI-compatible)\n" "$TUNNEL_URL"
printf "  ${C_B}Credentials${C_0}  : %s/credentials.txt  (chmod 600)\n" "$BASE"
printf "  ${C_B}Docs${C_0}         : %s/README.md\n" "$BASE"
printf "  ${C_B}Status${C_0}       : sudo bash %s/status.sh\n" "$BASE"
printf "  ${C_D}note: tunnel URL changes on tunnel restart — recovery command is in the docs${C_0}\n"
echo
