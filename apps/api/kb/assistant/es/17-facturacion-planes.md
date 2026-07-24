---
id: facturacion-planes
title: "Planes, facturación y datos fiscales"
routes: ["/admin/settings/billing", "/admin/settings/fiscal"]
roles: ["tenant_admin"]
keywords: ["planes", "precios", "facturacion", "pago", "mercadopago", "tarjeta", "cambiar plan", "mejorar plan", "prueba gratis", "anual", "mensual", "factura", "historial de pagos", "datos fiscales", "nit", "cedula", "dian", "limite del plan", "creditos sms", "cupon"]
---

# Planes, facturación y datos fiscales

Todo lo relacionado con tu suscripción vive en una sola página: en el menú lateral, sección **GESTIÓN**, entra a **Facturación**. Ahí ves tu plan actual, cambias de plan, administras tu tarjeta, consultas tu historial de pagos y compras créditos SMS. Solo el rol de administrador puede ver y modificar la facturación.

## Los 5 planes

| Plan | Precio mensual | Agentes IA | Mensajes IA/mes | Usuarios | Contactos | Calendarios | Canales |
|------|----------------|------------|-----------------|----------|-----------|-------------|---------|
| **Emprendedor** | USD $21 | 1 | 1.000 | 1 | 100 | 1 | Solo WhatsApp |
| **Starter** | USD $49 | 1 | 5.000 | 3 | 500 | 1 | WhatsApp, Instagram, Messenger, Email y chat web |
| **Pro** | USD $129 | 3 | 25.000 | 5 | 5.000 | 3 | Todos |
| **Enterprise** | USD $349 | 10 | 100.000 | Ilimitados | 50.000 | 10 | Todos |
| **Custom** | A cotizar | Ilimitados | Ilimitados | Ilimitados | Ilimitados | Ilimitados | Todos |

Algunos detalles útiles:

- **Emprendedor** es el plan de entrada: solo WhatsApp, sin automatizaciones ni campañas. Ideal para arrancar y luego subir.
- **Starter** desbloquea más canales, 5 reglas de automatización y 3 campañas por mes.
- **Pro** suma Telegram, automatizaciones y campañas ilimitadas, y hasta **2 números de WhatsApp** conectados a la vez (cada conexión con su propio agente de IA).
- **Enterprise** permite hasta 3 números de WhatsApp, 2 cuentas de Instagram y soporte prioritario.
- **Custom** es a la medida: precio y límites se acuerdan con el equipo de Parallly.
- Recuerda: hay **un agente de IA por conexión**. Si tienes 2 números de WhatsApp, cada número tiene su agente; cuántas conexiones del mismo tipo puedes tener depende de tu plan.
- Los precios se muestran en tu **moneda local** cuando está disponible (por ejemplo, pesos colombianos); si no, verás el equivalente en USD.
- El SMS no es un canal de conversación: son **notificaciones salientes que funcionan con créditos** (1 crédito = 1 segmento de SMS). Ver más abajo.

## Prueba gratis

- **Emprendedor y Starter**: 7 días de prueba, **sin tarjeta**.
- **Pro y Enterprise**: 15 días de prueba, **con tarjeta** (no se cobra hasta que termina la prueba).
- Tu cuenta arranca con la prueba del plan Emprendedor al registrarte.
- 3 días antes de que termine la prueba recibes un email recordatorio. Si la prueba vence sin tarjeta, la cuenta queda como **Vencida**: pierdes el acceso, pero **tus datos se conservan** y todo vuelve al pagar.

## Ciclo mensual o anual

Cada plan de pago puede cobrarse en ciclo **Mensual** o **Anual**. El anual aplica un **descuento de ~15%** sobre el total del año.

1. Entra a **GESTIÓN → Facturación**.
2. Usa el selector **Mensual / Anual**: al elegir Anual, las tarjetas de plan muestran el precio anual y el ahorro.
3. Para cambiar el ciclo de una suscripción activa, usa **Cambiar a anual** (o **Cambiar a mensual**). El cambio de ciclo es **inmediato**: se cierra la suscripción actual y se crea una nueva con el ciclo elegido.

## Cómo mejorar o bajar de plan

1. Entra a **GESTIÓN → Facturación** y baja hasta **Planes disponibles**.
2. En la tarjeta del plan que quieres, haz clic en **Mejorar a…** (subir) o **Bajar a…** (bajar).
3. Si **subes de plan**: se pide tarjeta y el cobro del nuevo plan es inmediato. Los nuevos límites aplican al instante.
4. Si **bajas de plan**: el cambio queda **programado para el final de tu período actual**, sin cobro adicional. Conservas todas tus funciones hasta esa fecha, y puedes arrepentirte con el botón **Mantener mi plan**.

## Método de pago (MercadoPago)

Los cobros se procesan con **MercadoPago**. Tu tarjeta se guarda de forma segura (Parallly nunca ve el número completo).

Para cambiar de tarjeta:

1. En **GESTIÓN → Facturación**, haz clic en **Cambiar tarjeta**.
2. Ingresa los datos de la nueva tarjeta en la ventana segura de MercadoPago.
3. Haz clic en **Guardar nueva tarjeta**. El próximo cobro usará la tarjeta nueva.

### Si un cobro falla

