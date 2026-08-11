# Build de la app móvil con EAS (distribución)

> Estado al 10-ago-2026: el AAB de producción v7 fue generado por EAS desde el commit
> `8bea2bec`, terminó en estado `FINISHED` y fue validado con bundletool, firma y
> manifiesto. La versión se instaló/actualizó en un SM-S918B desde Google Play
> (`com.android.vending`); login, desconexión, reconexión y relanzamiento pasaron. La
> prueba interna v7 está activa. El rollout completo de Producción fue enviado para
> 176 países/regiones más `Resto del mundo`; sus 11 cambios fueron enviados y Play
> confirma **Tus cambios están en proceso de revisión**. La publicación administrada
> está desactivada, por lo que una aprobación publicará automáticamente.

## Artefacto vigente

| Dato | Valor comprobado |
|---|---|
| EAS build ID | `d42cf4d5-db7c-4f6c-95c9-32e174901d16` |
| Commit | `8bea2bec1b3b502285633bc7bbf34a79c6ee7d69` |
| Plataforma / perfil | Android / `production` |
| Distribución | `STORE` |
| package | `cloud.parallly.mobile` |
| versionName / versionCode | `1.0.0` / `7` |
| minSdk / targetSdk / compileSdk | `24` / `36` / `36` |
| Tamaño del AAB | `53.294.348` bytes |
| SHA-256 del AAB | `194859407468ECD77F59D666B8AD8FE8E3BD207AFC04853044774599FD78747B` |
| Certificado upload SHA-256 | `42:DE:BB:77:51:83:D1:D9:63:7D:43:60:79:C0:CF:71:D6:79:E4:F6:36:C8:C2:5A:F6:0C:61:44:AE:B5:A1:34` |
| Ruta local | `C:\Users\USER\Desktop\parallly-v7-play\parallly-1.0.0-v7.aab` |
| Artefacto EAS | `https://expo.dev/artifacts/eas/XWBP5QWO_EE61q4DVG5aPWfsmQfFdpGX_BzEVShWPPI.aab` |

Este es el AAB del release vigente. Play Console lo reconoce como `1.0.0 (7)` y la
prueba interna v7 está activa; los v2–v6 quedaron reemplazados como candidatos.

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
npx eas-cli build:view d42cf4d5-db7c-4f6c-95c9-32e174901d16
npx eas-cli build:list --platform android --limit 5 --non-interactive --json
```

Antes de aceptar un build futuro, comprobar que su commit coincide con `HEAD` y que
EAS incrementó versionCode. No reutilizar versionCode `7` para otro AAB.

## Validar el AAB

Usar el jar ejecutable completo de bundletool. El jar modular que queda en la caché de
Gradle no contiene `Main-Class` y no funciona con `java -jar`.

Herramienta usada para v7 (el mismo jar reutilizable conservado junto a v6):
`C:\Users\USER\Desktop\parallly-v6-play\bundletool-all-1.18.1.jar`.

```powershell
$paralllyBundletoolJar = 'C:\Users\USER\Desktop\parallly-v6-play\bundletool-all-1.18.1.jar'
cd C:\Users\USER\Desktop\parallly-v7-play
java -jar $paralllyBundletoolJar validate --bundle=parallly-1.0.0-v7.aab
java -jar $paralllyBundletoolJar dump manifest --bundle=parallly-1.0.0-v7.aab
jarsigner -verify parallly-1.0.0-v7.aab
```

Resultado v7:

- `bundletool validate`: **PASS**;
- package `cloud.parallly.mobile`;
- versionCode `7`, versionName `1.0.0`;
- minSdk `24`, targetSdk/compileSdk `36`;
- `jarsigner`: firma verificada;
- certificado de upload SHA-256:
  `42:DE:BB:77:51:83:D1:D9:63:7D:43:60:79:C0:CF:71:D6:79:E4:F6:36:C8:C2:5A:F6:0C:61:44:AE:B5:A1:34`;
- `SYSTEM_ALERT_WINDOW` y `WRITE_EXTERNAL_STORAGE`: ausentes;
- `READ_EXTERNAL_STORAGE`: presente solo hasta `maxSdkVersion=32`;
- `RECORD_AUDIO`: presente, requerido para notas de voz.

Calcular el hash antes de mover o subir el archivo:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath .\parallly-1.0.0-v7.aab
```

