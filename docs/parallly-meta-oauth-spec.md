# Parallly — Spec técnica: OAuth automatizado para Messenger e Instagram

## 0. Contexto del producto

**Empresa:** Automation AI S.A.S. (Colombia)
**Marca:** Parallext
**Producto:** Parallly — plataforma SaaS omnicanal de mensajería empresarial

Parallly permite a negocios centralizar y automatizar conversaciones de WhatsApp, Messenger e Instagram en una bandeja unificada.

**Estado actual:**
- WhatsApp Embedded Signup ya implementado y funcionando (referencia para el patrón a seguir).
- App de Meta: `Parallext Prod` (App ID: `1254054003272576`).
- Tech Provider verificado, App publicada, App Review aprobado para WhatsApp.
- App Review para los 6 permisos de Messenger + Instagram en curso (ya enviada).
- En `/admin/channels/messenger` y `/admin/channels/instagram` hay un formulario **manual** donde el cliente tendría que pegar Page Access Token e IG Business Account ID a mano. **Esto se debe reemplazar por OAuth automatizado.**

**Permisos solicitados a Meta (relevantes para esta implementación):**

Messenger:
- `pages_show_list`
- `pages_messaging`
- `pages_manage_metadata`
- `pages_read_engagement`

Instagram (flujo "Instagram API with Instagram Login" — NO usa Página de Facebook):
- `instagram_business_basic`
- `instagram_business_manage_messages`

---

## 1. Objetivo de esta implementación

Reemplazar el formulario manual actual por dos flujos OAuth automatizados (uno para Messenger, otro para Instagram) en los que el cliente:

1. Hace click en "Conectar".
2. Es redirigido (o se abre un popup) al consentimiento de Meta.
3. Autoriza permisos.
4. Vuelve a Parallly y ve el canal **conectado** sin pegar nada manualmente.
5. Parallly almacena tokens de larga duración cifrados, suscribe webhooks automáticamente, y empieza a recibir mensajes en tiempo real.

---

## 2. Arquitectura: dos flujos diferentes

⚠️ **Crítico:** Messenger e Instagram usan SDKs y endpoints distintos. NO es el mismo flujo dos veces.

| | Messenger | Instagram |
|---|---|---|
| SDK frontend | Facebook JS SDK (`FB.login`) | Redirect / popup directo a `instagram.com/oauth/authorize` |
| Identificadores | App ID de Meta (`1254054003272576`) + Configuration ID de FB Login for Business | Instagram App ID (`1472258884595741`) + Instagram App Secret (distintos del de Meta) |
| Token type | Page Access Token (no expira si el user token era de larga duración) | Long-lived Instagram User Access Token (60 días, refrescable) |
| Webhook subscription | Manual por página: `POST /{page-id}/subscribed_apps` | Automática a nivel de app (configurada una vez en el Dashboard) |
| Identificador del cliente | `page_id` | `ig_user_id` (Instagram-scoped) |
| Refresh de token | No requerido | Cron cada 30 días: `GET /refresh_access_token` |

---

## 3. Variables de entorno requeridas

```env
# Meta App (compartido con WhatsApp ESU)
META_APP_ID=1254054003272576
META_APP_SECRET=<el actual>
META_GRAPH_VERSION=v21.0

# Messenger
MESSENGER_FB_LOGIN_CONFIG_ID=<crear en Facebook Login for Business; ver §4>
MESSENGER_REDIRECT_URI=https://admin.parallly-chat.cloud/admin/channels/messenger/callback

# Instagram (CREDENCIALES DISTINTAS — no usar META_APP_ID/SECRET)
INSTAGRAM_APP_ID=1472258884595741
INSTAGRAM_APP_SECRET=<obtener de App Dashboard → Use cases → Instagram → API setup with Instagram login>
INSTAGRAM_REDIRECT_URI=https://admin.parallly-chat.cloud/admin/channels/instagram/callback

# Webhooks (compartido)
META_WEBHOOK_VERIFY_TOKEN=d944049ef61b80d0c607bded5505f60a6a310216f7bbc41188264567a7ddf92b
META_WEBHOOK_BASE_URL=https://api.parallly-chat.cloud/api/v1/channels/webhook

# Cifrado (CRÍTICO — los tokens NUNCA se almacenan en plano)
TOKEN_ENCRYPTION_KEY=<32 bytes hex; usar AES-256-GCM>
```

