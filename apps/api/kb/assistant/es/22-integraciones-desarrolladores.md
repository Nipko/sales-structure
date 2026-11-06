---
id: integraciones-desarrolladores
title: "Integraciones, API, webhooks y chat web"
routes: ["/admin/settings/integrations", "/admin/settings/integrations/crm", "/admin/settings/integrations/ecommerce", "/admin/settings/integrations/mcp", "/admin/settings/integrations/payments", "/admin/settings/integrations/reviews", "/admin/settings/integrations/slack", "/admin/settings/integrations/vertical", "/admin/settings/integrations/channel-manager", "/admin/settings/integrations/webhooks", "/admin/settings/api-keys", "/admin/settings/integrations/web-chat", "/admin/settings/integrations/web-chat/triggers"]
roles: ["tenant_admin"]
keywords: ["integraciones", "api", "api key", "webhook", "mcp", "crm", "ecommerce", "pagos", "reseñas", "slack", "chat web", "widget", "desarrolladores", "credenciales", "toast", "mindbody", "cliniko", "channel manager", "google business"]
---

# Integraciones, API, webhooks y chat web

Un administrador gestiona las conexiones externas desde **Configuración → Canales e integraciones**. Allí puede conectar CRM, comercio electrónico, pagos, reseñas, Slack, servicios del vertical y servidores MCP, además de configurar el chat web.

Para integraciones propias usa **Claves API** y **Webhooks**. Trata las claves y secretos como contraseñas: cópialos solo al sistema que los necesita, rota una credencial expuesta y verifica la firma de cada webhook. Antes de activar una integración en producción, prueba el evento con datos no sensibles y confirma qué acciones puede ejecutar.

En **Integraciones → Pagos**, el negocio puede conectar su propia cuenta Wompi o pasarela de pagos compatible para cobrar a sus clientes. El dinero va directamente a esa cuenta y estas credenciales nunca pagan la suscripción de Parallly. Elige un solo proveedor activo, copia la URL de eventos que muestra la pantalla y habilita **Cobros a clientes** dentro del agente. El agente usa el monto del pedido guardado en Parallly y sólo confirma “pagado” cuando el backend valida el evento y la transacción del proveedor; un enlace, una redirección o una captura no prueban el pago. La creación de enlaces depende de la feature vigente del plan, pero los pagos ya emitidos continúan conciliándose después de un downgrade.

La disponibilidad de cada conector depende de la configuración de la cuenta. La pantalla de la integración y **Plan y facturación** son la fuente vigente; evita basarte en límites o precios copiados en documentación externa.

## Integraciones verticales (Toast, Mindbody, Cliniko)

En **Configuración → Canales e integraciones → Integraciones verticales** conectas el sistema que ya usa tu rubro: **Toast** (restaurantes: menú, ítems y precios), **Mindbody** (gimnasios: clases y horarios) o **Cliniko** (salud: tipos de cita y disponibilidad, sin acceso al historial clínico). La pantalla solo muestra los proveedores que aplican a tu tipo de negocio.

Son integraciones **de solo lectura y en beta**: llevan datos al agente, pero no escriben en el sistema de origen ni confirman disponibilidad en vivo cuando el proveedor no la ofrece (Mindbody, por ejemplo, no confirma cupos ni reservas). Completa las credenciales, pulsa **Probar** y, si la conexión responde, **Sincronizar**. Cada tarjeta muestra el estado (por ejemplo **Funcionando** o **Datos viejos**), cuándo llegó el último dato y si faltan permisos. El **Mapeo por recurso** vincula una sede, calendario o recurso de Parallly con su identificador externo; un mapeo nunca habilita escrituras por sí solo.

## Channel Manager (hotel y alquiler vacacional)

Si tu negocio es hotel o alquiler vacacional, esa pantalla muestra además un acceso a **Channel Manager**, que conecta Hostaway. Puedes **Probar sin sincronizar** antes de guardar; después pulsa **Sincronizar ahora** y enlaza cada publicación externa con exactamente un alojamiento de Parallly. Hostaway sigue siendo la fuente de verdad: el agente todavía no crea reservas allí, y una publicación sin mapear deja bloqueadas sus reservas por conversación y las pasa a tu equipo. Sin channel manager, puedes sincronizar Airbnb o Booking.com por iCal desde cada propiedad (ver **Herramientas y módulos según tu industria**).

## Reseñas de Google

En **Configuración → Canales e integraciones → Reseñas** pulsa **Conectar Google Business**, autoriza el acceso y guarda el local. Con **Sincronizar** traes las reseñas (también se actualizan solas cada pocas horas) y ves la calificación media, el total, las que siguen sin responder y las negativas. En cada reseña, **Sugerir con IA** propone una respuesta en el idioma de tu cuenta; revísala, edítala si hace falta y pulsa **Publicar respuesta** para publicarla en Google. Si activas **Respuesta automática con IA**, Parallly publica sin revisión humana una respuesta a cada reseña nueva sin responder, también a las negativas: actívala solo si aceptas ese riesgo.

## Servidores MCP externos

Conectar o descubrir un servidor MCP externo no autoriza sus herramientas. Un administrador revisa cada herramienta y declara su efecto (lectura, escritura, pago, notificación o irreversible) y si exige confirmación del cliente o aprobación humana. Una herramienta sin revisar queda bloqueada para el agente.