El valor debe ser:
`194859407468ECD77F59D666B8AD8FE8E3BD207AFC04853044774599FD78747B`.

## Instalar y comprobar la entrega de Google Play

Para validar el artefacto que realmente reciben los usuarios, la prueba vigente no usa
un APK universal cargado con ADB. La v7 se instaló/actualizó desde la prueba interna de
Google Play y luego se verificó la fuente del paquete:

```powershell
adb devices -l
adb shell pm list packages -i cloud.parallly.mobile
adb shell dumpsys package cloud.parallly.mobile | Select-String 'versionCode|versionName|installerPackageName'
adb shell monkey -p cloud.parallly.mobile -c android.intent.category.LAUNCHER 1
```

Resultado confirmado en `SM-S918B`:

- versionName `1.0.0`, versionCode `7`;
- instalador `com.android.vending`;
- el arreglo del conflicto de sesión permitió completar el login correctamente;
- desconexión, reconexión y relanzamiento pasaron;
- logcat no mostró fatal ni `JSON Parse error: Unexpected end of input`.

La fuente `com.android.vending` distingue esta validación de una instalación local por
ADB y confirma que el smoke corresponde a la entrega procesada por Play App Signing.

## Smoke test de desconexión

La prueba técnica y visible fue completada con v7 entregada por Google Play:

- durante la desconexión Android informó `Active default network: none`;
- el proceso de la app permaneció vivo con PID activo;
- Inbox mostró el estado `SIN CONEXIÓN`;
- CRM mostró un error honesto y la acción `Reintentar`, sin sustituirlo por un estado
  vacío ni dejar un loader infinito;
- logcat mostró 0 coincidencias de `FATAL` y 0 de `JSON Parse`;
- al restaurar Wi-Fi y datos, `Reintentar` cargó los leads de CRM inmediatamente sin
  cerrar la sesión.

Después de restaurar la red se relanzó la app y el login/sesión siguió operativo.
Resultado: **PASS** para login, desconexión/reconexión y relanzamiento en el SM-S918B.

## Estado en Google Play

- AAB v7 validado por Play y publicado en una prueba interna activa con versionCode
  `7`;
- App access guardado;
- Target audience guardado únicamente como `18 años o más`;
- Data safety guardado y App content muestra que no hay acciones pendientes;
- la declaración de IA/opinión quedó completada con criterio conservador: únicamente
  `play-icon-512.png` y `play-feature-graphic-1024x500.png` se etiquetaron; las cuatro
  capturas reales de la app no se etiquetaron;
- las cuatro capturas aprobadas fueron cargadas y la ficha de tienda quedó guardada con
  sus cambios incluidos en la revisión de Producción;
- la lista de verificadores quedó guardada, seleccionada y contiene un verificador;
- el release `1.0.0 (7)` está activo y disponible desde
  `https://play.google.com/apps/internaltest/4701526887696492046`;
- la instalación/actualización desde Google Play quedó verificada mediante
  `com.android.vending`, y el smoke de login, desconexión/reconexión y relanzamiento
  pasó;
- el panel tiene Producción habilitada y no muestra un requisito de 12 testers durante
  14 días. Esto es una observación de la consola, no una exención general de la política.

La cuenta de revisión `architerin@gmail.com` quedó verificada con 2FA desactivado. El
tenant `Test Business` tiene una compensación Pro activa hasta el 7-ago-2036, registrada
como `plan_comp_granted` con motivo de revisión y QA de Google Play.

Estado de Producción:

- rollout completo de v7 enviado para 176 países/regiones más `Resto del mundo`;
- 11 cambios en revisión; Play confirma `Tus cambios están en proceso de revisión`;
- app todavía no publicada en Producción;
- publicación administrada desactivada: Play publicará automáticamente si aprueba.

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
