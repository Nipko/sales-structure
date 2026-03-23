# Especificación técnica — Servicio de onboarding de clientes a WhatsApp Business Cloud API con Embedded Signup

## 1. Objetivo

Construir un servicio backend, desplegado como **un contenedor adicional** dentro del proyecto **Parallly/Parallext** en EasyPanel, que permita:

- onboardear clientes nuevos a **WhatsApp Business Cloud API**;
- soportar **Embedded Signup v4**;
- soportar **coexistencia** con **WhatsApp Business App**;
- registrar y administrar los assets resultantes del cliente;
- dejar al cliente listo para enviar y recibir mensajes;
- enrutar webhooks de WhatsApp por cliente;
- exponer una API interna limpia para dashboard, automatizaciones y futuros módulos.

Meta documenta que **Embedded Signup v4** es la versión vigente, que el flujo se basa en **Facebook Login for Business** y que el signup genera o conecta automáticamente los assets de WhatsApp necesarios para operar. citeturn0search4turn0search5turn0search25

---

## 2. Decisión de stack recomendada

### Stack recomendado

**Backend: NestJS + TypeScript + PostgreSQL + Redis + BullMQ**

### Por qué este stack

- Encaja bien con un servicio de tipo plataforma/API multi-tenant.
- TypeScript reduce fricción con tu frontend actual y con agentes de código.
- NestJS organiza mejor controladores, servicios, módulos, DTOs, guards, jobs y webhooks que un Express “plano”.
- PostgreSQL funciona muy bien para datos transaccionales, relaciones por cliente, auditoría y estados de onboarding.
- Redis + BullMQ simplifican tareas asíncronas, reintentos y procesamiento de webhooks.
- Corre bien como contenedor independiente en EasyPanel.

### Alternativa válida

**FastAPI** también sería buena, pero para este caso NestJS tiene ventaja práctica si quieres:

- panel interno más amplio;
- DTOs/validación estricta;
- jobs y módulos claros;
- futura integración con más módulos JavaScript/TypeScript.

### Recomendación final

Usa **NestJS**.

---

## 3. Recomendación de infraestructura con tu stack actual

Viendo tu stack actual, ya tienes contenedores de API, dashboard, Redis y PostgreSQL. Para este nuevo servicio:

### Recomendación

No crees una nueva VM ni una nueva instancia separada de PostgreSQL al inicio.

### Haz esto

- crea **un contenedor nuevo** para el servicio, por ejemplo `parallext-whatsapp-onboarding`;
- reutiliza el **mismo PostgreSQL** ya existente;
- reutiliza el **mismo Redis** ya existente;
- crea una **base de datos nueva** dentro del mismo PostgreSQL, o como mínimo un **schema separado**.

### Opción preferida

**Nueva base de datos en el mismo PostgreSQL**.

Ejemplo:

- instancia PostgreSQL actual: la misma
- nueva DB: `parallext_whatsapp`

### Por qué no usar la misma base de datos de n8n

No es recomendable mezclar este servicio con tablas de n8n porque:

- complica backups y restores;
- mezcla responsabilidad de producto con orquestación;
- hace más difícil auditar y migrar;
- sube riesgo de tocar tablas que no te pertenecen.

### Redis

Puedes reutilizar el Redis existente con prefijos de cola, por ejemplo:

- `wa:onboarding:*`
- `wa:webhooks:*`
- `wa:sync:*`

---

## 4. Requisitos funcionales

El servicio debe soportar estos casos de uso desde la primera arquitectura.

### Caso A — Cliente nuevo, sin WABA ni número previo

El cliente completa Embedded Signup y se crean los assets necesarios para operar en WhatsApp Business Platform. Meta describe este onboarding como el flujo principal de Embedded Signup. citeturn0search4turn0search5

### Caso B — Cliente con WABA existente

El sistema debe registrar y sincronizar los assets ya existentes del cliente si el flujo devuelve una cuenta ya creada.

### Caso C — Cliente con WhatsApp Business App existente

Debes soportar **coexistencia**, donde un cliente puede onboardear su cuenta existente de WhatsApp Business App y su número actual para usarlo también con la plataforma. Meta lo documenta explícitamente como un flujo soportado. citeturn0search1turn0search16turn0search12

### Caso D — Cliente cancela el flujo

Debe registrarse onboarding cancelado, con trazabilidad.

### Caso E — Cliente ya conectado

Debe detectarse y evitar duplicación de assets o múltiples onboardings activos incompatibles.

