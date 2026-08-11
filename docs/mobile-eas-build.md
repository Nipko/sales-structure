# Build de la app móvil con EAS (distribución)

> Estado al 10-ago-2026: el AAB de producción v6 fue generado por EAS desde el commit
> `41d58962`, validado con bundletool y jarsigner, convertido a APK universal e
> instalado por cable en un SM-S918B conservando la sesión. La prueba visible de
> desconexión/reconexión pasó y Play Console publicó la prueba interna que contiene
> únicamente v6. La versión está disponible para el verificador interno configurado;
> producción todavía no se ha iniciado.

## Artefacto vigente

| Dato | Valor comprobado |
|---|---|
| EAS build ID | `e8a0b188-d8a9-41c5-a9e0-c30ebb270279` |
| Commit | `41d589629d4c9ab52d9e3bb18896bffbcb8e359b` |
| Plataforma / perfil | Android / `production` |
| Distribución | `STORE` |
| package | `cloud.parallly.mobile` |
| versionName / versionCode | `1.0.0` / `6` |
| minSdk / targetSdk / compileSdk | `24` / `36` / `36` |
| Tamaño del AAB | `53.293.577` bytes |
| SHA-256 del AAB | `D9C0DDD82EC0E27F464A7E885087067731E7F8679746C603F68CA64F57B7555F` |
| Certificado upload SHA-256 | `42:DE:BB:77:51:83:D1:D9:63:7D:43:60:79:C0:CF:71:D6:79:E4:F6:36:C8:C2:5A:F6:0C:61:44:AE:B5:A1:34` |
| Ruta local | `C:\Users\USER\Desktop\parallly-v6-play\parallly-1.0.0-v6.aab` |
| Artefacto EAS | `https://expo.dev/artifacts/eas/X_9vGw0u4tz7Gl-VbvFa38oJZSm3fLgQqllHkfny_9E.aab` |

Este es el único AAB del release actual. Play Console lo reconoce como `1.0.0 (6)` y la
prueba interna activa contiene únicamente v6; los v2–v5 quedaron reemplazados.

## Por qué EAS y no solo un APK local

- El perfil `production` genera el AAB firmado que acepta Google Play.
- El APK local de Gradle sirve para desarrollo, pero no representa necesariamente el
  manifest, los plugins ni la firma del artefacto de tienda.
- EAS ejecuta los config plugins, usa el keystore administrado e integra los secretos de
  Firebase y Sentry de forma reproducible.
- Para el smoke test físico se puede derivar un APK universal del AAB con bundletool;
  ese APK de prueba no sustituye el AAB que se sube a Play.

## Secretos de EAS

Ya están configurados en el proyecto:

- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_AUTH_TOKEN`
- `GOOGLE_SERVICES_JSON` como secreto de archivo

`app.config.ts` lee `process.env.GOOGLE_SERVICES_JSON` durante EAS y usa
`./google-services.json` en el entorno local. `google-services.json` y
`sentry.properties` permanecen fuera del repositorio.

Si se rota el archivo de Firebase:

```bash
cd apps/mobile
npx eas-cli secret:create --scope project --type file --name GOOGLE_SERVICES_JSON --value ./google-services.json
```

## Perfiles de `eas.json`

| Perfil | Uso | Salida |
|---|---|---|
| `development` | Dev client con Metro | APK interno |
| `preview` | Instalación standalone para QA | APK interno |
| `production` | Release de Google Play con autoIncrement | AAB |

## Generar un nuevo build de producción

Ejecutar desde la app móvil y con el árbol que se desea publicar ya comprometido:

```bash
cd apps/mobile
npx eas-cli build --platform android --profile production --non-interactive
```

Consultar el resultado:

```bash
npx eas-cli build:view e8a0b188-d8a9-41c5-a9e0-c30ebb270279
npx eas-cli build:list --platform android --limit 5 --non-interactive --json
```

Antes de aceptar un build futuro, comprobar que su commit coincide con `HEAD` y que
EAS incrementó versionCode. No reutilizar versionCode `6` para otro AAB.

## Validar el AAB

Usar el jar ejecutable completo de bundletool. El jar modular que queda en la caché de
Gradle no contiene `Main-Class` y no funciona con `java -jar`.

Herramienta usada para v6:
`C:\Users\USER\Desktop\parallly-v6-play\bundletool-all-1.18.1.jar`.

```bash
cd C:\Users\USER\Desktop\parallly-v6-play
java -jar bundletool-all-1.18.1.jar validate --bundle=parallly-1.0.0-v6.aab
java -jar bundletool-all-1.18.1.jar dump manifest --bundle=parallly-1.0.0-v6.aab
jarsigner -verify parallly-1.0.0-v6.aab
```

Resultado v6:

- `bundletool validate`: **PASS**;
- package `cloud.parallly.mobile`;
- versionCode `6`, versionName `1.0.0`;
- minSdk `24`, targetSdk/compileSdk `36`;
- `jarsigner`: firma verificada;
- certificado de upload SHA-256:
  `42:DE:BB:77:51:83:D1:D9:63:7D:43:60:79:C0:CF:71:D6:79:E4:F6:36:C8:C2:5A:F6:0C:61:44:AE:B5:A1:34`;
- `SYSTEM_ALERT_WINDOW` y `WRITE_EXTERNAL_STORAGE`: ausentes;
- `READ_EXTERNAL_STORAGE`: presente solo hasta `maxSdkVersion=32`;
- `RECORD_AUDIO`: presente, requerido para notas de voz.

Calcular el hash antes de mover o subir el archivo:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath .\parallly-1.0.0-v6.aab
```

