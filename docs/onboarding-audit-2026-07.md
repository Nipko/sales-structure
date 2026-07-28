# Auditoría del onboarding — Julio 2026

> Auditoría end-to-end del recorrido de alta: landing → signup → verificación → wizard guiado → setup-wizard → primer canal → dashboard.
> Método: lectura estática de código en 7 dimensiones paralelas + ronda de verificación adversarial sobre los hallazgos graves. **Nada se ejecutó en producción.**
> Supersede parcialmente a `docs/onboarding-audit-2026-06.md` (estado de fases) y corrige secciones de `docs/onboarding-redesign-2026-q2.md`.

**Nota global: 4.5 / 10.** Las piezas están bien construidas; el recorrido está roto en las junturas.

Leyenda de evidencia:
- **[V]** verificado adversarialmente (un segundo agente intentó refutarlo y no pudo)
- **[VD]** verificado directamente durante la redacción de este informe
- **[sv]** con evidencia archivo:línea de su dimensión, **sin** ronda de verificación

---

## 1. Veredicto

| Pregunta | Respuesta | Evidencia más fuerte |
|---|---|---|
| ¿Está bien conectado? | **No** | `/onboarding` crea el agente desde los objetivos (`auth.service.ts:1540-1548`) y `/admin/setup-wizard` lo sobrescribe pidiendo plantilla otra vez (`persona.controller.ts:162-169`) |
| ¿Es lógico? | **A medias** | El orden macro es correcto, pero se pregunta dos veces lo mismo con distinto vocabulario: "¿qué querés lograr?" y dos pantallas después "elegí una plantilla" |
| ¿Es rápido? | **No** | ~11 pantallas, ~30 campos, 8-15 min hasta el "aha" — contra una sesión de servidor que expira a los **6 minutos** (`auth.service.ts:37`) |
| ¿Es simple? | **El registro sí; lo que sigue no** | 4 campos en el alta (bien); 13 campos en una sola pantalla del wizard y 4 guías simultáneas al aterrizar |
| ¿Es lo mejor que podemos tener? | **No, pero está a dos semanas** | De los 8 problemas más caros, 5 son XS/S y tocan menos de 6 archivos |

La nota es baja pero el costo de subirla es bajo: los tres problemas que más duelen son bugs de plomería, dos de ellos de una línea.

---

## 2. El recorrido real hoy

