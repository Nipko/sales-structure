# Parallly Mobile — Plan técnico (Fase B · Expo / React Native)

> App nativa para **agentes** (no consumidores): inbox, CRM, citas y analítica desde el móvil.
> Decisión de stack: **Expo (managed) + React Native + TypeScript** — encaja con el equipo React/TS, reúsa los tipos de `packages/shared` y compila iOS sin Mac (EAS Build).
> Fecha: 31 may 2026. Deriva de la "Sección especial Mobile" de `implementation-plan-2026-q2.md`.

## 1. Por qué Expo/RN
- Equipo ya domina **React + TypeScript** → curva mínima, contratación sencilla.
- **Reúsa la API** existente: `auth` (JWT) + `agent-console` (inbox) + **Socket.io `/inbox`**. No hace falta backend nuevo.
- Puede importar **`@parallext/shared`** (tipos) del monorepo.
- **EAS Build** compila iOS/Android en la nube (sin Mac).
- Un solo código → **iOS + Android**.

## 2. Arquitectura

```
Dispositivo (Expo/RN)
  ├─ AuthContext  → POST /auth/login → JWT (access+refresh) en SecureStore
  ├─ api (fetch)  → https://api.parallly-chat.cloud/api/v1  (Bearer + refresh)
  ├─ socket.io    → wss://api.parallly-chat.cloud/inbox  (auth: { token })
  └─ Navigation   → Login → Tabs (Inbox · CRM · Citas · Más)
```

- **Auth**: igual que el dashboard — `POST /auth/login` → `{ accessToken, refreshToken, user }`. Refresh con `POST /auth/refresh`. Tokens en **expo-secure-store** (cifrado del SO). Login biométrico (expo-local-authentication) para reabrir sesión.
- **Tiempo real**: `socket.io-client` al namespace `/inbox` con `auth: { token }`. Eventos: `newMessage`, `inbox:refresh`, `inbox:handoff`, `inbox:escalation`.
- **Push**: `expo-notifications` → token Expo/FCM/APNS → `POST /notifications/subscribe` (reusa el `PushModule`/`push_subscriptions` de T1.11). Disparado en mensaje nuevo / handoff / SLA.

## 3. Endpoints que consume (ya existen)
| Acción | Endpoint |
|--------|----------|
| Login | `POST /auth/login` |
| Refresh | `POST /auth/refresh` |
| Inbox (lista) | `GET /agent-console/inbox/:tenantId?filter=` |
| Conversación | `GET /agent-console/conversation/:tenantId/:id` |
| Enviar mensaje | `POST /agent-console/conversation/:tenantId/:id/message` |
| Asignar / Resolver | `PUT .../assign` · `PUT .../resolve` |
| Sugerencia IA (copilot) | `GET .../suggest` |
| Disponibilidad agente | `PUT /agent-console/status/:userId` |

## 4. Estructura de carpetas (`apps/mobile/`)
```
app.config.ts        — config Expo (scheme, plugins, extra.apiUrl)
index.ts / App.tsx   — entry + providers + navigation
src/
  lib/config.ts      — API_URL / SOCKET_URL (desde extra)
  lib/api.ts         — cliente fetch (auth + refresh + agent-console)
  lib/socket.ts      — conexión socket.io /inbox
  contexts/AuthContext.tsx
  navigation/RootNavigator.tsx
  screens/LoginScreen.tsx
  screens/InboxScreen.tsx
  screens/ConversationScreen.tsx
  screens/PlaceholderScreen.tsx  (CRM/Citas/Más — siguientes sprints)
  theme.ts
```

## 5. Pantallas
**Core (todos los sectores):** inbox unificado, chat en tiempo real, push, quick replies + macros, vista 360° del contacto, asignación, notas internas, copilot (sugerir/resumir/reescribir), notas de voz + transcripción, media, colisión, resumen al handoff.
**CRM/Pipeline:** lead, kanban mobile, crear/actualizar deals, tareas.
**Booking:** citas de hoy, confirmar/reagendar, calendario, check-in.
**Analytics:** KPIs clave (resolution rate, performance).
**Por vertical** (respeta `verticalConfig.industry`): turismo→propiedades; gimnasios→clases; restaurantes→pedidos; salud→pacientes del día.
**LatAm:** español-first, modo bajo consumo, Android 10+, biométrico, dark mode, cola offline.

