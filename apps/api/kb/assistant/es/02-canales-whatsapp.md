---
id: canales-whatsapp
title: "Conectar WhatsApp"
routes: ["/admin/channels", "/admin/channels/whatsapp", "/admin/channels/whatsapp/templates"]
roles: ["tenant_admin"]
keywords: ["whatsapp", "conectar whatsapp", "numero de whatsapp", "whatsapp business", "coexistencia", "app de whatsapp", "migrar numero", "plantillas", "templates", "plantilla whatsapp", "sincronizar chats", "historial de chats", "codigo qr", "verificacion", "meta", "facebook", "desconectar whatsapp", "ventana de 24 horas", "varias cuentas", "segundo numero", "requiere reautorizar", "ventana emergente bloqueada", "conexion con advertencias", "negocio no verificado", "cobro de meta", "meta cobra", "cuanto cuesta whatsapp", "medio de pago", "tarjeta en meta", "mensajes de servicio", "mil mensajes gratis", "tope de gasto", "envio pausado", "dejo de responder", "1 de octubre", "factura de meta"]
---

# Conectar WhatsApp

WhatsApp es el canal principal de Parallly: al conectarlo, tu agente de IA empieza a recibir y responder los mensajes de tus clientes en ese número, con tu catálogo, tu agenda y tu información de negocio. La conexión es oficial, a través de Meta (la empresa dueña de WhatsApp), y toma entre 5 y 20 minutos según el método que elijas.

## Antes de empezar

- Necesitas ser **administrador** de tu cuenta de Parallly; la administración de canales no está disponible para supervisores ni agentes.
- Necesitas una cuenta de Facebook con acceso al negocio en Meta Business Suite.
- Ten a mano el número de teléfono que vas a usar: debe poder recibir SMS o llamadas (no sirven números virtuales VoIP ni líneas premium).
- La pantalla **Canales** indica si WhatsApp está habilitado para tu cuenta.

## Cómo conectar tu número

1. En la barra lateral, sección **Administración**, entra a **Canales**.
2. En la tarjeta de **WhatsApp**, haz clic en **Conectar**.
3. Antes de las rutas aparece **"Antes de conectar WhatsApp"**: una lista corta con el número, el acceso a su código de verificación y la cuenta de Facebook. Marca los tres puntos y toca **Continuar**; hasta que los confirmes, el botón dice **Confirma los puntos para continuar**. Es un recordatorio, no una validación: nadie revisa tus datos ahí. El mismo paso aparece en el asistente **Conoce a tu agente** y en la pantalla de **WhatsApp**.
4. Verás la pantalla **"Elige tu método de conexión"** con tres rutas:
   - **WhatsApp Business App** (etiqueta **Coexistencia**, marcada **Recomendado**, ~20 min) — si ya usas la app de WhatsApp Business en tu teléfono y quieres conservarla junto con tus chats. Es la ruta que sugerimos; mira la sección siguiente.
   - **Número nuevo** (~5 min) — para un número que nunca se ha usado en WhatsApp. Es el camino más rápido si vas a estrenar línea.
   - **Migrar desde otro proveedor** (~15 min) — si ya usas WhatsApp con otra plataforma (Wati, 360dialog, Twilio, etc.) y quieres traer tu número sin tiempo fuera de línea.
5. Elige tu método y haz clic en **Conectar con Facebook**. Se abre una ventana de Meta.
6. Inicia sesión con tu cuenta de Facebook y selecciona (o crea) tu portafolio de Meta Business.
7. Selecciona o agrega tu cuenta de WhatsApp Business y el número de teléfono.
8. Verifica el número con un **código por SMS o llamada de voz** y aprueba los permisos.
9. Verás el progreso en pantalla: **Autorización → Conectando número → Activando WhatsApp**. Al terminar aparece "¡Conexión exitosa!" y tu agente ya responde en ese número.

> Tip: apenas conectes, la pantalla te muestra la tarjeta **"Probá tu agente"** con tu número. Escríbele un WhatsApp desde otro teléfono y mira cómo responde.

### Si la ventana de Meta no aparece