### Caso F — Reintento / reconexión

Debe existir una ruta para volver a sincronizar assets o retomar onboarding.

---

## 5. Requisitos de Meta que debes modelar

Tu diseño debe asumir estos componentes y restricciones:

- **Facebook Login for Business** como base del flujo. citeturn0search4
- Configuración de tipo **WhatsApp Embedded Signup**. citeturn0search0turn0search25
- Producto **WhatsApp Cloud API** dentro de la configuración. citeturn0search4
- Permisos `whatsapp_business_management` y `whatsapp_business_messaging`. citeturn0search4turn0search8
- Token de configuración tipo **system-user access token** para operación continua. Meta documenta el uso de system user tokens para WhatsApp Business Platform y onboarding tech provider. citeturn0search2turn0search8turn0search13
- Uso del `config_id` para lanzar el flujo. citeturn0search4turn0search25
- Webhooks como pieza obligatoria para mensajes, estados y sincronización. citeturn0search3turn0search10turn0search18

---

## 6. Arquitectura del servicio

### Contenedores

#### 1. `parallext-whatsapp-onboarding`
Servicio principal NestJS.

Responsabilidades:
- API REST interna;
- exchange del `code`;
- sincronización de assets Meta;
- gestión de onboarding;
- webhook receiver;
- tareas asíncronas;
- health checks.

#### 2. `parallext-whatsapp-worker`
Puede ser el mismo código, pero ejecutado como worker separado.

Responsabilidades:
- colas BullMQ;
- retries;
- sincronización de WABAs, números, templates;
- procesamiento pesado de webhooks.

#### 3. PostgreSQL
Preferiblemente misma instancia actual, **nueva base de datos**.

#### 4. Redis
Misma instancia actual.

---

## 7. Módulos backend a implementar

## 7.1. `AuthModule`

Responsabilidades:
- autenticar requests internas de Parallext;
- validar acceso por tenant/cliente;
- proteger endpoints admin;
- emitir JWT interno si hace falta.

## 7.2. `CustomersModule`

Responsabilidades:
- CRUD básico de clientes/tenants;
- mapear cliente interno con assets Meta.

## 7.3. `WhatsAppOnboardingModule`

Responsabilidades:
- iniciar onboarding;
- validar `code`;
- hacer exchange;
- descubrir assets;
- persistir estados;
- reconectar;
- cancelar;
- reintentar;
- soportar coexistencia.

## 7.4. `MetaGraphModule`

Responsabilidades:
- cliente HTTP tipado para Graph API;
- rotación segura de tokens;
- requests a Meta;
- manejo centralizado de errores, rate limits y retries.

## 7.5. `WhatsAppAssetsModule`

Responsabilidades:
- sincronizar WABAs;
- sincronizar números;
- sincronizar templates;
- sincronizar capacidades/estados.

## 7.6. `WebhooksModule`

Responsabilidades:
- endpoint GET de verificación;
- endpoint POST de recepción;
- validación;
- idempotencia;
- encolado;
- enrutamiento por cliente.

## 7.7. `JobsModule`

Responsabilidades:
- colas;
- tareas de reconciliación;
- polling eventual;
- reintentos;
- limpieza.

## 7.8. `AuditModule`

Responsabilidades:
- logs de onboarding;
- cambios de estado;
- actor que inició el proceso;
- payloads relevantes ofuscados.

## 7.9. `HealthModule`

Responsabilidades:
- `/health/live`
- `/health/ready`
- checks de DB, Redis y reachability básica.

---

## 8. Flujo completo de onboarding

## 8.1. Inicio del flujo

### Frontend

Botón “Conectar WhatsApp Business”.

Debe ejecutar `window.FB.login()` con:

- `config_id`
- `response_type: 'code'`
- `override_default_response_type: true`
- `extras.sessionInfoVersion`
- opcionalmente contexto del cliente en estado local

Esto coincide con el flujo actual de Facebook Login for Business + Embedded Signup v4. citeturn0search4turn0search25

### Frontend — listener extra recomendado

Agrega soporte a `window.addEventListener('message', ...)` para capturar eventos del flujo embebido y estados de sesión. Esto te ayuda a detectar cancelación, cierre y estado intermedio del flujo. Meta documenta `sessionInfoVersion` y variantes de datos para Embedded Signup v4. citeturn0search4turn0search25

## 8.2. Recepción del `code`

El frontend debe llamar al backend:

`POST /api/v1/whatsapp/onboarding/start`

Payload:

