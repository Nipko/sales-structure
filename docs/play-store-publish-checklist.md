# Play Store — Estado y checklist de publicación (Parallly Mobile)

> **Estado al 10-ago-2026.** La app ya existe en Google Play Console, pero **todavía no
> está publicada ni se ha iniciado un rollout**. El AAB `1.0.0 (2)` está guardado como
> borrador en Prueba interna; el **AAB `1.0.0 (3)` ya está construido y validado** pero
> aún no subido. Todo estado `✅` de este documento fue comprobado en Play Console, en el
> artefacto generado o contra la URL real.

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
| Cuenta de desarrollador | Organización; identidad, sitio y contactos verificados; sin problemas de políticas |

---

## 🚦 Resumen: qué falta para publicar

| # | Bloqueante | Estado real |
|---|---|---|
| 1 | Publicar los ajustes de privacidad de logout, notificaciones y outbox | ✅ **Cerrado** — commit `652c38f9`, desplegado y verificado en vivo (§9) |
| 2 | Generar y validar un **AAB v3** con esos ajustes | ✅ **Construido y validado** (§1); ⏳ falta subirlo a Play |
| 3 | Smoke test del APK v3 y recorrido por modos operativos | ◐ El dispositivo tiene el versionCode 3 **del build local**, no el de EAS; permisos verificados idénticos (§1) |
| 4 | Crear tenant y agente demo permanentes para **App access** | ◐ La cuenta existe y **sí tiene tenant** ("Test Business"), pero está casi vacía y con PII real (§2) |
| 5 | Capturas de pantalla seguras (mínimo 2) | ⏳ Las 3 existentes son inservibles: PII real, pantallas vacías, ratio y alfa fuera de norma (§3) |
| 6 | Enviar **Data safety** | ◐ Los 5 pasos y las correcciones están guardados como borrador; falta Target audience y el envío final |
| 7 | Completar **Target audience** | ⏳ Pendiente; seleccionar solo `18 años o más` |
| 8 | Terminar la ficha de tienda | ◐ Textos, ícono y gráfico destacado cargados; faltan capturas |
| 9 | Configurar testers y lanzar Prueba interna | ⏳ El release está guardado, pero no hay testers ni rollout |

El cuestionario IARC, las demás declaraciones de App content y los datos de contacto ya
están completos. **Nada de lo anterior equivale a una publicación.**

**El camino crítico hoy es el bloqueante 4→5**: el tenant demo casi vacío es lo que a la
vez frena las capturas y degrada lo que verá el revisor. Todo lo demás está listo o es
trabajo manual de consola.

---

## ✅ Completado y verificado

| Requisito | Evidencia / estado |
|---|---|
| App creada | Play App ID `4973585124580020376`; package `cloud.parallly.mobile` |
| Política de privacidad | `https://parallly-chat.cloud/privacy` → HTTP 200, 4 idiomas |
| Términos | `https://parallly-chat.cloud/terms` → HTTP 200 |
| Eliminación de cuenta y datos | `https://parallly-chat.cloud/data-deletion` → HTTP 200 |
| Alta de cuenta accesible | `https://admin.parallly-chat.cloud/signup` → HTTP 200 |
| Target API level | `targetSdkVersion 36` (Android 16) |
| Seguridad de red | TLS y plugin `withAndroidNetworkSecurity`; sin tráfico en claro |
| Secretos de build en EAS | `GOOGLE_SERVICES_JSON`, `SENTRY_ORG/PROJECT/AUTH_TOKEN` |
| Recorrido de quien instala sin cuenta | Bienvenida, login y enlaces de alta/legales implementados; ver §5 |
| App content | Ads: No · Gobierno: No · Advertising ID: No · Funciones financieras: Seguros · Salud: administración/servicios de atención médica |
| IARC | Completado con `support@parallext.com`; clasificaciones recibidas: todos, PEGI con orientación parental, USK 16 y genérica 12+ |
| Textos de tienda | Nombre, descripción corta y descripción completa cargados en el borrador |
| Ícono de tienda | `apps/mobile/store-assets/play-icon-512.png`, 512×512, cargado |
| Gráfico destacado | `apps/mobile/store-assets/play-feature-graphic-1024x500.png`, 1024×500 RGB/24 bits, cargado |