```
LANDING (parallly-chat.cloud)
  │  CTA "Empezar con Pro" → SIGNUP_URL sin parámetros
  │  (apps/landing/src/lib/constants.ts:1) ── el plan elegido se pierde acá ──✗
  ▼
[1] /signup ...................... 1 pantalla · 4 campos · 3 vías (email / Google / Microsoft)
  │  signup/page.tsx:37-39 · sin términos, sin teléfono, sin tarjeta
  │  Backend: crea SOLO el usuario, sin tenant (auth.service.ts:310-327) ✔ correcto
  │  Crea sesión Redis TTL 360s ⏱ ── EL RELOJ DE 6 MINUTOS ARRANCA ACÁ
  │
  ├─ Google/Microsoft → emailVerified:true (auth.service.ts:637, :747) → salta a [3] ✔
  ▼
[2] /verify-email ................ 1 pantalla · OTP 6 dígitos · código vive 10 min
  │  ✗ CALLEJÓN: si escribiste mal el mail no hay "cambiar correo", ni "omitir",
  │    ni "cerrar sesión". Todo login futuro vuelve acá (AuthContext.tsx:281-286).
  │  ✗ CALLEJÓN: si el SMTP falla, la API responde success:true igual
  │    (email.service.ts:52-56 → auth.controller.ts:509-512 ignora el booleano)
  │  ✗ Si pasaron >6 min desde [1] → 401 → localStorage borrado → /login?expired=1
  ▼
[3] /onboarding .................. 3 pasos · 13 campos (4 obligatorios) + 2 grupos de checkboxes
  │  Paso 1 "Tu empresa": nombre*, web, tel, email, ABOUT* (textarea), 4 redes,
  │         industria*, sub-tipo, tamaño*, timezone (fijo en America/Bogota, :395)
  │  Paso 2 "Tus clientes" · Paso 3 "Objetivos": checkboxes por vertical
  │  ⚠ CERO llamadas HTTP en los 3 pasos · CERO persistencia (todo useState, :372-411)
  │    → cerrar la pestaña = empezar de cero
  │  ⚠ El botón final NO dice "Crear mi cuenta": la condición es `step === 4` y
  │    STEP_KEYS tiene 3 entradas, así que step nunca pasa de 2 (:21, :1049)
  │  ✗ Pasos 4 (referido) y 5 (plan) existen en el JSX y nunca se renderizan (:905, :946)
  │    → signupSource queda null para el 100% de los tenants
  │
  │  SUBMIT → POST /auth/complete-onboarding (auth.service.ts:1442-1653)
  │    crea tenant + schema + AGENTE POR DEFECTO (createDefaultAgentFromGoals, :1540-1548)
  │    + business info + bootstrap vertical (FAQs, servicios, pipeline) + trial
  ▼
  [puente 1.4 s] "¡Cuenta lista!" → window.location.href = "/admin/setup-wizard"
  ▼
[4] /admin/setup-wizard .......... 5 pasos · ~8 campos + 3 FAQs
  │  (0) Elegir plantilla ← ⚠ el agente YA EXISTE, esto lo va a sobrescribir
  │  (1) Personalizar: nombre, saludo, tono, horarios, mini-FAQ
  │  (2) "Pruébalo" ← 🎯 PRIMER MOMENTO AHA (pantalla nº 9 del recorrido)
  │      ⚠ prueba el agente VIEJO: lo del paso 1 se persiste recién en handleFinish
  │  (3) Conectar canal ← CTA alternativo "Conectar después" (:526-536)
  │  (4) Tour de herramientas ← tarjeta "Analytics" → /admin/analytics = 404
  │
  ├─✗ CALLEJÓN "Saltar" (header, siempre visible): escribe setupWizardCompleted:true
  │   y NO existe ningún enlace al wizard en toda la app. El comentario de
  │   admin/page.tsx:114 dice "pueden re-correrlo desde ajustes" — es falso.
  ▼
[5] /admin ....................... 4 guías simultáneas
      · tour Onborda a los 800 ms (ProductTour.tsx:154-166)
      · banner ámbar "conectá un canal" (admin/page.tsx:125, 308-321)
      · OnboardingChecklist de 9 ítems (montado siempre, layout.tsx:122)
        ✗ nunca llega a 9/9 (ver problema #2)
      · empty-state con 3 CTAs
```

**Conteo real:** ~11 pantallas · ~30 campos · ~35-45 clics.
**Tiempo honesto hasta ver al agente responder:** 8-15 min si nada falla. **El presupuesto de sesión es de 6 minutos.**

---

## 3. Lo que está bien

1. **Alta de 4 campos, sin tarjeta y sin muro de pago** (`signup/page.tsx:37-39`). Trial-first deliberado y documentado (`onboarding/page.tsx:17-20`). Es la decisión de producto correcta.
2. **El tenant NO se crea en el signup** (`auth.service.ts:310-327`): los registros abandonados no dejan schemas de PostgreSQL huérfanos ni suscripciones fantasma.
3. **Autologin real** con accessToken + refreshToken (`auth.service.ts:338-360`).
4. **Tres vías de alta**, y Google/Microsoft marcan `emailVerified:true` (`:637`, `:747`), salteando correctamente la verificación.
5. **Adaptación por vertical de verdad, no cosmética:** veterinaria ofrece "Triage de emergencias" y "Recordatorios de vacunación" (`onboarding/page.tsx:165-170`), inmobiliaria "Calificar interesados (presupuesto, zona)" (`:190`), con las 17 industrias traducidas en los 4 idiomas.
6. **Seguridad sólida en el camino de alta:** bcrypt 12 rondas (`:307`), validación de fuerza server-side (`:219-229`), bloqueo de correos desechables (`email.util.ts:28-33`), throttle contra la IP real de Cloudflare (`auth-throttle.guard.ts:34-45`), OTP comparado timing-safe (`:864`), código OAuth de un solo uso con TTL 60 s.
7. **El backend degrada con gracia**: schema, agente, business info y bootstrap vertical van cada uno en su try/catch (`:1534-1590`); lo esencial (tenant + enlace + audit) es atómico (`:1475-1531`).
8. **Cobertura i18n mecánicamente completa**: 504 claves del funnel verificadas contra los 4 archivos de `apps/dashboard/messages/` — no falta ninguna clave viva en ningún idioma.
9. **`firstChannelConnectedAt` ya se registra** en `tenants` de forma fire-and-forget al primer connect (`channel-management.controller.ts:38-47`): la métrica de activación por canal existe, solo falta explotarla.