```json
{
  "customerId": "cust_123",
  "configId": "1433848224880053",
  "code": "AQAB...",
  "mode": "new|existing|coexistence",
  "source": "embedded_signup"
}
```

## 8.3. Exchange del `code`

El backend debe:

- validar request;
- verificar permisos del usuario interno;
- ejecutar el exchange del `code` con Meta;
- guardar el payload del exchange;
- pasar el onboarding al estado `EXCHANGE_COMPLETED`.

Meta documenta que el flujo de Embedded Signup para tech providers requiere capturar la data generada por el signup y usarla para onboardear al negocio cliente. citeturn0search4turn0search8

## 8.4. Descubrimiento de assets

El backend debe descubrir y guardar:

- `meta_business_id`
- `waba_id`
- `phone_number_id`
- `display_phone_number`
- `verified_name`
- estado de número
- si fue coexistencia
- tasks/permissions efectivas si están disponibles

## 8.5. Asociación con tenant interno

Debes asociar inequívocamente cada asset al `customerId` interno.

## 8.6. Verificación operativa

Luego del signup:

- verificar webhook;
- sincronizar templates;
- ejecutar test de lectura de assets;
- opcionalmente enviar mensaje de prueba.

## 8.7. Cierre del onboarding

Estados finales:

- `COMPLETED`
- `COMPLETED_WITH_WARNINGS`
- `FAILED`
- `CANCELLED`

---

## 9. Soporte completo de coexistencia

Meta documenta un flujo específico para **onboardear usuarios de WhatsApp Business App** y mantener operación conjunta con la plataforma. citeturn0search1turn0search16

### Debes modelar esto como caso de uso propio

### Campo lógico

- `signup_mode = 'coexistence'`

### Campos persistidos

- `is_coexistence`
- `coexistence_status`
- `coexistence_acknowledged_by_user`
- `coexistence_activated_at`
- `history_sync_enabled` si llegas a soportar sincronización de historial

Meta también documenta un webhook `history` para sincronización de chats de usuarios onboardeados por solution provider. citeturn0search31

### Requisito UX

Antes de lanzar el flujo, pregunta:

- “¿Este número ya usa WhatsApp Business App?”
- “¿Quieres mantener la app y también usar la API?”

### Resultado esperado

Si el cliente selecciona coexistencia, el sistema debe marcarlo y adaptar la lógica de soporte posterior.

---

## 10. Diseño de API

## 10.1. Onboarding

### `POST /api/v1/whatsapp/onboarding/start`
Inicia y procesa onboarding desde `code`.

### `GET /api/v1/whatsapp/onboarding/:onboardingId`
Detalle completo del onboarding.

### `GET /api/v1/whatsapp/onboarding/:onboardingId/status`
Estado resumido.

### `POST /api/v1/whatsapp/onboarding/:onboardingId/retry`
Reintenta exchange, discovery o verificación.

### `POST /api/v1/whatsapp/onboarding/:onboardingId/cancel`
Marca cancelado.

### `POST /api/v1/whatsapp/onboarding/:onboardingId/resync`
Re-sincroniza assets con Meta.

## 10.2. Assets

### `GET /api/v1/customers/:customerId/whatsapp/business-accounts`
Lista WABAs del cliente.

### `GET /api/v1/customers/:customerId/whatsapp/phone-numbers`
Lista números.

### `GET /api/v1/customers/:customerId/whatsapp/templates`
Lista templates.

### `POST /api/v1/customers/:customerId/whatsapp/templates/sync`
Sincroniza templates.

### `POST /api/v1/customers/:customerId/whatsapp/phone-numbers/sync`
Sincroniza números.

## 10.3. Operación

### `POST /api/v1/customers/:customerId/whatsapp/send-test-message`
Envía mensaje de prueba.

### `POST /api/v1/customers/:customerId/whatsapp/webhook/rebind`
Reasocia / revalida webhook.

### `GET /api/v1/customers/:customerId/whatsapp/health`
Salud operativa del cliente.

## 10.4. Webhooks

### `GET /api/v1/webhooks/whatsapp`
Verificación de Meta con `hub.challenge`. Meta documenta que el endpoint debe responder 200 y devolver `hub.challenge` para validar el webhook. citeturn0search10

### `POST /api/v1/webhooks/whatsapp`
Recepción de eventos. Los webhooks de WhatsApp son HTTP requests con payload JSON para mensajes, estados y más. citeturn0search3turn0search18

---

## 11. Modelo de datos recomendado

