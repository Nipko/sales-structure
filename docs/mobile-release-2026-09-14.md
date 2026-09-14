# Android 1.1.0 — auditoría de compatibilidad y publicación

## Estado

Release en preparación. Este documento no confirma todavía un AAB terminado ni una
publicación nueva en Google Play. Play Console confirma `1.0.0 (9)` en Producción
al 100%, con fecha 25-ago-2026, y sin cambios pendientes. El Samsung SM-S918B
conectado tiene `versionCode=9`, `versionName=1.0.0`, instalado por
`com.android.vending`. Coincide con el último build Android terminado de EAS.

| Referencia | Valor |
|---|---|
| Package | `cloud.parallly.mobile` |
| EAS project | `5a6f6dab-dec2-44e0-b00a-58e77c909501` |
| Build base | `66ec0b67-5e25-450e-a65f-70b4f4766eff` |
| Fecha del build base | 25-ago-2026 |
| Commit informado por EAS | `a0f925ef68247ec509965cb359d208cbe1d732bd` |
| Versión candidata | `1.1.0`; versionCode asignado por EAS remoto con autoIncrement |

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
- AAB, firma y prueba física del candidato: pendientes de completar.
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
| Optimización por debajo del umbral | Ofuscación 1%; Play indica umbral de 25% y plazo febrero de 2027. Plugin reproducible activa R8/minificación y reducción de recursos, con reglas optimizadas y mapas para Play/Sentry. Falta medir el AAB; no hay reglas globales que conserven todo |
| Orientación en pantallas grandes | Play señala `MainActivity` con `screenOrientation=PORTRAIT`. Plugin Android retira la restricción y permite redimensionar; introspección verificada, iOS conserva vertical. Formularios CRM/chat/operación permiten scroll; falta smoke físico |
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

## Evidencia pendiente del artefacto

Registrar aquí commit exacto, build ID, versionCode, URL del AAB, SHA-256,
bundletool validate, package/SDK/permisos y firma. Después registrar por separado
prueba interna, instalación desde Play y estado real de Producción. Un envío a revisión
no equivale a una publicación aprobada.
