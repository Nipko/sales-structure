# WhatsApp Automation Blueprint

Guía completa para implementar automatización de WhatsApp con agente conversacional IA en cualquier proyecto. Abstracción de la implementación de Parallext.

---

## Arquitectura general

```
WhatsApp → Meta Cloud API → Chatwoot (inbox) → Webhook → Tu Sistema → LLM → Chatwoot API → WhatsApp
                                                              ↓
                                                     Meta API (read receipts)
```

### Componentes necesarios

| Componente | Función | Alternativas |
|---|---|---|
| **Chatwoot** | Inbox de mensajes, gestión de conversaciones | Cualquier plataforma que reciba webhooks de WhatsApp |
| **Webhook receiver** | Recibe eventos de Chatwoot | Express, NestJS, FastAPI, cualquier HTTP server |
| **Identity resolver** | Identifica clientes entre canales | PostgreSQL + lógica de matching |
| **Config manager** | Configura comportamiento del agente | Base de datos + admin panel |
| **LLM Runner** | Genera respuestas con IA | OpenAI, Anthropic, cualquier LLM |
| **Response writer** | Envía respuesta de vuelta | Chatwoot API |
| **Meta API client** | Read receipts, typing | Llamadas directas a Graph API |

---

## Paso 1: Configurar Chatwoot con WhatsApp

### Requisitos previos
- Facebook App con WhatsApp Business API habilitado
- Número de WhatsApp Business verificado
- Chatwoot instalado (Docker recomendado)

### Instalación de Chatwoot (Docker)

```yaml
# docker-compose.yml
services:
  chatwoot-app:
    image: chatwoot/chatwoot:latest
    env_file: .env
    entrypoint: docker/entrypoints/rails.sh
    command: ["bundle", "exec", "rails", "s", "-p", "3000", "-b", "0.0.0.0"]
    ports:
      - "127.0.0.1:3000:3000"
    volumes:
      - chatwoot_storage:/app/storage
    depends_on:
      chatwoot-postgres:
        condition: service_healthy
      chatwoot-redis:
        condition: service_healthy

  chatwoot-sidekiq:
    image: chatwoot/chatwoot:latest
    env_file: .env
    command: ["bundle", "exec", "sidekiq", "-C", "config/sidekiq.yml"]
    volumes:
      - chatwoot_storage:/app/storage
    depends_on:
      chatwoot-postgres:
        condition: service_healthy
      chatwoot-redis:
        condition: service_healthy

  chatwoot-postgres:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_USER: chatwoot
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: chatwoot
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U chatwoot"]
      interval: 10s
      timeout: 5s
      retries: 5

  chatwoot-redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  chatwoot_storage:
  pg_data:
  redis_data:
```

### Variables de entorno de Chatwoot (.env)

```env
SECRET_KEY_BASE=<openssl rand -hex 64>
FRONTEND_URL=https://chatwoot.tudominio.com
RAILS_ENV=production
POSTGRES_HOST=chatwoot-postgres
POSTGRES_PORT=5432
POSTGRES_USERNAME=chatwoot
POSTGRES_PASSWORD=<password>
POSTGRES_DATABASE=chatwoot
REDIS_URL=redis://:${REDIS_PASSWORD}@chatwoot-redis:6379
FB_APP_ID=<tu_facebook_app_id>
FB_APP_SECRET=<tu_facebook_app_secret>
```

### Setup de base de datos

```bash
docker compose run --rm chatwoot-app bundle exec rails db:chatwoot_prepare
docker compose up -d
```

### Conectar WhatsApp
1. En Chatwoot: Settings → Inboxes → Add Inbox → WhatsApp
2. Configurar con Facebook App credentials
3. Verificar que los mensajes llegan a Chatwoot

### API Token
**IMPORTANTE:** El token de Chatwoot debe ser de un **usuario regular** (Agent/Admin), NO de SuperAdmin. SuperAdmin devuelve 401 en la API de cuentas.

```bash
# Crear usuario via Rails console
docker compose exec chatwoot-app bundle exec rails console

> account = Account.first
> user = User.create!(name: "Bot", email: "bot@tudominio.com", password: "password", confirmed_at: Time.now)
> account.account_users.create!(user: user, role: :administrator)
> puts user.access_token.token
```

