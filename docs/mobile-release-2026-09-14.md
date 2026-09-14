# Android 1.1.1 — auditoría de compatibilidad y publicación

## Estado

**Candidato v10 bloqueado; no enviar a Producción.** Sentry confirmó el evento
`REACT-NATIVE-2` (`7730735217`) en `cloud.parallly.mobile@1.1.0+10`, dist `10`:
la conversión nativa de opciones de SecureStore lanza `NullPointerException`
durante el inicio de sesión con Google en Android 11. La revisión del 14-sep
observó 25 eventos en tres dispositivos identificados como OnePlus8Pro. Las
pruebas estáticas y la mejora de optimización no certificaban este recorrido en
ejecución.

La reproducción aislada en el Samsung confirmó el NPE con el DEX exacto de v10,
sin acceder a credenciales ni datos de la app. ReTrace lo ubica en
`RecordTypeConverter.kt:74`: R8 eliminó `PropertyDescriptor.fieldAnnotation` y
convirtió la lectura de la clave en `throw null`. La estructura de
`SecureStoreOptions` estaba conservada; repetir su regla de keep no soluciona
este límite de reflexión.

El candidato **1.1.1 (12)** conserva específicamente las anotaciones
`expo.modules.kotlin.records.**` y los constructores de `ValidationBinder` usados
por `createInstance()`. Mantiene R8 completo, shrinking y mapas de Sentry. La
conversión nativa del nuevo AAB ya pasó; falta validar la instalación y el acceso
real desde Play antes de reemplazar el candidato bloqueado en producción.
En Play, v10 fue guardado para más
adelante y ya no figura en los cambios listos para enviar a revisión.

