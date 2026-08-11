# Play Store — Estado y checklist de publicación (Parallly Mobile)

> **Estado al 10-ago-2026.** La aplicación ya existe en Google Play Console y la prueba
> interna está activa; aún no fue enviada a revisión ni publicada en Producción. El
> candidato vigente es el AAB
> `1.0.0 (6)`, generado desde `main` en el commit `41d58962`, validado con bundletool e
> instalado en el dispositivo de pruebas. Play lo tiene en un release interno que contiene
> únicamente v6; App access, Target audience, Data safety y la ficha con cuatro capturas
> están guardados, App content figura al día, la declaración de IA/opinión está
> completada y la ficha aparece **Lista para enviar a revisión**. Todos los elementos
> marcados como pendientes requieren todavía confirmación explícita.

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
| 1 | AAB final de Android | ✅ v6 construido, validado, firmado, instalado y cargado (§1) |
| 2 | Prueba física del artefacto | ✅ Desconexión/reconexión técnica y visible aprobada (§1) |
| 3 | Cuenta de revisión | ◐ Existe y tiene tenant; faltan confirmar 2FA y plan no expirante (§2) |
| 4 | Capturas de teléfono | ✅ 4 archivos compatibles, autorizados y cargados (§3) |
| 5 | App access | ✅ Detalle agregado y página guardada |
| 6 | Target audience | ✅ Guardado únicamente como `18 años o más` |
| 7 | Data safety | ✅ Revisado y guardado; App content al día (§4) |
| 8 | Ficha de tienda | ✅ Textos, ícono, gráfico y 4 capturas guardados |
| 9 | Prueba interna | ✅ v6 activa, un verificador y enlace de participación disponibles |
| 10 | Declaración IA/opinión | ✅ 2 recursos promocionales etiquetados; 4 capturas reales sin etiqueta |
| 11 | Producción | ◐ Habilitada; preparación `0/5` y países/regiones pendientes |

El camino crítico restante es: instalar v6 desde Play y repetir el smoke interno,
confirmar 2FA y el plan permanente de la cuenta demo, y completar las 5 tareas de
Producción, incluida la selección de países/regiones. La prueba interna activa no
equivale a una publicación en Producción.

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
| Estado de ficha | `Lista para enviar a revisión` |
| Prueba interna | Borrador guardado con únicamente `1.0.0 (6)` |

## 1. AAB v6 y prueba física

### Artefacto cargado

| Dato | Valor comprobado |
|---|---|
| EAS build ID | `e8a0b188-d8a9-41c5-a9e0-c30ebb270279` |
| Commit exacto | `41d589629d4c9ab52d9e3bb18896bffbcb8e359b` |
| Perfil / distribución | Android `production` · `STORE` |
| package | `cloud.parallly.mobile` |
| versionName / versionCode | `1.0.0` / `6` |
| minSdk / targetSdk / compileSdk | `24` / `36` / `36` |
| Tamaño del AAB | `53.293.577` bytes |
| SHA-256 del AAB | `D9C0DDD82EC0E27F464A7E885087067731E7F8679746C603F68CA64F57B7555F` |
| Archivo local | `C:\Users\USER\Desktop\parallly-v6-play\parallly-1.0.0-v6.aab` |

Validaciones realizadas sobre el artefacto exacto:

- EAS terminó el build con estado `FINISHED`.
- `bundletool validate`: **PASS**.
- El manifest declara package `cloud.parallly.mobile`, versionCode `6`, versionName
  `1.0.0`, minSdk `24` y targetSdk/compileSdk `36`.
- `jarsigner -verify`: firma del AAB verificada.
- Certificado de upload SHA-256:
  `42:DE:BB:77:51:83:D1:D9:63:7D:43:60:79:C0:CF:71:D6:79:E4:F6:36:C8:C2:5A:F6:0C:61:44:AE:B5:A1:34`.
- El manifest no incluye `SYSTEM_ALERT_WINDOW` ni `WRITE_EXTERNAL_STORAGE`;
  `READ_EXTERNAL_STORAGE` está limitado a `maxSdkVersion=32` y `RECORD_AUDIO` está
  presente para las notas de voz.
- Se generó `parallly-1.0.0-v6-universal.apks` y de allí `universal.apk`.
- SHA-256 de `universal.apk`:
  `F1C14E5F12D82415AD0BB2733CC560A401F9E0A3E84BC8038D30F57AFEA0C4FB`.

El APK universal derivado del AAB se instaló por cable con `adb install -r` en un
**Samsung SM-S918B**. La actualización conservó la sesión. La app arrancó y los logs
no mostraron fatal ni `JSON Parse error: Unexpected end of input`.

