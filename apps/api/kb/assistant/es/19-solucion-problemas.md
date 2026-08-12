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

1. Pide al administrador que abra **Administración → Canales** y busque la tarjeta del canal afectado. Si tú eres administrador, hazlo directamente.
2. El administrador revisa el estado de la conexión: si dice **Desconectado** o muestra un token vencido, debe seguir los pasos de la siguiente sección.
3. Si hay **varias cuentas del mismo canal**, el administrador confirma que el cliente escribió al número o cuenta conectados: cada conexión es independiente.
4. Haz una prueba tú mismo: envía un mensaje desde otro teléfono o cuenta y verifica si aparece en el **Inbox** en unos segundos.
5. Si el canal figura como **Conectado** y aun así no llegan mensajes, escríbenos a soporte con el canal, la hora aproximada y un ejemplo del mensaje que no llegó.

> **Canales** es una pantalla exclusiva del administrador. Supervisores y agentes deben informar al administrador el canal, la hora aproximada y un ejemplo; no pueden consultar ni cambiar el estado desde esa pantalla.

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
6. **¿Se agotó la capacidad de mensajes IA?** Entra a **Plan y facturación** y revisa la barra de uso y las opciones vigentes.

Si el agente **responde, pero responde mal** (inventa datos, no conoce tus precios o se sale del tema):

- Alimenta la **Base de Conocimiento**: el agente responde con lo que le enseñas. Agrega o corrige artículos y preguntas frecuentes con la información oficial de tu negocio.
- Ajusta las **reglas** y los **temas prohibidos** en la tarjeta **Comportamiento** del editor del agente.
- Prueba los cambios sin afectar clientes reales en **Agente IA → Probar agente**: es un simulador donde chateas con tu propio agente.

## No puedo enviar una campaña

El lanzamiento desde el editor actual no está certificado para producción: todavía falta vincular de forma segura el identificador y los componentes de la plantilla aprobada con el emisor, y añadir una acción de cancelación para campañas programadas. Usa **Campañas** solo para preparar borradores, audiencias y revisar métricas existentes. No pulses **Enviar ahora** ni programes una campaña real; coordina una prueba controlada con [soporte](https://parallly-chat.cloud/support).

## Llegué al límite de mi plan

Cuando un recurso llega a su tope (agentes, contactos, campañas, mensajes IA, etc.), la plataforma te avisa con un mensaje del tipo "Has alcanzado el límite de tu plan actual" y no podrás crear más de ese recurso.

- En **Plan y facturación** ves las barras de uso y una advertencia al acercarte a la capacidad.
- La pantalla confirma cuándo aplicará un cambio y cualquier cobro antes de que lo aceptes.
- Cada contador muestra su periodo y próxima renovación.
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

**¿Cuándo se reinician los límites de mi cuenta?**
Cada barra de uso muestra su periodo y próxima renovación en **Plan y facturación**.

**¿Cuánto tarda Meta en aprobar una plantilla de WhatsApp?**
Meta no garantiza un plazo. El estado (Pendiente, Aprobada o Rechazada) se ve en **Canales → WhatsApp**.
