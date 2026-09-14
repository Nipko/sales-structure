# Optimización Android y diagnóstico de release

Fecha: 14 de septiembre de 2026. El AAB 1.1.0 (10) superó firma y estructura,
pero falló la conversión nativa de registros.
**Incidencia posterior: v10 bloqueado por SecureStore.** El probe nativo con su
DEX exacto reproduce `NullPointerException` en `RecordTypeConverter.kt:74`; R8
eliminó el miembro `PropertyDescriptor.fieldAnnotation` y sustituyó la lectura
por `throw null`, aunque las anotaciones y el DTO permanecían en el DEX.
La corrección para 1.1.1 añade keep solo a los tipos de anotación de
`expo.modules.kotlin.records` y a constructores de implementaciones de
`ValidationBinder`. El candidato 1.1.1 (12), EAS
`3f8c9d02-c694-47c2-9f93-21daa9176533`, terminó y pasó la conversión con su
DEX exacto en Android 16: diez etapas PASS, salida 0. Conserva R8 completo,
optimización, ofuscación y shrinking; el mapping se subió a Sentry.

El [diagnóstico reproducible](../apps/mobile/scripts/android-records-probe/README.md)
comprueba el mapping embebido y cada DEX mediante SHA-256. En Android 16 el
binario v10 supera las tres etapas de construcción y reflexión, pero falla las
siete etapas de conversión, con `RESULT failures=7` y salida 1. Incluye
opciones vacías, valores explícitos, rechazo de tipos incorrectos y registros
de notificaciones con campos obligatorios. Las pruebas usan objetos sintéticos;
no llaman a SecureStore ni acceden a sesiones, almacenamiento o datos de la app.

En v12 pasan 300 conversiones válidas y cuatro rechazos de datos inválidos.
El DEX tiene 7.428.824 bytes y SHA-256
`DE4532F905581D7C12430198DF408D5DD67CF04A07D0A2218E26AB32A1061351`.
El mapping conserva las reglas acotadas y `r8.json` confirma que las tres fases
siguen activas. Play confirma también para el build 12, artefacto
`4860230132141226011`, **91% de ofuscación**, optimización **Alta**, R8 completo
y compatibilidad de páginas de 16 KB. Las cifras del build 10 que aparecen
abajo son evidencia histórica.

Play confirma optimización alta y 91% de ofuscación para el build 10, disponible
en pruebas internas desde el 14-sep-2026 a la 01:05 de Bogotá. La observación del
build 9 (ofuscación 1%) corresponde al binario anterior en producción. Permanecen
pendientes la prueba física y la actualización de producción.

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
- Archivo generado `android/app/parallly-r8.pro`: conserva los atributos
  `SourceFile,LineNumberTable` para interpretar ubicaciones en errores, los tipos
  de anotación del contrato Expo Record y los constructores de sus validadores.

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
Tras la incidencia v10 se añade explícitamente este límite de reflexión:

```proguard
-keep @interface expo.modules.kotlin.records.** { *; }
-keep class * implements expo.modules.kotlin.records.ValidationBinder {
    public <init>();
}
```

Son diez tipos de anotación y siete constructores en el SDK instalado. No se
permite optimización de este límite: la sola presencia de metadata no impide
que R8 suponga que los proxies de anotación no tienen instancias.

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

### Evidencia del artefacto terminado

EAS terminó el build de producción el 14-sep-2026 a las 05:55:44 UTC.
El registro de compilación contiene `BUILD SUCCESSFUL` y la tarea
`uploadSentryProguardMappingsRelease`, con confirmación de subida del mapping
nativo a Sentry. Esto confirma la entrega del mapa; no una prueba de simbolicación
de un fallo real en el dispositivo.

| Comprobación | Resultado |
| --- | --- |
| Build EAS | `0bf6fdb7-6f21-4d4b-bd4a-71a756c89ed7`, `FINISHED`, perfil `production` |
| Commit | `d67c1fa0f9fe6883b60a8814fcaf0fbde36236b2` |
| Aplicación | `cloud.parallly.mobile`, versión `1.1.0`, versionCode `10` |
| SDK | mínimo 24, objetivo 36 |
| AAB | 52.032.300 bytes; firma verificada y `bundletool validate` aprobado |
| SHA-256 AAB | `1CAFA2E8EC550803EB87025AA7668007AB235C1DEC25D479C2595628BF5FE14A` |
| Mapping incluido | `BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map`, 69.276.634 bytes |
| Clases renombradas | 7.637, según el mapping inspeccionado |
| Metadatos R8 | `BUNDLE-METADATA/com.android.tools/r8.json`, versión 8.11.18 |

El `r8.json` del ZIP confirma `isObfuscationEnabled=true`,
`isOptimizationsEnabled=true`, `isShrinkingEnabled=true` y
`isProGuardCompatibilityModeEnabled=false`. Sus estadísticas internas son
`noObfuscationPercentage=14.52`, `noOptimizationPercentage=15.45` y
`noShrinkingPercentage=15.19`. Son estadísticas internas de R8, distintas del
91% de ofuscación que Play muestra para este artefacto; se conservan sus nombres
originales para no confundir las mediciones.

Fuentes locales: `C:/Users/USER/Desktop/parallly-v10-play/artifact-validation.json`,
`build-view.json`, `build-log-01.txt` y el AAB `parallly-1.1.0-v10.aab` del mismo
directorio. La introspección previa no ejecutaba dangerous mods; estos resultados
proceden de la compilación y del artefacto descargado.

### Resultado confirmado en Google Play

El explorador de app bundles de Play Console, artefacto `4860230114055681879`,
analizó el AAB 1.1.0 (10) y muestra:

| Métrica de Play | Resultado |
| --- | --- |
| Optimización | Alta |
| Porcentaje de ofuscación | 91%, superior al umbral de 25% observado en Play |
| R8 | Modo completo |
| Código DEX | 7,42 MB |
| Páginas de memoria | Admite 16 KB |
| Tamaño de descarga | 13,5 MB; reducción de 6,99 MB frente al build 9 |
| Tamaño de actualización | 4,53 MB |

La versión 10 figura disponible en pruebas internas, publicada el
14-sep-2026 a la 01:05 de Bogotá. Esta evidencia confirma el resultado de
optimización del nuevo artefacto. El aviso de 1% del build 9 es histórico para
ese binario y puede seguir asociado a producción hasta actualizarla; no se
registra aquí una publicación del build 10 en producción.

Play mide código DEX Java/Kotlin, no el bundle JavaScript ni bibliotecas `.so`.
Puede usar `r8.json`, mapping o heurísticas según los metadatos disponibles. El
91% anterior procede de su análisis visible, no de calcular un porcentaje a
partir del recuento local de clases renombradas.
[Métrica oficial DEX](https://developer.android.com/topic/performance/vitals/code-optimization).

La comprobación funcional permanece pendiente y debe usar el binario release optimizado: inicio y
Google Sign-In, biometría/SecureStore, push, cámara y adjuntos, notas de voz,
Inbox y reconexión, y las operaciones móviles corregidas. Una sesión de Expo Go
o una compilación debug no valida compatibilidad con R8. También queda pendiente
comprobar las advertencias de APIs edge-to-edge; la optimización alta no demuestra
que hayan desaparecido ni sustituye la prueba física del binario de Play.
