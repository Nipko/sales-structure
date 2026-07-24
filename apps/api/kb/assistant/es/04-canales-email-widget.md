---
id: canales-email-widget
title: "Canal de Email y Widget de chat web"
routes: ["/admin/channels", "/admin/channels/email", "/admin/settings/integrations/web-chat", "/admin/settings/integrations/web-chat/triggers"]
roles: ["tenant_admin"]
keywords: ["email", "correo", "canal de email", "conectar correo", "smtp", "sendgrid", "gmail", "outlook", "widget", "chat web", "web chat", "chat en mi sitio", "chat en mi pagina", "burbuja de chat", "codigo de insercion", "instalar widget", "triggers", "mensaje de bienvenida", "formulario pre-chat"]
---

Además de WhatsApp y las redes sociales, tu negocio puede atender clientes por **Email** (los correos llegan a tu bandeja de entrada como cualquier conversación) y por un **widget de chat web** que instalas en tu propio sitio para que los visitantes hablen con tu asistente de IA sin salir de la página. Aquí te explicamos cómo configurar ambos.

> Solo el rol **administrador** puede conectar el canal de Email y configurar el widget de chat web.

## Disponibilidad según tu plan

| Plan | Canal de Email | Widget de chat web | Triggers proactivos del widget |
|------|----------------|--------------------|--------------------------------|
| Emprendedor | No incluido | No incluido | — |
| Starter | Sí | Sí | Hasta 3 |
| Pro | Sí | Sí | Hasta 10 |
| Enterprise | Sí | Sí | Ilimitados |
| Custom | Sí | Sí | Ilimitados |

Si tu plan no incluye alguno de los dos, puedes mejorar tu plan en **Configuración** → **Facturación**.

---

## Cómo conectar el canal de Email

1. En la barra lateral, entra a **Canales** y haz clic en la tarjeta de **Email**.
2. En **Configuración del remitente**, completa:
   - **Email de envío**: la dirección desde la cual saldrán tus correos (ej. `ventas@tuempresa.com`).
   - **Nombre del remitente**: el nombre que verán tus clientes (ej. "Equipo de Ventas — MiEmpresa").
   - **Responder a**: dirección opcional a donde llegan las respuestas, si quieres que sea distinta a la de envío.
3. Elige el **Proveedor** de envío:
   - **SMTP**: funciona con cualquier servicio de correo (Gmail, Outlook, tu hosting). Completa **Host**, **Puerto**, **Usuario**, **Contraseña** y **Encriptación**. Recomendado: TLS con puerto 587.
   - **SendGrid**: si tu negocio maneja alto volumen de correos, pega tu **API Key de SendGrid**.
4. Activa el interruptor **Canal activo**.
5. Haz clic en **Guardar configuración**. Parallly envía un correo de prueba para verificar que todo quedó bien.

Listo: los correos que reciba esa dirección aparecerán como conversaciones en tu bandeja de entrada, junto a WhatsApp, Instagram y los demás canales.

> **Si usas Gmail u Outlook con verificación en 2 pasos**: no uses tu contraseña normal. Crea una "Contraseña de aplicación" de 16 caracteres desde la configuración de seguridad de tu cuenta de correo y úsala en el campo **Contraseña**.

### Recepción de correos con SendGrid

Si elegiste SendGrid, la página te muestra una dirección de recepción con el botón **Copiar URL de Webhook**. Cópiala y pégala en tu cuenta de SendGrid (en Settings → Inbound Parse) para que los correos entrantes lleguen a tu bandeja de Parallly. Es un paso de una sola vez.

### Cómo funciona el email en tu bandeja

- Cada correo recibido crea una conversación nueva, o se suma a una existente si el contacto ya está registrado.
- Tu asistente de IA puede responder correos igual que responde mensajes de WhatsApp o Instagram.
- Las respuestas salen como un correo normal desde la dirección que configuraste.
- Verás asunto, cuerpo y adjuntos de cada correo dentro de la conversación.

### Asignar un asistente de IA al Email

Recuerda la regla general: **un asistente de IA por conexión**. En el editor de tu asistente (sección **Agente IA**), enlaza la conexión de Email para que responda los correos entrantes. Si prefieres que los correos los conteste solo tu equipo humano, simplemente no le asignes asistente.

---

## Cómo instalar el widget de chat en tu sitio web

1. En la barra lateral, entra a **Configuración** → sección **Integraciones y alertas** → **Chat web**.
2. Haz clic en **Crear widget**. Se crea tu widget con la configuración inicial.
3. En la tarjeta del widget verás el **Código de incrustación**. Haz clic en el botón **Copiar código**.
4. Pega ese código en tu sitio web, idealmente justo antes del cierre de la página (si otra persona administra tu sitio, envíale el código tal cual: sabrá dónde ponerlo). Funciona en cualquier sitio: WordPress, Shopify, Wix, páginas hechas a medida, etc.
5. Guarda los cambios en tu sitio y recarga la página: la burbuja de chat aparecerá en la esquina que hayas elegido.