---

## 4. Pre-requisito en el Meta App Dashboard (one-time setup)

Antes de codear, en App Dashboard:

1. **Facebook Login for Business → Configurations → Create configuration**:
   - Name: `Messenger Onboarding Parallly`
   - Login type: **Business Login**
   - Token type: **User access token**
   - Assets: **Pages**
   - Permissions: `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`
   - Guardar el `Configuration ID` → va en `MESSENGER_FB_LOGIN_CONFIG_ID`.

2. **Facebook Login for Business → Settings → Valid OAuth Redirect URIs**: agregar `https://admin.parallly-chat.cloud/admin/channels/messenger/callback`.

3. **Webhooks** del producto **Page**: configurar callback `https://api.parallly-chat.cloud/api/v1/channels/webhook/messenger` con verify token, suscribir campos: `messages`, `messaging_postbacks`, `message_deliveries`, `message_reads`, `messaging_referrals`.

4. **Webhooks** del producto **Instagram**: configurar callback `https://api.parallly-chat.cloud/api/v1/channels/webhook/instagram` con verify token, suscribir campos: `messages`, `messaging_postbacks`, `messaging_seen`.

5. **Instagram → API setup with Instagram login → Business login settings → OAuth redirect URIs**: agregar `https://admin.parallly-chat.cloud/admin/channels/instagram/callback`.

---

## 5. Modelo de datos

Crear tabla `channel_connections` (o extender la que ya tienes para WhatsApp):

```sql
CREATE TABLE channel_connections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel             VARCHAR(20) NOT NULL CHECK (channel IN ('whatsapp', 'messenger', 'instagram')),
  external_id         VARCHAR(64) NOT NULL,        -- page_id (messenger) | ig_user_id (instagram) | phone_number_id (whatsapp)
  display_name        VARCHAR(255),                 -- Page name | IG @username | nombre amigable
  profile_picture_url TEXT,
  access_token_encrypted    TEXT NOT NULL,          -- AES-256-GCM
  access_token_expires_at   TIMESTAMPTZ,            -- NULL para Messenger (Page tokens no expiran), 60d para IG
  metadata            JSONB DEFAULT '{}',           -- guardar: page_category, ig_account_type, scopes granted, etc.
  status              VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'error')),
  last_error          TEXT,
  connected_by_user_id UUID REFERENCES users(id),
  connected_at        TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, channel, external_id)
);

CREATE INDEX idx_channel_connections_tenant ON channel_connections(tenant_id, channel, status);
CREATE INDEX idx_channel_connections_external ON channel_connections(channel, external_id);
```

Tabla de auditoría OAuth (recomendada para soporte y debugging):

```sql
CREATE TABLE oauth_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID,
  channel      VARCHAR(20),
  step         VARCHAR(40),       -- 'init', 'callback', 'token_exchange', 'long_lived_exchange', 'subscribe_webhook', 'success', 'error'
  status_code  INTEGER,
  payload      JSONB,             -- request/response sin secretos
  error_message TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);
```

---

## 6. Helper: cifrado de tokens (obligatorio)

```typescript
// utils/crypto.ts
import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const KEY = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, 'hex'); // 32 bytes

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptToken(encoded: string): string {
  const data = Buffer.from(encoded, 'base64');
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
```

⚠️ **Nunca loguear tokens, ni siquiera fragmentos.** Logs deben mostrar `***REDACTED***`.

---

## 7. FLUJO MESSENGER

### 7.1 Frontend — `/admin/channels/messenger/page.tsx`

Reemplazar el formulario actual de "Facebook Page ID + Page Access Token + Nombre" por un único botón **"Conectar con Facebook"**.

