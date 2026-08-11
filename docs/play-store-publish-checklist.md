# Play Store — Estado y checklist de publicación (Parallly Mobile)

> **Estado al 10-ago-2026.** La aplicación ya existe en Google Play Console, la prueba
> interna está activa y Producción fue enviada a revisión; todavía no está publicada. El
> candidato vigente es el AAB `1.0.0 (7)`, generado desde el commit `8bea2bec`, validado
> con bundletool, firma y manifiesto, e instalado desde Google Play en el dispositivo de
> pruebas. Play lo tiene en un release interno activo con v7; App access, Target audience,
> Data safety y la ficha con cuatro capturas
> están guardados, App content figura al día y la declaración de IA/opinión está
> completada. Play confirma **Tus cambios están en proceso de revisión**. La publicación
> administrada está desactivada, por lo que una aprobación publicará la app
> automáticamente.

## Identidad en Google Play

| Dato | Valor / estado |
|---|---|
| Nombre | Parallly |
| App ID de Play Console | `4973585124580020376` |
| Package | `cloud.parallly.mobile` |
| Tipo / precio | App · Gratis |
| Idioma predeterminado | Español (Latinoamérica), `es-419` |
| Correo de soporte | `support@parallext.com` |
| Teléfono de soporte | `+573134328491` |
| Sitio web | `https://parallly-chat.cloud` |
| Cuenta de desarrollador | Organización; identidad, sitio y contactos verificados |

## Resumen ejecutivo

| # | Requisito | Estado real |
|---|---|---|
| 1 | AAB final de Android | ✅ v7 construido, validado, firmado, instalado desde Play y cargado (§1) |
| 2 | Prueba física del artefacto | ✅ Login, desconexión/reconexión y relanzamiento aprobados (§1) |
| 3 | Cuenta de revisión | ✅ Activa, 2FA desactivado y Pro compensado hasta 7-ago-2036 (§2) |
| 4 | Capturas de teléfono | ✅ 4 archivos compatibles, autorizados y cargados (§3) |
| 5 | App access | ✅ Detalle agregado y página guardada |
| 6 | Target audience | ✅ Guardado únicamente como `18 años o más` |
| 7 | Data safety | ✅ Revisado y guardado; App content al día (§4) |
| 8 | Ficha de tienda | ✅ Textos, ícono, gráfico y 4 capturas incluidos en la revisión |
| 9 | Prueba interna | ✅ v7 activa, un verificador y enlace de participación disponibles |
| 10 | Declaración IA/opinión | ✅ 2 recursos promocionales etiquetados; 4 capturas reales sin etiqueta |
| 11 | Producción | ◐ Rollout completo de v7 para 176 países/regiones + Resto del mundo; 11 cambios en revisión |

El camino crítico restante es la revisión de Google Play. Los 11 cambios ya fueron
enviados; no hay un envío manual pendiente. Como la publicación administrada está
desactivada, la aprobación producirá la publicación automática del rollout completo.

## Completado y verificado

| Requisito | Evidencia / estado |
|---|---|
| App creada | Play App ID `4973585124580020376`; package `cloud.parallly.mobile` |
| Política de privacidad | `https://parallly-chat.cloud/privacy` → HTTP 200, 4 idiomas |
| Términos | `https://parallly-chat.cloud/terms` → HTTP 200 |
| Eliminación de cuenta y datos | `https://parallly-chat.cloud/data-deletion` → HTTP 200 |
| Alta de cuenta accesible | `https://admin.parallly-chat.cloud/signup` → HTTP 200 |
| Seguridad Android | minSdk 24; targetSdk/compileSdk 36; TLS; sin tráfico en claro |
| Secretos de build | `GOOGLE_SERVICES_JSON`, `SENTRY_ORG/PROJECT/AUTH_TOKEN` en EAS |
| IARC | Completado con `support@parallext.com` |
| Textos de tienda | Nombre, descripción corta y descripción completa guardados |
| Ícono | `apps/mobile/store-assets/play-icon-512.png`, 512×512, cargado |
| Gráfico destacado | `apps/mobile/store-assets/play-feature-graphic-1024x500.png`, 1024×500, cargado |
| App access | Detalle de acceso agregado y página guardada |
| Target audience | Guardado únicamente como `18 años o más` |
| Data safety / App content | Formulario revisado y guardado; App content muestra `Ya estás al día` |
| Capturas | Cuatro capturas de teléfono cargadas y ficha guardada |
| Declaración IA/opinión | Completada; solo ícono y gráfico destacado etiquetados |
| Estado de publicación | `Tus cambios están en proceso de revisión` |
| Prueba interna | Release activo con `1.0.0 (7)` |

