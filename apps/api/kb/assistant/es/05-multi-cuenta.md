---
id: multi-cuenta
title: "Varias conexiones del mismo canal (multi-cuenta)"
routes: ["/admin/channels", "/admin/agent", "/admin/broadcast", "/admin/channels/whatsapp/templates"]
roles: ["tenant_admin"]
keywords: ["multi-cuenta", "varias cuentas", "dos numeros de whatsapp", "segundo numero", "otra cuenta de instagram", "limite de cuentas", "conectar otra cuenta", "agregar otra", "desconectar una cuenta", "numero emisor", "elegir numero", "enviar desde el numero", "cuentas por canal", "varias conexiones", "dos cuentas", "contador de cuentas", "limite por plan", "varios numeros"]
---

# Varias conexiones del mismo canal (multi-cuenta)

¿Tu negocio tiene un número de WhatsApp para ventas y otro para soporte? ¿O dos cuentas de Instagram para marcas distintas? Con Parallly puedes conectar **más de una cuenta del mismo canal** — por ejemplo dos números de WhatsApp, dos cuentas de Instagram o dos bots de Telegram — y cada una funciona de forma independiente: las conversaciones nunca se mezclan y cada conexión puede tener su propio agente de IA.

> Conectar, desconectar y revisar las cuentas de canal es tarea del rol **administrador**. Los supervisores pueden elegir un emisor disponible dentro del flujo de campañas, pero no administran canales desde esta pantalla.

## Capacidad de conexiones

La cantidad y los tipos de conexión disponibles dependen de la configuración de tu cuenta. Cada tarjeta de **Canales** muestra el uso actual y si puedes agregar otra; **Plan y facturación** muestra el límite vigente. El chat web se administra en su propia pantalla.

## Cómo ver cuántas cuentas tienes conectadas

1. En la barra lateral, entra a **Canales**.
2. Cada tarjeta de canal muestra el uso actual y el límite aplicable a tu cuenta. Si la capacidad es ilimitada, puede aparecer el símbolo ∞.
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

Cuando tienes más de un número de WhatsApp conectado, el borrador de campaña permite elegir el emisor:

1. En la barra lateral, entra a **Campañas** y crea una **Nueva campaña**.
2. En el formulario verás el campo **Enviar desde el número**.
3. Elige el número emisor, o deja **Número principal (por defecto)**.
4. Guarda el borrador sin programarlo ni lanzarlo. El envío de producción desde el editor no está certificado de punta a punta y no ofrece cancelación de campañas programadas; consulta el artículo **Campañas y difusión** antes de operar.

## Plantillas de WhatsApp con varios números

Las plantillas aprobadas por Meta pertenecen a un número concreto. Si tienes varios números:

1. Entra a **Canales → WhatsApp** y haz clic en **Ver todas las plantillas**.
2. Al crear una plantilla, aparece el campo **Número / cuenta**: elige para cuál número la estás creando, o deja **Número principal (por defecto)**.
3. Envíala a aprobación y verifica el estado recibido desde Meta. Al preparar un borrador, selecciona una plantilla y un emisor de la misma cuenta; esto no elimina la limitación actual del lanzamiento de campañas.

## Preguntas frecuentes

**¿Se pueden mezclar las conversaciones de mis dos números?**
No. Cada conexión mantiene sus conversaciones separadas en el inbox, y las respuestas siempre salen por la misma cuenta por la que escribió el cliente.

**¿Puedo asignar dos agentes de IA al mismo número?**
No. Cada conexión tiene exactamente un agente asignado. Lo que sí puedes hacer es asignar el mismo agente a varias conexiones.

**Llegué al límite de cuentas de mi plan, ¿qué hago?**
Revisa las opciones vigentes en **Administración → Plan y facturación**, o contáctanos en https://parallly-chat.cloud/support si necesitas una capacidad distinta para tu negocio.

**Si desconecto una cuenta, ¿las otras siguen funcionando?**
Sí. La desconexión es individual: las demás cuentas del mismo canal siguen recibiendo y respondiendo mensajes con normalidad.

**¿El multi-cuenta aplica al chat web?**
El widget de chat web se configura aparte en **Configuración → Canales e integraciones**. El multi-cuenta aplica únicamente a las conexiones que la pantalla de **Canales** permita agregar.

**¿Cuentan las cuentas de canales distintos para el mismo límite?**
No necesariamente. La pantalla calcula la capacidad por tipo de canal y muestra cada uso por separado.

¿Dudas? Escríbenos en https://parallly-chat.cloud/support — con gusto te ayudamos.
