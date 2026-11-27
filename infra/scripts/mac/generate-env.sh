#!/usr/bin/env bash
# Writes the repository-root .env for the Mac mini interim environment.
#
# Internal secrets (database, Redis, JWT, encryption, internal API key) are
# generated here and never leave the machine. External credentials (LLM
# providers, Meta, Google, SMTP, Sentry, payments) are left EMPTY: the owner
# fills them in by hand. Refuses to overwrite an existing .env, because the
# encryption key protects data already stored with it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ENV_FILE="$ROOT/.env"
if [ -e "$ENV_FILE" ]; then
  echo "Refusing to overwrite $ENV_FILE (it holds the encryption key for stored data)." >&2
  exit 1
fi

hex() { openssl rand -hex "$1"; }

API_BASE="${PUBLIC_API_BASE:-https://api.parallly-chat.cloud}"
WA_BASE="${PUBLIC_WA_BASE:-https://wa.parallly-chat.cloud}"
DASH_BASE="${PUBLIC_DASHBOARD_BASE:-https://admin.parallly-chat.cloud}"
LANDING_BASE="${PUBLIC_LANDING_BASE:-https://parallly-chat.cloud}"
DB_PASSWORD="$(hex 24)"
REDIS_PASSWORD="$(hex 24)"

umask 077
cat > "$ENV_FILE" <<EOF
# Parallext Engine - Mac mini interim environment
# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) by infra/scripts/mac/generate-env.sh
# Never commit this file. Back up ENCRYPTION_KEY: without it, stored channel
# tokens and tenant credentials cannot be decrypted.
NODE_ENV=production
LOG_LEVEL=info

# ---- Internal secrets (generated) ----
DB_PASSWORD=${DB_PASSWORD}
DATABASE_URL=postgresql://parallext:${DB_PASSWORD}@pgbouncer:5432/parallext_engine?pgbouncer=true&connection_limit=8
DIRECT_DATABASE_URL=postgresql://parallext:${DB_PASSWORD}@postgres:5432/parallext_engine
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=${REDIS_PASSWORD}
INTERNAL_JWT_SECRET=$(hex 32)
JWT_SECRET=$(hex 32)
JWT_REFRESH_SECRET=$(hex 32)
ENCRYPTION_KEY=$(hex 32)
INTERNAL_API_KEY=$(hex 24)
BULL_BOARD_TOKEN=$(hex 24)

# ---- Public URLs ----
PUBLIC_API_BASE=${API_BASE}
PUBLIC_WA_BASE=${WA_BASE}
API_URL=${API_BASE}
API_PUBLIC_URL=${API_BASE}/api/v1
DASHBOARD_URL=${DASH_BASE}
NEXT_PUBLIC_DASHBOARD_URL=${DASH_BASE}
NEXT_PUBLIC_API_URL=${API_BASE}/api/v1
NEXT_PUBLIC_WA_SERVICE_URL=${WA_BASE}/api/v1
EMAIL_LOGO_URL=${LANDING_BASE}/parallly-logo.svg
BODY_SIZE_LIMIT=50mb
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
FISCAL_STORAGE_PATH=/data/invoices
# The origin is only reachable through Cloudflare Tunnel.
BILLING_TRUST_COUNTRY_HEADER=true

# ---- LLM providers (at least one; OpenAI also powers embeddings) ----
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
DEEPSEEK_API_KEY=
XAI_API_KEY=

# ---- Meta (WhatsApp, Messenger, Instagram) ----
META_APP_ID=
META_APP_SECRET=
META_CONFIG_ID=
META_SOLUTION_ID=
META_BUSINESS_ID=
META_VERIFY_TOKEN=$(hex 16)
WHATSAPP_VERIFY_TOKEN=
SYSTEM_USER_ID=
MESSENGER_FB_LOGIN_CONFIG_ID=
MESSENGER_REDIRECT_URI=${DASH_BASE}/admin/channels/messenger
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
INSTAGRAM_REDIRECT_URI=${DASH_BASE}/admin/channels/instagram/callback

# ---- Google / Microsoft sign-in and calendars ----
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_CALENDAR_REDIRECT_URI=${API_BASE}/api/v1/calendar/google/callback
MS_AUTH_CLIENT_ID=
MS_AUTH_CLIENT_SECRET=
MS_AUTH_REDIRECT_URI=${API_BASE}/api/v1/auth/microsoft/callback
MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_TENANT_ID=common
MS_CALENDAR_REDIRECT_URI=${API_BASE}/api/v1/calendar/microsoft/callback

# ---- Email (verification, password reset) ----
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# ---- Errors and alerts ----
SENTRY_DSN=
TELEGRAM_ALERT_BOT_TOKEN=
TELEGRAM_ALERT_CHAT_ID=

# ---- Payments (leave empty: nothing is charged from this environment) ----
WOMPI_PUBLIC_KEY=
WOMPI_PRIVATE_KEY=
WOMPI_EVENTS_SECRET=
WOMPI_INTEGRITY_SECRET=
WOMPI_MERCHANT_TIMEZONE=America/Bogota
WOMPI_ALLOW_SANDBOX_IN_PRODUCTION=false
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
OWNER_COUPON_PIN=

# ---- Push notifications (npx web-push generate-vapid-keys) ----
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
EOF
# WHATSAPP_VERIFY_TOKEN mirrors META_VERIFY_TOKEN, as in the production deploy.
VERIFY="$(grep '^META_VERIFY_TOKEN=' "$ENV_FILE" | cut -d= -f2)"
sed -i '' "s/^WHATSAPP_VERIFY_TOKEN=$/WHATSAPP_VERIFY_TOKEN=${VERIFY}/" "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "Wrote $ENV_FILE. Fill in at least one LLM key before starting the stack."