---

## 4. Los problemas, por prioridad

| # | Problema | Sev. | Evidencia | Impacto | Esf. |
|---|---|---|---|---|---|
| 1 | **La sesión muere a los 6 min justo en `/verify-email` y `/onboarding`.** El único renovador es el activity ping, y ambas rutas están en `PUBLIC_PATHS` — el ping y el refresh proactivo se apagan ahí **[V][VD]** | Alta | `auth.service.ts:37` (`SESSION_TTL=360`, comentario propio: "refreshed by activity ping"), `:154`, `:586-591`; `AuthContext.tsx:74`, `:150-151`, `:190-191` | Llena 3 pasos, aprieta Finalizar, y lo escupe a `/login` perdiendo todo lo tipeado | S |
| 2 | **El checklist nunca detecta un canal conectado.** Lee `res.channels` + snake_case sobre un endpoint que devuelve `{success, data:[...]}` con campos camelCase de Prisma **[V][VD]** | Alta | `OnboardingChecklist.tsx:58-60` vs `channel-management.controller.ts:53-58` | Conecta WhatsApp y el ítem sigue pendiente para siempre; nunca llega a 9/9, nunca se descarta, reaparece en cada recarga | XS |
| 3 | **Dos configuraciones del mismo agente.** `/onboarding` lo crea desde industria+objetivos y el setup-wizard vuelve a pedir plantilla y lo sobrescribe **[sv]** | Alta | `auth.service.ts:1540-1548` → `persona.service.ts:2542-2574`; `setup-wizard/page.tsx:308-341`; `persona.controller.ts:162-169` | Responde "qué querés lograr" y dos pantallas después le vuelven a preguntar lo mismo. Percibe dos productos pegados con cinta | M |
| 4 | **"Saltar" cierra el wizard para siempre**: escribe `setupWizardCompleted:true` y no existe ningún enlace al wizard en toda la app **[V]** | Alta | `persona.controller.ts:217-227`; grep de `setup-wizard` en `apps/dashboard/src` → solo el redirect, el bounce y `api.ts` | Queda registrado, con agente sin personalizar y sin canal, y nadie lo vuelve a llevar al flujo | S |
| 5 | **El paso "Pruébalo" prueba el agente viejo**: la plantilla y el nombre/saludo se persisten recién en `handleFinish` **[sv]** | Alta | `setup-wizard/page.tsx:157-177`, `:484`; `AgentTestChat.tsx:25-34, 49` | Bautiza al agente, escribe su saludo, prueba, y el bot responde con la plantilla vieja → "esto no guardó nada". Rompe la confianza en el momento de la demo | M |
| 6 | **El progreso del wizard no persiste**: todo es `useState`, cero llamadas HTTP en los 3 pasos **[V]** | Alta | `onboarding/page.tsx:372-411`; contraste: `setup-wizard/page.tsx:107-116` sí persiste en localStorage | Cierra la pestaña (o el navegador móvil la descarta) y vuelve a un formulario en blanco | S |
| 7 | **El email de verificación puede no enviarse nunca y la API responde `success:true`** **[V]** | Alta | `email.service.ts:52-56`, `:74-77`; `auth.service.ts:849-853`; `auth.controller.ts:509-512` | Con el SMTP caído, el 100% de los registros por email quedan fuera del producto y solo queda un `warn` en logs | XS |
| 8 | **Onboarding no idempotente**: la transacción comitea el tenant antes de los pasos 4-7; si algo posterior falla, el reintento choca contra el 409 de slug duplicado **[sv]** | Alta | `auth.service.ts:1465-1470`, `:1475-1531`, `:1614-1617` | Su cuenta existe pero él sigue atrapado en el formulario, con un error en inglés y sin salida | M |
| 9 | **Timezone hardcodeado en Bogotá + idioma adivinado del huso**: `timezone.includes('America') ? 'es' : 'en'`, y el huso además define el país de facturación con un mapa de 9 zonas sobre 21 ofrecidas **[sv]** | Alta | `onboarding/page.tsx:395`; `auth.service.ts:1576`, `:1601`, `:1897-1911`; `packages/shared/src/timezones.ts:22-42` | Un tenant brasileño arranca con agente, FAQs y pipeline **en español** teniendo el pt completo; uno de Panamá queda facturado como Colombia | S |
| 10 | **Un typo en el email encierra la cuenta**: no hay "cambiar correo", ni "omitir", ni "cerrar sesión"; y a la vez `emailVerified` no bloquea nada **[V]** | Media | `verify-email/page.tsx` (archivo completo); `AuthContext.tsx:281-286`; `emailVerified` no se lee en ningún guard (`completeOnboarding:1442`, `jwt.strategy.ts:22-28`) | Fricción para los honestos, cero freno para el resto. Salida real: registrarse de nuevo | M |
| 11 | **Errores del backend en inglés crudo**, con las traducciones ya escritas como código muerto **[V]** | Media | `auth.service.ts:302`, `:865`, `:1469`; `auth-throttle.guard.ts:63`; `api.ts:1811`; `signup/page.tsx:128` | "Email already registered" / "A company with a similar name already exists" en el primer minuto, a una PYME de Bogotá | S |
| 12 | **El funnel no puede ver el abandono del registro**: el tenant nace recién al terminar el onboarding, con `onboardingCompletedAt` en el mismo `create` **[sv]** | Media | `auth.service.ts:1477`, `:1495`; `tenants.service.ts:988-1051` | La etapa "onboarding completado" da 100% por construcción. El agujero real — incluido el problema #1 — es invisible | S |
| 13 | **`signupSource` es null para el 100% de los tenants** (paso de referido muerto, sin captura de UTMs) **[sv]** | Media | `onboarding/page.tsx:21`, `:491`; `auth.service.ts:1496`; `admin/funnel/page.tsx:239-258` | Se gasta presupuesto de adquisición a ciegas | S |
| 14 | **La tarjeta "Analytics" del último paso del wizard va a un 404** (`/admin/analytics` no existe; la ruta real es `analytics-v2`) **[V][VD]** | Media | `ToolsTour.tsx:95` | Última impresión del flujo guiado: producto roto | XS |
| 15 | **El plan elegido en la landing se pierde** **[V, con matiz]** | Media | `constants.ts:1`; `PricingSection.tsx:148`; `onboarding/page.tsx:410` | Clickea "Empezar con Pro" y termina en trial emprendedor sin que ninguna pantalla se lo explique. **La divergencia de datos NO ocurre**: `billing.service.ts:205-215` converge el plan en la misma request — el verificador refutó esa mitad del hallazgo | S |
| 16 | **El botón final del wizard no dice "Crear mi cuenta"**: la condición es `step === 4` y `STEP_KEYS` tiene 3 entradas **[VD]** | Baja | `onboarding/page.tsx:21`, `:1049` (el string `createAccount` ya está traducido en los 4 idiomas) | El paso decisivo se presenta como un "Siguiente" más | XS |

