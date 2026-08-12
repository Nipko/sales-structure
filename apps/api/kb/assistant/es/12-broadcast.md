---
id: broadcast
title: "Campañas y difusión (broadcast)"
routes: ["/admin/broadcast", "/admin/channels/whatsapp/templates", "/admin/contacts/segments"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["campaña", "campañas", "broadcast", "difusión", "envío masivo", "mensajes masivos", "whatsapp masivo", "plantilla", "plantillas de whatsapp", "template", "segmento", "destinatarios", "audiencia", "programar envío", "promociones", "marketing", "entregado", "leído", "prueba a/b", "número emisor"]
---

# Campañas y difusión (broadcast)

La sección **IA y crecimiento → Campañas** reúne borradores, audiencia, estados y métricas de envíos masivos. Pueden verla los administradores y supervisores cuando la función está habilitada para la cuenta.

## Estado de disponibilidad de esta versión

El flujo de lanzamiento desde el editor **no está certificado de punta a punta para producción**:

- En WhatsApp, el editor actual no vincula de forma segura el texto escrito con el nombre y los componentes de una plantilla aprobada por Meta. Un envío puede fallar aunque el texto se vea correcto.
- Una campaña programada no tiene una acción operativa de cancelación antes de que el proceso automático la tome.
- El envío de Email de campañas no certifica Email como canal conversacional ni ofrece una conexión de Email de autoservicio.

Por ahora usa la pantalla para preparar borradores, revisar segmentos y consultar resultados ya registrados. **No pulses Enviar ahora ni programes una campaña de producción** hasta que el panel muestre un selector verificado de plantilla/emisor y una acción de cancelación. Para un envío real, coordina primero una prueba controlada con soporte.

## Preparar un borrador seguro

1. Ve a **IA y crecimiento → Campañas** y crea una campaña.
2. Dale un nombre interno.
3. Elige **Todos los contactos** o un **Segmento** creado en **CRM → Segmentos**.
4. Revisa la cantidad de destinatarios y las bajas de comunicación.
5. Guarda el borrador sin fecha de envío.

No uses datos sensibles en el nombre interno. La disponibilidad, los canales y la capacidad vigentes se muestran en la propia pantalla y en **Administración → Plan y facturación**.

## Plantillas de WhatsApp

Ruta: **Canales → WhatsApp → Ver todas las plantillas**.

- Una plantilla tiene un nombre técnico, idioma, categoría y componentes que deben coincidir exactamente con lo aprobado por Meta.
- **Sincronizar desde Meta** actualiza los estados visibles en Parallly.
- Al conectar WhatsApp, Parallly puede enviar **4 plantillas semilla**: recordatorio de cita, confirmación de asistencia, confirmación de pedido y pago recibido.
- Meta determina si aprueba o rechaza cada plantilla y cuánto tarda; Parallly solo muestra el estado recibido.

Tener una plantilla aprobada no corrige por sí solo la limitación del editor de campañas descrita arriba.

## Estados y métricas

La lista puede mostrar borradores y campañas ya procesadas con destinatarios, entregas, lecturas, respuestas o fallos. Estos datos dependen de los eventos que reporte cada proveedor; una lectura o entrega no siempre está disponible.

Los controles de variantes A/B forman parte del editor, pero su envío comparte la misma limitación de lanzamiento. Úsalos solo como configuración de borrador hasta que el flujo esté certificado.

## Preguntas frecuentes

**¿Puedo cancelar una campaña programada?**
No existe una acción operativa de cancelación en la versión actual. Por eso no programes campañas de producción desde este editor.

**¿Puedo escribir directamente el texto de una plantilla de WhatsApp y enviarlo?**
No de forma segura en esta versión. WhatsApp exige el identificador y los componentes exactos de una plantilla aprobada; el editor todavía no realiza esa vinculación de punta a punta.

**¿Cuánto tarda Meta en aprobar una plantilla?**
No hay un plazo garantizado. Consulta el estado sincronizado en **Canales → WhatsApp**.

**¿El Email de campañas habilita un canal de Email?**
No. El Email conversacional de autoservicio no está certificado actualmente.

**¿Necesitas más ayuda?** Escríbenos en https://parallly-chat.cloud/support
