---
id: canales-whatsapp
title: "Conectar WhatsApp"
routes: ["/admin/channels", "/admin/channels/whatsapp", "/admin/channels/whatsapp/templates"]
roles: ["tenant_admin"]
keywords: ["whatsapp", "conectar whatsapp", "numero de whatsapp", "whatsapp business", "coexistencia", "app de whatsapp", "migrar numero", "plantillas", "templates", "plantilla whatsapp", "sincronizar chats", "historial de chats", "codigo qr", "verificacion", "meta", "facebook", "desconectar whatsapp", "ventana de 24 horas", "varias cuentas", "segundo numero"]
---

# Conectar WhatsApp

WhatsApp es el canal principal de Parallly: al conectarlo, tu agente de IA empieza a recibir y responder los mensajes de tus clientes en ese número, con tu catálogo, tu agenda y tu información de negocio. La conexión es oficial, a través de Meta (la empresa dueña de WhatsApp), y toma entre 5 y 20 minutos según el método que elijas.

## Antes de empezar

- Necesitas ser **administrador** de tu cuenta de Parallly (los supervisores y agentes pueden ver los canales, pero no conectarlos).
- Necesitas una cuenta de Facebook con acceso al negocio en Meta Business Suite.
- Ten a mano el número de teléfono que vas a usar: debe poder recibir SMS o llamadas (no sirven números virtuales VoIP ni líneas premium).
- WhatsApp está disponible en todos los planes, desde Emprendedor.

## Cómo conectar tu número

1. En la barra lateral, sección **Gestión**, entra a **Canales**.
2. En la tarjeta de **WhatsApp**, haz clic en **Conectar**.
3. Verás la pantalla **"Elige tu método de conexión"** con estas opciones:
   - **Número de prueba** — explora la plataforma sin compromiso y conecta tu número real después.
   - **Número nuevo** (~5 min) — para un número que nunca se ha usado en WhatsApp. Es el camino más rápido.
   - **WhatsApp Business App** (etiqueta **Coexistencia**, ~20 min) — si ya usas la app de WhatsApp Business en tu teléfono y quieres conservarla. Es la opción más popular; mira la sección siguiente.
   - **Migrar desde otro proveedor** (~15 min) — si ya usas WhatsApp con otra plataforma (Wati, 360dialog, Twilio, etc.) y quieres traer tu número sin tiempo fuera de línea.
4. Elige tu método y haz clic en **Conectar con Facebook**. Se abre una ventana de Meta.
5. Inicia sesión con tu cuenta de Facebook y selecciona (o crea) tu portafolio de Meta Business.
6. Selecciona o agrega tu cuenta de WhatsApp Business y el número de teléfono.
7. Verifica el número con un **código por SMS o llamada de voz** y aprueba los permisos.
8. Verás el progreso en pantalla: **Autorización → Conectando número → Activando WhatsApp**. Al terminar aparece "¡Conexión exitosa!" y tu agente ya responde en ese número.

> Tip: apenas conectes, la pantalla te muestra la tarjeta **"Probá tu agente"** con tu número. Escríbele un WhatsApp desde otro teléfono y mira cómo responde.

## Modo coexistencia: mantén tu app de WhatsApp Business

Si hoy atiendes a tus clientes desde la app de WhatsApp Business en tu teléfono, no tienes que abandonarla. Con el método **WhatsApp Business App** (Coexistencia), tu número queda conectado a Parallly **y** sigue funcionando en tu teléfono al mismo tiempo: la IA responde desde la plataforma y tú puedes seguir chateando desde la app cuando quieras.

Pasos específicos de este método:

1. Inicia sesión con tu cuenta de Facebook y selecciona tu portafolio de Meta Business.
2. **Escanea el código QR desde tu app de WhatsApp Business** (como cuando vinculas WhatsApp Web).
3. **Autoriza la sincronización de historial y contactos**. Importante: tienes **24 horas** para autorizarla después de conectar; si se pasa el plazo, hay que repetir la conexión desde cero.

Requisitos: app de WhatsApp Business actualizada (versión 2.24.17 o superior), número con al menos 7 días de actividad en la app y una conexión WiFi estable (la sincronización puede tardar varias horas).

**Qué se sincroniza con Parallly:**

- Chats individuales de los últimos **6 meses** (texto)
- Imágenes, videos y audios de los últimos 14 días
- Tus contactos guardados en la app
- Los mensajes nuevos que envíes desde la app, en tiempo real

**Qué NO se sincroniza:** chats grupales, mensajes temporales o de "ver una vez", archivos multimedia con más de 14 días y el catálogo de productos de la app.

**Limitaciones del modo coexistencia:**

