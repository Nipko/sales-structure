# GATE 0 — Checklist ejecutable de producción (app móvil)

> Objetivo: llevar la app móvil de "feature-complete" a **listo para producción**, al estándar de la plataforma. Derivado de `docs/mobile-app-audit-2026-q2.md` (Partes 1-3) + **verificación en código** (jun 2026).
> Regla: **el GATE 0 precede a cualquier feature nueva.** "Definition of Done para producción" = todo el GATE 0 ✅ + núcleo de alcance sólido.

## Progreso (sesión jun 2026)
- ✅ **G0.1 — Sentry**: `@sentry/react-native` + `Sentry.init`/`Sentry.wrap` (ErrorBoundary + captura nativa), DSN del proyecto móvil vía `app.config.ts extra` (no hardcodeado), deshabilitado en dev. **Validado en dispositivo** (`RNSentry: Starting with DSN…`). Pendiente opcional: subida de source maps (`SENTRY_AUTH_TOKEN`).
- ✅ **G0.2 — Manejo de errores + toast**: `ToastProvider`/`useToast` + try/catch/rollback en Conversación, Más, Citas, Pipeline, Inbox. Fin de falsos "éxito".
- ✅ **G0.10 — Deep-link `linking`**: config `parallly://` en `App.tsx` (conversation/lead/pipeline/crm/citas). Validado a nivel Android.
- ✅ **G0.4 — i18n (es/en/pt/fr) — COMPLETO**: infraestructura (`expo-localization` + `I18nProvider`/`useI18n`, auto-OS + selector persistente en "Más") + **todas las pantallas migradas** (navegación, Login completo incl. 2FA, Más, Inbox, Citas, Pipeline, CRM+LeadDetail, Conversation completo). ~130 claves en 4 idiomas. Tests: paridad de claves + valores no vacíos. **Validado en dispositivo** (auto-detección OS + selector). La terminología vertical (verticalConfig) sigue teniendo precedencia sobre i18n donde aplica.
- ◐ **G0.7 — Estados de error**: hecho en **Inbox** (error+reintento, reload silencioso). Pendiente: CRM, Citas, Más + skeletons + paginación.
- ◐ **G0.5 — Tests**: base montada (jest-expo + Testing Library), `npm test` en verde, 2 tests (Toast). Pendiente: auth/socket/push/error-paths + Detox smoke.
- ◐ **G0.6 — Offline**: ✅ **cola de envío saliente** (`src/lib/outbox.ts`) — los mensajes que fallan se encolan en memoria, se muestran como pendientes (reloj) / fallidos (alerta), y se **reintentan automáticamente al reconectar** el socket (`onInboxStatus`). Integrado en `ConversationScreen` (render de pendientes + toast "se enviará al reconectar"). Tests del outbox (envío OK / fallo). Pendiente: persistencia entre cierres de app (AsyncStorage) + caché del inbox para arranque offline.
- ◐ **G0.9 — Seguridad**: ✅ logger dev-only (`src/lib/log.ts`) → sin fuga de tokens/socket IDs a logcat en release. **Cert pinning: OMITIDO a propósito** (la API está detrás de Cloudflare, que rota certs; leaf-pinning brickearía la app en cada rotación — se confía en TLS del sistema + Cloudflare). Pendiente/backend: sanitizar errores de auth (responsabilidad del API, no del cliente) y opción explícita "olvidar este dispositivo" (el device-trust NO se borra en logout a propósito — es por-dispositivo, no por-sesión).
- Verificación de código: `tsc` exit 0 + `npm test` exit 0. App validada en dispositivo como build release standalone.
- ⏳ Pendientes mayores: **G0.1 Sentry** (requiere DSN), **G0.4 i18n**, **G0.6 offline**, **G0.3** (fetch estado inicial), **G0.8 a11y**, **G0.9 seguridad**.

---


## Correcciones tras verificación en código (importante)

El análisis automático sobreestimó los gaps de *features*. Verificado contra el código real:

- ✅ **Estado de agente EXISTE y funciona** (`MoreScreen.tsx:9-13,42-44` → `api.setAvailability` `api.ts:187-188`, URL correcta). Estados: online/away/offline. *No hay que construirlo* — hay que endurecerlo.
- ✅ **Copiloto cableado** (`ConversationScreen.tsx:154,171,180` → `api.getAiSuggestion/copilotSummary/copilotRewrite`). No es stub.
- ✅ **Acciones de cierre cableadas** (`ConversationScreen.tsx:125,131,137` → assign/returnToAI/resolve).
- ❌ **Pero ninguna tiene manejo de error**: muestran éxito aunque la API falle. **Ese es el bloqueante real, no la ausencia de features.**

→ El GATE 0 es por tanto **mayormente robustez transversal**, no construcción. Menos trabajo del estimado, mejor enfocado.

---

## G0.1 — Observabilidad (Sentry)
Estándar de plataforma: Sentry obligatorio. Hoy el móvil está **ciego** a crashes/latencia en campo.

- [ ] Instalar `@sentry/react-native` + configurar en `App.tsx` (init antes del render).
- [ ] Envolver la app en `Sentry.wrap()` + `ErrorBoundary` con pantalla de fallback.
- [ ] Subir source maps en el build EAS (release tracking).
- [ ] Verificar que `EXPO_PUBLIC_SENTRY_DSN` se inyecta en build (añadir a EAS secrets + `app.config.ts`).
- [ ] Medir crash-free rate como criterio de salida del gate.