## 6. Sprints sugeridos (8-12 semanas)
1. **S1-2 — Fundación + Inbox MVP** ✅ (scaffold de este commit): auth+biométrico, navegación, **Inbox (lista→chat→responder)** en tiempo real. ← *primer corte funcional*.
2. **S3-4 — Inbox completo:** push nativo, quick replies/macros, asignar/resolver/notas, copilot, notas de voz.
3. **S5-6 — CRM:** contacto 360°, pipeline kanban, deals, tareas.
4. **S7-8 — Booking + Analytics:** citas de hoy, confirmar/reagendar, KPIs.
5. **S9-10 — Vertical + pulido:** adaptación por industria, modo bajo consumo, cola offline.
6. **S11-12 — Stores:** EAS Build, iconos/splash, revisión Apple/Google, beta (TestFlight/Internal Testing).

## 7. Requisitos
- **Apple Developer Program** ~$99/año (App Store + APNs). **Google Play** $25 (una vez).
- **EAS** (Expo Application Services) para builds en la nube (sin Mac).
- Variables: `apiUrl` en `app.config.ts > extra` (o `EXPO_PUBLIC_API_URL`).

## 8. Cómo correr (local)
```bash
cd apps/mobile
npm install
npx expo install        # alinea versiones nativas con el SDK
npx expo start          # QR → Expo Go (dev) ; o development build
# Builds de tienda:
# npm i -g eas-cli && eas build -p ios|android
```

> Nota: este codebase es **separado** del pipeline web (no se despliega con `git push`). Se prueba con Expo Go / development build y se publica vía EAS.

---

# v2 — Diseño profundo (dejar de ser "lector", operar como herramienta de agente)

## Los 4 trabajos del agente (cómo debe operar)
1. **Triage** — ver *qué necesita atención YA*: handoffs sin asignar, mis SLA por vencer, escalaciones. Filtros + orden por urgencia.
2. **Responder rápido y rico** — texto + **imagen + nota de voz**, plantillas, macros, **reescribir/resumir con IA**, estado de mensaje.
3. **Contexto sin salir del chat** — panel 360° (pedidos, citas, historial, tags, lead score), banner de handoff, notas internas.
4. **Actuar inline** — **tomar control / devolver a la IA**, asignar/resolver, agendar, mover deal, nota interna.

## Matriz de brechas → endpoint/backend que ya existe
| Brecha | Cómo se resuelve |
|--------|------------------|
| Inbox renderizaba campos adivinados | ✅ corregido (contactName/lastMessage/channel/status/isAiHandled) |
| Chat con campos adivinados | ✅ corregido (sender/content/timestamp + notas + banner) |
| **Tomar control / devolver a IA** | `assign` (tomar) + **NUEVO** `PUT /agent-console/.../return-to-ai` (status='active', assigned_to=NULL) |
| **Crear nota interna** | `POST /agent-console/conversation/:t/:id/note` |
| **Reescribir borrador / resumir hilo (IA)** | `POST /copilot/:conversationId/rewrite` `{draft,tone}` · `GET /copilot/:conversationId/summary` |
| **Ver imágenes / notas de voz** | `message.type` + `message.metadata` (URL); voz ya llega transcrita en `content` |
| **Snooze / archivar** | `PUT .../snooze` · `PUT .../archive` |
| Panel de contacto 360° | `getConversation.contact` (tags, LTV, #convs) + `/crm/leads/:t/:leadId` |
| Búsqueda | `/crm/leads?search=` (contactos) |
| Colisión (quién mira) | `collision-detection` (WebSocket viewers) |
| Deep-link push→chat | el push ya manda `data.url`; falta resolver conversationId y navegar |

## Sprints de ejecución
- **Sprint A — Chat profesional (en curso):** tomar control / devolver a IA (+ endpoint backend), crear nota interna, **reescribir (tonos) + resumir con copilot**, mostrar imágenes y marca de nota de voz, snooze/archivar.
- **Sprint B — Contexto + triage:** panel 360° en el chat, búsqueda, vista "Para mí ahora" (handoff+SLA), colisión.
- **Sprint C — Pulido/sistema:** deep-link push→conversación, centro de notificaciones, tema claro/oscuro, switch de empresa, re-lock biométrico.

> Enviar media saliente (subir imagen/audio desde el móvil) requiere endpoint de upload + envío por canal → se evalúa en Sprint B (hoy se muestran entrantes y se transcriben las de voz).