- Debes **abrir la app de WhatsApp Business al menos cada 14 días** para mantener la conexión activa.
- Los dispositivos vinculados (WhatsApp Web/Desktop) se desconectan al activar; puedes reconectarlos después.
- Las listas de difusión de la app pasan a modo de solo lectura.
- La velocidad de envío es algo menor (~20 mensajes por segundo), suficiente para la gran mayoría de negocios.

## Estados del canal

En **Canales**, cada tarjeta muestra el estado de la conexión:

- **Conectado** — el número está activo y el agente responde.
- **Desconectado** — todavía no hay conexión, o se desconectó.

Al entrar a **WhatsApp** con un número conectado verás la tarjeta **Canal Activo** con el **Número**, el **Nombre verificado** y la **Calidad** (la calificación que Meta le da a tu número según cómo reciben tus mensajes los clientes; mantenerla "alta" te da mejores límites de envío). También encontrarás la tarjeta **Perfil de negocio** con el botón **Gestionar perfil** para editar la información que tus clientes ven en WhatsApp.

## Plantillas de WhatsApp

WhatsApp permite responder libremente durante las **24 horas** siguientes al último mensaje del cliente. Para escribirle **fuera** de esa ventana — por ejemplo un recordatorio de cita o una campaña — necesitas una **plantilla aprobada por Meta**.

Para gestionarlas: **Canales → WhatsApp → Ver todas las plantillas** (la página **Plantillas de WhatsApp**).

- **Sincronizar desde Meta** — trae a Parallly las plantillas que ya tengas aprobadas en tu cuenta.
- **Crear plantilla** — crea una nueva sin salir de Parallly: nombre, idioma, categoría, cuerpo con variables (por ejemplo `{{1}}` para el nombre del cliente), encabezado, pie y hasta 3 botones, con vista previa en vivo. Al terminar, haz clic en **Enviar a Meta**; la aprobación suele tardar de minutos a 72 horas.
- Cada plantilla muestra su estado: **Aprobada**, **Pendiente** o **Rechazada** (con el motivo del rechazo para que la corrijas y la vuelvas a enviar).
- Al conectar WhatsApp, Parallly envía automáticamente **3 plantillas semilla** ya validadas (recordatorio de cita, confirmación de pedido y pago recibido) para que tengas con qué empezar.

## ¿Más de un número de WhatsApp?

Puedes conectar varios números del mismo canal según tu plan. En la tarjeta de WhatsApp verás el contador de cuentas (por ejemplo "1/2 cuentas") y el botón **Agregar otra** mientras tengas cupo disponible.

| Plan | Números de WhatsApp |
|------|:---:|
| Emprendedor | 1 |
| Starter | 1 |
| Pro | 2 |
| Enterprise | 3 |
| Custom | Sin límite |

Cada conexión es independiente: tiene su propio agente de IA (lo asignas en el editor del agente), sus conversaciones no se mezclan y, al enviar campañas o plantillas, eliges desde qué número sale el mensaje. Si necesitas más números que los de tu plan, escríbenos a [soporte](https://parallly-chat.cloud/support).

## Cómo desconectar un número

1. Entra a **Canales**, abre **WhatsApp** y elige la conexión que quieres quitar.
2. Haz clic en **Desconectar** y confirma. Si tienes varios números, los demás siguen activos.
3. El resultado se muestra con un color:
   - **Verde** — desconectado completamente.
   - **Amarillo** — se desconectó en Parallly, pero conviene revisar también en Meta Business Suite que la integración quedó cerrada.
   - **Rojo** — hubo un error de red; intenta de nuevo.

## Preguntas frecuentes

**¿Puedo seguir usando WhatsApp Business en mi teléfono?**
Sí, con el modo **Coexistencia**: la IA responde desde Parallly y tú conservas la app. Solo recuerda abrirla al menos cada 14 días.

**¿Pierdo mis chats anteriores al conectar?**
No, si conectas por coexistencia: se sincronizan hasta 6 meses de chats de texto y tus contactos. Si migras desde otro proveedor, el historial de ese proveedor no se transfiere.

**¿Necesito plantillas para que el agente responda?**
No. El agente responde libremente dentro de la ventana de 24 horas tras el último mensaje del cliente. Las plantillas solo hacen falta para iniciar tú la conversación fuera de esa ventana.

**¿Por qué mi plantilla fue rechazada?**
Meta revisa el contenido. En la página de plantillas verás el **motivo del rechazo**; corrige el texto (evita lenguaje promocional agresivo en plantillas de utilidad) y vuelve a enviarla.

**¿Quién puede conectar o desconectar WhatsApp?**
Solo el **administrador** de la cuenta. Supervisores y agentes pueden ver el estado, pero no modificarlo.

**¿Puedo tener un agente distinto en cada número?**
Sí. La regla es un agente de IA por conexión: por ejemplo, un agente de ventas en un número y uno de soporte en otro. Se asigna en el editor del agente.

¿Te quedó alguna duda? Escríbenos en [soporte](https://parallly-chat.cloud/support).