---

## Paso 2: Webhook receiver

### Qué envía Chatwoot

Configurar en Chatwoot: Settings → Integrations → Webhooks → URL: `https://api.tudominio.com/webhooks/chatwoot`

Chatwoot envía un payload JSON por cada evento. El importante es `message_created`:

```json
{
  "event": "message_created",
  "message_type": "incoming",
  "content": "Hola, quiero información",
  "content_type": "text",
  "source_id": "wamid.HBgMNTczMjA4MDEwNzM3...",
  "conversation": {
    "id": 1,
    "channel": "Channel::Whatsapp",
    "contact_inbox": {
      "source_id": "573208010737"
    }
  },
  "sender": {
    "id": 1,
    "name": "Juan Perez",
    "type": "contact",
    "phone_number": "+573208010737",
    "email": null
  },
  "account": {
    "id": 1,
    "name": "Mi Empresa"
  }
}
```

### Campos clave del payload

| Campo | Descripción | Uso |
|---|---|---|
| `event` | Tipo de evento | Solo procesar `message_created` |
| `message_type` | `incoming` (0) o `outgoing` (1) | Solo procesar incoming |
| `content` | Texto del mensaje | Enviar al LLM |
| `source_id` | WhatsApp message ID (wamid) | Para read receipts con Meta API |
| `conversation.id` | ID de conversación en Chatwoot | Para enviar respuesta |
| `conversation.channel` | Canal (`Channel::Whatsapp`) | Para detectar WhatsApp |
| `sender.type` | `contact` o `user` | Solo procesar `contact` |
| `sender.phone_number` | Teléfono del contacto | Para identificación |
| `account.id` | ID de cuenta Chatwoot | Para la API (viene como objeto, no número) |

### Implementación del receiver (NestJS)

```typescript
@Post('chatwoot')
@HttpCode(200)
async handleWebhook(@Body() payload: any) {
  // Solo message_created
  if (payload.event !== 'message_created') return { received: true };

  // Solo incoming de contactos
  const isIncoming = payload.message_type === 0 || payload.message_type === 'incoming';
  if (!isIncoming) return { received: true };
  if (payload.sender?.type !== 'contact') return { received: true };
  if (!payload.content?.trim()) return { received: true };

  // Read receipt inmediato (WhatsApp)
  if (payload.source_id && payload.conversation?.channel === 'Channel::Whatsapp') {
    this.whatsappService.markAsRead(payload.source_id).catch(() => {});
  }

  // Procesar async (no bloquear respuesta a Chatwoot)
  this.processMessage(payload).catch(err => console.error(err));

  return { received: true };
}
```

### IMPORTANTE: No usar validación estricta de DTO

Chatwoot envía payloads complejos con campos anidados que varían por versión. **No uses class-validator** en el webhook endpoint — acepta `any` y extrae lo que necesitas.

### IMPORTANTE: account viene como objeto

```typescript
// ❌ MAL — payload.account es {id: 1, name: "Mi Empresa"}, no un número
const accountId = payload.account;

// ✅ BIEN
const accountId = typeof payload.account === 'object' ? payload.account?.id : payload.account;
```

---

## Paso 3: Normalización del evento

Transformar el payload crudo en un evento tipado:

```typescript
interface IncomingEvent {
  messageId: string;        // source_id (wamid para WhatsApp)
  conversationId: number;   // conversation.id
  accountId: number;        // account.id (extraído del objeto)
  contactPhone: string;     // sender.phone_number
  contactName: string;      // sender.name
  contactEmail: string;     // sender.email
  channel: string;          // 'whatsapp' | 'instagram' | 'messenger' | 'email'
  content: string;          // message content
  contentType: string;      // 'text' | 'image' | etc.
}

function normalize(payload: any): IncomingEvent {
  const channelMap: Record<string, string> = {
    'Channel::Whatsapp': 'whatsapp',
    'Channel::Instagram': 'instagram',
    'Channel::FacebookPage': 'messenger',
    'Channel::Email': 'email',
  };

  const rawAccount = payload.account;
  const accountId = typeof rawAccount === 'object' ? rawAccount?.id : rawAccount;
  const channel = channelMap[payload.conversation?.channel] || 'whatsapp';

  return {
    messageId: payload.source_id || String(payload.id || ''),
    conversationId: payload.conversation?.id,
    accountId,
    contactPhone: payload.sender?.phone_number || null,
    contactName: payload.sender?.name || 'Unknown',
    contactEmail: payload.sender?.email || null,
    channel,
    content: payload.content || '',
    contentType: payload.content_type || 'text',
  };
}
```

