# Play Store — Estado y checklist de publicación (Parallly Mobile)

> **Estado al 9-ago-2026.** La app ya existe en Google Play Console, pero **todavía no
> está publicada ni se ha iniciado un rollout**. El AAB `1.0.0 (2)` está guardado como
> borrador en Prueba interna. Todo estado `✅` de este documento fue comprobado en Play
> Console, en el artefacto generado o contra la URL real.

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
| 1 | Publicar los ajustes de privacidad de logout, notificaciones y outbox | ◐ Implementación y pruebas completas; falta commit, push y despliegue |
| 2 | Generar y validar un **AAB v3** con esos ajustes | ⏳ El AAB v2 existente es anterior a los cambios y no debe ser el artefacto final |
| 3 | Smoke test del APK v3 y recorrido por modos operativos | ◐ Un APK anterior arrancó correctamente en un Samsung SM-S938B; falta validar el nuevo build y las verticales |
| 4 | Crear tenant y agente demo permanentes para **App access** | ⏳ Pendiente; sin 2FA y con datos completamente ficticios |
| 5 | Capturas de pantalla seguras (mínimo 2) | ⏳ Pendientes; las capturas anteriores contienen PII o formato no apto |
| 6 | Enviar **Data safety** | ◐ Los 5 pasos y las correcciones están guardados como borrador; falta Target audience y el envío final |
| 7 | Completar **Target audience** | ⏳ Pendiente; seleccionar solo `18 años o más` |
| 8 | Terminar la ficha de tienda | ◐ Textos, ícono y gráfico destacado cargados; faltan capturas |
| 9 | Configurar testers y lanzar Prueba interna | ⏳ El release está guardado, pero no hay testers ni rollout |

El cuestionario IARC, las demás declaraciones de App content y los datos de contacto ya
están completos. **Nada de lo anterior equivale a una publicación.**

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

### Siguiente artefacto obligatorio: AAB v3

Los ajustes locales ya están implementados y probados: el logout quita la suscripción
push, invalida el registro nativo, limpia las notificaciones y aísla el outbox y la
caché del inbox por usuario y tenant. Las políticas también nombran expresamente a
Sentry, Expo y FCM. Esos cambios aún no forman parte del AAB v2.

Antes de continuar con Play:

1. terminar las pruebas y revisión de los cambios;
2. hacer commit y push únicamente del alcance de esta sesión;
3. verificar el despliegue de las páginas legales;
4. generar el AAB de producción siguiente (esperado: versionCode `3`);
5. volver a validar package, SDK, firma y permisos;
6. reemplazar el artefacto v2 del release interno por el v3.

```bash
cd apps/mobile
npx eas-cli build --platform android --profile production
```

Si `SYSTEM_ALERT_WINDOW` o `WRITE_EXTERNAL_STORAGE` aparece en el AAB, **no subirlo**.

Después, instalar el APK correspondiente por ADB inalámbrico y probar al menos un tenant
representativo de cada modo operativo: agenda, estadías, tours, restaurante, pedidos,
clases, matrículas, seguros, solicitudes de servicio, fotografía y pruebas de manejo,
alquiler vehicular y hospedaje de mascotas. Ninguna vertical debe caer en una cita
genérica que no corresponda.

## 2. App access — bloqueante de revisión

La app exige login; el revisor necesita credenciales reutilizables que no dependan de
un código temporal.

- Crear un tenant demo sintético y un usuario `tenant_agent` permanente.
- Desactivar 2FA para esa cuenta.
- Mantener la cuenta operativa también después de publicar: Google puede revalidarla en
  actualizaciones futuras.
- Precargar conversaciones, CRM y una operación vertical con datos ficticios.
- No exigir pago, configuración adicional ni acceso a un correo externo.

Texto sugerido para el campo de instrucciones en inglés:

> Sign in with the credentials above. The account does not require two-factor
> authentication. Open Inbox to review synthetic conversations, CRM for sample leads,
> and Operations for restaurant orders and reservations. All records are fictional and
> no additional setup or payment is required.

**Estado:** pendiente crear la cuenta y completar App content → App access.

## 3. Capturas de pantalla

Google Play exige mínimo 2 y máximo 8 capturas, lado entre 320 y 3840 px, relación
máxima 2:1 y JPEG o PNG RGB de 24 bits sin alfa.

Las capturas anteriores de 1080×2340 son RGBA, exceden la relación permitida y una
incluye nombres y teléfonos reales. **No deben subirse.**

Regenerar al menos cuatro capturas de 1080×1920 RGB, autenticado en el tenant demo:

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

## 8. Orden recomendado para continuar

1. Cerrar y probar los ajustes locales de privacidad/logout.
2. Commit y push controlados; verificar el despliegue de privacidad.
3. Generar AAB v3, validar e instalar el APK por conexión inalámbrica.
4. Crear la cuenta demo y completar App access.
5. Tomar y cargar capturas seguras.
6. Corregir Data safety y completar Target audience.
7. Reemplazar el AAB v2 por el v3 en Prueba interna.
8. Agregar testers, revisar todos los avisos y lanzar el rollout interno.

Solo después de validar la prueba interna se debe preparar el release de producción.

## 9. Notas de despliegue

- La versión desplegada anterior ya expone las páginas de privacidad y eliminación de
  cuenta. Las aclaraciones nuevas sobre Sentry/Expo/FCM y los ajustes de logout están
  todavía en el árbol local y **no deben darse por desplegados**.
- Los builds locales con `gradlew assembleRelease` sirven para probar en el dispositivo,
  pero no representan por sí solos el manifest final de EAS.
- El AAB v2 de Play Console es un borrador recuperable; no llegó a usuarios ni testers.
- Mantener separados los conceptos **guardado**, **enviado a revisión** y **publicado**:
  en este momento solo hay configuración y artefactos guardados como borrador.