```tsx
'use client';

import { useEffect } from 'react';

declare global {
  interface Window { FB: any; fbAsyncInit: () => void; }
}

export default function MessengerConnectPage() {
  useEffect(() => {
    // Cargar SDK solo si no está ya cargado (probablemente ya lo está por WhatsApp ESU)
    if (window.FB) return;
    window.fbAsyncInit = function () {
      window.FB.init({
        appId: process.env.NEXT_PUBLIC_META_APP_ID,
        cookie: true,
        xfbml: false,
        version: 'v21.0',
      });
    };
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    document.body.appendChild(script);
  }, []);

  const handleConnect = () => {
    window.FB.login(
      (response: any) => {
        if (response.authResponse?.code) {
          // Mandar el code al backend para canjearlo
          fetch('/api/channels/messenger/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: response.authResponse.code }),
          })
            .then((r) => r.json())
            .then((data) => {
              if (data.success) {
                // Refrescar UI; mostrar páginas conectadas
                window.location.reload();
              } else {
                alert(`Error: ${data.error}`);
              }
            });
        } else {
          console.warn('User cancelled or did not grant permissions', response);
        }
      },
      {
        config_id: process.env.NEXT_PUBLIC_MESSENGER_FB_LOGIN_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
      }
    );
  };

  return (
    <div>
      {/* Bloque de Webhook URL + Verify Token: déjalo informativo, ya está configurado en Meta */}
      <button onClick={handleConnect} className="btn-primary">
        Conectar con Facebook
      </button>
    </div>
  );
}
```

### 7.2 Backend — `POST /api/channels/messenger/connect`

```typescript
// app/api/channels/messenger/connect/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { encryptToken } from '@/utils/crypto';
import { getCurrentTenant } from '@/auth';

export async function POST(req: NextRequest) {
  const tenant = await getCurrentTenant(req);
  if (!tenant) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { code } = await req.json();
  if (!code) return NextResponse.json({ error: 'missing_code' }, { status: 400 });

  try {
    // Paso 1: Canjear code por user access token (ya viene long-lived al usar FB Login for Business con response_type=code)
    const tokenRes = await fetch(
      `https://graph.facebook.com/${process.env.META_GRAPH_VERSION}/oauth/access_token?` +
        new URLSearchParams({
          client_id: process.env.META_APP_ID!,
          client_secret: process.env.META_APP_SECRET!,
          redirect_uri: process.env.MESSENGER_REDIRECT_URI!,
          code,
        })
    );
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(`token_exchange: ${tokenData.error.message}`);
    const userAccessToken: string = tokenData.access_token;

    // Paso 2: Listar páginas que el usuario administra
    const pagesRes = await fetch(
      `https://graph.facebook.com/${process.env.META_GRAPH_VERSION}/me/accounts?` +
        new URLSearchParams({
          fields: 'id,name,category,picture,access_token,tasks',
          access_token: userAccessToken,
        })
    );
    const pagesData = await pagesRes.json();
    if (pagesData.error) throw new Error(`me_accounts: ${pagesData.error.message}`);

    const pages = pagesData.data || [];
    if (pages.length === 0) {
      return NextResponse.json(
        { error: 'no_pages_found', message: 'El usuario no administra ninguna Página de Facebook.' },
        { status: 400 }
      );
    }

    // Paso 3: Para cada página seleccionada, suscribir webhook + guardar
    // Si solo hay 1 página, conectarla directo. Si hay múltiples, devolver lista para que el frontend la muestre.
    // (Recomendado MVP: si vinieron N páginas, conectar todas. Refinar luego con UI de selección.)
    const connected = [];
    for (const page of pages) {
      // Validar que el usuario tenga permiso de mensajería sobre la página
      if (!page.tasks?.includes('MESSAGING') && !page.tasks?.includes('MANAGE')) continue;

      // Suscribir webhook
      const subRes = await fetch(
        `https://graph.facebook.com/${process.env.META_GRAPH_VERSION}/${page.id}/subscribed_apps`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            subscribed_fields:
              'messages,messaging_postbacks,message_deliveries,message_reads,messaging_referrals',
            access_token: page.access_token,
          }),
        }
      );
      const subData = await subRes.json();
      if (subData.error) throw new Error(`subscribe_app: ${subData.error.message}`);

      // Upsert en DB
      await db.channelConnection.upsert({
        where: {
          tenantId_channel_externalId: {
            tenantId: tenant.id,
            channel: 'messenger',
            externalId: page.id,
          },
        },
        update: {
          accessTokenEncrypted: encryptToken(page.access_token),
          displayName: page.name,
          profilePictureUrl: page.picture?.data?.url,
          metadata: { category: page.category, tasks: page.tasks },
          status: 'active',
          updatedAt: new Date(),
        },
        create: {
          tenantId: tenant.id,
          channel: 'messenger',
          externalId: page.id,
          accessTokenEncrypted: encryptToken(page.access_token),
          accessTokenExpiresAt: null, // Page tokens no expiran
          displayName: page.name,
          profilePictureUrl: page.picture?.data?.url,
          metadata: { category: page.category, tasks: page.tasks },
          status: 'active',
        },
      });

      connected.push({ id: page.id, name: page.name, picture: page.picture?.data?.url });
    }

    return NextResponse.json({ success: true, connected });
  } catch (err: any) {
    // Loggear a oauth_audit_log
    await db.oauthAuditLog.create({
      data: { tenantId: tenant.id, channel: 'messenger', step: 'error', errorMessage: err.message },
    });
    return NextResponse.json({ error: 'oauth_failed', message: err.message }, { status: 500 });
  }
}
```

### 7.3 UI de "ya conectado"

Cuando el cliente entra a `/admin/channels/messenger` y ya hay connections en DB para su tenant, mostrar:
- Lista de páginas conectadas con foto + nombre + estado.
- Botón "Desconectar" por página (que llama a `DELETE /api/channels/messenger/:page_id`).
- Botón "Conectar otra página" (vuelve a abrir `FB.login`).

---

## 8. FLUJO INSTAGRAM

### 8.1 Frontend — `/admin/channels/instagram/page.tsx`

NO se usa `FB.login`. Es un redirect (o popup) directo a Instagram OAuth.

```tsx
'use client';