## 11.1. Tabla `customers`

- `id`
- `name`
- `slug`
- `status`
- `created_at`
- `updated_at`

## 11.2. Tabla `whatsapp_onboardings`

- `id`
- `customer_id`
- `config_id`
- `mode` (`new`, `existing`, `coexistence`)
- `status`
- `meta_business_id`
- `waba_id`
- `phone_number_id`
- `display_phone_number`
- `verified_name`
- `exchange_payload_json`
- `session_payload_json`
- `error_code`
- `error_message`
- `started_by_user_id`
- `code_received_at`
- `exchange_completed_at`
- `assets_synced_at`
- `completed_at`
- `created_at`
- `updated_at`

## 11.3. Tabla `whatsapp_business_accounts`

- `id`
- `customer_id`
- `waba_id`
- `meta_business_id`
- `display_name`
- `timezone_id`
- `currency`
- `status`
- `is_coexistence`
- `created_at`
- `updated_at`

## 11.4. Tabla `whatsapp_phone_numbers`

- `id`
- `customer_id`
- `waba_id`
- `phone_number_id`
- `display_phone_number`
- `verified_name`
- `quality_rating`
- `status`
- `is_primary`
- `created_at`
- `updated_at`

## 11.5. Tabla `whatsapp_templates`

- `id`
- `customer_id`
- `waba_id`
- `template_id`
- `name`
- `language`
- `category`
- `status`
- `payload_json`
- `created_at`
- `updated_at`

## 11.6. Tabla `whatsapp_webhook_events`

- `id`
- `customer_id`
- `waba_id`
- `phone_number_id`
- `event_type`
- `message_id`
- `payload_json`
- `received_at`
- `processed_at`
- `status`

## 11.7. Tabla `whatsapp_credentials`

- `id`
- `customer_id`
- `credential_type`
- `encrypted_value`
- `expires_at`
- `rotation_state`
- `created_at`
- `updated_at`

## 11.8. Tabla `audit_logs`

- `id`
- `actor_user_id`
- `customer_id`
- `action`
- `entity_type`
- `entity_id`
- `metadata_json`
- `created_at`

---

## 12. Estados del onboarding

Define un enum estricto:

- `CREATED`
- `FRONTEND_OPENED`
- `CODE_RECEIVED`
- `EXCHANGE_IN_PROGRESS`
- `EXCHANGE_COMPLETED`
- `ASSET_DISCOVERY_IN_PROGRESS`
- `ASSETS_DISCOVERED`
- `WEBHOOK_VALIDATION_IN_PROGRESS`
- `WEBHOOK_VALIDATED`
- `TEST_MESSAGE_IN_PROGRESS`
- `COMPLETED`
- `COMPLETED_WITH_WARNINGS`
- `CANCELLED`
- `FAILED`

---

## 13. Frontend: componente a implementar

## `WhatsAppSignupButton`

Debe:

- inicializar SDK;
- ejecutar `FB.login`;
- recibir `code`;
- mandar request al backend;
- manejar timeout;
- manejar cancelación;
- mostrar estado;
- pasar `customerId`, `configId` y `mode`.

### Payload recomendado al backend

```json
{
  "customerId": "cust_123",
  "configId": "1433848224880053",
  "mode": "coexistence",
  "code": "AQAB...",
  "source": "embedded_signup"
}
```

### Estado visual recomendado

- `idle`
- `popup_opened`
- `code_received`
- `backend_processing`
- `success`
- `error`
- `cancelled`

### Listener adicional recomendado

Implementa escucha de `postMessage` para capturar eventos del popup/iframe.

---

## 14. Backend: lógica interna del `start`

El servicio `POST /whatsapp/onboarding/start` debe ejecutar esta secuencia:

1. Validar JWT interno.
2. Validar permisos sobre `customerId`.
3. Validar `code` no vacío.
4. Validar `configId` permitido.
5. Crear registro onboarding en estado `CODE_RECEIVED`.
6. Hacer exchange del `code` con Meta.
7. Guardar payload crudo del exchange.
8. Descubrir WABA y número.
9. Crear o actualizar tablas de assets.
10. Asociar assets al cliente.
11. Validar webhook.
12. Opcionalmente sincronizar templates.
13. Opcionalmente enviar test message.
14. Marcar `COMPLETED` o `COMPLETED_WITH_WARNINGS`.

---

## 15. Cliente Graph API

Crea un servicio centralizado:

### `MetaGraphClient`

