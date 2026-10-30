# Source maps de Sentry — App móvil (Parallly)

> Estado: **listo para EAS**. Los source maps del móvil se suben automáticamente
> durante un build de tienda con EAS. NO se suben en los APK locales de `gradlew`
> (y no hace falta — para dev basta el stack + mensaje del error).

## Por qué EAS y no los builds locales

- El plugin `@sentry/react-native` solo corre durante `expo prebuild`, que EAS
  ejecuta en cada build. Los APK locales usan el `android/` ya generado + `gradlew`
  directo → **no corren config plugins**, así que no suben source maps.
- En EAS el upload corre en Linux limpio con `sentry-cli` → "simplemente funciona".
- Forzarlo en el build local de Windows tocaría `metro.config.js` + el `build.gradle`
  hand-tuneado para el junction `C:\ss` → riesgo de romper la receta. No vale la pena
  para APK de prueba.

## Configuración ya hecha (en el repo)

- `app.config.ts` → plugin `@sentry/react-native` con `{ url, organization, project }`
  leídos de `process.env.SENTRY_ORG` / `SENTRY_PROJECT`.
- `.gitignore` → `sentry.properties` y `.sentryclirc` excluidos (nunca commitear el token).
- El DSN del cliente ya está embebido en `app.config.ts` (`extra.sentryDsn`) — eso es
  seguro y es lo que reporta los crashes (ya funciona hoy, sin source maps).

## Qué hacer cuando montemos el build de tienda (EAS)

Crear **3 secretos de EAS** (una sola vez por proyecto):

```bash
cd apps/mobile
eas secret:create --scope project --name SENTRY_ORG          --value <tu-org-slug>
eas secret:create --scope project --name SENTRY_PROJECT      --value <tu-project-slug>
eas secret:create --scope project --name SENTRY_AUTH_TOKEN   --value <sntrys_...>
```

- **org slug / project slug**: en la URL del dashboard de Sentry →
  `sentry.io/organizations/<ORG-SLUG>/projects/<PROJECT-SLUG>/`
- **auth token**: `sentry.io/settings/auth-tokens/` → Create New Token
  (solo escritura de releases/source maps; trátalo como contraseña).

Con eso, `eas build --platform android --profile production` (o `preview`) sube los
source maps solo. Al ocurrir un crash, Sentry muestra `ConversationScreen.tsx:312`
en vez del frame minificado.

> Alternativa: en lugar de los secretos `SENTRY_ORG`/`SENTRY_PROJECT`, se pueden
> hardcodear los slugs en `app.config.ts` (no son secretos) y dejar solo
> `SENTRY_AUTH_TOKEN` como secreto. Pásame los slugs y lo cambio.

## El token en GitHub Secrets

El `SENTRY_AUTH_TOKEN` que está en **GitHub Secrets** NO llega a la app móvil
(el móvil no se compila en GitHub Actions). Sirve para los source maps del
**backend** (`@sentry/nestjs`) si algún día se cablea en `deploy.yml`. Para el
móvil, el token debe vivir como **secreto de EAS** (ver arriba).