export default function InstagramConnectPage() {
  const handleConnect = () => {
    // Generar state CSRF y guardarlo en sessionStorage para validarlo en callback
    const state = crypto.randomUUID();
    sessionStorage.setItem('ig_oauth_state', state);

    const params = new URLSearchParams({
      enable_fb_login: '0',
      force_authentication: '1',
      client_id: process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID!,
      redirect_uri: process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI!,
      response_type: 'code',
      scope: 'instagram_business_basic,instagram_business_manage_messages',
      state,
    });

    // Abrir en popup centrado (UX consistente con WhatsApp ESU)
    const w = 600, h = 700;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(
      `https://www.instagram.com/oauth/authorize?${params.toString()}`,
      'ig_oauth',
      `width=${w},height=${h},left=${left},top=${top}`
    );

    // Escuchar postMessage desde el callback
    const listener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'ig_oauth_success') {
        window.removeEventListener('message', listener);
        popup?.close();
        window.location.reload();
      } else if (event.data?.type === 'ig_oauth_error') {
        window.removeEventListener('message', listener);
        popup?.close();
        alert(`Error: ${event.data.message}`);
      }
    };
    window.addEventListener('message', listener);
  };

  return (
    <div>
      {/* Webhook URL + Verify Token (informativo) */}
      <button onClick={handleConnect} className="btn-primary">
        Conectar con Instagram
      </button>
    </div>
  );
}
```

### 8.2 Callback page — `/admin/channels/instagram/callback/page.tsx`

```tsx
'use client';
import { useEffect } from 'react';

export default function InstagramCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    const expectedState = sessionStorage.getItem('ig_oauth_state');
    sessionStorage.removeItem('ig_oauth_state');

    if (error) {
      window.opener?.postMessage(
        { type: 'ig_oauth_error', message: params.get('error_description') || error },
        window.location.origin
      );
      return;
    }
    if (!code || state !== expectedState) {
      window.opener?.postMessage(
        { type: 'ig_oauth_error', message: 'Invalid state or missing code' },
        window.location.origin
      );
      return;
    }

    fetch('/api/channels/instagram/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          window.opener?.postMessage({ type: 'ig_oauth_success' }, window.location.origin);
        } else {
          window.opener?.postMessage(
            { type: 'ig_oauth_error', message: data.message },
            window.location.origin
          );
        }
      });
  }, []);

  return <div>Conectando...</div>;
}
```

### 8.3 Backend — `POST /api/channels/instagram/connect`

```typescript
// app/api/channels/instagram/connect/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { encryptToken } from '@/utils/crypto';
import { getCurrentTenant } from '@/auth';