---

## 1. AAB y permisos

### AAB v2 ya generado y validado

El build de producción `1.0.0 (2)` se generó con EAS y se validó antes de subirlo:

- package: `cloud.parallly.mobile`
- versionName: `1.0.0`
- versionCode: `2`
- minSdk: `24`
- targetSdk: `36`
- tamaño: `53.253.426` bytes
- SHA-256: `960945052243F263F39A45B4352A59B0C8381E23004DE532222896125AEB204E`
- `bundletool validate`: OK
- firma de upload: válida
- `SYSTEM_ALERT_WINDOW`: ausente
- `WRITE_EXTERNAL_STORAGE`: ausente
- `READ_EXTERNAL_STORAGE`: limitado a `maxSdkVersion=32`

Está cargado en **Prueba interna** como `1.0.0 (2) — prueba interna`, pero únicamente
como borrador: no tiene testers y no se lanzó.

### Qué artefacto va a Play

| AAB | Commit | Estado |
|---|---|---|
| v2 | anterior | Borrador en Prueba interna, sin testers. **Descartado** |
| v3 | `652c38f9` | Construido y validado (abajo). **Descartado**: anterior a los arreglos de §7-bis |
| v4 | `e268912b` | Construido durante la sesión, pero **anterior al arreglo del CRM**. Descartado |
| **v5** | `ab3e5cbc` | **El que se sube**: incluye Deal/Agenda + creación de leads + teléfono obligatorio + error visible |

La validación del v3 que sigue documentada abajo es el **procedimiento** a repetir sobre
el v5, no un aval del v3.

### AAB v3 — construido y validado (10-ago-2026)

Los ajustes de privacidad ya están dentro del artefacto: el logout quita la suscripción
push, invalida el registro nativo, limpia las notificaciones y aísla el outbox y la
caché del inbox por usuario y tenant. Las políticas nombran expresamente a Sentry, Expo
y FCM y **ya están desplegadas** (§9).

| Dato | Valor comprobado |
|---|---|
| EAS build ID | `5c3dc850-ce3f-48d3-9259-9c6c4a311884` |
| Commit | `652c38f9` (árbol limpio) |
| package | `cloud.parallly.mobile` |
| versionName / versionCode | `1.0.0` / `3` |
| minSdk / targetSdk / compileSdk | `24` / `36` / `36` |
| Tamaño | `53.263.867` bytes |
| SHA-256 del AAB | `7DFB867EB3894A8F79646EBAD9DBD947D9825BB9358742A51EC3697C0CBF1483` |
| Certificado de firma (SHA-256) | `42:DE:BB:77:51:83:D1:D9:63:7D:43:60:79:C0:CF:71:D6:79:E4:F6:36:C8:C2:5A:F6:0C:61:44:AE:B5:A1:34` |
| `bundletool validate` | OK |
| Permisos declarados | 31 |

Higiene de permisos, verificada sobre el manifest extraído del propio AAB:

- `SYSTEM_ALERT_WINDOW`: **ausente**
- `WRITE_EXTERNAL_STORAGE`: **ausente**
- `READ_EXTERNAL_STORAGE`: presente con `maxSdkVersion=32`
- `POST_NOTIFICATIONS`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`, `com.google.android.c2dm.permission.RECEIVE`: **presentes** — sin el primero el push estaría muerto en Android 13+
- Sin `ACCESS_FINE_LOCATION` ni `READ_CONTACTS`, coherente con lo declarado en Data safety
- El resto son permisos de badge de launcher (Samsung/Huawei/Oppo/Sony…), todos `normal`

Comandos usados (reproducibles):

```bash
npx eas-cli build:list --platform android --limit 5 --non-interactive --json
java -jar bundletool.jar validate --bundle=parallly-v3.aab
java -jar bundletool.jar dump manifest --bundle=parallly-v3.aab
```

Si `SYSTEM_ALERT_WINDOW` o `WRITE_EXTERNAL_STORAGE` aparece en un AAB futuro, **no subirlo**.

### Smoke test: qué está instalado hoy y qué falta

El SM-S938B (Android 16) tiene instalado `versionCode 3`, pero firmado con
`CN=Android Debug` → es el **build local de `gradlew`**, no el artefacto de EAS. Sirve
para probar comportamiento, no para dar por validado el artefacto de la tienda.

Mitigación ya hecha: se comparó permiso por permiso el APK instalado contra el manifest
del AAB de EAS → **31 vs 31, sin diferencias en ninguna dirección**. El riesgo que
cubría esta verificación (que el manifest local no reflejara el de EAS) queda descartado.

Para correr el smoke test sobre el artefacto exacto:

```bash
java -jar bundletool.jar build-apks --bundle=parallly-v3.aab --output=universal.apks --mode=universal
```

El APK universal resultante (77.606.724 bytes) queda firmado con el debug keystore de
bundletool, que **no** coincide con el del build local → instalarlo exige `adb uninstall`
primero y eso borra la sesión y el outbox del dispositivo.

Falta recorrer al menos un tenant representativo de cada modo operativo: agenda,
estadías, tours, restaurante, pedidos, clases, matrículas, seguros, solicitudes de
servicio, fotografía y pruebas de manejo, alquiler vehicular y hospedaje de mascotas.
Ninguna vertical debe caer en una cita genérica que no corresponda.

## 2. App access — bloqueante de revisión

La app exige login; el revisor necesita credenciales reutilizables que no dependan de
un código temporal.

### Cuenta de revisión (10-ago-2026)

- Usuario: `architerin@gmail.com`. **La contraseña no se guarda en el repo**: vive
  únicamente en Play Console → App content → App access. Un repo no es un gestor de
  secretos, y esa credencial tiene que sobrevivir a revalidaciones futuras de Google.
- Estado verificado en dispositivo: la sesión abre y **el usuario sí tiene tenant**
  (`Test Business`). Esto descarta el peor escenario: con `tenantId` nulo la app cae en
  `NoWorkspaceScreen`, que solo ofrece "terminar la configuración en la web" y logout —
  un callejón sin salida que Google reporta como "no pudimos acceder a la app".

### Lo que todavía falta en esa cuenta

| Punto | Estado |
|---|---|
| Datos ficticios precargados | ❌ Inbox: 1 conversación. CRM: 1 lead. Agenda: vacía |
| Sin PII real | ❌ La única conversación y el único lead se llaman **"Nir Levin"** (nombre real del dueño) |
| 2FA desactivado | ⏳ Sin confirmar |
| Plan/trial que no expire | ⏳ Sin confirmar — **si el trial vence, la cuenta deja de servir** para las revalidaciones de Google en cada actualización futura |
| Sin exigir pago ni correo externo | ✅ El alta y el pago ocurren fuera del APK (§5) |

No existe hoy un sembrador de datos demo en el repo (`apps/api/prisma` solo tiene
`seed.ts`, `seed-billing-plans.js` y `seed-gecko.sql`). Poblar el tenant es trabajo
manual, o bien vía la app, o bien vía el dashboard, o bien generando conversaciones
reales con el widget público (`POST /widget/sessions` acepta un `name` de visitante sin
autenticación, lo que permite nombres ficticios y respuestas reales de la IA).

Texto sugerido para el campo de instrucciones en inglés:

> Sign in with the credentials above. The account does not require two-factor
> authentication. Open Inbox to review synthetic conversations, CRM for sample leads,
> and Operations for restaurant orders and reservations. All records are fictional and
> no additional setup or payment is required.

**Estado:** pendiente crear la cuenta y completar App content → App access.

## 3. Capturas de pantalla

Google Play exige mínimo 2 y máximo 8 capturas, lado entre 320 y 3840 px, relación
máxima 2:1 y JPEG o PNG RGB de 24 bits sin alfa.

Las tres capturas que hay en `apps/mobile/store-assets/` fueron auditadas una por una el
10-ago-2026 y **ninguna es utilizable**:

| Archivo | Problema |
|---|---|
| `screen-1-inbox.png` | Pantalla **vacía**: "No hay conversaciones" |
| `screen-2-crm.png` | **PII real**: nombres, 6 teléfonos y 2 handles de Instagram de personas reales |
| `screen-3-reserva.png` | Pantalla **vacía**: "No hay citas próximas" |
| Las tres | 1080×2340 → ratio **2.167**, por encima del máximo 2:1 · `Format32bppArgb` (con canal alfa) |

`diag-inbox.png` tiene los mismos defectos y tampoco debe subirse.

### Normalización (resuelta)

No hace falta escalar ni deformar. Las barras del sistema, medidas en el propio
dispositivo (no estimadas), son:

```bash
adb shell dumpsys window | grep -E 'statusBars frame|navigationBars frame'
#   statusBars     frame=[0,0][1080,96]
#   navigationBars frame=[0,2214][1080,2340]
```

Recortándolas, un `screencap` de 1080×2340 queda en **1080×2118 → ratio 1.961**, dentro
del máximo 2:1, y se exporta en `Format24bppRgb` (sin canal alfa). De paso desaparecen
la hora, la batería y los iconos de notificación personales del dueño, que no deben
salir en la ficha de tienda.

El script está en el scratchpad de la sesión (`normalize-shots.ps1`) y ya se validó
sobre una captura real.

Regenerar al menos cuatro capturas, autenticado en el tenant demo:

- Inbox
- conversación con copiloto de IA
- CRM / detalle de lead
- operación vertical, por ejemplo pedidos o reservas de restaurante

```bash
adb exec-out screencap -p > screen-1-inbox.png
```

El ícono y el gráfico destacado ya están cargados; solo faltan las capturas seguras.

## 4. Data safety

Los cinco pasos se completaron y se guardaron como **borrador**, con estas decisiones
generales:

- la app recopila datos;
- los datos se cifran en tránsito;
- se ofrece eliminación de cuenta mediante
  `https://parallly-chat.cloud/data-deletion`;
