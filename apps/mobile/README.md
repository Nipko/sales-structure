# Parallly Mobile (Expo / React Native)

App nativa operativa para usuarios tenant — inbox en tiempo real, CRM, tareas,
indicadores permitidos y workspace adaptado a la vertical.
Consume la API existente (`auth` + `agent-console`) y Socket.io `/inbox`. Codebase **separado** del web (no se despliega con `git push`).

Manual funcional: [`../../docs/mobile-user-manual.md`](../../docs/mobile-user-manual.md).
El plan histórico de implementación permanece en `docs/mobile-app-plan.md`.

## Contexto / contrato compartido
Vive en el **monorepo** y consume **`@parallext/shared`** (vía `file:../../packages/shared`) → el contrato de tipos de la API queda **enforced por TypeScript** (si el backend cambia un tipo, el mobile no compila). Metro está configurado para monorepo en `metro.config.js` (`watchFolders` + `nodeModulesPaths`). La superficie completa de API a espejar está en `apps/dashboard/src/lib/api.ts`.

## Estado
- ✅ Tipos compartidos conectados (`@parallext/shared`) — contrato enforced
- ✅ Auth (email/contraseña → JWT en SecureStore) + **desbloqueo biométrico**
- ✅ Navegación (tabs: Inbox · CRM · Operación vertical · Más)
- ✅ **Inbox en tiempo real** (lista rica: avatar+canal, hora, badges handoff/IA, filtros, **búsqueda**) vía Socket.io
- ✅ **Chat profesional**: burbujas con hora, notas internas intercaladas, banner de handoff, **imágenes + nota de voz** (entrantes); acciones: **contacto 360° · asignarme · devolver a IA · resolver · resumir (IA) · nota interna**; composer con **canned · macros · IA contextual** (vacío→sugiere, con texto→**reescribe por tono**); **indicador de colisión** y outbox offline aislada por cuenta
- ✅ **CRM**: lista de leads (búsqueda) + detalle 360° (datos, etiquetas, oportunidades, llamar/email)
- ✅ **Embudo**: etapas del pipeline + **mover deals** entre etapas (desde el header de CRM)
- ✅ **Citas**: agenda próxima + **confirmar / cancelar**
- ✅ **Más**: KPIs (resolución IA/verificada, 30 días) + **disponibilidad** + cerrar sesión
- ✅ **Adaptación por vertical**: el tercer tab se resuelve desde el manifest/capacidades efectivas y puede abrir agenda, estadías, tours, restaurante, pedidos, clases, educación, seguros, solicitudes, fotografía, alquiler vehicular o hospedaje de mascotas
- ✅ **Push nativo** (Expo): registro del token + `/push/expo-subscribe`; el backend envía vía Expo Push API en mensaje/handoff/SLA/cita; **tap → conversación exacta** (deep-link, también en cold start). *Requiere `eas init` (projectId) y un **development build** — NO funciona en Expo Go (SDK 53+ quitó remote push de Expo Go).*
- ✅ **Seguridad**: re-bloqueo biométrico al volver tras más de 15 minutos en segundo
  plano, con overlay de desbloqueo
- 📦 **Estado Android documentado al 10-ago-2026:** AAB `1.0.0 (7)` validado y activo en prueba interna; el rollout de Producción fue enviado a revisión. Este README no confirma una aprobación posterior ni visibilidad pública: verificar Play Console antes de comunicar el estado actual.
- 🚧 iOS no se declara publicado. Opcionales aplazados: tema claro, switch multi-tenant y centro de notificaciones persistente.

## Push nativo — cómo activarlo
1. `npm i -g eas-cli && eas login`
2. `eas init` (crea el projectId en `app.config.ts > extra.eas.projectId`)
3. `eas build --profile development -p android` → instala el APK en tu teléfono
4. Abre la app (dev build, no Expo Go), acepta permisos → el token Expo se registra solo

## Requisitos previos
- Node 18+, `npm`
- Expo Go (para dev) o un development build
- Para tiendas: cuenta **Apple Developer** ($99/año) y **Google Play** ($25), `eas-cli`

## Correr en local
```bash
cd apps/mobile
npm install
npx expo install --fix    # alinea TODAS las deps con el SDK (54) instalado
npx expo start            # escanea el QR con Expo Go
```

Apunta a otra API:
```bash
EXPO_PUBLIC_API_URL=https://tu-api/api/v1 npx expo start
```

## Builds de tienda (EAS, sin Mac)
```bash
npm i -g eas-cli
eas login
eas build -p android        # APK/AAB
eas build -p ios            # IPA (build en la nube de Expo)
eas submit -p ios|android   # subir a las tiendas
```

## Estructura
```
app.config.ts          config Expo (scheme, plugins, extra.apiUrl)
App.tsx                providers + navigation
src/lib/api.ts         cliente fetch (auth + refresh + agent-console)
src/lib/socket.ts      socket.io /inbox
src/contexts/AuthContext.tsx
src/navigation/RootNavigator.tsx
src/screens/           Login · Welcome · Inbox · Conversation · Outbound · CRM
                       LeadDetail · Pipeline · Appointments · Reservations
                       Operations · More · NotificationPrefs · NoWorkspace
src/theme.ts
```

## Assets (icono / splash)
Generados desde el **logo real de Parallly** (`apps/dashboard/public/parallly-logo-white.svg`).
El "loguito" = la marca azul `#3897f0` que forma la doble-l de "Parallly"; se usa sola como
símbolo del ícono (sin texto: las máscaras de Android recortan el texto). Fondo de marca `#0a0a12`
con glow morado sutil.

- `icon.png` 1024×1024 — loguito sobre fondo de marca (iOS / launcher legacy)
- `adaptive-icon.png` 1024×1024 — loguito en zona segura (foreground del adaptive icon de Android)
- `adaptive-bg.png` 1024×1024 — fondo de marca + glow (background del adaptive icon)
- `splash.png` 1242×2436 — lockup completo "Parallly" centrado sobre oscuro
- `logo-wordmark.png` 720×118 — lockup transparente para uso in-app (cabecera del login)

Para **regenerarlos** tras cambiar el logo de marca:
```bash
node apps/mobile/scripts/generate-assets.cjs   # usa sharp del root del monorepo
```