export async function POST(req: NextRequest) {
  const tenant = await getCurrentTenant(req);
  if (!tenant) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { code } = await req.json();
  if (!code) return NextResponse.json({ error: 'missing_code' }, { status: 400 });

  try {
    // Paso 1: Code -> short-lived token
    const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.INSTAGRAM_APP_ID!,
        client_secret: process.env.INSTAGRAM_APP_SECRET!,
        grant_type: 'authorization_code',
        redirect_uri: process.env.INSTAGRAM_REDIRECT_URI!,
        code,
      }),
    });
    const shortData = await shortRes.json();
    // Respuesta: { data: [{ access_token, user_id, permissions }] } o { access_token, user_id, permissions } según versión
    const shortToken =
      shortData.data?.[0]?.access_token || shortData.access_token;
    const igUserId =
      shortData.data?.[0]?.user_id || shortData.user_id;
    if (!shortToken) throw new Error(`short_token_exchange: ${JSON.stringify(shortData)}`);

    // Paso 2: short-lived -> long-lived (60 días)
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?` +
        new URLSearchParams({
          grant_type: 'ig_exchange_token',
          client_secret: process.env.INSTAGRAM_APP_SECRET!,
          access_token: shortToken,
        })
    );
    const longData = await longRes.json();
    if (!longData.access_token) throw new Error(`long_token_exchange: ${JSON.stringify(longData)}`);

    const longLivedToken: string = longData.access_token;
    const expiresInSec: number = longData.expires_in; // ~5,184,000 (60 días)
    const expiresAt = new Date(Date.now() + expiresInSec * 1000);

    // Paso 3: Obtener perfil básico para mostrar en UI
    const profileRes = await fetch(
      `https://graph.instagram.com/v21.0/me?` +
        new URLSearchParams({
          fields: 'user_id,username,name,profile_picture_url,account_type',
          access_token: longLivedToken,
        })
    );
    const profile = await profileRes.json();

    // Paso 4: Guardar
    await db.channelConnection.upsert({
      where: {
        tenantId_channel_externalId: {
          tenantId: tenant.id,
          channel: 'instagram',
          externalId: String(igUserId),
        },
      },
      update: {
        accessTokenEncrypted: encryptToken(longLivedToken),
        accessTokenExpiresAt: expiresAt,
        displayName: profile.username ? `@${profile.username}` : profile.name,
        profilePictureUrl: profile.profile_picture_url,
        metadata: { account_type: profile.account_type, name: profile.name },
        status: 'active',
        updatedAt: new Date(),
      },
      create: {
        tenantId: tenant.id,
        channel: 'instagram',
        externalId: String(igUserId),
        accessTokenEncrypted: encryptToken(longLivedToken),
        accessTokenExpiresAt: expiresAt,
        displayName: profile.username ? `@${profile.username}` : profile.name,
        profilePictureUrl: profile.profile_picture_url,
        metadata: { account_type: profile.account_type, name: profile.name },
        status: 'active',
      },
    });

    return NextResponse.json({
      success: true,
      account: { id: igUserId, username: profile.username, picture: profile.profile_picture_url },
    });
  } catch (err: any) {
    await db.oauthAuditLog.create({
      data: { tenantId: tenant.id, channel: 'instagram', step: 'error', errorMessage: err.message },
    });
    return NextResponse.json({ error: 'oauth_failed', message: err.message }, { status: 500 });
  }
}
```

### 8.4 Cron de refresh de tokens IG (CRÍTICO)

Los Instagram User Tokens expiran a los 60 días. Si pasan 60 días sin refresh, el cliente queda desconectado y debe re-autorizar manualmente. Hay que prevenirlo.

```typescript
// jobs/refresh-instagram-tokens.ts (correr cada día via cron)
import { db } from '@/db';
import { encryptToken, decryptToken } from '@/utils/crypto';

