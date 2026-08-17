---
id: integraciones-desarrolladores
title: "Integraciones, API, webhooks y chat web"
routes: ["/admin/settings/integrations", "/admin/settings/integrations/crm", "/admin/settings/integrations/ecommerce", "/admin/settings/integrations/mcp", "/admin/settings/integrations/payments", "/admin/settings/integrations/reviews", "/admin/settings/integrations/slack", "/admin/settings/integrations/vertical", "/admin/settings/integrations/webhooks", "/admin/settings/api-keys", "/admin/settings/integrations/web-chat", "/admin/settings/integrations/web-chat/triggers"]
roles: ["tenant_admin"]
keywords: ["integraciones", "api", "api key", "webhook", "mcp", "crm", "ecommerce", "pagos", "reseñas", "slack", "chat web", "widget", "desarrolladores", "credenciales"]
---

# Integraciones, API, webhooks y chat web

Un administrador gestiona las conexiones externas desde **Configuración → Canales e integraciones**. Allí puede conectar CRM, comercio electrónico, pagos, reseñas, Slack, servicios del vertical y servidores MCP, además de configurar el chat web.

Para integraciones propias usa **Claves API** y **Webhooks**. Trata las claves y secretos como contraseñas: cópialos solo al sistema que los necesita, rota una credencial expuesta y verifica la firma de cada webhook. Antes de activar una integración en producción, prueba el evento con datos no sensibles y confirma qué acciones puede ejecutar.

En **Integraciones → Pagos**, el negocio puede conectar su propia cuenta Wompi o pasarela de pagos compatible para cobrar a sus clientes. El dinero va directamente a esa cuenta y estas credenciales nunca pagan la suscripción de Parallly. Elige un solo proveedor activo, copia la URL de eventos que muestra la pantalla y habilita **Cobros a clientes** dentro del agente. El agente usa el monto del pedido guardado en Parallly y sólo confirma “pagado” cuando el backend valida el evento y la transacción del proveedor; un enlace, una redirección o una captura no prueban el pago. La creación de enlaces depende de la feature vigente del plan, pero los pagos ya emitidos continúan conciliándose después de un downgrade.

La disponibilidad de cada conector depende de la configuración de la cuenta. La pantalla de la integración y **Plan y facturación** son la fuente vigente; evita basarte en límites o precios copiados en documentación externa.
