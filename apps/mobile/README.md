# Parallly Mobile (Expo / React Native)

App nativa para **agentes** — inbox en tiempo real, CRM, citas y analítica.
Consume la API existente (`auth` + `agent-console`) y Socket.io `/inbox`. Codebase **separado** del web (no se despliega con `git push`).

Ver el plan completo en `docs/mobile-app-plan.md`.

## Estado (S1 — fundación + Inbox MVP)
- ✅ Auth (email/contraseña → JWT en SecureStore) + **desbloqueo biométrico**
- ✅ Navegación (tabs: Inbox · CRM · Citas · Más) + stack de Inbox
- ✅ **Inbox en tiempo real** (lista → chat → responder) vía Socket.io
- ✅ Sugerencia IA (copilot) en el composer
- 🚧 Siguientes sprints: push nativo, quick replies/macros, CRM, booking, analytics, vertical

## Requisitos previos
- Node 18+, `npm`
- Expo Go (para dev) o un development build
- Para tiendas: cuenta **Apple Developer** ($99/año) y **Google Play** ($25), `eas-cli`

## Correr en local
```bash
cd apps/mobile
npm install
npx expo install          # alinea versiones nativas con el SDK 52
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

> Nota: faltan los assets binarios (`assets/icon.png`, `splash.png`, `adaptive-icon.png`). Genera los tuyos o quita esas referencias de `app.config.ts` para el primer `expo start`.