Responsabilidades:
- construir URLs;
- firmar requests;
- incluir tokens seguros;
- parsear respuestas;
- normalizar errores;
- aplicar retries con backoff;
- soportar timeouts.

### Métodos mínimos

- `exchangeOnboardingCode()`
- `getBusinessAccountsForCustomer()`
- `getPhoneNumbersForWaba()`
- `getTemplatesForWaba()`
- `subscribeAppWebhookIfNeeded()`
- `sendTestMessage()`

Meta documenta el uso de Graph API con tokens para WhatsApp Business Platform, y el uso seguro de system user access tokens. citeturn0search2turn0search17turn0search23

---

## 16. Webhooks

Meta documenta que webhooks son requests HTTP con JSON payload y que son núcleo del WhatsApp Business Platform. citeturn0search3turn0search18turn0search24

## 16.1. Endpoint GET

Debe validar `hub.mode`, `hub.verify_token` y responder con `hub.challenge` cuando corresponda. citeturn0search10

## 16.2. Endpoint POST

Debe:
- aceptar payload;
- validar estructura;
- guardar evento crudo;
- responder rápido 200;
- encolar procesamiento.

## 16.3. Procesamiento mínimo de mensajes

Debes soportar:
- mensajes entrantes;
- estados de mensajes;
- errores asíncronos;
- history webhook si luego activas sincronización con coexistencia. citeturn0search18turn0search31

## 16.4. Idempotencia

Usa hash de payload o `message_id` para evitar duplicados.

---

## 17. Colas y jobs

Usa BullMQ.

### Colas sugeridas

- `wa-onboarding`
- `wa-webhooks`
- `wa-sync-assets`
- `wa-sync-templates`
- `wa-send-tests`

### Jobs sugeridos

- `processOnboardingCode`
- `discoverAssets`
- `syncPhoneNumbers`
- `syncTemplates`
- `verifyWebhook`
- `processIncomingWebhook`
- `sendTestMessage`
- `reconcileCustomerAssets`

---

## 18. Seguridad

## 18.1. Secretos

Nunca expongas al frontend:
- app secret;
- system user token;
- tokens internos.

Guárdalos en secretos de EasyPanel o vault.

## 18.2. Rotación

Soporta:
- rotar app secret;
- rotar verify token;
- regenerar y actualizar tokens si cambia política.

## 18.3. Logging

Ofusca:
- tokens;
- códigos;
- números sensibles;
- payloads completos.

## 18.4. Auditoría

Registra:
- quién inició onboarding;
- cuándo;
- para qué cliente;
- qué assets resultaron;
- si hubo coexistencia.

---

## 19. Validaciones obligatorias

Antes del signup:
- cliente existe;
- usuario tiene permisos;
- no hay onboarding incompatible en progreso;
- si es coexistencia, hubo confirmación explícita;
- la configuración `config_id` es válida.

Después del signup:
- hay `waba_id`;
- hay `phone_number_id`;
- los assets quedaron asociados;
- webhook responde;
- la sincronización mínima funciona.

---

## 20. Errores a modelar

Crea códigos internos como:

- `WA_ES_USER_CANCELLED`
- `WA_ES_CODE_MISSING`
- `WA_ES_CODE_EXPIRED`
- `WA_ES_EXCHANGE_FAILED`
- `WA_ES_CONFIG_INVALID`
- `WA_ES_PERMISSIONS_INSUFFICIENT`
- `WA_ES_WABA_NOT_FOUND`
- `WA_ES_PHONE_NOT_FOUND`
- `WA_ES_WEBHOOK_INVALID`
- `WA_ES_DUPLICATE_CUSTOMER_BINDING`
- `WA_ES_COEXISTENCE_NOT_ALLOWED`
- `WA_ES_RATE_LIMITED`
- `WA_ES_GRAPH_API_ERROR`

Cada error debe devolver:
- `code`
- `userMessage`
- `technicalMessage`
- `retryable`

---

## 21. Estructura de carpetas sugerida

```text
src/
  main.ts
  app.module.ts

  common/
    dto/
    enums/
    filters/
    guards/
    interceptors/
    utils/

  config/
    app.config.ts
    database.config.ts
    redis.config.ts
    meta.config.ts

  modules/
    auth/
    customers/
    whatsapp-onboarding/
      controllers/
      services/
      dto/
      entities/
      enums/
      mappers/
      jobs/
    whatsapp-assets/
      controllers/
      services/
      dto/
      entities/
    webhooks/
      controllers/
      services/
      dto/
      jobs/
    meta-graph/
      clients/
      dto/
      services/
      errors/
    audit/
    health/

  database/
    migrations/
    seeds/
```