export async function refreshInstagramTokens() {
  // Buscar tokens que expiren en menos de 30 días Y tengan más de 24h
  const threshold30d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const connections = await db.channelConnection.findMany({
    where: {
      channel: 'instagram',
      status: 'active',
      accessTokenExpiresAt: { lte: threshold30d },
      updatedAt: { lte: oneDayAgo },
    },
  });

  for (const conn of connections) {
    try {
      const currentToken = decryptToken(conn.accessTokenEncrypted);
      const res = await fetch(
        `https://graph.instagram.com/refresh_access_token?` +
          new URLSearchParams({
            grant_type: 'ig_refresh_token',
            access_token: currentToken,
          })
      );
      const data = await res.json();
      if (!data.access_token) {
        await db.channelConnection.update({
          where: { id: conn.id },
          data: { status: 'error', lastError: `refresh_failed: ${JSON.stringify(data)}` },
        });
        continue;
      }
      await db.channelConnection.update({
        where: { id: conn.id },
        data: {
          accessTokenEncrypted: encryptToken(data.access_token),
          accessTokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
          updatedAt: new Date(),
        },
      });
    } catch (err: any) {
      await db.channelConnection.update({
        where: { id: conn.id },
        data: { status: 'error', lastError: err.message },
      });
    }
  }
}
```

⚠️ Si una conexión queda con status `error` o `expired`, mostrar un banner en `/admin/channels/instagram` pidiéndole al cliente reconectar. NO intentar usar el token automáticamente.

---

## 9. WEBHOOKS

### 9.1 GET handler (verificación) — compartido por canal

```typescript
// app/api/v1/channels/webhook/[channel]/route.ts (GET)
export async function GET(req: NextRequest, { params }: { params: { channel: string } }) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('forbidden', { status: 403 });
}
```

### 9.2 POST handler — Messenger

Payload típico:
```json
{
  "object": "page",
  "entry": [{
    "id": "<PAGE_ID>",
    "time": 1234567890,
    "messaging": [{
      "sender": { "id": "<PSID>" },
      "recipient": { "id": "<PAGE_ID>" },
      "timestamp": 1234567890,
      "message": { "mid": "...", "text": "Hola" }
    }]
  }]
}
```

Lógica:
1. Validar firma `X-Hub-Signature-256` con `META_APP_SECRET`.
2. Por cada `entry`, buscar `channel_connections` donde `channel='messenger'` y `external_id=entry.id`.
3. Si no se encuentra, ignorar (no es de un cliente nuestro).
4. Si se encuentra, normalizar el mensaje y emitirlo al sistema interno de Parallly (inbox, automatización, etc.).

### 9.3 POST handler — Instagram

Payload típico:
```json
{
  "object": "instagram",
  "entry": [{
    "id": "<IG_USER_ID>",
    "time": 1234567890,
    "messaging": [{
      "sender": { "id": "<IG_SCOPED_USER_ID>" },
      "recipient": { "id": "<IG_USER_ID>" },
      "timestamp": 1234567890,
      "message": { "mid": "...", "text": "Hola" }
    }]
  }]
}
```

Misma lógica que Messenger, pero buscando por `channel='instagram'` y `external_id=entry.id`.

### 9.4 Validación de firma (CRÍTICO de seguridad)

```typescript
import crypto from 'crypto';

function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected =
    'sha256=' +
    crypto
      .createHmac('sha256', process.env.META_APP_SECRET!)
      .update(rawBody)
      .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

Aplicar en el POST handler antes de procesar.

---

## 10. ENVÍO DE MENSAJES (outbound)

### 10.1 Messenger — Send API

