# Parallly Mobile (Expo / React Native)

App nativa para **agentes** — inbox en tiempo real, CRM, citas y analítica.
Consume la API existente (`auth` + `agent-console`) y Socket.io `/inbox`. Codebase **separado** del web (no se despliega con `git push`).

Ver el plan completo en `docs/mobile-app-plan.md`.

## Contexto / contrato compartido
Vive en el **monorepo** y consume **`@parallext/shared`** (vía `file:../../packages/shared`) → el contrato de tipos de la API queda **enforced por TypeScript** (si el backend cambia un tipo, el mobile no compila). Metro está configurado para monorepo en `metro.config.js` (`watchFolders` + `nodeModulesPaths`). La superficie completa de API a espejar está en `apps/dashboard/src/lib/api.ts`.

## Estado (S1 — fundación + Inbox MVP)
- ✅ Tipos compartidos conectados (`@parallext/shared`) — contrato enforced
- ✅ Auth (email/contraseña → JWT en SecureStore) + **desbloqueo biométrico**
- ✅ Navegación (tabs: Inbox · CRM · Citas · Más)
- ✅ **Inbox en tiempo real** (lista → chat → responder) vía Socket.io
- ✅ Acciones de chat: **asignarme**, **resolver**, **respuestas rápidas (canned)**, **sugerencia IA**
- ✅ **CRM**: lista de leads (búsqueda) + detalle 360° (datos, etiquetas, oportunidades, llamar/email)
- ✅ **Citas**: agenda próxima + **confirmar / cancelar**
- ✅ **Más**: KPIs (resolución IA/verificada, 30 días) + **disponibilidad** + cerrar sesión
- 🚧 Pendiente: **push nativo** (requiere endpoint backend para tokens Expo/FCM; el actual es Web-Push), macros, pipeline kanban, adaptación por vertical

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
src/screens/           Login · Inbox · Conversation · Placeholder
src/theme.ts
```

## Assets (icono / splash)
Incluidos en `assets/` (burbuja de chat de marca, morado `#6c5ce7`):
- `icon.png` 1024×1024 · `adaptive-icon.png` 1024×1024 · `splash.png` 1242×2436

Para **regenerarlos** o personalizarlos (edita el SVG en el script):
```bash
node apps/mobile/scripts/generate-assets.cjs   # usa sharp del root del monorepo
```
