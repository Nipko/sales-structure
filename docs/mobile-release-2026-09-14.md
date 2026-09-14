# Android 1.1.0 — auditoría de compatibilidad y publicación

## Estado

El AAB `1.1.0 (10)` terminó en EAS y pasó la validación de artefacto y firma.
Google Play lo publicó en la prueba interna el 14-sep-2026 a la 01:05 de Bogotá;
la comprobación física todavía está pendiente. Play Console confirma `1.0.0 (9)` en Producción
al 100%, con fecha 25-ago-2026. El Samsung SM-S918B
conectado tiene `versionCode=9`, `versionName=1.0.0`, instalado por
`com.android.vending`. Coincide con el último build Android terminado de EAS.

| Referencia | Valor |
|---|---|
| Package | `cloud.parallly.mobile` |
| EAS project | `5a6f6dab-dec2-44e0-b00a-58e77c909501` |
| Build base | `66ec0b67-5e25-450e-a65f-70b4f4766eff` |
| Fecha del build base | 25-ago-2026 |
| Commit informado por EAS | `a0f925ef68247ec509965cb359d208cbe1d732bd` |
| Versión candidata | `1.1.0 (10)`; versionCode asignado por EAS remoto con autoIncrement |

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

## Evidencia del artefacto

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

- Prueba interna: `1.1.0 (10)` disponible para verificadores internos desde
  14-sep-2026, 01:05 Bogotá, segmento `4701526887696492046`, release `5`.
- Play reconoce los adjuntos de ReTrace y símbolos de depuración nativos.
- No se pierden teléfonos, tablets ni Chromebooks compatibles frente a v9.
- Instalación y comprobación física: solicitadas al usuario, pendientes.
- Producción: todavía `1.0.0 (9)`. Candidato `1.1.0 (10)` guardado con las cuatro
  notas de idioma, 100% y todos los países de destino actuales, segmento
  `4698586868298478161`, release `3`. Envío a revisión pendiente de la comprobación física.

Un envío a revisión no equivale a una publicación aprobada.
