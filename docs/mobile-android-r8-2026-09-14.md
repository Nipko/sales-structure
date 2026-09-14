# Optimización Android y diagnóstico de release

Fecha: 14 de septiembre de 2026. Cambio preparado para Parallly Mobile 1.1.0.
La observación de Play del build 9 (ofuscación 1%) corresponde al binario anterior;
el nuevo porcentaje queda pendiente de compilar y analizar el AAB.

## Causa y configuración reproducible

La plantilla Expo SDK 54 dejaba `android.enableMinifyInReleaseBuilds` y
`android.enableShrinkResourcesInReleaseBuilds` desactivadas por defecto. Además
referenciaba `proguard-android.txt`, cuya configuración desactiva optimizaciones.
Android recomienda activar ambas fases y usar `proguard-android-optimize.txt`.
[Configuración oficial R8](https://developer.android.com/topic/performance/app-optimization/enable-app-optimization).

`apps/mobile/plugins/withAndroidReleaseOptimization.js`, registrado en
`app.config.ts`, aplica estos valores durante prebuild:

- Reducción y ofuscación de código release: `android.enableMinifyInReleaseBuilds=true`.
- Reducción de recursos release: `android.enableShrinkResourcesInReleaseBuilds=true`.
- Modo completo: `android.enableR8.fullMode=true`.
- Reglas base: `proguard-android-optimize.txt`.
- Archivo generado `android/app/parallly-r8.pro`: conserva solamente los atributos
  `SourceFile,LineNumberTable` para interpretar ubicaciones en errores.

No cambia debug, firma, SDK, versión de AGP ni configuración iOS. El plugin
falla con un mensaje explícito si una actualización del SDK cambia el formato
Groovy o desconecta las propiedades esperadas de release. El árbol `android/`
local está ignorado por Git; la fuente del cambio es el plugin versionado.

Expo documenta estas opciones para SDK 54 y su aplicación mediante config plugins
durante prebuild. `expo-build-properties` no estaba instalado; se usa la API de
plugins ya disponible, sin agregar dependencias npm.
[Expo SDK 54 BuildProperties](https://docs.expo.dev/versions/v54.0.0/sdk/build-properties/).

## Reflexión, módulos nativos y mapping

No se agregan reglas `-keep class **`, exclusiones de bibliotecas completas ni
`-dontoptimize`, `-dontobfuscate`, `-dontshrink` o supresión global de advertencias.
Se conservan las reglas existentes de la plantilla y las reglas consumer
de las dependencias; los atributos de diagnóstico no mantienen clases vivas.

La revisión del código instalado confirmó:

- React Native 0.81.5 registra `ReactAndroid/proguard-rules.pro` mediante
  `consumerProguardFiles`: protege el puente nativo, anotaciones DoNotStrip,
  métodos JNI y TurboModules que se invocan dinámicamente.
- Expo Modules Core registra sus reglas consumer para módulos, records,
  shared objects, vistas y eventos usados por reflexión.
- Google Sign-In 16.1.2 utiliza el puente React Native y Play Services Auth
  21.4.0. No se añade una regla propia para conservar todo `com.google.**`;
  las reglas consumer de sus artefactos permanecen en la resolución de Gradle.
- Sentry React Native 7.2.0 ya incluye el plugin Android Gradle 5.11.0.
  `experimental_android.enableAndroidGradlePlugin=true` activa su integración;
  `includeProguardMapping` y `autoUploadProguardMapping` están habilitados.
  La subida de símbolos y fuentes nativas adicionales y source context queda
  deshabilitada. La integración previa de source maps JavaScript se conserva.

Autoridad de Sentry: `@sentry/react-native/plugin/build/withSentry.js`,
`withSentryAndroidGradlePlugin.js` y `sentry.gradle` del paquete instalado.
El mapping utiliza `SENTRY_ORG`, `SENTRY_PROJECT` y `SENTRY_AUTH_TOKEN` externos.
No se incluyen credenciales en el plugin. `SENTRY_DISABLE_AUTO_UPLOAD=true` o
`SENTRY_DISABLE_NATIVE_DEBUG_UPLOAD=true` desactivan esa subida: no deben usarse
para dar por verificado el diagnóstico del build de producción.

El perfil EAS production conserva `android/app/build/outputs/mapping/release/**`
como artefactos adicionales. El mapping debe asociarse al mismo build que
produjo el fallo; un mapping de otra versión no sirve para interpretarlo.

## Evidencia y validación del AAB

Comprobado localmente:

- Nueve pruebas del plugin: propiedades antiguas y duplicadas, idempotencia,
  conservación de firma/debug/reglas propias, cambios incompatibles del template,
  atributos sin keep global y generación real del archivo de reglas en un
  directorio temporal durante el mod de prebuild.
- TypeScript sin errores.
- `expo config --type introspect --json` muestra las tres propiedades activadas.
- Evaluación en memoria de los mods Gradle registrados confirma el default
  optimizado, la inclusión de `parallly-r8.pro`, Sentry Gradle 5.11.0 y subida de
  mapping habilitada. No modifica el proyecto Android local.

Introspect no ejecuta dangerous mods ni compila Java/Kotlin. Antes de distribuir,
verificar en el build EAS que existe `parallly-r8.pro`, que R8 finaliza sin errores,
que el mapping se conserva y Sentry registra su subida. Inspeccionar en el AAB
`BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map` y, si la versión
de herramientas lo produce, `BUNDLE-METADATA/com.android.tools/r8.json`.

Play mide código DEX Java/Kotlin, no el bundle JavaScript ni bibliotecas `.so`.
Puede usar `r8.json`, mapping o heurísticas según los metadatos disponibles; por
eso esta configuración no demuestra por sí sola el porcentaje final ni que el
aviso del build 9 desapareció.
[Métrica oficial DEX](https://developer.android.com/topic/performance/vitals/code-optimization).

La comprobación funcional debe usar el binario release optimizado: inicio y
Google Sign-In, biometría/SecureStore, push, cámara y adjuntos, notas de voz,
Inbox y reconexión, y las operaciones móviles corregidas. Una sesión de Expo Go
o una compilación debug no valida compatibilidad con R8.