La autorización ocurre en una ventana emergente de Meta. Si al hacer clic no se abre nada,
o el botón se queda esperando, casi siempre es el navegador bloqueando ventanas
emergentes:

1. Permite las ventanas emergentes para `admin.parallly-chat.cloud` desde el ícono de
   bloqueo de la barra de direcciones.
2. Vuelve a hacer clic en **Conectar con Facebook**.
3. No cierres la ventana de Meta hasta ver el mensaje de conexión terminada. Si la
   cerraste a mitad de camino, empieza de nuevo desde **Canales**.

Este paso funciona mejor en una computadora: desde el celular la ventana de Meta se abre
como otra pestaña y es fácil perderla de vista.

### Conexión terminada con advertencias

A veces la conexión se completa pero queda algo pendiente del lado de Meta. En ese caso la
pantalla no muestra un éxito limpio: aparece una **tarjeta ámbar** con las advertencias.
Las más comunes:

- **Negocio no verificado en Meta** — el número queda conectado, con límites de envío más
  bajos, hasta que completes la verificación del negocio en Meta Business Suite.
- **Suscripción de webhook fallida** — Parallly no quedó suscrito a los mensajes entrantes
  de ese número, así que el agente podría no recibir nada. Reintenta la conexión y, si se
  repite, escríbenos a soporte.
- **Registro del número pendiente** — Meta terminó de dar de alta el número más tarde que
  el resto de la conexión. Suele resolverse solo en unos minutos; vuelve a la pantalla y
  confirma que el número quedó activo.
- **No pudimos traer tus plantillas** — la sincronización de plantillas falló. La conexión
  sirve igual; vuelve a sincronizarlas desde **Plantillas** cuando quieras.

Lee la advertencia antes de dar por terminada la puesta en marcha: la tarjeta ámbar
significa "conectado, pero revisa esto", no "todo listo".

## Modo coexistencia: mantén tu app de WhatsApp Business

Si hoy atiendes a tus clientes desde la app de WhatsApp Business en tu teléfono, no tienes que abandonarla. Con el método **WhatsApp Business App** (Coexistencia), tu número queda conectado a Parallly **y** sigue funcionando en tu teléfono al mismo tiempo: la IA responde desde la plataforma y tú puedes seguir chateando desde la app cuando quieras.

Pasos específicos de este método:

1. Inicia sesión con tu cuenta de Facebook y selecciona tu portafolio de Meta Business.
2. **Escanea el código QR desde tu app de WhatsApp Business** (como cuando vinculas WhatsApp Web).
3. **Autoriza la sincronización de historial y contactos**. Importante: tienes **24 horas** para autorizarla después de conectar; si se pasa el plazo, hay que repetir la conexión desde cero.

Requisitos: app de WhatsApp Business actualizada (versión 2.24.17 o superior), número con al menos 7 días de actividad en la app y una conexión WiFi estable (la sincronización puede tardar varias horas).

**Qué se sincroniza con Parallly:**

- Chats individuales de los últimos **6 meses** (texto)
- Imágenes, videos y audios de los últimos 14 días
- Tus contactos guardados en la app
- Los mensajes nuevos que envíes desde la app, en tiempo real

**Qué NO se sincroniza:** chats grupales, mensajes temporales o de "ver una vez", archivos multimedia con más de 14 días y el catálogo de productos de la app.

**Limitaciones del modo coexistencia:**

- Debes **abrir la app de WhatsApp Business al menos cada 14 días** para mantener la conexión activa.
- Los dispositivos vinculados (WhatsApp Web/Desktop) se desconectan al activar; puedes reconectarlos después.
- Las listas de difusión de la app pasan a modo de solo lectura.
- La velocidad de envío es algo menor (~20 mensajes por segundo), suficiente para la gran mayoría de negocios.

## Estados del canal

En **Canales**, cada tarjeta muestra el estado de la conexión:

