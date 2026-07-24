---
id: sms-creditos
title: "Créditos SMS y notificaciones por SMS"
routes: ["/admin/settings/billing", "/admin/broadcast"]
roles: ["tenant_admin"]
keywords: ["sms", "creditos", "creditos sms", "paquete sms", "comprar creditos", "saldo sms", "recarga", "mensajes de texto", "notificaciones sms", "segmento", "mercadopago", "pago unico", "campañas sms", "recordatorios sms", "saldo agotado", "avisos por texto", "sms deshabilitado", "texto a clientes"]
---

# Créditos SMS y notificaciones por SMS

Con Parallly puedes enviar **notificaciones por SMS** a tus clientes: recordatorios, avisos y promociones que llegan como mensaje de texto a su celular. El SMS funciona con un sistema de **créditos prepagos** que compras por paquete.

Importante: el SMS **no es un canal de conversación**. Es un envío de **una sola vía**: tu cliente recibe el mensaje, pero no puede responderlo por SMS. Las conversaciones con tu agente de IA ocurren por WhatsApp, Instagram, Messenger, Telegram, Email o el chat web.

## Qué es un crédito

- **1 crédito = 1 segmento de SMS** (aproximadamente **160 caracteres** de texto simple).
- Si tu mensaje usa **tildes, eñes o emojis**, cada segmento se reduce a unos **70 caracteres**, porque el texto viaja en un formato distinto.
- Un mensaje más largo que un segmento se divide en varios y **consume un crédito por cada segmento**. Por ejemplo, un recordatorio de unos 120 caracteres con tildes usa 2 segmentos, es decir, 2 créditos.

Consejo: escribe mensajes cortos y directos. Si puedes evitar tildes y emojis, cada crédito rinde más.

## Cómo comprar un paquete de créditos

Los paquetes se pagan con **MercadoPago** como **pago único**: no es una suscripción y no genera cobros recurrentes.

1. En el menú lateral, dentro de **Gestión**, entra a **Facturación**.
2. Baja hasta la sección **Créditos SMS**. Ahí verás los paquetes disponibles con su cantidad de mensajes y precio (algunos aparecen marcados como **Más popular**).
3. Elige el paquete que necesitas y presiona **Comprar**.
4. Se abre el pago de MercadoPago. Completa el pago como en cualquier compra en línea.
5. Al volver a Parallly verás el aviso "Procesando tu compra…": los créditos se **acreditan automáticamente en unos segundos** después de confirmarse el pago.

Solo el **administrador** de la cuenta puede comprar créditos, porque la compra se hace desde la página de Facturación.

## Cómo ver tu saldo y tu consumo

En la misma sección **Créditos SMS** de **Facturación** encuentras:

- Tu **saldo actual** ("créditos disponibles"), siempre visible en la parte superior de la sección.
- Los **SMS consumidos este mes**.
- Avisos automáticos: cuando tu saldo **baja de 50 créditos** aparece una alerta sugiriendo recargar, y cuando llega a **0** verás un aviso destacado para comprar un paquete.

Cada envío queda registrado internamente con su fecha y cantidad de créditos, así el saldo siempre refleja exactamente lo comprado menos lo consumido.

## Cómo enviar notificaciones SMS a tus clientes

Los SMS salen desde **Campañas** (menú lateral, sección **Crecimiento**):

1. Entra a **Campañas** y crea una nueva campaña.
2. Al elegir los canales de envío, selecciona **SMS** (si la opción está disponible en tu cuenta).
3. Escribe el texto del mensaje. El editor te muestra el contador de caracteres para que sepas cuántos segmentos usará.
4. Elige la audiencia y envía o programa la campaña.

Además de las campañas, también **consumen créditos** los envíos automáticos que tengas configurados por SMS, como **recordatorios de cita** y **secuencias de seguimiento**.

Lo que **no** consume créditos: los SMS que la plataforma te envía a ti por seguridad (por ejemplo, códigos de verificación). Tus créditos son solo para los mensajes que tu negocio envía a **tus clientes**.

## Por qué puede aparecer deshabilitado

Hay tres situaciones distintas:

- **No ves la sección "Créditos SMS" en Facturación, o no aparece SMS como canal en Campañas**: el servicio de SMS se habilita a nivel de la plataforma y puede estar desactivado temporalmente (por ejemplo, mientras se ajusta la cobertura en tu país). Mientras esté desactivado no se pueden comprar créditos ni enviar SMS. Tu **saldo se conserva intacto** y vuelve a estar disponible cuando el servicio se reactiva.
- **Te quedaste sin saldo**: los envíos por SMS simplemente **no salen** y **no se te cobra nada**. Compra un paquete y los próximos envíos saldrán con normalidad (los mensajes que no salieron por falta de saldo no se reenvían solos).
- **No eres administrador**: la compra de paquetes está en Facturación, que solo ve el administrador de la cuenta. Pídele a tu administrador que haga la recarga.

## Preguntas frecuentes

**¿Los créditos vencen?**
No tienen fecha de vencimiento: tu saldo se conserva hasta que lo consumas, incluso si el servicio de SMS se pausa temporalmente.

**¿La compra de créditos es una suscripción?**
No. Es un **pago único** por MercadoPago. Compras cuando quieres y recargas solo cuando lo necesitas.

**¿Mis clientes pueden responder el SMS?**
No. El SMS es de una sola vía. Si quieres conversar con tus clientes, usa los canales conversacionales (WhatsApp, Instagram, Messenger, Telegram, Email o el chat web).

**¿Por qué un solo mensaje me descontó varios créditos?**
Porque superó un segmento. El texto simple rinde ~160 caracteres por segmento; con tildes o emojis, ~70. Un mensaje largo se divide en varios segmentos y cada uno cuesta 1 crédito.

**¿Pagué y no veo los créditos?**
La acreditación es automática y suele tardar unos segundos tras confirmarse el pago. Refresca la página de **Facturación**; si después de unos minutos el saldo no aparece, escríbenos a soporte: https://parallly-chat.cloud/support

**¿Desde qué número salen los SMS?**
Los envía Parallly con un número emisor de la plataforma; no necesitas contratar ni conectar ningún proveedor de SMS propio.
