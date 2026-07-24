---
id: solucion-problemas
title: "Solución de problemas frecuentes"
routes: ["/admin/channels", "/admin/agent", "/admin/inbox", "/admin/broadcast", "/admin/appointments", "/admin/settings/billing"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["problemas", "no funciona", "no llegan mensajes", "no responde", "el bot no responde", "canal desconectado", "token expirado", "reconectar", "campaña no envia", "plantilla rechazada", "limite del plan", "limite alcanzado", "cita no aparece", "calendario no sincroniza", "correo de verificacion", "no llega el codigo", "error", "ayuda", "soporte", "contactar soporte"]
---

# Solución de problemas frecuentes

¿Algo no funciona como esperabas? Esta guía reúne los problemas más comunes y cómo resolverlos paso a paso. Si al final nada de esto lo soluciona, al cierre te decimos cómo escribir a soporte.

## No llegan mensajes de un canal

Si tus clientes te escriben pero los mensajes no aparecen en el **Inbox**:

1. Entra a **Canales** en la barra lateral y busca la tarjeta del canal afectado.
2. Revisa el estado de la conexión: si dice **Desconectado** o ves un aviso como "**Token expirado. Por favor reconecta tu cuenta**", esa es la causa. Sigue los pasos de la siguiente sección para reconectar.
3. Si tienes **varias cuentas del mismo canal** (por ejemplo, dos números de WhatsApp), confirma que el cliente escribió al número o cuenta que está conectado: cada conexión es independiente.
4. Haz una prueba tú mismo: envía un mensaje desde otro teléfono o cuenta y verifica si aparece en el **Inbox** en unos segundos.
5. Si el canal figura como **Conectado** y aun así no llegan mensajes, escríbenos a soporte con el canal, la hora aproximada y un ejemplo del mensaje que no llegó.

> Solo el rol **administrador** puede conectar, reconectar o desconectar canales. Supervisores y agentes ven el estado, pero no pueden modificarlo.

## Canal desconectado o token vencido: cómo reconectar

Las autorizaciones de algunos canales pueden vencer con el tiempo o invalidarse si cambias la contraseña o los permisos de la cuenta (por ejemplo, en Instagram o Facebook).

1. Ve a **Canales** y abre la tarjeta del canal.
2. Haz clic en **Reconectar** (o **Conectar**, si aparece como desconectado).
3. Repite el inicio de sesión con el proveedor (Meta, Google, etc.) y aprueba los permisos.
4. Listo: la conexión vuelve a activarse y **tus conversaciones e historial se conservan intactos**.

Detalles útiles:

- **Instagram** usa una autorización que dura 60 días. Parallly la renueva automáticamente, pero si la renovación falla (contraseña o permisos cambiados) recibirás una alerta y verás el aviso de token expirado en la tarjeta: ahí solo debes pulsar **Reconectar**.
- Reconectar **no borra nada**: contactos, conversaciones y configuración del agente siguen igual.

## El agente de IA no responde (o responde mal)

Revisa esta lista en orden; casi siempre la causa es una de estas:

1. **¿La conexión tiene agente asignado?** Entra a **Agente IA**. Si ves un aviso tipo "canales sin agente asignado", esas conexiones las atiende tu agente predeterminado con una configuración genérica. Abre el agente correcto y, en **Asignación de conexiones**, marca la cuenta exacta que debe atender. Recuerda: hay **un agente de IA por conexión**.
2. **¿El agente está activo?** En la lista de agentes, verifica que no esté **pausado**.
3. **¿Está dentro de su horario?** En el editor del agente, revisa la tarjeta **Horario**: fuera de ese rango el agente no responde de forma automática.
4. **¿El modo de respuesta es el correcto?** En **Comportamiento**, si el modo está en "siempre humano", la IA nunca contesta sola. Cámbialo a "siempre IA" o "híbrido" según lo que necesites.
5. **¿La conversación está con un humano?** Si tú o alguien del equipo tomó la conversación en el **Inbox** (o el cliente pidió hablar con una persona), la IA queda pausada en esa conversación hasta que se pulse **Resolver**. Es el comportamiento esperado, no una falla.
6. **¿Se agotaron los mensajes IA del mes?** Entra a **Configuración → Facturación** y mira la barra de uso de mensajes IA. Cada plan incluye una cantidad mensual (por ejemplo, Emprendedor 1.000 y Starter 5.000); si se agota, mejora tu plan o espera al reinicio del mes.

Si el agente **responde, pero responde mal** (inventa datos, no conoce tus precios o se sale del tema):

- Alimenta la **Base de Conocimiento**: el agente responde con lo que le enseñas. Agrega o corrige artículos y preguntas frecuentes con la información oficial de tu negocio.
- Ajusta las **reglas** y los **temas prohibidos** en la tarjeta **Comportamiento** del editor del agente.
- Prueba los cambios sin afectar clientes reales en **Agente IA → Probar agente**: es un simulador donde chateas con tu propio agente.

## No puedo enviar una campaña

Las causas más comunes al crear o enviar una campaña en **Campañas**:

- **Tu plan no incluye campañas o llegaste al tope del mes.** Emprendedor no incluye campañas; Starter incluye 3 por mes; Pro, Enterprise y Custom las tienen ilimitadas. Si alcanzaste el tope verás el aviso de límite con la opción **Mejorar plan**.
- **La plantilla de WhatsApp no está aprobada.** Para escribirle a clientes que no te han hablado en las últimas 24 horas, WhatsApp exige una plantilla revisada y aprobada por Meta. Revisa el estado en **Canales → WhatsApp → Ver todas las plantillas**: debe figurar como **Aprobada** (la revisión de Meta suele tardar entre unos minutos y 72 horas). Si fue **Rechazada**, verás el motivo; corrige el texto y vuelve a enviarla.
- **Algunos destinatarios no reciben.** Es normal que unos pocos fallen: contactos que se dieron de baja (no se les envían más difusiones) o números que ya no existen. Lo ves en las métricas de la campaña.
- **Varios números conectados**: verifica que elegiste el **número emisor** correcto al crear la campaña.

## Llegué al límite de mi plan

Cuando un recurso llega a su tope (agentes, contactos, campañas, mensajes IA, etc.), la plataforma te avisa con un mensaje del tipo "Has alcanzado el límite de tu plan actual" y no podrás crear más de ese recurso.

- En **Configuración → Facturación** ves las barras de uso: advertencia ámbar al **80%** y alerta roja al **95%** con el botón **Mejorar plan**.
- Subir de plan aplica **al instante**: pagas el plan nuevo y los límites se amplían de inmediato.
- Los contadores mensuales (mensajes IA, campañas, multimedia) **se reinician el primer día de cada mes**.
- También puedes liberar espacio (por ejemplo, eliminar un agente o contactos que no uses) en lugar de subir de plan.

## La cita no aparece en mi calendario

1. Primero confirma que la cita existe en Parallly: entra a **Agenda** y búscala en la pestaña **Calendario**. Si no está ahí, la reserva no llegó a concretarse (el cliente pudo no confirmar el último paso).
2. Si la cita está en Parallly pero no en tu Google Calendar u Outlook, ve a **Agenda → Configuración → Calendarios conectados** y revisa que tu calendario siga **conectado**. Si la conexión venció, pulsa **Reconectar**.
3. Si tienes **varios calendarios conectados**, la cita pudo sincronizarse en otro: cada cita va primero al calendario asignado al **servicio**, si no hay, al del **profesional** asignado, y si tampoco, al calendario **general** del negocio. Revisa esas asignaciones en la edición del servicio.
4. La sincronización es rápida pero no siempre instantánea: espera un par de minutos y actualiza tu calendario.

## No me llega el correo de verificación

Al registrarte (o recuperar tu contraseña), Parallly te envía un **código de 6 dígitos** por correo. Si no llega:

1. Revisa la carpeta de **spam o correo no deseado**, y busca "Parallly" en tu bandeja.
2. Espera 2 o 3 minutos: algunos proveedores de correo demoran la entrega.
3. Verifica que escribiste bien tu dirección de correo y pide un **nuevo código** desde la misma pantalla.
4. Si usas un correo de empresa, es posible que un filtro corporativo lo bloquee; intenta con otra dirección o pide a tu equipo de sistemas que lo permita.
5. Si nada funciona, escríbenos a soporte indicando el correo con el que intentas registrarte.

## Cómo contactar a soporte

Si seguiste los pasos y el problema continúa:

- Escríbenos en [parallly-chat.cloud/support](https://parallly-chat.cloud/support).
- También puedes preguntarle al **copiloto** dentro del panel: muchas dudas se resuelven al momento.

Para ayudarte más rápido, incluye: qué intentabas hacer, en qué canal o página ocurrió, la hora aproximada y, si puedes, una captura de pantalla del error.

## Preguntas frecuentes

**¿Reconectar un canal borra mis conversaciones o contactos?**
No. Reconectar solo renueva la autorización con el proveedor; todo tu historial se conserva.

**¿Por qué la IA dejó de responder solo en una conversación?**
Porque esa conversación está asignada a una persona de tu equipo. Mientras esté tomada, la IA se pausa; vuelve a responder cuando se pulsa **Resolver** en el Inbox.

**¿Quién puede reconectar canales o cambiar la configuración del agente?**
Solo el rol **administrador**. Si eres supervisor o agente y detectas el problema, avísale a tu administrador.

**¿Cuándo se reinician los límites mensuales de mi plan?**
El primer día de cada mes. Los límites fijos (agentes, contactos, calendarios) solo cambian al cambiar de plan.

**¿Cuánto tarda Meta en aprobar una plantilla de WhatsApp?**
Normalmente entre unos minutos y 72 horas. El estado (Pendiente, Aprobada o Rechazada) se ve en **Canales → WhatsApp**.