## 1. AAB v7 y prueba física

### Artefacto cargado

| Dato | Valor comprobado |
|---|---|
| EAS build ID | `d42cf4d5-db7c-4f6c-95c9-32e174901d16` |
| Commit exacto | `8bea2bec1b3b502285633bc7bbf34a79c6ee7d69` |
| Perfil / distribución | Android `production` · `STORE` |
| package | `cloud.parallly.mobile` |
| versionName / versionCode | `1.0.0` / `7` |
| minSdk / targetSdk / compileSdk | `24` / `36` / `36` |
| Tamaño del AAB | `53.294.348` bytes |
| SHA-256 del AAB | `194859407468ECD77F59D666B8AD8FE8E3BD207AFC04853044774599FD78747B` |
| Archivo local | `C:\Users\USER\Desktop\parallly-v7-play\parallly-1.0.0-v7.aab` |

Validaciones realizadas sobre el artefacto exacto:

- EAS terminó el build con estado `FINISHED`.
- `bundletool validate`: **PASS**.
- El manifest declara package `cloud.parallly.mobile`, versionCode `7`, versionName
  `1.0.0`, minSdk `24` y targetSdk/compileSdk `36`.
- `jarsigner -verify`: firma del AAB verificada.
- Certificado de upload SHA-256:
  `42:DE:BB:77:51:83:D1:D9:63:7D:43:60:79:C0:CF:71:D6:79:E4:F6:36:C8:C2:5A:F6:0C:61:44:AE:B5:A1:34`.
- El manifest no incluye `SYSTEM_ALERT_WINDOW` ni `WRITE_EXTERNAL_STORAGE`;
  `READ_EXTERNAL_STORAGE` está limitado a `maxSdkVersion=32` y `RECORD_AUDIO` está
  presente para las notas de voz.
- La firma del AAB y el manifiesto fueron comprobados correctamente.

La v7 se instaló/actualizó en el **Samsung SM-S918B** desde Google Play. Android reporta
`com.android.vending` como instalador, por lo que la prueba corresponde al artefacto
entregado por Play y no a un APK cargado por ADB. El arreglo del conflicto de sesión al
iniciar sesión fue verificado en el dispositivo; el ciclo login, uso, desconexión,
reconexión y relanzamiento terminó sin cierres fatales ni `JSON Parse error: Unexpected
end of input`.

Play Console aceptó el AAB y la prueba interna activa muestra `7 (1.0.0)`, API 24+ y
target SDK 36. El release está disponible para verificadores internos desde
`https://play.google.com/apps/internaltest/4701526887696492046`.

### Prueba de desconexión

La prueba técnica y visible pasó:

- Android reportó `Active default network: none` durante la pérdida de conectividad;
- el proceso de Parallly permaneció vivo con PID activo;
- Inbox mostró `SIN CONEXIÓN`;
- CRM mostró `No se pudieron cargar los datos.` y `Reintentar`, sin falso estado vacío;
- logcat registró `0` coincidencias de `FATAL` o `JSON Parse`;
- la red se restauró y Android volvió a reportarla como activa;
- al pulsar `Reintentar`, CRM cargó los leads inmediatamente sin cerrar la sesión.

Resultado de login, desconexión/reconexión y relanzamiento: **PASS**.

### Historial de artefactos

| AAB | Commit | Estado |
|---|---|---|
| v2 | anterior | Retirado del borrador; recuperable en la biblioteca de artefactos |
| v3 | `652c38f9` | Descartado; anterior a correcciones funcionales |
| v4 | `e268912b` | Descartado; anterior al arreglo de CRM |
| v5 | `d9d81927` | Validado e instalado, pero sustituido por v6 |
| v6 | `41d58962` | Publicado internamente, sustituido por v7 |
| **v7** | **`8bea2bec`** | **Artefacto vigente de prueba interna y versión de Producción en revisión** |

La prueba interna publicada muestra versionCode `7` como versión activa.

## 2. App access y cuenta demo verificados

La aplicación exige login. Google necesita credenciales reutilizables, sin código
temporal, pago ni configuración adicional.

### Cuenta de revisión

- Usuario: `architerin@gmail.com`.
- Tenant: `Test Business`.
- La contraseña debe vivir únicamente en Play Console. No debe guardarse en el repo ni
  enviarse por chat.