---

## 22. Variables de entorno mínimas

```env
NODE_ENV=production
PORT=3000
API_PREFIX=/api/v1

DB_HOST=parallext-postgres
DB_PORT=5432
DB_NAME=parallext_whatsapp
DB_USER=...
DB_PASSWORD=...

REDIS_HOST=parallext-redis
REDIS_PORT=6379
REDIS_PASSWORD=

META_APP_ID=...
META_APP_SECRET=...
META_VERIFY_TOKEN=...
META_CONFIG_ID=1433848224880053
META_GRAPH_VERSION=v23.0

WHATSAPP_WEBHOOK_VERIFY_TOKEN=...
WHATSAPP_DEFAULT_CONFIG_ID=1433848224880053

INTERNAL_JWT_SECRET=...
ENCRYPTION_KEY=...

LOG_LEVEL=info
```

La versión concreta de Graph API puede variar; mantenla configurable.

---

## 23. Dockerización

### Dockerfile recomendado

- base: `node:20-alpine` o `node:20-slim`
- build multi-stage
- compilar NestJS
- ejecutar como usuario no-root
- healthcheck HTTP

### Contenedores mínimos

- `parallext-whatsapp-onboarding`
- `parallext-whatsapp-worker`

### Volúmenes

No necesitas volumen persistente para la app si todo estado va a DB/Redis.

---

## 24. Salud y observabilidad

### Health endpoints

- `GET /health/live`
- `GET /health/ready`

### Métricas recomendadas

- onboardings iniciados
- onboardings completados
- onboardings fallidos
- tiempo promedio de exchange
- tiempo promedio de asset discovery
- webhooks por minuto
- fallos Graph API
- retries por tipo

### Logs estructurados

Usa JSON logging.

---

## 25. Admin interno

Debes construir un panel mínimo para:

- ver onboardings en progreso;
- ver estado por cliente;
- ver assets asociados;
- reintentar sincronización;
- revalidar webhook;
- ver errores técnicos;
- ver si el cliente está en coexistencia.

---

## 26. Secuencia de desarrollo recomendada

## Fase 1 — MVP funcional

- contenedor NestJS;
- conexión a PostgreSQL/Redis;
- `FB.login` frontend;
- endpoint `POST /onboarding/start`;
- tabla `whatsapp_onboardings`;
- exchange del `code`;
- persistencia básica;
- respuesta al frontend.

## Fase 2 — Assets

- descubrir `waba_id`;
- descubrir `phone_number_id`;
- guardar assets;
- endpoints de consulta.

## Fase 3 — Webhooks

- endpoint GET/POST;
- verify token;
- guardar eventos;
- procesamiento async.

## Fase 4 — Operación

- sync templates;
- send test message;
- estado operativo.

## Fase 5 — Coexistencia

- flags de coexistencia;
- UX específica;
- lógica de historial y soporte.

## Fase 6 — Robustez

- retries;
- auditoría;
- health;
- métricas;
- panel admin.

---

## 27. Checklist de Definition of Done

Un onboarding queda “listo” solo si:

- el usuario completó Embedded Signup;
- el backend hizo exchange del `code`;
- existe `waba_id` persistido;
- existe `phone_number_id` persistido;
- el asset está asociado al cliente correcto;
- el webhook está validado;
- al menos una lectura operativa funciona;
- el estado queda en `COMPLETED` o `COMPLETED_WITH_WARNINGS`.

---

## 28. Entregables que debe producir tu agente de código

1. proyecto NestJS inicial
2. Dockerfile
3. docker-compose o definición para EasyPanel
4. módulo `whatsapp-onboarding`
5. módulo `meta-graph`
6. módulo `webhooks`
7. entidades TypeORM o Prisma
8. migraciones SQL
9. DTOs y validación
10. jobs BullMQ
11. health checks
12. README operativo
13. colección de pruebas HTTP
14. seeds de desarrollo
15. documentación de coexistencia

---

## 29. Siguiente paso recomendado

Con esta especificación, el siguiente entregable ideal es uno de estos:

- **A.** estructura inicial del proyecto NestJS con carpetas, Dockerfile y variables;
- **B.** diseño de base de datos en SQL;
- **C.** implementación exacta del endpoint `POST /api/v1/whatsapp/onboarding/start`.

El orden recomendado es **A → B → C**.