Los visitantes que escriban por el widget aparecen como conversaciones en tu bandeja de entrada, y tu asistente de IA los atiende automáticamente.

### Cómo personalizar el widget

En la misma página, haz clic en el ícono de **Configurar** (engranaje) de tu widget y ajusta:

| Opción | Qué controla |
|--------|--------------|
| **Nombre del widget** | Nombre interno para identificarlo (no lo ven tus visitantes) |
| **Nombre del asistente** | El nombre que ve el visitante en la ventana de chat |
| **Color primario** | El color de la burbuja y la cabecera del chat, para que combine con tu marca |
| **Posición** | **Abajo derecha** o **Abajo izquierda** de la pantalla |
| **Mensaje de bienvenida** | El primer mensaje que ve el visitante al abrir el chat |
| **Formulario previo al chat** | Si está activo, el visitante deja sus datos (nombre, contacto) antes de chatear |

Al terminar, haz clic en **Guardar**. Los cambios se aplican en tu sitio sin tocar el código de nuevo.

> Los campos que se piden en el formulario previo al chat se definen en **Configuración** → **Formulario pre-chat**. Pedir el teléfono o correo te permite reconocer al visitante si luego te escribe por WhatsApp u otro canal.

---

## Cómo crear triggers proactivos (que el chat salude primero)

Los triggers hacen que el widget se active solo según el comportamiento del visitante, sin esperar a que haga clic. Bien usados, aumentan mucho las conversaciones iniciadas.

1. Entra a **Configuración** → **Chat web** y haz clic en el botón **Triggers proactivos**.
2. Haz clic en **Nuevo trigger** y ponle un **Nombre** (ej. "Oferta de ayuda en precios").
3. En **Condiciones**, haz clic en **Agregar condición** y elige cuándo se dispara:

| Condición | Se dispara cuando… |
|-----------|--------------------|
| **Tiempo en página** | El visitante lleva X segundos en la página |
| **Scroll (%)** | Bajó más de cierto porcentaje de la página |
| **Intención de salir** | Mueve el cursor para cerrar la pestaña |
| **URL de la página** | Está en una página específica (ej. `/precios`) |
| **Número de visitas** | Ha entrado N o más veces a tu sitio |

4. Si agregas varias condiciones, elige el **Operador**: **Todas deben cumplirse (AND)** o **Al menos una (OR)**.
5. Elige el **Tipo de acción**: **Abrir widget** (el chat se abre solo), **Mostrar burbuja** (aparece un mensajito junto al ícono) o **Mostrar banner** (franja con mensaje y botón).
6. Escribe el **Mensaje** que verá el visitante y, si quieres, ajusta la **Frecuencia (min)** (0 = se muestra una sola vez por visita).
7. Haz clic en **Guardar**. El trigger queda **Activo** de inmediato.

**Ejemplos que funcionan bien:**

- Página de precios + 15 segundos → burbuja: "¿Tienes dudas sobre nuestros planes? Te ayudo a elegir".
- Intención de salir en el checkout → abrir widget: "¡Espera! ¿Te ayudo a completar tu compra?".
- 3.ª visita → banner: "Bienvenido de vuelta — agenda una demo gratuita".

> **Consejo**: uno o dos triggers bien ubicados convierten más que bombardear al visitante en cada página. Si ves el aviso "Has alcanzado el límite de triggers de tu plan", desactiva alguno o mejora tu plan.

---

## Preguntas frecuentes

**¿El canal de Email reemplaza mi correo normal?**
No. Tu buzón sigue funcionando igual; Parallly se conecta a tu servicio de correo para enviar respuestas y para traer los correos entrantes a tu bandeja de conversaciones. Nada se borra de tu cuenta de correo.

**Guardé la configuración de Email pero no llegan correos a la bandeja.**
Revisa que el interruptor **Canal activo** esté encendido y que el correo de prueba haya llegado. Si usas Gmail/Outlook con verificación en 2 pasos, verifica que estés usando una contraseña de aplicación. Si usas SendGrid, confirma que pegaste la URL de recepción en tu cuenta de SendGrid.

**¿Puedo tener el widget en varios sitios web?**
Puedes crear más de un widget desde **Crear widget** y cada uno tiene su propio código de incrustación y su propia personalización.

**¿Cómo quito el chat de mi sitio?**
En la tarjeta del widget, haz clic en **Eliminar** y confirma: los visitantes ya no podrán chatear, aunque el código siga en tu página. Si prefieres conservar el widget y su configuración, pide a quien administra tu sitio que retire el código de la página.

**¿Qué pasa con los chats del widget cuando mi negocio está cerrado?**
Tu asistente de IA responde 24/7. Si el visitante pide hablar con una persona fuera de horario, aplican tus **Horarios de atención** y el mensaje fuera de horario que hayas configurado.

**¿Necesito saber programar para instalar el widget?**
No. Solo copias el código con **Copiar código** y lo pegas en tu sitio (o se lo envías a quien lo administre). Es un paso de una sola vez.

¿Sigues con dudas? Escríbenos en https://parallly-chat.cloud/support