- no se declararon datos compartidos, considerando a Sentry, Expo y FCM proveedores de
  servicio que procesan datos por cuenta de Parallly;
- los 27 tipos seleccionados tienen configurado propósito, obligatoriedad y tratamiento.

Las dos correcciones de precisión ya se guardaron en Play Console:

- se quitó “Información de pago del usuario”, porque la app registra el método de pago
  operativo, no números de tarjeta ni datos de cuenta financiera;
- se quitó “Otros datos de rendimiento de la app”, porque Sentry queda cubierto por
  `Registros de fallas` y `Diagnóstico`.

Falta completar Target audience; Play no permite enviar Data safety mientras ese
bloque siga incompleto.

Datos que sí deben permanecer declarados según el uso efectivo incluyen identidad y
contacto, mensajes y adjuntos, archivos, actividad dentro de la app, crash
logs/diagnósticos e identificador de dispositivo o token push. No se recopila ubicación.

## 5. Qué ve quien instala sin cuenta

La app es la consola del agente. El alta y la configuración de la empresa se completan
en el wizard web; el APK no ofrece una compra ni muestra precios.

| Situación | Qué ve | Salida |
|---|---|---|
| Primer arranque | Bienvenida con “Ya tengo cuenta” y “Crear cuenta en la web” | Login o navegador |
| Login | Enlace permanente para crear la cuenta en la web | Navegador |
| Google sin cuenta existente | El backend rechaza con `no_account`; no crea un usuario huérfano | Permanece en login |
| Cuenta sin empresa configurada | “Falta terminar la configuración” y botón a `/onboarding` | Navegador o logout |