- Los registros visibles y las cuatro capturas fueron confirmados por el propietario
  como datos ficticios de prueba, incluido `Nir Levin`.

| Punto | Estado |
|---|---|
| Cuenta con tenant funcional | ✅ |
| Contenido autorizado como ficticio | ✅ |
| Sin configuración o pago adicional | ✅ |
| 2FA desactivado | ✅ Verificado en Seguridad mediante impersonación auditada |
| Plan/tenant que no expire | ✅ Pro compensado, `active`, hasta 7-ago-2036 |
| Detalle de acceso agregado y página guardada | ✅ |

Play Console tiene guardado el detalle con estos datos no secretos:

- Nombre: `Agent console login`
- Usuario: `architerin@gmail.com`
- Acceso: todas las funciones de la app
- Instrucciones:

```text
Sign in with the credentials above. Two-factor authentication is disabled. Open Inbox
to review synthetic conversations, CRM for sample leads, and Deal for appointments.
All records are fictional and no additional setup or payment is required. The app is
an agent console for an existing business account; sign-up and billing happen on the
web dashboard, not inside the app.
```

El detalle ya fue agregado y la página quedó guardada. El 10-ago-2026 se verificó que la
pantalla de Seguridad ofrece `Activar autenticación de dos factores`, confirmando que
2FA está desactivado. Billing Ops muestra `Test Business` como Pro, `active`, con fin de
periodo el 7-ago-2036; el cambio quedó auditado como `plan_comp_granted` con motivo
`Cuenta demo Google Play — revisión y QA`.

## 3. Capturas de pantalla

Las cuatro capturas finales están tanto en el repo como en la carpeta de entrega:

| Orden | Archivo |
|---|---|
| 1 | `apps/mobile/store-assets/play/1-inbox.png` |
| 2 | `apps/mobile/store-assets/play/2-conversacion.png` |
| 3 | `apps/mobile/store-assets/play/3-crm.png` |
| 4 | `apps/mobile/store-assets/play/4-agenda.png` |

Todas son PNG RGB de 24 bits, sin alfa, con resolución `1080×2096` y relación `1.941`,
dentro del máximo 2:1 de Play. Su contenido fue autorizado explícitamente como
ficticio. Las cuatro fueron cargadas en ese orden y la ficha quedó guardada.

No usar los recursos antiguos `screen-1-inbox.png`, `screen-2-crm.png`,
`screen-3-reserva.png` ni `diag-inbox.png`: son capturas de una iteración anterior y no
son los archivos aprobados para este release.

## 4. Data safety

El formulario fue revisado sin cambiar sus respuestas y quedó guardado con estas
decisiones:

- la app recopila datos y los cifra en tránsito;
- eliminación de cuenta mediante `https://parallly-chat.cloud/data-deletion`;
- Sentry, Expo y FCM se tratan como proveedores de servicio que procesan datos por
  cuenta de Parallly, no como terceros a quienes se venden o comparten datos;
- no se declara “Información de pago del usuario”;
- no se declara “Otros datos de rendimiento de la app”; Sentry queda cubierto por
  registros de fallas y diagnóstico;
- permanecen identidad/contacto, mensajes y adjuntos, archivos, actividad, crash logs,
  diagnóstico e identificador de dispositivo/token push;
- no se recopila ubicación.

Target audience quedó guardado únicamente como `18 años o más` y el resumen de App
content muestra `Ya estás al día`.

La declaración de IA/opinión quedó completada con criterio conservador:

- `apps/mobile/store-assets/play-icon-512.png` y
  `apps/mobile/store-assets/play-feature-graphic-1024x500.png` fueron etiquetados;
- las cuatro capturas de pantalla reales de la app no fueron etiquetadas, porque
  documentan la interfaz real y no son recursos generados o alterados por IA.

## 5. Qué ve quien instala sin cuenta

La app es la consola móvil del agente. El alta y la configuración de empresa ocurren
en el wizard web; el APK no ofrece compras ni muestra precios.

| Situación | Qué ve | Salida |
|---|---|---|
| Primer arranque | Bienvenida con acceso y alta web | Login o navegador |
| Login | Enlace permanente para crear cuenta en web | Navegador |
| Google sin cuenta | El backend responde `no_account`; no crea usuario huérfano | Permanece en login |
| Cuenta sin empresa | Pantalla para terminar configuración | Onboarding web o logout |

Privacidad y eliminación de cuenta/datos están disponibles en **Más → Cuenta**.

## 6. App content y ficha de tienda

### Completado