El APK universal está firmado por bundletool para pruebas locales; sirve para probar el
contenido del bundle, pero el archivo que va a Play es exclusivamente el AAB.

Play Console aceptó el AAB y la prueba interna activa muestra únicamente `6 (1.0.0)`,
API 24+ y target SDK 36. El release está disponible para verificadores internos desde
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

Resultado de desconexión/reconexión visible: **PASS**.

### Historial de artefactos

| AAB | Commit | Estado |
|---|---|---|
| v2 | anterior | Retirado del borrador; recuperable en la biblioteca de artefactos |
| v3 | `652c38f9` | Descartado; anterior a correcciones funcionales |
| v4 | `e268912b` | Descartado; anterior al arreglo de CRM |
| v5 | `d9d81927` | Validado e instalado, pero sustituido por v6 |
| **v6** | **`41d58962`** | **Único artefacto de la prueba interna activa** |

La prueba interna publicada muestra únicamente versionCode `6`.

## 2. App access guardado; cuenta demo por verificar

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
| 2FA desactivado | ⏳ Pendiente de confirmar |
| Plan/tenant que no expire | ⏳ Pendiente de confirmar |
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

El detalle ya fue agregado y la página quedó guardada. La frase sobre 2FA debe
comprobarse ahora contra el estado real de la cuenta antes de publicar.

La cuenta de revisión debe quedar en un plan interno o compensado que no expire. Google
puede volver a comprobarla en futuras actualizaciones; un trial temporal no es una
credencial estable de revisión.

## 3. Capturas de pantalla

Las cuatro capturas finales están tanto en el repo como en la carpeta de entrega:

| Orden | Archivo |
|---|---|
| 1 | `apps/mobile/store-assets/play/1-inbox.png` |
| 2 | `apps/mobile/store-assets/play/2-conversacion.png` |
| 3 | `apps/mobile/store-assets/play/3-crm.png` |
| 4 | `apps/mobile/store-assets/play/4-agenda.png` |

Copia para carga manual:
`C:\Users\USER\Desktop\parallly-v6-play\`.

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
- Ficha en estado `Lista para enviar a revisión`.
- AAB v6 publicado como único artefacto de la prueba interna.
- Lista `Parallly Android v6 testers` guardada y seleccionada con un verificador.
- Release `1.0.0 (6) — prueba interna` activo y disponible para verificadores.

### Pendiente

- confirmar 2FA desactivado y plan no expirante para la cuenta demo;
- instalar desde el enlace de participación y repetir el smoke test de la entrega de Play;
- completar las 5 tareas de Producción, incluida la selección de países/regiones.

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
su pantalla, además del flujo de creación de leads en CRM. v6 lo sustituye porque el
commit `41d58962` completa el endurecimiento móvil integral:

- parseo seguro de respuestas vacías o no JSON;
- autenticación y 2FA sin exponer `Unexpected end of input`;
- mutaciones que no muestran éxito cuando la API responde `success: false`;
- loaders con error y reintento en lugar de falsos estados vacíos;
- toasts visibles y accesibles dentro de modales nativos;
- manejo uniforme de fallos en Inbox, CRM, agenda y operaciones verticales.

La validación local fue TypeScript limpio y 22 suites / 302 pruebas Jest aprobadas. Los
workflows de Release y Vertical Quality Evidence del commit `41d58962` finalizaron con
éxito.

## 8. Orden para continuar

1. Abrir el enlace de participación con la cuenta verificadora, instalar v6 desde Play y
   repetir el smoke interno.
2. Confirmar 2FA desactivado y convertir el tenant demo a un plan que no expire.
3. Completar las 5 tareas de Producción, incluidos países/regiones, y solo entonces
   preparar el envío a revisión.

## 9. Acceso a Producción

El panel de esta app muestra Producción habilitada y no presenta un requisito visible
de 12 testers durante 14 días. Esta es una observación de la consola para esta app, no
una afirmación de que ese requisito nunca pueda aplicar en otras cuentas o momentos.

La preparación de Producción está en `0/5`. Países/regiones continúa pendiente y no hay
un release de Producción enviado a revisión.

## 10. Notas de despliegue

- Las páginas legales están desplegadas y responden HTTP 200.
- `41d58962` está en `origin/main`; es un cambio exclusivamente móvil y no requiere un
  despliegue adicional de API para construir o subir el AAB.
- El v2 de Play es un borrador recuperable; no llegó a usuarios ni testers.
- Mantener separados los estados **prueba interna activa**, **enviado a revisión** y
  **publicado en Producción**. Actualmente v6 está activa solo para verificadores y no
  se ha enviado a revisión de Producción.