Los enlaces a privacidad y solicitud de eliminación de cuenta/datos están disponibles
en **Más → Cuenta**.

Mientras alta y pago ocurran fuera del APK y la app no muestre precios ni llamadas a
comprar, la suscripción se trata como SaaS externo. Añadir una compra dentro de la app
obligaría a reevaluar Google Play Billing.

## 6. IARC, Target audience y App content

### Completado

- IARC enviado; la app se declaró como herramienta de comunicación/negocios con
  contenido generado por usuarios.
- Ads: No.
- Aplicación gubernamental: No.
- Advertising ID: No.
- Funciones financieras: Seguros.
- Salud: Administración y servicios de atención médica.

### Pendiente

- App access: agregar la cuenta demo y las instrucciones de acceso.
- Target audience: elegir únicamente **18 años o más**; no está dirigida a niños.
- Enviar Data safety una vez completados los puntos anteriores.

## 7. Ficha de tienda

La ficha está guardada como borrador con estos textos:

**Nombre:** Parallly

**Descripción corta:**

> Consola de agentes: responde WhatsApp, Instagram y más, con IA en el bolsillo.

**Descripción completa:**

> Parallly es la app del agente para atender y vender por WhatsApp, Instagram, Messenger y Telegram desde un solo lugar.
>
> • Bandeja unificada en tiempo real con alertas para el equipo.
> • Responde con texto, imágenes, documentos, video y notas de voz.
> • Copiloto de IA: sugiere respuestas, reescribe en 6 tonos, resume la conversación, traduce y propone la próxima mejor acción de venta.
> • CRM integrado: leads, pipeline, notas, tareas y escáner de tarjetas de visita.
> • Toma el control del bot con un tap, asigna conversaciones y colabora con tu equipo.
> • Gestiona la operación real de cada negocio: agenda, reservas, pedidos, clases, matrículas, solicitudes de servicio, alquileres y hospedajes.
>
> Diseñada para equipos de ventas y atención en Latinoamérica. Requiere una cuenta de Parallly.

Los dos gráficos base ya están cargados:

- `apps/mobile/store-assets/play-icon-512.png`
- `apps/mobile/store-assets/play-feature-graphic-1024x500.png`

Faltan únicamente las capturas descritas en §3 para completar los recursos visuales.
No usar marcas de Meta de forma que impliquen respaldo oficial.

## 7-bis. Defectos encontrados preparando la publicación

Los dos salieron de recorrer la app con la cuenta de revisión. Ambos **ya están
arreglados**; se dejan documentados porque explican por qué el artefacto final es el v5
y no el v3.

### a) La pestaña y el encabezado de la agenda decían cosas distintas — `e268912b`

La pestaña inferior decía **"Deal"** y el encabezado de esa misma pantalla decía
**"Agenda"**. La pestaña resolvía el nombre con tres fuentes (`labelOverrides` →
catálogo de workspaces → `transactionNoun`) y `AppointmentsScreen` sólo miraba la
primera, cayendo a `citas.title`. La vertical `technology` trae
`transactionNoun.es = 'deal'`, de ahí la contradicción.

Ahora ambos llaman a `resolveVerticalWorkspaceLabel`, con 7 tests que fijan la
invariante. `ReservationsScreen` ya coincidía (`stays.title` == `workspace.stays` en los
4 idiomas), así que no se tocó.

### b) Crear un lead fallaba SIEMPRE con un 500 — `ab3e5cbc` ⚠️ era bloqueante real

Un revisor que tocara "Crear lead" habría visto **un botón que no hace nada**. Tres
defectos encadenados:

1. **La causa raíz.** `ALLOWED_FIELDS` en `leads.repository.ts` nombraba cinco columnas
   que la tabla `leads` nunca tuvo: `source`, `notes`, `tags`, `customer_profile_id` y
   `converted_at`. Una whitelist que admite una columna fantasma es peor que ninguna:
   la promueve al INSERT y Postgres rechaza la sentencia entera con **42703**. La app
   móvil estampa `source: 'mobile'` en cada lead → fallaba el 100% de las veces.
   La atribución real vive en `utm_source`, que es lo que lee el breakdown de fuentes de
   CRM analytics; `source` nunca formó parte del modelo.
2. **`leads.phone` es `NOT NULL`**, pero el formulario ofrecía crear un lead sólo con
   nombre. Ese camino terminaba en otro 500.
3. **El fallo era invisible.** En Android un `<Modal>` es su propia ventana nativa, así
   que el toast de error — un `View` absoluto del árbol de la app — se dibujaba
   **detrás** de la hoja. Por eso un 500 se veía como un botón muerto. Es exactamente
   la clase de falla silenciosa que el GATE 0 (G0.2) debía haber eliminado.

Arreglado: una sola lista de columnas reales compartida por `createLead`/`updateLead`,
las claves que no son columnas se pliegan en `metadata` (no se pierde la atribución),
400 en vez de 500 si falta el teléfono, la app lo exige, y el error se muestra **dentro**
de la hoja. 5 tests de regresión en `leads.repository.spec.ts`.

> **Pendiente de auditar:** el mismo patrón de whitelist a mano existe en otros
> repositorios del CRM. Conviene revisar si alguno más nombra columnas inexistentes.

## 8. Orden recomendado para continuar

Los pasos 1-3 de la lista original ya están hechos. Lo que queda, en orden:

1. **Poblar el tenant demo** con datos ficticios y sacar de ahí el nombre real del dueño.
   Es el camino crítico: destraba a la vez las capturas y la calidad de lo que ve el revisor.
2. Confirmar en esa cuenta: 2FA desactivado y plan/trial que no expire.
3. Tomar las 4 capturas nuevas y normalizarlas a 1080×1920 RGB sin alfa.
4. (Opcional, recomendado antes de fijar capturas) arreglar el desfase "Deal" / "Agenda" (§7-bis).
5. Subir el AAB v3 reemplazando el v2 en Prueba interna y cargar las capturas en la ficha.
6. Completar App access, Target audience (`18 años o más`) y enviar Data safety.
7. Agregar testers, revisar todos los avisos y lanzar el rollout interno.

Solo después de validar la prueba interna se debe preparar el release de producción.

## 9. Notas de despliegue

- ✅ **Las páginas legales nuevas ya están desplegadas y verificadas en vivo**
  (10-ago-2026). El commit `652c38f9` está en `origin/main` y el contenido servido lo
  confirma:

  | URL | HTTP | Sentry / Expo / Firebase / FCM |
  |---|---|---|
  | `https://parallly-chat.cloud/privacy` | 200 | 4 / 5 / 3 / 2 menciones |
  | `https://parallly-chat.cloud/data-policy` | 200 | 3 / 4 / 2 / 3 menciones |
  | `https://parallly-chat.cloud/terms` | 200 | — |
  | `https://parallly-chat.cloud/data-deletion` | 200 | — |
  | `https://admin.parallly-chat.cloud/signup` | 200 | — |

  Nota: `WebFetch` recibe 403 de Cloudflare contra este dominio; hay que verificar con
  `Invoke-WebRequest` y un User-Agent de navegador.
- Los builds locales con `gradlew assembleRelease` sirven para probar en el dispositivo,
  pero no representan por sí solos el manifest final de EAS.
- El AAB v2 de Play Console es un borrador recuperable; no llegó a usuarios ni testers.
- Mantener separados los conceptos **guardado**, **enviado a revisión** y **publicado**:
  en este momento solo hay configuración y artefactos guardados como borrador.