---

## Paso 4: Llamar al LLM

```typescript
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateResponse(
  systemPrompt: string,
  userMessage: string,
  config: { model: string; temperature: number; maxTokens: number }
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: config.model,
    temperature: Number(config.temperature),  // IMPORTANTE: castear a Number
    max_tokens: Number(config.maxTokens),      // PostgreSQL devuelve strings para numeric
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });

  return response.choices[0]?.message?.content || '';
}
```

### IMPORTANTE: Castear valores numéricos

Si los parámetros del modelo vienen de una base de datos PostgreSQL via TypeORM, los campos `numeric` pueden llegar como strings. OpenAI rechaza strings con: `"expected a decimal, but got a string"`.

```typescript
// ❌ MAL
temperature: modelConfig.temperature   // puede ser "0.7" (string)

// ✅ BIEN
temperature: Number(modelConfig.temperature)  // 0.7 (number)
```

---

## Paso 5: Enviar respuesta via Chatwoot

```typescript
async function sendResponse(
  chatwootBaseUrl: string,
  apiToken: string,
  accountId: number,
  conversationId: number,
  content: string
) {
  const url = `${chatwootBaseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'api_access_token': apiToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content,
      message_type: 'outgoing',
      private: false,
    }),
  });

  return response.json();
}
```

### IMPORTANTE: URL interna de Chatwoot

Si tu sistema corre en Docker junto con Chatwoot, **no uses la URL pública** de Chatwoot. Cloudflare puede interferir con el header `api_access_token`.

Solución: conectar ambos stacks Docker via una red bridge compartida:

```yaml
# En tu docker-compose.yml
services:
  tu-servicio:
    networks:
      - tu-red
      - chatwoot-bridge

networks:
  tu-red:
    driver: bridge
  chatwoot-bridge:
    external: true
```

```yaml
# En chatwoot/docker-compose.yml
services:
  chatwoot-app:
    networks:
      - chatwoot-net
      - chatwoot-bridge

networks:
  chatwoot-net:
    driver: bridge
  chatwoot-bridge:
    external: true
```

```bash
# Crear la red (una vez)
docker network create chatwoot-bridge
```

Después usar: `CHATWOOT_BASE_URL=http://chatwoot-chatwoot-app-1:3000`

---

## Paso 6: Read receipts (checks azules)

Llamar directamente a la API de Meta cuando recibes un mensaje:

```typescript
async function markAsRead(
  phoneNumberId: string,
  accessToken: string,
  messageId: string   // el source_id/wamid del webhook
) {
  await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    }),
  });
}
```

**Dónde obtener las credenciales:**
- `phoneNumberId`: Meta Business Manager → Tu App → WhatsApp → API Setup → Phone number ID
- `accessToken`: Meta Business Manager → Tu App → Settings → Basic → App Secret (o System User token permanente)

**Cuándo llamarlo:** inmediatamente al recibir el webhook, antes de procesar el mensaje.

---

## Paso 7: Idempotencia

Los webhooks pueden llegar duplicados. Usa una clave de idempotencia:

```typescript
const idempotencyKey = `${event.messageId}:${event.conversationId}`;

// Verificar si ya procesamos este mensaje
const exists = await db.query(
  'SELECT 1 FROM idempotency_keys WHERE key = $1',
  [idempotencyKey]
);

if (exists) {
  console.log('Duplicate message, skipping');
  return;
}

// Guardar clave
await db.query(
  'INSERT INTO idempotency_keys (key, created_at, expires_at) VALUES ($1, NOW(), NOW() + INTERVAL \'24 hours\')',
  [idempotencyKey]
);
```

