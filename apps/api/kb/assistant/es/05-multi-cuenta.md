---
id: multi-cuenta
title: "Varias conexiones del mismo canal (multi-cuenta)"
routes: ["/admin/channels", "/admin/agent", "/admin/broadcast", "/admin/channels/whatsapp/templates"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["multi-cuenta", "varias cuentas", "dos numeros de whatsapp", "segundo numero", "otra cuenta de instagram", "limite de cuentas", "conectar otra cuenta", "agregar otra", "desconectar una cuenta", "numero emisor", "elegir numero", "enviar desde el numero", "cuentas por canal", "varias conexiones", "dos cuentas", "contador de cuentas", "limite por plan", "varios numeros"]
---

# Varias conexiones del mismo canal (multi-cuenta)

¿Tu negocio tiene un número de WhatsApp para ventas y otro para soporte? ¿O dos cuentas de Instagram para marcas distintas? Con Parallly puedes conectar **más de una cuenta del mismo canal** — por ejemplo dos números de WhatsApp, dos cuentas de Instagram o dos bots de Telegram — y cada una funciona de forma independiente: las conversaciones nunca se mezclan y cada conexión puede tener su propio agente de IA.

> Conectar y desconectar cuentas es tarea del rol **administrador**. Los supervisores pueden ver el estado de los canales y elegir el número emisor al enviar campañas.

## Cuántas cuentas del mismo canal incluye tu plan

Cada plan define cuántas conexiones del mismo tipo puedes tener. Estos son los límites incluidos:

| Plan | WhatsApp | Instagram | Messenger | Telegram |
|------|:--------:|:---------:|:---------:|:--------:|
| Emprendedor | 1 | 1 | 1 | 1 |
| Starter | 1 | 1 | 1 | 1 |
| Pro | 2 | 1 | 3 | 1 |
| Enterprise | 3 | 2 | 5 | 2 |
| Custom | Ilimitado | Ilimitado | Ilimitado | Ilimitado |

Ten en cuenta:

- Los canales disponibles también dependen de tu plan: el plan **Emprendedor** incluye solo WhatsApp, y **Telegram** está disponible desde el plan **Pro**.
- El canal de **Email** admite una conexión por negocio.
- Si necesitas más cuentas de las que incluye tu plan, puedes mejorar de plan desde **Configuración → Facturación**, o escribirnos para ampliar tu límite: el equipo de Parallly puede ajustarlo para tu negocio.

## Cómo ver cuántas cuentas tienes conectadas

1. En la barra lateral, entra a **Canales**.
2. Cada tarjeta de canal muestra un contador con el formato **"X/Y cuentas"** — por ejemplo, "1/2 cuentas" significa que tienes 1 cuenta conectada y tu plan permite hasta 2 de ese canal. Si tu límite es ilimitado, verás el símbolo ∞.
3. Cuando todavía tienes cupo, la tarjeta muestra el enlace **Agregar otra**.

## Cómo conectar otra cuenta del mismo canal

1. Entra a **Canales** y ubica la tarjeta del canal (por ejemplo, WhatsApp).
2. Haz clic en **Agregar otra**.
3. Sigue el mismo proceso de conexión de siempre: inicio de sesión con Meta para WhatsApp, Instagram o Messenger, o el token de @BotFather para Telegram.
4. Al terminar, la nueva cuenta aparece en la tarjeta del canal junto a las demás, con su propio nombre o número.

Cada cuenta guarda su propia autorización, así que los mensajes siempre salen por el número o la cuenta correctos.

> Si el enlace **Agregar otra** no aparece, ya alcanzaste el límite de tu plan para ese canal.

## Cada conexión con su propio agente de IA

En Parallly la regla es **un agente de IA por conexión**, no por canal. Eso significa que si tienes dos números de WhatsApp, puedes asignar un agente distinto a cada uno — por ejemplo, "Sofía" para el número de ventas y "Carlos" para el de soporte.

Para asignarlos:

1. En la barra lateral, entra a **Agente IA** y abre el agente que quieres configurar.
2. En la sección **Asignación de canales**, verás una opción por **cada cuenta conectada**, identificada con su nombre o número (por ejemplo, "WhatsApp · Ventas +57 300…").
3. Marca las conexiones que este agente debe atender y presiona **Guardar cambios** en la barra inferior.

Si asignas a este agente una conexión que ya atendía otro agente, la plataforma te lo avisa antes de guardar: la conexión pasará al nuevo agente.

## Cómo desconectar una cuenta específica

La desconexión es **por cuenta**: puedes desconectar un número sin afectar a los demás.

1. Entra a **Canales** y haz clic en el canal.
2. Ubica la cuenta específica que quieres desconectar y haz clic en **Desconectar**.
3. Confirma en el mensaje: "¿Desconectar esta cuenta? Las demás cuentas de este canal seguirán activas."
4. Revisa el resultado en el modal de confirmación: verde significa desconexión completa; amarillo significa que quedó desconectada en Parallly pero conviene revisar también tu cuenta del proveedor (por ejemplo, Meta Business Suite).

## Elegir el número emisor en campañas

Cuando tienes más de un número de WhatsApp conectado, al crear una campaña eliges desde cuál se envía:

1. En la barra lateral, entra a **Campañas** y crea una **Nueva campaña**.
2. En el formulario verás el campo **Enviar desde el número**.
3. Elige el número emisor, o deja **Número principal (por defecto)** para enviar desde tu número principal.
4. Completa el resto de la campaña (audiencia, plantilla, programación) y confirma.

## Plantillas de WhatsApp con varios números

Las plantillas aprobadas por Meta pertenecen a un número concreto. Si tienes varios números:

1. Entra a **Canales → WhatsApp** y haz clic en **Ver todas las plantillas**.
2. Al crear una plantilla, aparece el campo **Número / cuenta**: elige para cuál número la estás creando, o deja **Número principal (por defecto)**.
3. Envíala a aprobación como de costumbre. Al enviar campañas, usa plantillas del mismo número que elegiste como emisor.

## Preguntas frecuentes

**¿Se pueden mezclar las conversaciones de mis dos números?**
No. Cada conexión mantiene sus conversaciones separadas en el inbox, y las respuestas siempre salen por la misma cuenta por la que escribió el cliente.

**¿Puedo asignar dos agentes de IA al mismo número?**
No. Cada conexión tiene exactamente un agente asignado. Lo que sí puedes hacer es asignar el mismo agente a varias conexiones.

**Llegué al límite de cuentas de mi plan, ¿qué hago?**
Puedes mejorar tu plan desde **Configuración → Facturación**, o contactarnos en https://parallly-chat.cloud/support para evaluar una ampliación del límite para tu negocio.

**Si desconecto una cuenta, ¿las otras siguen funcionando?**
Sí. La desconexión es individual: las demás cuentas del mismo canal siguen recibiendo y respondiendo mensajes con normalidad.

**¿El multi-cuenta aplica al chat web o al Email?**
El Email admite una conexión por negocio, y el widget de chat web se configura aparte en **Configuración → Integraciones → Web Chat**. El multi-cuenta aplica a WhatsApp, Instagram, Messenger y Telegram.

**¿Cuentan las cuentas de canales distintos para el mismo límite?**
No. El límite es por tipo de canal: por ejemplo, en el plan Pro puedes tener 2 números de WhatsApp y además 3 páginas de Messenger.

¿Dudas? Escríbenos en https://parallly-chat.cloud/support — con gusto te ayudamos.