**Fuera de tabla, anotado y sin verificar [sv]:** el ítem "Conectar un canal" del checklist lleva a páginas prohibidas para `tenant_agent` y rebota al inbox (`OnboardingChecklist.tsx:24-34` vs `roles.ts:124-149`); el checklist es `hidden lg:block` — invisible en móvil (`:180`); cualquier rol del tenant es empujado al setup-wizard y puede reconfigurar el agente del negocio (`admin/page.tsx:111`, `persona.controller.ts:14`); las FAQs sembradas por vertical nunca llegan a la IA porque ninguna plantilla enciende `tools.faqs` (`verticals.service.ts:279-300` vs `conversations.service.ts:1772`); las verticales con agenda arrancan sin `availability_slots` (`verticals.service.ts:20-137`); el contenido semilla que leen los clientes finales está **sin tildes** ("¿Cual es el horario de atencion?", `vertical-definitions.ts:66`); voseo y tuteo mezclados en pantallas consecutivas.

### Hallazgo adyacente — el país de facturación no era corregible (RESUELTO, `4983284e`)

Revisando la cohesión del circuito fiscal con el alta: **la capa fiscal en sí está bien cosida.** El gate, el banner, el modal, el formulario y el chequeo de completitud coinciden — `isFiscalDataComplete` está escrito explícitamente para espejar `setFiscalData` y no derivar por su cuenta — y el gate solo dispara en flujos que cobran (`billing.service.ts:143`), así que el trial gratuito del onboarding no se bloquea. Que el wizard no pida datos fiscales es correcto: todavía no hay nada que facturar.