- **Conectado** — el número está activo y el agente responde.
- **Conectado** + **Reconectar: credenciales vencidas** — la tarjeta muestra las dos
  etiquetas a la vez: la verde de siempre y, al lado, una roja. La conexión existe, pero el
  permiso que Parallly usa para enviar está vencido, revocado, con error o ya no está. El
  número puede seguir recibiendo mensajes y las respuestas no salen hasta que vuelvas a
  autorizar desde **Conectar**. **Salud de agentes** lo reporta como una conexión operativa afectada y lo
  trata como acción crítica del agente.
- **Desconectado** — todavía no hay conexión, o se desconectó.

Al entrar a **WhatsApp** con un número conectado verás la tarjeta **Canal Activo** con el **Número**, el **Nombre verificado** y la **Calidad** (la calificación que Meta le da a tu número según cómo reciben tus mensajes los clientes; mantenerla "alta" te da mejores límites de envío). También encontrarás la tarjeta **Perfil de negocio** con el botón **Gestionar perfil** para editar la información que tus clientes ven en WhatsApp.

## Lo que Meta le cobra a tu cuenta de WhatsApp

Desde el **1 de octubre de 2026**, Meta le cobra a **tu propia cuenta de WhatsApp Business** cada **mensaje de servicio entregado**: las respuestas del agente y las de tu equipo dentro de la ventana de 24 horas. Lo que te escriben tus clientes sigue sin costo.

Ese cobro **no es de Parallly**. Ante Meta, Parallly es proveedor de tecnología: no te factura los mensajes, no se los paga a Meta por vos y no los incluye en tu suscripción. Son dos pagos distintos y ninguno reemplaza al otro:

- **Tu suscripción a Parallly** — el software. Se gestiona en **Administración → Plan y facturación**.
- **Los mensajes que WhatsApp entrega** — se los paga tu negocio a Meta, con el medio de pago cargado en **tu** cuenta de WhatsApp Business.

Cambiar de plan en Parallly no cambia lo que Meta cobra.

### El medio de pago se carga en Meta, no en Parallly

Se agrega desde las herramientas de Meta (WhatsApp Manager → configuración de la cuenta → **Facturación y pagos**), con un usuario que administre esa cuenta de WhatsApp Business. Si tu portafolio de Meta ya tiene un medio de pago cargado —por ejemplo para anuncios—, puedes elegirlo para esta cuenta sin volver a cargarlo.

**Parallly nunca te pide el número de una tarjeta por chat**: ni el agente, ni Parallly Assist, ni soporte. Si alguien te lo pide dentro de una conversación, no somos nosotros.

### Sin medio de pago, el número deja de entregar

No es que funcione peor: desde el 1 de octubre de 2026, una cuenta de WhatsApp Business sin medio de pago **deja de entregar los mensajes de servicio**, aunque no hayas gastado nada ese mes. Visto desde afuera es un agente que dejó de responder.

Lo que sigue funcionando: los mensajes que entran se reciben, se guardan y aparecen en el **Inbox**. La conversación no se pierde; lo que no sale es la respuesta.

### Cómo saber si tu número está listo

1. Entra a **Canales → WhatsApp** y mira la tarjeta **Cobro de WhatsApp (Meta)**: ahí aparece si algún número quedó con el envío pausado.
2. Confirma en las herramientas de Meta que **esa** cuenta de WhatsApp Business tiene medio de pago, moneda y zona horaria definidas. Las tres hacen falta: si falta una, el cobro no se puede hacer.
3. **Una tarjeta cargada no garantiza que el cobro se apruebe.** Meta puede decir que hay medio de pago y el banco rechazarlo igual: tarjeta vencida, sin compras internacionales habilitadas, sin cupo o con datos fiscales incompletos. "Cargada" sólo significa que eso no es lo que falta.

### Los 1.000 mensajes de servicio gratis

Cada **número** recibe **1.000 mensajes de servicio gratis por mes calendario**. Meta cobra a partir del mensaje 1.001.

Lo que la cuota **no** es:

- **No es por país.** Un número que atiende nueve países tiene mil gratis en total, no mil por país.
- **No es por contacto ni por conversación.** Se cuentan mensajes entregados, no personas.
- **No cubre plantillas.** Las plantillas de marketing, utilidad y autenticación se cobran aparte y no consumen la cuota.
- **No se acumula.** Lo que no uses este mes no pasa al siguiente.
- **No es por cuenta ni por plan.** Es por número: si tienes dos números conectados, cada uno trae su propia cuota.