EAS terminó el candidato el 14-sep-2026 a las 07:16:56 UTC desde el commit
`a516c144cd0ab2a4a94b10d19d786bf7a178aaf5`, build
[`3f8c9d02-c694-47c2-9f93-21daa9176533`](https://expo.dev/accounts/nirlevin/projects/parallly-mobile/builds/3f8c9d02-c694-47c2-9f93-21daa9176533).
El código 11 quedó reservado por EAS en un intento cuya carga falló por falta de
espacio local; no se creó ni distribuyó un binario 11. El reintento cargó
correctamente el código 12. Play publicó `1.1.1 (12)` en pruebas internas el
14-sep-2026 a las 02:21 de Bogotá, release 6, con notas en cuatro idiomas.

La prueba reproducible está en
[`apps/mobile/scripts/android-records-probe`](../apps/mobile/scripts/android-records-probe/README.md).
Vincula el mapping con el AAB por SHA-256 y ejecuta el DEX exacto con mapas
sintéticos, sin llamar módulos ni acceder a datos de la app. En v10 pasan las
tres etapas de construcción/reflexión y fallan las siete etapas de conversión
con NPE, incluida la validación de campos obligatorios de notificaciones.
La salida es `RESULT failures=7`, código 1. En el AAB 12 pasan las diez etapas,
con `RESULT failures=0`, código 0: 100 conversiones vacías, 100 con valores
explícitos y 100 registros válidos de notificaciones, más cuatro rechazos
semánticos de datos inválidos. Esto no sustituye la prueba completa de inicio
de sesión desde Play.

## Evidencia del candidato corregido 1.1.1 (12)

| Dato | Resultado |
|---|---|
| AAB | `parallly-1.1.1-v12.aab`, 52.039.230 bytes |
| SHA-256 AAB | `362F2DB492D6F819458D40909FC6D0E67860E016FBA3F8DF61F580C9600AB05C` |
| SHA-256 DEX | `DE4532F905581D7C12430198DF408D5DD67CF04A07D0A2218E26AB32A1061351` |
| Mapping | 69.298.430 bytes, 7.643 clases renombradas; SHA coincide con el mapping embebido |
| Firma y estructura | `bundletool validate` y `jarsigner` PASS; mismo certificado de upload que v9/v10 |
| Manifest | Package correcto, mínimo 24, destino 36, sin restricción de orientación; redimensionable y `adjustNothing` |
| API embebida | `https://api.parallly-chat.cloud/api/v1` |
| Optimización | R8 8.11.18, ofuscación, optimización y shrinking activos, modo completo |
| Diagnóstico Sentry | Google Services procesado y un nuevo mapping subido; `BUILD SUCCESSFUL` |
| Prueba Android | Samsung SM-S918B, Android 16: diez etapas PASS, salida 0 |
| Análisis Play | Artefacto `4860230132141226011`: optimización Alta, 91% de ofuscación, R8 completo, DEX 7,43 MB, páginas de 16 KB |
| Distribución interna | Release 6, disponible el 14-sep-2026 a las 02:21 de Bogotá; descarga 13,5 MB, actualización desde v10 3,59 MB |

Artefactos y logs en `C:/Users/USER/Desktop/parallly-v12-play`. La prueba usa el
DEX exacto del AAB y verifica sus hashes; no reinstala la app ni lee SecureStore.
El Samsung todavía tenía instalado `1.0.0 (9)` al ejecutar el diagnóstico.

## Evento adicional de Google Sign-In

Sentry `REACT-NATIVE-3` (`7730787001`), evento
`df19fb8df28844a38a49a85944cec56c`, pertenece a `1.1.0 (10)`: un evento manejado
en Android 11 el 14-sep-2026 a las 06:55:33.974 UTC, con `flow=google_signin` y
`google_status_code=8`. El mapping exacto resuelve `a6.e` como
`com.google.android.gms.common.api.ApiException`. Sentry no recibió stack.

Google define [INTERNAL_ERROR (8)](https://developers.google.com/android/reference/com/google/android/gms/common/api/CommonStatusCodes#INTERNAL_ERROR)
como un error interno para el que reintentar debería resolver el problema.
`LoginScreen` muestra el código y libera el botón en `finally`. El evento no
demuestra una configuración OAuth incorrecta, un fallo no manejado ni el mismo
NPE de Expo Record. Comparte dispositivo y traza con el evento de SecureStore;
esa coincidencia no establece causalidad. Se debe comprobar el acceso real con
Google en el build 12 y revisar cualquier repetición antes de promoverlo.

## Base de comparación de la auditoría

El AAB `1.1.0 (10)` terminó en EAS y pasó la validación de artefacto y firma.
Google Play lo publicó en la prueba interna el 14-sep-2026 a la 01:05 de Bogotá,
antes de identificar la regresión; el build 12 lo sustituye en ese segmento.
Play Console confirma `1.0.0 (9)` en Producción
al 100%, con fecha 25-ago-2026. El Samsung SM-S918B
conectado tiene `versionCode=9`, `versionName=1.0.0`, instalado por
`com.android.vending`. Coincide con el build base del 25 de agosto.

| Referencia | Valor |
|---|---|
| Package | `cloud.parallly.mobile` |
| EAS project | `5a6f6dab-dec2-44e0-b00a-58e77c909501` |
| Build base | `66ec0b67-5e25-450e-a65f-70b4f4766eff` |
| Fecha del build base | 25-ago-2026 |
| Commit informado por EAS | `a0f925ef68247ec509965cb359d208cbe1d732bd` |
| Versión candidata | `1.1.1 (12)`; versionCode asignado por EAS remoto con autoIncrement |

La metadata git de EAS identifica la base de comparación; por sí sola no prueba que
un build histórico no incluyera archivos modificados sin commit.

## Por qué hace falta actualizar

| Recorrido | Evidencia | Tratamiento |
|---|---|---|
| Pedidos de catálogo | La API exige revisión de términos, idempotencia al crear y versión al avanzar; build 9 no enviaba esos campos | Incluir los cambios móviles ya implementados en septiembre y sus regresiones |
| Respuestas humanas | El build base no conserva el identificador de reintento ni los estados pendientes/fallidos tras recargar | Incluir las correcciones de outbox y entrega del 9–12 de septiembre |
| Alquiler vehicular | La entrega/devolución requiere inspecciones con evidencia; el endpoint genérico de estado ya no acepta esos avances | Reconocer revisión pendiente, respetar cancelación permitida y guiar a inspecciones/revisión en la web según rol |
| Servicios a domicilio | Programar requiere un servicio de catálogo real con duración; móvil no lo enviaba | Selección explícita al programar, incluidos registros antiguos; la captura sin agendar sigue disponible con tipo de servicio libre |
| CRM y analítica | Agentes veían acciones de archivo e indicadores que la API reserva a administración/supervisión | Ocultar acciones y evitar solicitudes sin permiso |
| Conversación abierta | Reasignaciones y reconexiones podían dejar antiguo el control/presencia del hilo | Actualizar por eventos del inbox, restaurar presencia y retirar el contenido ante pérdida explícita de acceso |

Fuentes: `apps/api/src/modules/orders/orders.controller.ts`,
`apps/api/src/modules/resource-rentals/resource-rentals.service.ts`,
`apps/api/src/modules/home-services/home-services.service.ts`, controladores CRM,
dashboard-analytics y agent-console, y los clientes/helpers correspondientes en
`apps/mobile/src`.

## Alcance que continúa en la web

Configuración de empresa, canales, agentes, herramientas, conocimiento, publicación
de agentes, Assist/Calidad, credenciales de cobro y administración completa continúan
en el dashboard. El móvil es la consola operativa complementaria. Esta release no
promete paridad de todas las pantallas administrativas ni amplía capacidades por plan.
Las preferencias de notificación móviles siguen siendo locales; no equivalen a las
preferencias de cuenta del backend.

En talleres, la agenda móvil sigue cubriendo visitas/citas; las órdenes de reparación
(`repair_orders`) se gestionan en la web. Esta diferencia no se presenta como paridad
completa de la operación del taller.

## Validación

- Base antes de los cambios: TypeScript PASS; Jest PASS (27 suites, 331 pruebas).
- React Native 0.81.5 / Expo SDK 54: 21 dependencias nativas compatibles con la matriz
  local de Expo; Node 22.20 cumple el mínimo 20.19.4.
- Candidato: TypeScript PASS; Jest PASS (34 suites, 405 pruebas), incluidas las
  regresiones de acceso/presencia, operaciones, roles, idiomas y plugins Android.
- Exportación Android de producción PASS: Hermes, 1.657 módulos, bundle de
  5.780.591 bytes, assets completos; package, versión y API de producción verificados.
  Esta exportación no certifica el binario nativo.
- AAB: `bundletool validate` PASS, package/versión/SDK y API de producción embebida
  correctos; firma verificada y certificado de upload coincide. MainActivity sin
  restricción de orientación, redimensionable y con `adjustNothing` conservado.
  Mapping R8 incluido y subida nativa a Sentry completada. Prueba física pendiente.
- EAS conserva el keystore de upload y las credenciales FCM. No tiene una cuenta de
  servicio asignada a Play Store Submissions; la publicación requiere la sesión de
  Play Console. No se reutiliza la clave FCM como credencial de publicación.
- Verificación requerida del monorepo: TypeScript API/dashboard/landing PASS y
  bootstrap NestJS PASS. Docker no está disponible en este equipo, por lo que no se
  certifica aquí la salud de PgBouncer. Esta release no modifica backend ni esquema.

## Acciones recomendadas de Play Console

Observadas en el panel de Producción sobre `9 (1.0.0)` el 14-sep-2026:

| Señal | Evidencia y tratamiento |
|---|---|
| Optimización por debajo del umbral | Ofuscación 1% en v9; Play indica umbral de 25% y plazo febrero de 2027. El explorador del AAB v10 confirma **91%**, optimización **Alta** y modo completo de R8. El binario nuevo supera el umbral; el aviso histórico de Producción v9 no equivale al resultado del v10 |
| Orientación en pantallas grandes | Play señala `MainActivity` con `screenOrientation=PORTRAIT` en v9. El manifiesto del AAB v10 confirma la restricción eliminada y redimensionado permitido; iOS conserva vertical. Formularios CRM/chat/operación permiten scroll; falta smoke físico |
| APIs antiguas de borde a borde | Play enumera llamadas a colores de barras y modos de recorte en React Native, Material, react-native-screens y expo-image-picker. La app solo usa `StatusBar style="light"`; el SDK 54 instalado conserva llamadas de compatibilidad dentro de dependencias. No se declara resuelto hasta revisar el análisis del AAB nuevo |

La lista de fallas/ANR muestra **sin resultados / datos no disponibles**; no es
evidencia de una tasa de cero fallas. La consola también confirma que las apps de la
cuenta están registradas para la verificación de desarrolladores Android.

Detalles de dependencias, manifiesto y prueba visual pendiente:
[compatibilidad Android](mobile-play-compatibility-2026-09-14.md).
Configuración y verificación de mapas:
[optimización R8](mobile-android-r8-2026-09-14.md).

Fuentes oficiales: [optimización Android](https://developer.android.com/topic/performance/vitals/code-optimization),
[borde a borde Android 15](https://developer.android.com/about/versions/15/behavior-changes-15#edge-to-edge),
[pantallas grandes Android 16](https://developer.android.com/about/versions/16/behavior-changes-16#large-screens-form-factors).

## Notas propuestas para Google Play

```text
Mejoramos la confiabilidad al responder y reintentar mensajes, la sincronización de
conversaciones y los permisos del equipo. Actualizamos pedidos y servicios a domicilio
para trabajar con los nuevos controles de la plataforma. Los alquileres ahora muestran
el siguiente paso de revisión o inspección y permiten continuar en la web.
```

## Evidencia histórica del artefacto 1.1.0 (10), bloqueado

| Dato | Resultado |
|---|---|
| Commit del build | `d67c1fa0f9fe6883b60a8814fcaf0fbde36236b2` |
| Build EAS | [`0bf6fdb7-6f21-4d4b-bd4a-71a756c89ed7`](https://expo.dev/accounts/nirlevin/projects/parallly-mobile/builds/0bf6fdb7-6f21-4d4b-bd4a-71a756c89ed7) |
| Finalización | 14-sep-2026, 05:55:44 UTC, `FINISHED` |
| Artefacto | `parallly-1.1.0-v10.aab`, 52.032.300 bytes |
| SHA-256 | `1CAFA2E8EC550803EB87025AA7668007AB235C1DEC25D479C2595628BF5FE14A` |
| Firma de upload SHA-256 | `42:DE:BB:77:51:83:D1:D9:63:7D:43:60:79:C0:CF:71:D6:79:E4:F6:36:C8:C2:5A:F6:0C:61:44:AE:B5:A1:34` |
| Versión / SDK | `1.1.0 (10)`, mínimo 24, destino 36 |
| Validación | bundletool 1.18.1 y jarsigner PASS |
| Mapping | `BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map`, 69.276.634 bytes, 7.637 clases renombradas |
| R8 | 8.11.18; ofuscación, optimización y shrinking activos; modo de compatibilidad ProGuard desactivado |
| Firebase y Sentry | `processReleaseGoogleServices` y `uploadSentryProguardMappingsRelease` completados; `BUILD SUCCESSFUL` |
| Permisos retirados | `SYSTEM_ALERT_WINDOW` y `WRITE_EXTERNAL_STORAGE` ausentes |
| PR | [28](https://github.com/Nipko/sales-structure/pull/28); CI de contratos/pruebas y GitGuardian PASS |
| Análisis Play v10 | Artefacto `4860230114055681879`: optimización Alta, ofuscación 91%, R8 completo, DEX 7,42 MB; admite páginas de 16 KB |
| Descarga calculada por Play | Instalación nueva 13,5 MB, 6,99 MB menos que v9; actualización 4,53 MB |

La evidencia local está en `Desktop/parallly-v10-play`: metadata EAS, manifiesto,
validación, certificado, SHA-256 y metadata R8. El conteo de clases renombradas no
equivale al porcentaje que publica Play Console.

## Distribución

- Prueba interna: `1.1.1 (12)` disponible para verificadores internos desde
  14-sep-2026, 02:21 Bogotá, segmento `4701526887696492046`, release `6`.
  Sustituye a `1.1.0 (10)`, cuya release `5` no debe promoverse.
- Play reconoce los adjuntos de ReTrace y símbolos de depuración nativos.
- No se pierden teléfonos, tablets ni Chromebooks compatibles frente a v9.
- Instalación y comprobación física del build 12: solicitadas al usuario,
  pendientes. El diagnóstico aislado PASS no sustituye Google Sign-In ni la
  conservación de la sesión en la app instalada desde Play.
- Producción: todavía `1.0.0 (9)`. Candidato `1.1.0 (10)` guardado con las cuatro
  notas de idioma, 100% y todos los países de destino actuales, segmento
  `4698586868298478161`, release `3`. **No enviar v10**: reemplazarlo por el candidato
  que resuelva el fallo de SecureStore y pase la comprobación física.

Un envío a revisión no equivale a una publicación aprobada.
