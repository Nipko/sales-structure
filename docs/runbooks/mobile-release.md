# Runbook — release de la app móvil (Android / Google Play)

Proceso vigente para publicar una versión de `apps/mobile` (Expo / React Native). Reúne
en un solo documento lo que antes estaba repartido en el checklist de GATE 0, el
checklist de publicación en Play Store y los pasos finales de Play Console (retirados en
K3, 2026-10-30; el historial queda en git). El registro de la última release publicada
(1.1.1, sep-2026) está en
[`archive/2026-09-movil/mobile-release-2026-09-14.md`](../archive/2026-09-movil/mobile-release-2026-09-14.md).

- **Fuente de verdad del estado de tienda:** Google Play Console y EAS. Este documento no
  certifica ningún binario: cada candidato nuevo repite la validación.
- **Build y firma:** [`mobile-eas-build.md`](../mobile-eas-build.md).
- **Sourcemaps / errores:** [`mobile-sentry-sourcemaps.md`](../mobile-sentry-sourcemaps.md).
- **Comportamiento funcional:** [`mobile-user-manual.md`](../mobile-user-manual.md).

La app móvil **no** sale por el pipeline web: `deploy.yml` ignora `apps/mobile`. Su suite
de pruebas sí corre en CI (`vertical-quality.yml` y `deploy.yml`).

## 1. Criterio de calidad del candidato (antes del build)

Heredado del antiguo GATE 0; se revisa en cada release:

- Sentry reporta eventos del build y la tasa sin fallas es aceptable.
- Ninguna llamada a la API falla en silencio; los flujos muestran el error.
- Textos en los 4 idiomas (es/en/pt/fr) y terminología del tipo de negocio cableada.
- Suite móvil en verde en CI.
- Degradación sin red: cola de envío y reintento.
- Estados de carga / vacío / error y paginación en todas las pantallas.
- Accesibilidad básica: etiquetas y objetivos táctiles ≥ 44 px.

## 2. Build y validación del AAB

1. Generar el AAB de producción con EAS (perfil `production`; ver `mobile-eas-build.md`).
2. Validar con `bundletool`: `versionCode`, firma, manifiesto y nivel de optimización R8.
3. Instalar el candidato desde una prueba interna de Play (instalador
   `com.android.vending`) en un dispositivo físico y repetir el smoke: login, Inbox,
   envío y reintento, CRM, agenda, desconexión y reconexión de red.
4. Revisar en Sentry que el build envía eventos con sourcemaps.

## 3. Play Console — declaraciones que deben mantenerse

| Sección | Valor vigente | Motivo |
|---|---|---|
| Categoría | App de Negocios | Consola del agente para un negocio existente |
| Funciones de salud | **Ninguna función de salud** | La agenda es horizontal (reuniones, servicios). La app no integra Health Connect, datos clínicos ni permisos de salud. Declararla de salud provocó el rechazo del 16-ago-2026 |
| Target audience | Solo 18 años o más | — |
| Data safety | Recopila y cifra en tránsito identidad/contacto, mensajes y adjuntos, archivos, actividad, registros de fallas, diagnóstico y token push. **No** ubicación, **no** información de pago, **no** salud ni actividad física. Sentry, Expo y FCM son proveedores de servicio, no terceros | Coherente con el binario |
| Eliminación de cuenta | `https://parallly-chat.cloud/data-deletion`; en la app, **Más → Cuenta** | Requisito de Play |
| Declaración IA | Solo los recursos promocionales (`apps/mobile/store-assets/`) se etiquetan; las capturas reales de la app no | — |
| Anuncios / Advertising ID / app gubernamental | No | — |

**App access (cuenta de revisión).** Google necesita una cuenta reutilizable sin código
temporal, pago ni configuración adicional: tenant de prueba con plan activo de larga
duración, 2FA desactivado y datos ficticios. La contraseña vive **solo** en Play Console;
nunca en el repositorio ni en chats. Instrucciones que se dejan en la consola:

```text
Sign in with the credentials above. Two-factor authentication is disabled. Open Inbox
to review synthetic conversations, CRM for sample leads, and Deal for appointments.
All records are fictional and no additional setup or payment is required. The app is
an agent console for an existing business account; sign-up and billing happen on the
web dashboard, not inside the app.
```

Quien instala sin cuenta ve la bienvenida con login y enlace al alta web; Google sin
cuenta responde `no_account` y no crea un usuario huérfano. La app no vende ni muestra
precios.

## 4. Publicación

1. Subir el AAB a la **prueba interna**, con la lista de verificadores seleccionada.
2. Confirmar instalación desde Play y repetir el smoke del paso 2.3.
3. Crear la release de **Producción** con las notas de la versión (4 idiomas si aplica).
   La publicación administrada queda **desactivada**: si Google aprueba, Play publica solo.
4. Mantener separados tres estados al informar: *prueba interna activa*, *enviado a
   revisión* y *publicado en Producción*. No declarar publicada una versión que sigue en
   revisión.
5. Tras la aprobación: smoke en Producción y revisión de Sentry y de las alertas de Play
   (optimización, pantallas grandes, APIs de borde a borde).

## 5. Si Google rechaza

Leer el motivo exacto, corregir la declaración o el binario, y reenviar. No cambiar
declaraciones para “pasar” si no describen el binario real.