```typescript
async function sendMessengerMessage(pageId: string, recipientPsid: string, text: string) {
  const conn = await db.channelConnection.findUnique({
    where: { /* por pageId del tenant */ },
  });
  const pageToken = decryptToken(conn.accessTokenEncrypted);

  const res = await fetch(
    `https://graph.facebook.com/v21.0/me/messages?access_token=${pageToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientPsid },
        message: { text },
        messaging_type: 'RESPONSE', // o MESSAGE_TAG si fuera del sweet 24h con tag aprobado
      }),
    }
  );
  return res.json();
}
```

### 10.2 Instagram — Messaging API

```typescript
async function sendInstagramMessage(igUserId: string, recipientId: string, text: string) {
  const conn = await db.channelConnection.findUnique({
    where: { /* por igUserId del tenant */ },
  });
  const igToken = decryptToken(conn.accessTokenEncrypted);

  const res = await fetch(
    `https://graph.instagram.com/v21.0/${igUserId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${igToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
    }
  );
  return res.json();
}
```

⚠️ Respetar la ventana de 24 horas. Si el último mensaje del usuario fue hace >24h, el envío fallará (excepto con tags válidos en Messenger; IG no tiene tags equivalentes para mensajería estándar).

---

## 11. DESCONEXIÓN

`DELETE /api/channels/:channel/:external_id`:

**Messenger:**
1. `DELETE https://graph.facebook.com/v21.0/{page-id}/subscribed_apps?access_token={page-token}` (desuscribir webhook).
2. Marcar connection como `status='revoked'` en DB (no borrar para mantener histórico).

**Instagram:**
1. (Opcional) Llamar a `DELETE /me/permissions?access_token=...` para revocar.
2. Marcar `status='revoked'`.

---

## 12. MANEJO DE ERRORES COMUNES

| Código Meta | Significado | Acción |
|---|---|---|
| `OAuthException 190` | Token inválido/expirado | Marcar connection como `expired`; pedir reconexión al cliente. |
| `OAuthException 100` | Permiso faltante | Cliente debe re-autorizar con scopes correctos. |
| `Subcode 458` | App no instalada por el usuario | Reconexión completa. |
| `10` (Messenger) | Mensaje fuera de 24h sin tag | Validar antes de enviar; usar tag aprobado o no enviar. |
| `551` (IG) | Usuario no permite DMs del negocio | No reintentar. |

Implementar manejo central de errores que automáticamente cambie el `status` de la connection y notifique al tenant via UI (banner en `/admin/channels/...`).

---

## 13. CRITERIOS DE ACEPTACIÓN

Para considerar la implementación lista:

**Messenger:**
- [ ] El cliente entra a `/admin/channels/messenger`, da click en "Conectar con Facebook", autoriza, y vuelve a Parallly viendo su(s) página(s) listada(s) con foto y nombre.
- [ ] No hay ningún campo manual (no se pega Page ID ni Token).
- [ ] El webhook se suscribe automáticamente a la página tras la conexión.
- [ ] Un mensaje enviado desde Messenger a la página llega a la inbox de Parallly en <5 segundos.
- [ ] Un mensaje enviado desde Parallly llega al usuario de Messenger.
- [ ] El cliente puede desconectar la página y se desuscribe el webhook.

**Instagram:**
- [ ] El cliente entra a `/admin/channels/instagram`, da click en "Conectar con Instagram", autoriza en el popup, y al cerrarse el popup ve su cuenta IG conectada con @username y foto.
- [ ] El long-lived token se almacena cifrado con `expires_at` correcto.
- [ ] El cron de refresh extiende tokens que estén a <30 días de expirar.
- [ ] Un DM enviado a la cuenta IG llega a la inbox de Parallly en <5s.
- [ ] Una respuesta desde Parallly llega al DM del usuario.
- [ ] Tokens expirados/revocados muestran banner de "Reconectar" en la UI.

**Seguridad:**
- [ ] Tokens cifrados con AES-256-GCM en DB.
- [ ] Logs no exponen tokens.
- [ ] Webhook valida `X-Hub-Signature-256` antes de procesar payload.
- [ ] State CSRF validado en callback de Instagram.

**Multi-tenancy:**
- [ ] Cada `channel_connection` está scoped a un `tenant_id`. Imposible que tenant A vea conexiones de tenant B.
- [ ] El webhook enruta correctamente al tenant correcto basándose en `external_id` (page_id o ig_user_id).

---

## 14. NOTAS FINALES PARA CLAUDE CODE

- **Reusar el patrón de WhatsApp Embedded Signup** que ya existe en el repo. La sesión, el manejo de tenant, el cargado del SDK de Facebook, la encriptación de tokens — probablemente todo eso ya está y solo hay que extenderlo.
- **NO crear componentes de UI desde cero** si ya hay un `ChannelConnectCard`, `ChannelStatusBadge`, etc. Reutilizar.
- **Stack asumido (ajustar a lo real):** Next.js 14 App Router, TypeScript, Prisma o Drizzle como ORM, Postgres. Si el stack es distinto, traducir los snippets manteniendo la lógica.
- **Tests mínimos requeridos:** unit test del cifrado, integration test del callback de Instagram (mockear respuestas de Meta), e2e test del flujo Messenger con FB Login mockeado.
- **Hasta que App Review apruebe los permisos, solo testers/admins de la app podrán completar el flujo.** En desarrollo, agregar la cuenta de testing al rol de Tester en App Dashboard.
- Antes de mergear, **eliminar el formulario manual actual** de `/admin/channels/messenger` y `/admin/channels/instagram`. Solo quedan: el bloque informativo de Webhook URL (read-only) y el botón "Conectar".

---

## 15. ROADMAP POST-MVP (no para este sprint)

- Selector de páginas cuando el usuario admina múltiples (UI tipo modal).
- Re-uso del mismo `FB.login` para WhatsApp + Messenger en una sola pasada (configuración combinada).
- Soporte de Ice Breakers, Persistent Menu, Get Started Button para Messenger.
- Soporte de IG Stories Replies y mention webhooks.
- Métricas por canal en `/admin/analytics`.