El valor debe ser:
`D9C0DDD82EC0E27F464A7E885087067731E7F8679746C603F68CA64F57B7555F`.

## Generar e instalar el APK universal de prueba

```bash
java -jar bundletool-all-1.18.1.jar build-apks --bundle=parallly-1.0.0-v6.aab --output=parallly-1.0.0-v6-universal.apks --mode=universal
```

El archivo generado y el APK extraído quedaron en:

- `C:\Users\USER\Desktop\parallly-v6-play\parallly-1.0.0-v6-universal.apks`
- `C:\Users\USER\Desktop\parallly-v6-play\universal-v6-41d58962\universal.apk`

SHA-256 de `universal.apk`:
`F1C14E5F12D82415AD0BB2733CC560A401F9E0A3E84BC8038D30F57AFEA0C4FB`.

Instalación y comprobación:

```powershell
adb devices -l
adb install -r C:\Users\USER\Desktop\parallly-v6-play\universal-v6-41d58962\universal.apk
adb shell dumpsys package cloud.parallly.mobile | Select-String 'versionCode|versionName'
adb shell monkey -p cloud.parallly.mobile -c android.intent.category.LAUNCHER 1
```

Resultado confirmado en `SM-S918B`:

- instalación por cable exitosa;
- versionName `1.0.0`, versionCode `6`;
- la sesión anterior se conservó;
- la app abrió correctamente;
- logcat no mostró fatal ni `JSON Parse error: Unexpected end of input`.

bundletool firma el APK universal con una clave de prueba para instalarlo localmente.
Esto no altera la firma del AAB que Google Play procesa con Play App Signing.

## Smoke test de desconexión

La prueba técnica y visible fue completada con v6 instalado:

- durante la desconexión Android informó `Active default network: none`;
- el proceso de la app permaneció vivo con PID activo;
- Inbox mostró el estado `SIN CONEXIÓN`;
- CRM mostró un error honesto y la acción `Reintentar`, sin sustituirlo por un estado
  vacío ni dejar un loader infinito;
- logcat mostró 0 coincidencias de `FATAL` y 0 de `JSON Parse`;
- al restaurar Wi-Fi y datos, `Reintentar` cargó los leads de CRM inmediatamente sin
  cerrar la sesión.

Resultado: **PASS** para la desconexión/reconexión visible en el SM-S918B.

## Estado en Google Play

- AAB v6 validado por Play y publicado en una prueba interna activa que contiene
  únicamente versionCode `6`;
- App access guardado;
- Target audience guardado únicamente como `18 años o más`;
- Data safety guardado y App content muestra que no hay acciones pendientes;
- la declaración de IA/opinión quedó completada con criterio conservador: únicamente
  `play-icon-512.png` y `play-feature-graphic-1024x500.png` se etiquetaron; las cuatro
  capturas reales de la app no se etiquetaron;
- las cuatro capturas aprobadas fueron cargadas y la ficha de tienda quedó guardada con
  estado **Lista para enviar a revisión**;
- la lista `Parallly Android v6 testers` quedó guardada, seleccionada y contiene un
  verificador;
- el release `1.0.0 (6) — prueba interna` está activo y disponible desde
  `https://play.google.com/apps/internaltest/4701526887696492046`;
- el panel tiene Producción habilitada y no muestra un requisito de 12 testers durante
  14 días. Esto es una observación de la consola, no una exención general de la política.

Pendientes antes de preparar Producción:

- verificar que 2FA esté desactivado en la cuenta demo;
- verificar que el tenant demo tenga un plan interno o compensado que no expire;
- instalar la versión desde el enlace de participación y repetir el smoke test entregado
  por Google Play;
- completar las 5 tareas de Producción, actualmente `0/5`, incluida la selección de
  países/regiones que sigue pendiente.

## Build `preview`

Para una instalación interna rápida que no vaya a Play:

```bash
cd apps/mobile
npx eas-cli build --platform android --profile preview
```

El resultado es un APK standalone. No debe cargarse como release de Google Play.

## iOS pendiente

Requiere Apple Developer Program. Después de inscribirse:

```bash
npx eas-cli device:create
npx eas-cli build --platform ios --profile preview
```

También harán falta la clave APNs y un OAuth client iOS con su URL scheme para Google
Sign-In.

## Notas

- Las personalizaciones nativas de Android están replicadas mediante config plugins;
  EAS las reproduce sin intervención manual.
- Mantener el AAB, su SHA-256, el build ID y el commit juntos en cada release.
- No subir un AAB si bundletool falla, su package cambia, su versionCode no aumenta o el
  commit no coincide con el aprobado.