El mes se cierra en la **zona horaria de tu cuenta de WhatsApp Business**, que puede no ser la tuya. Si en Parallly ves un período de 30 días y en Meta un mes calendario, están midiendo cosas distintas.

### Qué ves en Parallly, y qué no

En **Canales → WhatsApp**, la tarjeta **Cobro de WhatsApp (Meta)** muestra cuánto llevas de la cuota gratis, el gasto del período separado por moneda, a dónde se fue y qué números están pausados. La lee sólo el **administrador**: **Canales** es una pantalla de administración, no aparece en el menú de supervisores ni de agentes y, si escriben la dirección, el panel los redirige. Quien no sea administrador y necesite el dato tiene que pedírselo. Reanudar un número también es del administrador.

Es la medición de **lo que Parallly envió** por esa conexión, no una copia de la factura de Meta. La factura la emite Meta y se consulta en las herramientas de Meta.

### Qué puede y qué no puede un tope de gasto

Un tope de gasto acota **lo que Parallly envía** por esa conexión durante el período. El medidor empieza en **Sólo observar**: cuenta, avisa y **no frena ningún envío**. Parallly crea valores iniciales de **2.000 entregas por número** y **60 por contacto** cada mes. Un administrador puede activar **Protección de gasto** en **Canales → WhatsApp** después de revisar la medición; desde ese momento se pausa lo proactivo cerca del tope y se detiene el alcance que lo agote.

Y aun activo, hay tres cosas que un tope **no** puede prometer:

- **No limita lo que otra herramienta le cobra a la misma cuenta.** Si otro sistema —o tu equipo desde la app de WhatsApp Business— envía por esa misma cuenta de WhatsApp Business, ese consumo va a la misma factura de Meta y Parallly no lo ve ni lo puede frenar.
- **No es un límite que Meta aplique.** Meta no conoce tu tope: sigue entregando y cobrando lo que le llegue, venga de donde venga.
- **No baja la tarifa.** Corta volumen, no el precio por mensaje.

### Si un número queda con el envío pausado

Cuando Meta responde que esa cuenta **no puede facturarse**, Parallly pausa los envíos cobrables **de ese número** —sólo de ese, no del resto— y no reintenta: cada intento sería idéntico y fallaría igual hasta que alguien haga algo del lado de Meta.

1. En **Canales → WhatsApp** vas a ver **Envío pausado**, con el motivo y desde cuándo.
2. Arregla el medio de pago en las herramientas de Meta.
3. Vuelve a Parallly y toca **Reanudar envíos** (sólo administrador). Es tu declaración de que lo arreglaste, no una comprobación: si Meta vuelve a rechazar el cobro, el número se pausa solo en el siguiente intento y el motivo aparece otra vez ahí.

Mientras dura la pausa, los mensajes que entran se siguen recibiendo.

## Plantillas de WhatsApp

WhatsApp permite responder libremente durante las **24 horas** siguientes al último mensaje del cliente. Para escribirle **fuera** de esa ventana — por ejemplo un recordatorio de cita o una campaña — necesitas una **plantilla aprobada por Meta**.

Para gestionarlas: **Canales → WhatsApp → Ver todas las plantillas** (la página **Plantillas de WhatsApp**).

- **Sincronizar desde Meta** — trae a Parallly las plantillas que ya tengas aprobadas en tu cuenta.
- **Crear plantilla** — crea una nueva sin salir de Parallly: nombre, idioma, categoría, cuerpo con variables (por ejemplo `{{1}}` para el nombre del cliente), encabezado, pie y hasta 3 botones, con vista previa en vivo. Al terminar, haz clic en **Enviar a Meta**; Meta determina el estado y el tiempo de revisión.
- Cada plantilla muestra su estado: **Aprobada**, **Pendiente** o **Rechazada** (con el motivo del rechazo para que la corrijas y la vuelvas a enviar).
- Al conectar WhatsApp, Parallly envía automáticamente **4 plantillas semilla** ya validadas (recordatorio de cita, confirmación de asistencia, confirmación de pedido y pago recibido) para que tengas con qué empezar.