Cuando un pago es rechazado, tu suscripción queda en estado **Pago pendiente** y recibes un email con instrucciones. Tienes dos caminos:

- **Cambiar la tarjeta** y esperar el reintento automático.
- Hacer clic en **Reintentar cobro ahora** para forzar la verificación al instante.

Si después de **7 días** el pago no se recupera, la cuenta se suspende temporalmente. Tus datos se conservan por 90 días y todo se reactiva al pagar.

## Historial de pagos y facturas

En la misma página de **Facturación**, la sección **Historial de facturas** muestra tus últimos pagos con **Fecha**, **Monto** (en la moneda del cobro) y **Estado** (Exitoso, Fallido, Reembolsado o Pendiente). Cuando hay factura disponible, aparece el botón **Descargar**.

## Pausar o cancelar

- **Pausar suscripción**: para tomar un descanso sin cancelar. No se te cobra mientras está pausada y vuelves con **Reanudar** (el próximo cobro mantiene tu fecha original). Los límites del plan siguen aplicando durante la pausa.
- **Cancelar al final del periodo**: conservas el acceso hasta la fecha de fin de tu ciclo actual.
- **Cancelar ahora**: el acceso termina de inmediato, sin reembolso del período en curso.

## Cupones promocionales

Si recibiste un código promocional, en **Facturación** busca la sección **Código de cupón**, pega el código y haz clic en **Aplicar**. Hay cupones de porcentaje de descuento, de monto fijo y de meses gratis (extienden tu prueba). Si el cupón no entra, el mensaje te dirá por qué (vencido, ya usado, no aplica a tu plan, etc.).

## Créditos SMS (notificaciones a tus clientes)

El envío de SMS funciona con **créditos prepagados**: 1 crédito = 1 segmento de SMS. En **Facturación**, la sección **Créditos SMS** muestra tu saldo disponible y lo consumido en el mes.

1. Elige un paquete de créditos y haz clic en **Comprar**.
2. Paga con MercadoPago como **pago único** (no es una suscripción).
3. Los créditos se acreditan automáticamente en unos segundos.

Los paquetes y precios los define la plataforma y pueden variar por país. Si la función de SMS está desactivada a nivel plataforma, la sección no permite comprar ni enviar.

## Datos fiscales para Colombia (NIT o cédula) y facturas DIAN

Si tu negocio está en Colombia, Parallly emite **factura electrónica DIAN** de tus cobros. Para que la factura salga a nombre de tu negocio, completa tu perfil fiscal:

1. En el menú lateral, entra a **Configuración**.
2. En la sección **Empresa**, abre **Facturación electrónica**.
3. Completa: tipo de organización (persona jurídica o natural), **tipo y número de documento** (NIT o cédula; el dígito de verificación del NIT se calcula solo), responsabilidad de IVA, razón social o nombres, municipio, dirección, email y teléfono.
4. Guarda los cambios.

En esa misma página ves el **historial de facturas emitidas** (número, estado, monto, PDF/XML) y puedes reintentar una factura que haya quedado pendiente.

> **Importante:** si no completas tus datos fiscales, tus facturas se emiten a nombre de "Consumidor Final" y **no te sirven para deducción de impuestos**. La página de Facturación te lo recuerda con los accesos **Ver datos fiscales** / **Completar datos fiscales**.

## Qué pasa al llegar a un límite

La página de **Facturación** muestra barras de uso de tu plan: mensajes IA del mes, procesamiento multimedia (audios e imágenes) y base de conocimiento.

- Al **80%** de uso ves una advertencia ámbar; al **95%**, una alerta roja con el botón **Mejorar plan**.
- Si alcanzas el límite de un recurso (contactos, agentes, campañas, etc.), la plataforma te avisa con un mensaje del tipo "Has alcanzado el límite de tu plan actual" y no podrás crear más de ese recurso hasta subir de plan o liberar espacio.
- Si se agota el límite de **multimedia**, tu agente sigue respondiendo, pero los audios e imágenes se registran de forma genérica, sin transcripción ni análisis.
- Los contadores mensuales se reinician el primer día de cada mes.

## Preguntas frecuentes

**¿Puedo cambiar de plan cuando quiera?**
Sí. Las subidas aplican al instante (con cobro inmediato); las bajadas quedan programadas para el final de tu período, sin cobro extra.

**¿Qué pasa con mis datos si dejo de pagar o cancelo?**
Se conservan. La cuenta queda bloqueada, pero al reactivar el pago recuperas todo tal como estaba.

**¿Puedo pagar en mi moneda local?**
El precio se muestra en tu moneda cuando hay tarifa local (Colombia, por ejemplo). El cobro lo procesa MercadoPago con la tarjeta que registres.

**¿La prueba gratis me pide tarjeta?**
Emprendedor y Starter no. Pro y Enterprise sí, pero no se cobra nada hasta que termina la prueba.

**¿Cómo obtengo mi factura?**
En **Facturación → Historial de facturas**, botón **Descargar**. Si estás en Colombia y completaste tus datos fiscales, además recibes la factura electrónica DIAN (PDF/XML) en **Configuración → Facturación electrónica**.

¿Dudas con un cobro? Escríbenos en https://parallly-chat.cloud/support — el equipo de Parallly te ayuda con gusto.