## G0.2 — Manejo de errores explícito (raíz del bloqueante)
Hoy ~todas las llamadas API fallan en silencio o muestran falso éxito.

- [ ] Crear util/hook global de **toast** (éxito/error) + reemplazar los `Alert` de falso-éxito.
- [ ] Envolver en try/catch y dar feedback real en: `assignToMe`, `doReturnToAI`, `doResolve` (`ConversationScreen.tsx:123-139`); `doSummary`, `getAiSuggestion`, `copilotRewrite` (`:152-182`); `setStatus` (`MoreScreen.tsx:42-45`); `cancel/confirm` cita (`AppointmentsScreen.tsx:111-118`); `moveDeal` (`PipelineScreen.tsx`).
- [ ] Eliminar los `catch {}` vacíos y los `Promise.all` sin manejo (`MoreScreen.tsx:31`).
- [ ] **Soft-warning de plan**: si el tenant está `past_due`/`expired`, banner no bloqueante antes de que el agente choque con error a mitad de conversación.

## G0.3 — Estado de agente: endurecer (NO construir)
- [ ] Cargar el estado **real** del usuario al abrir (hoy `useState('online')` hardcoded, `MoreScreen.tsx:25`).
- [ ] Update optimista **con rollback** si `setAvailability` falla.
- [ ] (Opcional menor) añadir `DND` a STATUSES si el backend lo soporta.

## G0.4 — i18n (es/en/pt/fr) — regla dura de plataforma
Hoy la app está hardcoded en español; el dashboard exige 4 idiomas.

- [ ] Integrar i18n (alinear con la lib del dashboard: next-intl/i18next equivalente RN).
- [ ] Extraer todos los strings de las 8 pantallas + navegación a catálogos es/en/pt/fr.
- [ ] **Cablear terminología vertical** desde `verticalConfig` (ya cargado en AuthContext) en labels de navegación (`RootNavigator.tsx`) — hoy hardcoded.

## G0.5 — Tests automatizados (regla de plataforma)
- [ ] Configurar Jest + React Native Testing Library + script `test`.
- [ ] Tests de unidad/integración del bucle crítico: auth/refresh (`AuthContext`, `api.ts`), socket (`socket.ts`), push (`push.ts`), y **error paths** de las llamadas API.
- [ ] Smoke E2E (Detox) del flujo: login → inbox → abrir conversación → responder.

## G0.6 — Resiliencia offline / red (LatAm)
- [ ] Cola local de envío de mensajes con reintento al reconectar el socket.
- [ ] Degradar UI cuando el socket cae (el indicador LIVE ya existe en `InboxScreen.tsx:99-104` — usarlo para bloquear/avisar envío).
- [ ] Caché del último inbox para arranque offline.

## G0.7 — Estados de UI (carga / vacío / error) + paginación
- [ ] Skeletons de carga (reemplazar spinners genéricos) en Inbox, More, CRM, Citas.
- [ ] Estados vacíos útiles y estados de error con retry en todas las pantallas.
- [ ] **Paginación del timeline** de conversación (riesgo de leak/lentitud >1000 msgs).

## G0.8 — Accesibilidad (baseline)
- [ ] `accessibilityLabel`/`accessibilityRole` en inputs, botones e iconos accionables (hoy: cero en toda la app).
- [ ] Touch targets ≥44px — **fix prioritario:** botón cancelar cita de 26px (`AppointmentsScreen.tsx`).
- [ ] No depender solo de color para estado (badges); verificar contraste; soportar dynamic type.

## G0.9 — Seguridad baseline (estándar de plataforma)
- [ ] Certificate pinning para `api.parallly-chat.cloud`.
- [ ] Sanitizar mensajes de error del backend antes de mostrarlos (evitar enumeración de usuarios, `LoginScreen.tsx:70-71`).
- [ ] Quitar `console.log` de tokens/socket IDs en release (`socket.ts:46-49`, `push.ts:57`).
- [ ] Revocar device-trust en logout / opción "cerrar sesión en todos los dispositivos".

## G0.10 — Bugs reales confirmados (rápidos)
- [ ] **Deep-link por URL**: añadir prop `linking` a `NavigationContainer` (`App.tsx:44`) — hoy `parallly://` no enruta (el tap de push sí navega vía `navigationRef`).
- [ ] **Token stale en socket vivo**: reaplicar token al socket al hacer refresh a mitad de sesión (`socket.ts:13-15`).
- [ ] **Confirmar en runtime** el fallback de Expo push en handoff con app cerrada (`push.ts` + backend `push.service.ts`); si falta, es P0 (es el dolor #1 del mercado).

---

## Criterio de salida del GATE 0 (Definition of Done)
- [ ] Sentry reportando, crash-free medido y aceptable.
- [ ] Cero llamadas API con fallo silencioso; toasts en todos los flujos.
- [ ] i18n en 4 idiomas + terminología vertical cableada.
- [ ] Suite de tests del bucle crítico en verde en CI.
- [ ] Offline básico (cola de envío + degradación) funcionando.
- [ ] Estados de carga/vacío/error y paginación en todas las pantallas.
- [ ] a11y baseline (labels + touch targets ≥44px).
- [ ] Seguridad baseline aplicada.
- [ ] Los 3 bugs de G0.10 cerrados/confirmados.

**Tras el GATE 0** → recién entonces P1 (paridad: media saliente, HSM, CRM editable…) y P2 (diferenciadores: copiloto 1-tap, ubicación GPS, snooze, OCR…), según el roadmap de `mobile-app-audit-2026-q2.md`.
