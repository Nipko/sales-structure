# Build de la app móvil con EAS (distribución)

> Estado: **listo para buildear**. La config de Expo evalúa limpio y todos los
> plugins resuelven. Falta solo ejecutar el build (consume créditos de EAS +
> requiere login de Expo) y crear 1 file-secret (`google-services.json`).

## Por qué EAS y no solo el APK local

- El APK local (`gradlew`, junction `C:\ss`) sirve para **validar en tu dispositivo**.
- EAS compila en la nube con keystore gestionado, firma de release reproducible,
  y corre los config plugins (source maps de Sentry, etc.) automáticamente.
  Es el camino para **distribuir** (internal/ad-hoc o tienda).

## Secretos de EAS (una sola vez por proyecto)

Ya creados ✅ (verificado con `eas secret:list`, ago 2026):
- `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`
- `GOOGLE_SERVICES_JSON` (FILE_BASE64, creado 05-jun) — el FCM client config SÍ viaja en los builds de EAS

Si alguna vez hay que recrearlo:
```bash
cd apps/mobile
eas secret:create --scope project --type file \
  --name GOOGLE_SERVICES_JSON --value ./google-services.json
```
`app.config.ts` ya lee `process.env.GOOGLE_SERVICES_JSON` → en el build de EAS
apunta a la ruta del file-secret; en local cae a `./google-services.json`.

## Perfiles (eas.json)

| Perfil | Uso | Output |
|--------|-----|--------|
| `development` | dev client + Metro | APK (internal) |
| `preview` | **standalone tipo APK de prueba** (recomendado para distribuir/validar) | APK (internal) |
| `production` | release de tienda (autoIncrement) | AAB |

## Ejecutar el build

```bash
cd apps/mobile
npx eas-cli login                                   # cuenta Expo (nirlevin), 1 vez
npx eas-cli build --platform android --profile preview
```
- 1ª vez: EAS genera el **keystore** automáticamente (acepta cuando pregunte).
- Al terminar imprime un **QR/link** → instalas el APK directo en el dispositivo.
- Los **source maps de Sentry** suben solos durante este build (gracias a los 3 secretos).

## iOS (pendiente — bloqueado)

Requiere **Apple Developer Program ($99/año)**. Una vez inscrito:
- `npx eas-cli device:create` (registra el iPhone, sin Mac)
- `npx eas-cli build --platform ios --profile preview`
- Subir APNs key + (para Google Sign-In iOS) crear OAuth client iOS + URL scheme.

## Notas

- `google-services.json` y `sentry.properties` están en `.gitignore` (secretos) →
  por eso van como secretos de EAS, no commiteados.
- Las personalizaciones nativas del build local de Windows (adjustNothing,
  network_security_config, RECORD_AUDIO, canonical entryFile) están replicadas
  como config plugins → EAS las reproduce sin intervención manual.