- IARC enviado.
- Ads: No.
- Aplicación gubernamental: No.
- Advertising ID: No.
- Funciones financieras: Seguros.
- Salud: Administración y servicios de atención médica.
- App access agregado y guardado.
- Target audience guardado únicamente como `18 años o más`.
- Data safety guardado; App content al día.
- Nombre, descripción, ícono, gráfico destacado y cuatro capturas guardados.
- Declaración IA/opinión completada con los dos recursos promocionales etiquetados y
  las cuatro capturas reales sin etiquetar.
- Ficha y demás cambios incluidos en el envío a revisión.
- AAB v7 publicado en la prueba interna activa.
- Lista de verificadores guardada y seleccionada con un verificador.
- Release `1.0.0 (7)` activo y disponible para verificadores.
- Instalación/actualización desde Google Play comprobada con instalador
  `com.android.vending`.
- Rollout completo de Producción enviado con v7 para 176 países/regiones y `Resto del
  mundo`.
- Los 11 cambios fueron enviados y Play confirma `Tus cambios están en proceso de
  revisión`.
- Publicación administrada desactivada; Play publicará automáticamente si aprueba.

### Pendiente

- esperar la decisión de Google Play;
- atender cualquier observación o rechazo si Play solicita cambios;
- confirmar la publicación automática después de una aprobación.

Textos vigentes de la ficha:

**Nombre:** Parallly

**Descripción corta:**

> Consola de agentes: responde WhatsApp, Instagram y más, con IA en el bolsillo.

**Descripción completa:**

> Parallly es la app del agente para atender y vender por WhatsApp, Instagram,
> Messenger y Telegram desde un solo lugar.
>
> • Bandeja unificada en tiempo real con alertas para el equipo.
> • Responde con texto, imágenes, documentos, video y notas de voz.
> • Copiloto de IA para sugerir, reescribir, resumir, traducir y proponer acciones.
> • CRM integrado con leads, pipeline, notas y tareas.
> • Control del bot, asignación de conversaciones y colaboración.
> • Operación adaptada a agenda, reservas, pedidos, clases, matrículas, solicitudes,
> alquileres y hospedajes.
>
> Diseñada para equipos de ventas y atención en Latinoamérica. Requiere una cuenta de
> Parallly.

## 7. Correcciones incluidas en el artefacto final

v5 incorporó las correcciones de coherencia entre el nombre de la operación vertical y
su pantalla, además del flujo de creación de leads en CRM. v6 completó el
endurecimiento móvil integral:

- parseo seguro de respuestas vacías o no JSON;
- autenticación y 2FA sin exponer `Unexpected end of input`;
- mutaciones que no muestran éxito cuando la API responde `success: false`;
- loaders con error y reintento en lugar de falsos estados vacíos;
- toasts visibles y accesibles dentro de modales nativos;
- manejo uniforme de fallos en Inbox, CRM, agenda y operaciones verticales.

La v7, construida desde `8bea2bec`, agrega el arreglo del conflicto de sesión que podía
impedir el login cuando ya existía una sesión activa. El comportamiento quedó verificado
en la instalación entregada por Google Play, junto con desconexión, reconexión y
relanzamiento.

## 8. Orden para continuar

1. Esperar la decisión de Google Play sobre los 11 cambios enviados.
2. Si Play solicita correcciones, resolverlas antes de reenviar.
3. Si Play aprueba, confirmar la publicación automática de v7 y ejecutar el smoke de
   Producción.

## 9. Acceso a Producción

El panel de esta app muestra Producción habilitada y no presenta un requisito visible
de 12 testers durante 14 días. Esta es una observación de la consola para esta app, no
una afirmación de que ese requisito nunca pueda aplicar en otras cuentas o momentos.

El rollout completo de Producción con v7 fue enviado para 176 países/regiones más
`Resto del mundo`. Play muestra 11 cambios y confirma **Tus cambios están en proceso de
revisión**. La app todavía no está publicada en Producción. La publicación administrada
está desactivada: si Google aprueba, Play publicará automáticamente.

## 10. Notas de despliegue

- Las páginas legales están desplegadas y responden HTTP 200.
- El AAB v7 fue construido desde el commit móvil `8bea2bec` y EAS lo reportó como
  `FINISHED`.
- El v2 de Play es un borrador recuperable; no llegó a usuarios ni testers.
- Mantener separados los estados **prueba interna activa**, **enviado a revisión** y
  **publicado en Producción**. Actualmente v7 está activa para verificadores y los 11
  cambios del rollout completo están en revisión, pero la app aún no está publicada.
