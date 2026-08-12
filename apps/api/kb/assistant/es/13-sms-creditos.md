---
id: sms-creditos
title: "Créditos SMS y notificaciones por SMS"
routes: ["/admin/settings/billing", "/admin/broadcast"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["sms", "creditos", "creditos sms", "paquete sms", "comprar creditos", "saldo sms", "recarga", "mensajes de texto", "notificaciones sms", "segmento", "campañas sms", "recordatorios sms", "saldo agotado", "sms deshabilitado", "texto a clientes"]
---

# Créditos SMS y notificaciones por SMS

SMS es una función de **notificaciones salientes**, no un canal de conversación con el agente de IA. Su disponibilidad, cobertura, remitente y forma de aprovisionar créditos dependen de la integración habilitada para la cuenta y el país.

## Segmentos y consumo

Un crédito representa un segmento de SMS. El texto simple suele admitir más caracteres que un mensaje con ciertos símbolos o emojis, y un mensaje largo puede dividirse en varios segmentos. El contador del editor es la referencia antes de enviar: revisa el total estimado, porque la codificación del texto puede cambiarlo.

## Saldo o compra de créditos

El administrador puede abrir **Administración → Plan y facturación**. Si aparece la sección **Créditos SMS**, allí verá el saldo, consumo y las opciones activas. Cuando exista una acción de compra o recarga, la pantalla muestra paquetes, precio, moneda, proveedor, condiciones y confirmación; sigue únicamente ese flujo seguro.

Si la sección o el botón no aparece, la compra no está habilitada para esa cuenta. No asumas un proveedor, tipo de pago, acreditación inmediata o vencimiento: la pantalla y la confirmación de la operación son la fuente vigente.

## Preparar un borrador de campaña SMS

Un administrador o supervisor puede usar **IA y crecimiento → Campañas** cuando SMS aparezca como opción:

1. Crea la campaña y selecciona **SMS**.
2. Escribe el texto y revisa la cantidad estimada de segmentos.
3. Elige una audiencia autorizada y confirma que respeta los opt-outs.
4. Revisa el resumen y guarda el borrador. No lo envíes ni lo programes para producción desde el editor actual: comparte el flujo de campañas todavía no certificado y una programación no tiene acción de cancelación. Consulta **Campañas y difusión**.

Los recordatorios y automatizaciones también pueden consumir créditos si la acción SMS está habilitada. Los códigos de seguridad que Parallly envía a usuarios no forman parte de las campañas del negocio.

## Si SMS aparece deshabilitado

- Si no aparece en **Campañas**, el servicio no está disponible para esa cuenta, país o configuración.
- Si el saldo no alcanza, el envío queda bloqueado; revisa la pantalla antes de volver a intentar.
- Si eres supervisor, puedes preparar u operar campañas permitidas, pero solo el administrador accede a facturación o a una compra habilitada.
- Si una operación confirmada no se refleja, actualiza la pantalla y contacta soporte con la fecha y el estado, sin compartir datos sensibles de pago.

El número o identificador remitente depende de la integración y puede variar por país. No prometas recepción de respuestas por SMS salvo que la propia pantalla indique una modalidad bidireccional.
