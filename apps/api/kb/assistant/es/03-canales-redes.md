---
id: canales-redes
title: "Conectar Instagram, Messenger y Telegram"
routes: ["/admin/channels", "/admin/channels/instagram", "/admin/channels/messenger", "/admin/channels/telegram"]
roles: ["tenant_admin"]
keywords: ["instagram", "messenger", "telegram", "facebook", "conectar canal", "conectar instagram", "conectar messenger", "conectar telegram", "reconectar", "token expirado", "bot", "botfather", "mensajes directos", "dm", "desconectar canal", "cuenta business", "varias cuentas", "limite de cuentas", "pagina de facebook", "redes sociales"]
---

# Conectar Instagram, Messenger y Telegram

Además de WhatsApp, tu negocio puede atender clientes por **Instagram**, **Messenger** y **Telegram**. Los tres se conectan desde **Administración → Canales**, y cada conexión puede tener su propio agente de IA. Aquí te explicamos qué necesitas, cómo conectar cada uno, qué significan los estados y qué hacer cuando una conexión expira.

> Solo el rol **administrador** puede entrar a Canales y administrar conexiones.

## Antes de empezar: requisitos por canal

| Canal | Necesitas |
|-------|-----------|
| Instagram | Una cuenta de **Instagram Business** (las cuentas personales no funcionan; es un requisito de Meta, no de Parallly) |
| Messenger | Una cuenta de Facebook con acceso de administrador a la **página de Facebook** de tu negocio |
| Telegram | Un **bot de Telegram** creado con @BotFather (te guiamos paso a paso; toma menos de 2 minutos) |

## Cómo conectar Instagram

1. En la barra lateral, entra a **Canales** y ubica la tarjeta de **Instagram**.
2. Haz clic en **Conectar**.
3. En la página de Instagram, haz clic en **Conectar con Instagram**. Se abrirá una ventana emergente de Meta.
4. Inicia sesión con tu cuenta de **Instagram Business** y acepta los permisos de mensajes que Meta te solicita.
5. La ventana se cierra sola y verás tu **Cuenta conectada** con el nombre y usuario de tu perfil.

Desde ese momento, los mensajes directos (DM) de Instagram llegan a tu bandeja de entrada y tu agente de IA puede responderlos.

### Cuándo y cómo reconectar Instagram

La autorización que Meta le da a Parallly para tu cuenta de Instagram **dura 60 días**. No tienes que hacer nada para mantenerla: Parallly la renueva automáticamente cada día cuando se acerca el vencimiento.

- En la tarjeta del canal verás el aviso "**El token expira en X días**" a modo informativo.
- Si la renovación automática falla (por ejemplo, porque cambiaste la contraseña o los permisos en Instagram), recibirás una alerta y verás el mensaje "**Token expirado. Por favor reconecta tu cuenta.**".
- En ese caso, haz clic en **Reconectar** y repite el inicio de sesión con Instagram. Tus conversaciones e historial se conservan intactos.

## Cómo conectar Messenger

1. En la barra lateral, entra a **Canales** y ubica la tarjeta de **Messenger**.
2. Haz clic en **Conectar**.
3. Haz clic en **Conectar con Facebook**. Se abrirá el diálogo de inicio de sesión de Facebook.
4. Inicia sesión, **selecciona la página de Facebook** de tu negocio y otorga los permisos de mensajería solicitados.
5. Listo: verás tu **Página conectada** y los mensajes de Messenger empezarán a llegar a tu bandeja de entrada.

## Cómo conectar Telegram

1. En la barra lateral, entra a **Canales** y ubica la tarjeta de **Telegram**. Haz clic en **Conectar**.
2. **Paso 1 — Crea tu bot en Telegram** (menos de 1 minuto):
   - Abre Telegram y busca **@BotFather** (el asistente oficial de Telegram para crear bots), o usa el botón **Abrir @BotFather**.
   - Envía el comando `/newbot` y elige un nombre y un usuario para tu bot.
   - BotFather te enviará un **token**: cópialo.
3. Haz clic en **Ya tengo el token**.
4. **Paso 2 — Pega el token de tu bot** en el campo indicado y haz clic en **Conectar bot**. El token se guarda encriptado y nunca se muestra en texto plano.
5. Verás la confirmación "**Bot conectado!**". Parallly completa el resto de la configuración automáticamente.
6. Usa **Abrir en Telegram** para enviarle un mensaje de prueba a tu bot y verificar que tu agente de IA responde.

## Estados de una conexión

En la página **Canales**, cada tarjeta muestra el estado actual:

- **Conectado** (insignia verde): el canal recibe y envía mensajes con normalidad. El botón cambia a **Configurar** para entrar al detalle.
- **Desconectado** (insignia roja): el canal no está activo. Entra a la tarjeta para conectarlo o reconectarlo.
- **Contador de cuentas** ("X/Y cuentas"): cuántas conexiones de ese tipo tienes activas y cuántas permite tu plan. Si aún tienes cupo, aparece el enlace **Agregar otra**.

Recuerda: cada conexión necesita un agente de IA asignado para responder automáticamente. La asignación se hace desde el editor del agente (sección **Agente IA**), y aplica la regla de **un agente por conexión**.

## Varias cuentas del mismo canal

Puedes conectar más de una cuenta del mismo tipo cuando tu cuenta tenga capacidad, sin mezclar conversaciones. La pantalla muestra el uso actual; consulta disponibilidad y límites vigentes en **Plan y facturación**.

## Cómo desconectar una cuenta

La desconexión es **por cuenta**: si tienes varias conexiones del mismo canal, desconectar una no afecta a las demás.

1. Entra a **Canales**, abre el canal y elige la conexión que quieres retirar.
2. Haz clic en **Desconectar** y confirma en el modal.
3. El resultado te dice exactamente qué pasó:
   - **Verde** — "Desconectado completamente": todo quedó cerrado también del lado del proveedor (Meta o Telegram).
   - **Amarillo** — "Desconectado en plataforma": Parallly ya no procesará mensajes, pero conviene revisar la integración en el proveedor (por ejemplo, en Meta Business Suite), porque la autorización pudo haber expirado antes de completar el cierre.
   - **Rojo** — hubo un error de red: intenta de nuevo.

## Preguntas frecuentes

**¿Puedo conectar mi Instagram personal?**
No. Solo funcionan cuentas de **Instagram Business**. Es un requisito de Meta. Convertir tu cuenta personal en Business es gratis y se hace desde la app de Instagram.

**¿Tengo que reconectar Messenger o Telegram cada cierto tiempo?**
No. La renovación periódica solo aplica a Instagram, y normalmente es automática. Solo tendrás que intervenir si recibes una alerta de que la renovación falló.

**¿Puedo tener un agente de IA distinto en cada canal?**
Sí: la regla es **un agente por conexión**. Puedes tener, por ejemplo, un agente formal en Messenger y otro más cercano en Instagram, según lo que permita tu plan.

**Conecté el canal pero el bot no responde. ¿Qué reviso?**
Verifica dos cosas en este orden: que la tarjeta del canal diga **Conectado**, y que la conexión tenga un agente de IA asignado en la sección **Agente IA**. Si ambas están bien y sigue sin responder, contáctanos en [soporte](https://parallly-chat.cloud/support).

**¿Qué pasa con mis conversaciones si desconecto y vuelvo a conectar?**
Nada se pierde: el historial de conversaciones y tus contactos se conservan. Al reconectar, los mensajes nuevos retoman la conversación existente.