Lo que no estaba cosido era **la entrada**. Tres comportamientos dependen de `tenant.billingCountry`:

| Si `billingCountry !== 'CO'` | Consecuencia |
|---|---|
| `fiscal-data.util.ts:22` | el gate nunca dispara |
| `fiscal.controller.ts:86` | el banner nunca avisa |
| `settings/billing/page.tsx:700` | la sección DIAN ni se renderiza |

Y ese valor se escribía **una sola vez**, en el alta, inferido del huso horario (`inferCountryFromTimezone` → `createTrialSubscription` → `billing.service.ts:212`), sin ningún endpoint ni pantalla capaz de cambiarlo después. Un tenant colombiano cuyo huso no resolviera a CO quedaba invisible para todo el circuito fiscal y sin forma de arreglarlo — y tampoco aparecía en `scripts/fiscal-backfill-report.js`, que filtra por `billingCountry: 'CO'`. El punto ciego se componía.

El arreglo del timezone (#9 de la tabla) agudizó el riesgo: al detectar el huso desde el navegador, un colombiano de viaje o con VPN pasa a registrarse en otro país, donde el default fijo `America/Bogota` antes lo dejaba siempre en CO. Resuelto con `PATCH /fiscal/:tenantId/billing-country` + selector en Ajustes → Datos fiscales (la página que se renderiza sin importar el país, a diferencia de la de billing).

**Residuo pendiente:** `billingCountry` solo se escribe dentro de `createTrialSubscription`, que en el onboarding va envuelto en try/catch. Si esa llamada falla, el tenant queda con el país en `null` y nunca es gateado. Corregible a mano desde el selector nuevo, pero la escritura inicial sigue siendo frágil. Sobre los tenants ya existentes: el mapa viejo mandaba todo a `'CO'` por defecto, así que están sobre-incluidos y el backfill los listará de más — el lado seguro del error.

### Hallazgo fuera de alcance — bug de producción confirmado

**Crear plantillas de WhatsApp desde la app está roto.** `whatsapp.controller.ts:363` y `:368` consultan `SELECT id, waba_id, access_token FROM whatsapp_channels WHERE is_active = true …`. Ninguna de esas tres columnas existe: el schema define `meta_waba_id`, `access_token_ref` y `channel_status` (`apps/api/prisma/tenant-schema.sql:631-655`), y la única migración posterior sobre esa tabla agrega `seeds_submitted`/`seeds_submitted_at` (`:1559-1560`). Todos los demás consumidores usan los nombres correctos (`channel-token.service.ts:58`, `whatsapp-connection.service.ts:184`, `offboarding.service.ts:236`, `whatsapp-webhook.service.ts:171`) — solo ese controller está mal. La query tira Postgres 42703. **[VD]**

---

## 5. El problema de fondo

**El onboarding no es un flujo: son dos flujos diseñados en momentos distintos que nunca se fusionaron.** `/onboarding` pregunta industria, audiencia y objetivos y con eso *ya crea un agente completo* (`auth.service.ts:1540-1548` → `persona.service.ts:2542-2574`, con `is_active=true, is_default=true`). `/admin/setup-wizard` arranca desde cero, como si ese agente no existiera, obliga a elegir plantilla otra vez y lo sobrescribe (`persona.controller.ts:162-169`). Todo lo que el usuario respondió sobre sus objetivos se descarta en silencio. Y los dos wizards ni siquiera comparten hábitos técnicos: el segundo persiste el borrador en localStorage y el primero —la puerta de entrada, donde abandonar cuesta un registro entero— no persiste nada.

De esa fractura se desprende casi todo lo demás. `setupWizardCompleted` vive en `tenant.settings` y `onboardingCompleted` en `users`, así que **no hay un solo lugar que sepa en qué punto del onboarding está una cuenta**: hay tres máquinas de estado (el `getRedirectPath` de `AuthContext.tsx:281-286`, el bounce de `admin/page.tsx:120-124`, y el checklist que consulta dos endpoints y arma su propia verdad). Cada una tiene su bug y ninguna es autoridad. Por eso el que aprieta "Saltar" desaparece del sistema de guía, por eso el checklist puede mentir sin que nada lo corrija, y por eso el funnel mide un conjunto (`tenants`) que por construcción es el 100% de sí mismo.

El segundo eje es de **presupuesto de tiempo**: el producto asume que el onboarding se resuelve en menos de 6 minutos (`SESSION_TTL = 360`, renovado únicamente por un ping que está apagado en las dos rutas donde el usuario pasa más tiempo) cuando en la práctica pide 8-15. No es un bug de sesión: es una suposición sobre la duración del flujo que dejó de ser cierta cuando el flujo creció a 11 pantallas, y nadie volvió a mirar la constante.

**El camino canónico debe ser uno solo: `/onboarding`, extendido, con `/admin/setup-wizard` degradado a "editor de agente" accesible desde Ajustes.** Los pasos 1-3 actuales se quedan; el paso de plantilla deja de ser una pregunta y pasa a ser una confirmación ("te preparamos a *Sofía*, recepcionista de clínica — ¿la usás así o la ajustás?"); el chat de prueba sube a `/onboarding` como cuarto paso; conectar el primer canal es el quinto y último. Un solo estado (`tenant.settings.onboardingStage`), un solo resolver de redirect (`resolvePostLoginPath(user)`), un solo componente de guía.

---

## 6. Plan priorizado

### Ahora (esta semana) — ✅ IMPLEMENTADO en `ba584bb8` (rama `fix/onboarding-semana-1`)

Los 8 arreglos están hechos y verificados (`tsc` limpio en api y dashboard, `test:bootstrap` pasa). Se detallan abajo tal como se planificaron; las desviaciones respecto del plan original fueron dos, ambas por seguridad: el borrador se guarda **por usuario y caduca a los 7 días** (una clave global habría mostrado los datos de una empresa a la siguiente persona que se registrara en el mismo navegador), y guardar el mismo correo en `/verify-email` **reenvía el código** en vez de devolver `email_unchanged` (el campo viene precargado, rechazarlo castigaba el uso más obvio).



1. **Matar el fusible de los 6 minutos.** Sacar `/verify-email` y `/onboarding` de `PUBLIC_PATHS` (`AuthContext.tsx:74`) o condicionar el ping y el refresh proactivo a `localStorage.getItem('accessToken')` en vez de `isAuthenticated && !isPublicPage` (`:150-151`, `:190-191`); como defensa en profundidad, refrescar el TTL de `session:{userId}` dentro de `validateUser` (`auth.service.ts:586`) cuando queden <2 min. → **mueve: tasa de finalización de `/onboarding`**.
2. **Arreglar el checklist**: usar el `hasAnyChannel` que ya viene en la misma respuesta de `getSetupStatus` (`persona.controller.ts:297`) y, para Instagram, `channelsRes?.data?.some(c => c.channelType === 'instagram' && c.isActive)`. Archivo: `OnboardingChecklist.tsx:50-78`.
3. **Persistir el borrador de `/onboarding`** copiando el `useEffect` que ya existe en `setup-wizard/page.tsx:107-116`, con limpieza tras el submit.
4. **Que el envío de email falle en voz alta**: `sendVerificationEmail` evalúa el booleano de `emailService.send()` → `ServiceUnavailableException('email_send_failed')` + `Sentry.captureMessage`; el signup devuelve `verificationEmailSent:false` y `/verify-email` muestra aviso ámbar con reintento.
5. **Salidas en `/verify-email`**: link "¿Te equivocaste de correo?" (PATCH que permite editar el email mientras `emailVerified=false`) + "Cerrar sesión". Y decidir la política: si la verificación debe bloquear, chequear `user.emailVerified` en `completeOnboarding` (`auth.service.ts:1443`).
6. **Botón final y 404**: `step === STEP_KEYS.length - 1` en `onboarding/page.tsx:1049` y `href: '/admin/analytics-v2'` en `ToolsTour.tsx:95`.
7. **Limpiar audiencias/objetivos al cambiar de industria**: `setAudiences([]); setGoals([])` en el `onChange` de `onboarding/page.tsx:737` (hoy solo limpia `subType`).
8. **Timezone del navegador**: inicializar con `Intl.DateTimeFormat().resolvedOptions().timeZone` validado contra la lista curada (`onboarding/page.tsx:395`) y completar `inferCountryFromTimezone` (`auth.service.ts:1897-1911`) con las 21 zonas del selector.

**Aparte del onboarding, mismo sprint:** corregir `whatsapp.controller.ts:363,368` a `meta_waba_id` / `access_token_ref` / `channel_status = 'connected'`.

### Después (2-4 semanas) — ✅ #9 a #13 y #15 IMPLEMENTADOS (`758f6ca2`, `ee674e00`)

Queda pendiente **#14 (instrumentar el funnel + capturar UTMs)** y, del #15, las tildes del contenido semilla — que terminaron cerrándose aparte, en la auditoría de verticales (`docs/vertical-bootstrap-audit-2026-07.md`, commit `95f758f3`).

Del #13 se implementó la mitad de UI: el banner "Retomar configuración" y el gate del bounce por rol. **Falta `@Roles('tenant_admin')` a nivel endpoint** en `persona.controller` — mientras el endpoint siga abierto a cualquier rol del tenant, el gate de UI es fachada.

Del #9 se implementó el comportamiento (preselección de la plantilla derivada + badge "Recomendada" honesto), **no el copy**: el paso 0 sigue diciendo "elegí una plantilla" en vez de "preparamos a *Sofía*, confirmala".



9. **Un solo camino canónico.** Preseleccionar en el paso 0 del setup-wizard la plantilla que el backend YA derivó (devolver `templateId` del agente `is_default` en `/persona/:tenantId/setup-status`) y degradarlo a "confirmá o ajustá". Es el 80% del beneficio del merge con el 20% del riesgo.
10. **Autosave al salir del paso "Personalizar"** para que "Pruébalo" pruebe el agente real: separar `applySetupTemplate` de `markCompleted`, o aceptar `draftConfig` en `POST /agent-test/:tenantId/:agentId`.
11. **Idempotencia de `completeOnboarding`**: si el user ya tiene `tenantId`, devolver tokens nuevos en vez de re-crear; desambiguar el slug con sufijo (-2, -3) en vez de rechazar; validar el nombre en el paso 1 con un endpoint debounced; eliminar el `plan:'starter'` de `auth.service.ts:1483`.
12. **Errores tipados end-to-end**: excepciones de auth con `{ error: 'email_taken', message }`, mapeo `errorCode → clave i18n` en signup/verify-email/onboarding/login (el transporte ya existe: `api.ts:1811`), + CTA a `/login` para `email_taken`. Los 4 JSON.
13. **Reabrir el setup-wizard**: distinguir `skipped` de `completed`, CTA "Retomar configuración guiada" en el banner de `/admin` y entrada en `settings/_settings-config.ts`; gatear el bounce a `tenant_admin` (`admin/page.tsx:111` + regla en `roles.ts` + `@Roles('tenant_admin')` en `persona.controller.ts`).
14. **Instrumentar el funnel de verdad**: etapa 0 = `users` con `tenantId: null` creados en la ventana (`tenants.service.ts:988`), + captura de UTMs en `/signup` persistidas hasta `completeOnboarding`. Explotar `firstChannelConnectedAt`, que ya se escribe.
15. **Idioma del tenant desde el locale real** (cookie de next-intl) en el payload de `completeOnboarding`, reemplazando `timezone.includes('America') ? 'es' : 'en'` (`auth.service.ts:1576`) y el `language:'es-CO'` hardcodeado (`:1484`). Y pasar el corrector de tildes por `vertical-definitions.ts`.

### Ideal (cuando haya aire)

16. **Preview vivo del agente dentro de `/onboarding`**: con `industry + about + goals` ya en estado, mostrar una burbuja con el saludo real del vertical mientras el usuario marca objetivos. Convierte el formulario en demo y adelanta el aha unas 5 pantallas. Reutiliza `AgentTestChat.tsx` contra un endpoint pre-tenant.
17. **Crawl automático del sitio web** que el usuario ya entrega y hoy se guarda como string (`auth.service.ts:1486`, `:1563`): encolar un job a KnowledgeService tras crear el tenant y precargar el `about` con lo scrapeado. El crawler ya existe en el módulo knowledge.
18. **Consumir `GET /verticals/definitions/all`** (endpoint existente cuyo `@ApiOperation` dice literalmente "for onboarding sub-types", `verticals.controller.ts:33-37`) y borrar las ~350 líneas de tablas hardcodeadas de `onboarding/page.tsx:47-353`, ya drifteadas (falta `alquiler_vacacional`, sobra `multiservicio`).
19. **Checklist responsive** (hoy `hidden lg:block`) y **guía priorizada al aterrizar**: si falta canal, no lanzar el tour ni el empty-state — un solo llamado a la acción.
20. **Términos y privacidad en el alta** con `acceptedTermsAt` persistido (columna nullable, respeta expand-contract). Las páginas legales ya existen en la landing y hoy están huérfanas.

---

## 7. Cómo se vería el onboarding ideal

Para una peluquería, una clínica dental o una inmobiliaria de LatAm, en el celular. **Objetivo: ver al agente responder en menos de 3 minutos y tener WhatsApp conectado en menos de 6.**

1. **Landing → `/signup?plan=pro`** (0:00). El CTA arrastra el plan. Cuatro campos o un tap en Google. Checkbox de términos. → 0:40
2. **Verificación no bloqueante** (0:40). Por Google no existe este paso. Por email, OTP con "vence en 10 minutos", link "Verificar más tarde" y "¿Te equivocaste de correo?". El banner de verificación pendiente lo persigue *dentro* del producto, no antes. → 1:10
3. **Paso 1 — "Contanos de tu negocio"** (1:10). Tres campos visibles: nombre, industria (+ sub-tipo) y sitio web. Timezone detectado del navegador, editable en un desplegable colapsado. **El `about` deja de ser un textarea en blanco**: si puso la URL, se precarga con lo que el crawler encontró. Nombre validado en vivo contra el slug. Borrador guardado en cada tecla. → 2:00
4. **Paso 2 — "¿Qué querés que haga?"** (2:00). Objetivos por vertical, con los títulos personalizados que **ya están traducidos en los 4 idiomas y nunca se cablearon** ("¿Cómo ayudará *Max* a tus tutores?"). A la derecha, en vivo, una burbuja que se actualiza con el saludo real del template. → 2:30
5. **Paso 3 — "Conocé a tu agente"** (2:30). 🎯 **AHA acá, no en la pantalla 9.** El agente ya existe; se presenta como recomendación: "Preparamos a *Sofía*, recepcionista de clínica. Probala." Chat real. Debajo, dos campos con autosave: nombre y saludo, reflejados en el chat. Botón secundario "Elegir otra plantilla". → 3:30
6. **Paso 4 — "Conectá WhatsApp"** (3:30). Embedded Signup, que ya está construido junto con coexistencia y migración de 6 meses de chats. Prerrequisitos arriba, en dos líneas. El botón alternativo dice "Conectar después" pero deja un estado `skipped` real, con fecha, que reabre la guía en 24 h — no un `completed:true` que borra al usuario del sistema. → 5:30
7. **`/admin`** (5:30). **Una sola guía**: si falta canal, el banner y nada más. Si el canal está, un checklist de 5 ítems reales, responsive, filtrado por rol. El tour se ofrece, no se dispara.

Lo que desaparece: el segundo wizard como segundo onboarding, la pregunta duplicada de plantilla, la pantalla puente con reload duro, las cuatro guías simultáneas y los 13 campos en una pantalla. **Once pantallas pasan a seis; ~30 campos a ~8; el aha se adelanta de la pantalla 9 a la 5.** El chat de prueba, el Embedded Signup, el crawler, los templates por vertical, los títulos personalizados y el endpoint de definiciones **ya están construidos**: el trabajo es de cableado y de borrar, no de construir.

---

## 8. Qué no se verificó

- **Nada se ejecutó.** Todo es lectura estática. Los 8-15 minutos son una estimación a partir del conteo de campos y pasos, no un dato medido.
- **Los tiempos del correo** (cuánto tarda el OTP con el SMTP actual, si cae en spam) no se probaron. Es la variable que determina cuántos usuarios cruzan el umbral de los 6 minutos.
- **Los ítems marcados `[sv]`** tienen evidencia archivo:línea pero no pasaron la ronda adversarial. Antes de tocar el #8 (idempotencia) conviene releer `auth.service.ts:1442-1653` completo, porque es el método que más lógica concentra.
- **Los hallazgos sueltos de las dimensiones `primer-canal`, `backend-bootstrap` e `i18n-ux`** (FAQs que no llegan a la IA, verticales sin `availability_slots`, plantillas semilla que nunca se envían) tienen archivo:línea pero no fueron verificados.
- **No hay datos de embudo reales** para priorizar por evidencia en vez de por razonamiento — y no los va a haber hasta que se arregle el #12, porque hoy la métrica es tautológica.
- **Nada se probó en móvil**, que es donde la mayoría de las PYMES LatAm evalúa el producto.