## ¿Más de un número de WhatsApp?

Puedes conectar varios números cuando tu cuenta tenga capacidad. La tarjeta de WhatsApp muestra el uso actual y el botón **Agregar otra** mientras haya cupo. Consulta el límite vigente en **Plan y facturación**.

Cada conexión es independiente: tiene su propio agente de IA (lo asignas en el editor del agente) y sus conversaciones no se mezclan. En un borrador de campaña puedes indicar el número emisor previsto, pero no lances campañas reales desde el editor actual: la vinculación exacta de plantilla/emisor y la cancelación todavía no están certificadas de punta a punta. Si necesitas más números que los permitidos por la configuración vigente de tu cuenta, escríbenos a [soporte](https://parallly-chat.cloud/support).

## Cómo desconectar un número

1. Entra a **Canales**, abre **WhatsApp** y elige la conexión que quieres quitar.
2. Haz clic en **Desconectar** y confirma. Si tienes varios números, los demás siguen activos.
3. El resultado se muestra con un color:
   - **Verde** — desconectado completamente.
   - **Amarillo** — se desconectó en Parallly, pero conviene revisar también en Meta Business Suite que la integración quedó cerrada.
   - **Rojo** — hubo un error de red; intenta de nuevo.

## Preguntas frecuentes

**¿Puedo seguir usando WhatsApp Business en mi teléfono?**
Sí, con el modo **Coexistencia**: la IA responde desde Parallly y tú conservas la app. Solo recuerda abrirla al menos cada 14 días.

**¿Pierdo mis chats anteriores al conectar?**
No, si conectas por coexistencia: se sincronizan hasta 6 meses de chats de texto y tus contactos. Si migras desde otro proveedor, el historial de ese proveedor no se transfiere.

**¿Necesito plantillas para que el agente responda?**
No. El agente responde libremente dentro de la ventana de 24 horas tras el último mensaje del cliente. Las plantillas solo hacen falta para iniciar tú la conversación fuera de esa ventana.

**¿Por qué mi plantilla fue rechazada?**
Meta revisa el contenido. En la página de plantillas verás el **motivo del rechazo**; corrige el texto (evita lenguaje promocional agresivo en plantillas de utilidad) y vuelve a enviarla.

**¿Quién puede conectar o desconectar WhatsApp?**
Solo el **administrador** de la cuenta. Supervisores y agentes no entran a **Canales**: ahí no ven el estado de la conexión ni pueden cambiarlo. Lo que sí ve un supervisor es si un canal asignado al agente quedó sin conectar, en **Salud de agentes**.

**¿Puedo tener un agente distinto en cada número?**
Sí. La regla es un agente de IA por conexión: por ejemplo, un agente de ventas en un número y uno de soporte en otro. Se asigna en el editor del agente.

**¿Parallly me cobra los mensajes de WhatsApp?**
No. Desde el 1 de octubre de 2026 Meta le cobra a tu cuenta de WhatsApp Business cada mensaje de servicio entregado, con el medio de pago que cargaste en Meta. Tu suscripción a Parallly es un pago aparte y no cambia por esto.

**¿Le doy mi tarjeta a Parallly para pagar WhatsApp?**
No, y nadie de Parallly te la va a pedir por chat. El medio de pago de WhatsApp se carga en las herramientas de Meta, sobre tu propia cuenta de WhatsApp Business.

**¿Los 1.000 mensajes gratis son por cuenta o por número?**
Por número y por mes calendario, sin acumulación. No son por país, no son por contacto y no cubren plantillas.

**¿Instagram y Messenger también se cobran por mensaje?**
Hoy no. El cobro por mensaje de servicio que empieza el 1 de octubre de 2026 es de WhatsApp; Instagram, Messenger y Telegram no tienen un cobro por mensaje de servicio de su proveedor.

¿Te quedó alguna duda? Escríbenos en [soporte](https://parallly-chat.cloud/support).