---

## Paso 8: Fallback a humano (handoff)

Si el LLM falla o el usuario pide hablar con un humano:

```typescript
// Detectar pedido de humano
const humanRequestRegex = /hablar con.*(humano|agente|persona|asesor)|necesito ayuda real/i;
if (humanRequestRegex.test(userMessage)) {
  // Crear nota interna en Chatwoot
  await sendResponse(chatwootUrl, token, accountId, conversationId,
    '[Nota interna] Cliente solicita atención humana', true /* private */);
  return;
}

// Si el LLM falla
try {
  const response = await generateResponse(prompt, message, config);
  await sendResponse(chatwootUrl, token, accountId, conversationId, response);
} catch (error) {
  // Nota interna para el equipo
  await sendResponse(chatwootUrl, token, accountId, conversationId,
    `[Nota interna] Bot falló: ${error.message}. Requiere atención humana.`, true);
}
```

---

## Paso 9: Autenticación entre servicios

Si tienes múltiples microservicios que se llaman entre sí:

```typescript
// Guard que acepta JWT (frontend) o Internal Key (servicios)
canActivate(context) {
  const request = context.switchToHttp().getRequest();

  // Internal service-to-service
  const internalKey = request.headers['x-internal-key'];
  if (internalKey === process.env.INTERNAL_API_KEY) {
    request.user = { sub: 'internal', role: 'admin' };
    return true;
  }

  // JWT from frontend
  const token = request.headers.authorization?.split(' ')[1];
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  request.user = payload;
  return true;
}
```

---

## Gotchas y lecciones aprendidas

### 1. Chatwoot SuperAdmin ≠ User
Los tokens de SuperAdmin NO funcionan con la API de cuentas (`/api/v1/accounts/:id/...`). Debes crear un usuario regular.

### 2. Cloudflare stripea headers
Si Chatwoot está detrás de Cloudflare, el header `api_access_token` puede ser stripeado. Solución: comunicar via red Docker interna.

### 3. Chatwoot 4.x no tiene typing API
El endpoint `toggle_typing` no existe en Chatwoot 4.12. No se puede enviar "escribiendo..." via Chatwoot.

### 4. TypeORM numeric → string
PostgreSQL `numeric(3,2)` columns devuelven strings via TypeORM. Siempre castear con `Number()` antes de enviar a OpenAI.

### 5. Webhook payload varía por versión
No confíes en DTOs estrictos para webhooks de Chatwoot. El payload cambia entre versiones. Acepta `any` y extrae defensivamente.

### 6. account es objeto, no número
Chatwoot envía `account: {id: 1, name: "..."}` no `account: 1`. Siempre extraer `.id`.

### 7. Docker networks entre compose stacks
Dos docker-compose separados no comparten red por defecto. Crear una red `external: true` y conectar ambos.

### 8. Self-hosted runner para CI/CD
Hostinger (y muchos VPS económicos) bloquean SSH desde IPs de GitHub Actions. Usar self-hosted runner en el VPS.

---

## Stack mínimo para replicar

```
Node.js + cualquier framework HTTP (Express, NestJS, Fastify)
PostgreSQL (para persistencia)
Chatwoot (para WhatsApp inbox)
OpenAI API key (para LLM)
Meta WhatsApp Business API credentials (para read receipts)
Docker + Docker Compose
Nginx + Cloudflare (para SSL y proxy)
```

## Flujo completo resumido

```
1. Usuario envía "Hola" por WhatsApp
2. Meta recibe → Chatwoot recibe → Sidekiq dispara webhook
3. Tu webhook recibe POST con payload
4. Marcas como leído en Meta (checks azules)
5. Normalizas el payload
6. Verificas idempotencia
7. Cargas config del agente (prompt, modelo, temperatura)
8. Llamas al LLM con el prompt + mensaje
9. Envías respuesta via API de Chatwoot
10. Chatwoot envía via Meta → WhatsApp → usuario recibe respuesta
```
