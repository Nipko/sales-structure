# Comunicación del cambio de pagos de WhatsApp en octubre de 2026

Investigación y materiales preparados el **30 de septiembre de 2026** para Parallly. El cambio entra en vigor el **1 de octubre de 2026**, según la zona horaria de la cuenta de mensajes en Meta. Este paquete contiene borradores para revisión y distribución; no acredita publicación, envío ni lectura por los clientes.

## Decisión recomendada

Comunicar hoy por **correo a los usuarios de Parallly y aviso en el dashboard**, con prioridad de seguimiento a los administradores que tienen WhatsApp conectado. Compartir la guía PDF mediante su enlace y mantenerla visible en el proceso de nuevas conexiones. Un video breve puede complementar la guía; no conviene retrasar el aviso hasta grabarlo.

Mensaje central: **revisa o agrega un método de pago válido en la cuenta de WhatsApp correspondiente en Meta para mantener las entregas cuando sean cobrables**. El 30 de septiembre es la fecha de preparación indicada por Meta; no significa que después sea imposible agregarlo ni que se elimine la cuenta.

## Qué confirmó Meta

Las páginas oficiales de precios y del anuncio se leyeron directamente en el navegador; ambas mostraron actualización del 28 de septiembre de 2026. La herramienta de búsqueda devolvió errores de acceso, por lo que se verificó el contenido completo en el sitio oficial.

| Tema | Consecuencia desde el 1 de octubre |
| --- | --- |
| Respuestas sin plantilla por WhatsApp Business Platform | Los mensajes de servicio tienen un cupo de 1.000 entregas por número de negocio y mes. Se cobran las que exceden ese cupo. |
| Cuenta sin método de pago | Meta entrega dentro del cupo gratuito, pero deja de entregar mensajes de servicio cuando se agota. |
| Conteo | Son mensajes entregados, no conversaciones ni clientes. El cupo se renueva mensualmente y no se acumula. |
| Plantillas de utilidad dentro de las 24 horas | Pasan a ser cobrables; el cupo anterior corresponde a servicio, no a estas plantillas. Aplican las excepciones gratuitas que Meta documenta. |
| Mensajes entrantes del cliente | Meta no cobra por recibirlos. |
| Respuestas del equipo y de la IA de Parallly por la API | El anuncio incluye personas e IA de terceros dentro de servicio cuando responden sin plantilla. |
| Ventana de atención de 24 horas | Sigue siendo necesaria para enviar mensajes sin plantilla. Agregar una tarjeta no amplía esa ventana. |

Fuentes: [Precios de WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) y [Anuncio de los cambios de servicio y utilidad](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages).

El cambio corresponde a WhatsApp Business Platform. El aviso no debe pedir configurar pagos de WhatsApp a quien solo usa Instagram, Messenger, Telegram o Web Chat. Puede informarles de que deberán revisar este requisito al conectar WhatsApp.

### Costos y excepciones que debe conocer soporte

- La tarifa depende del mercado del destinatario y de la moneda de facturación. Usar las hojas **vigentes desde el 1 de octubre de 2026**, no una tarifa universal ni la tabla anterior de julio. No se extrajeron tarifas monetarias en esta investigación.
- Servicio no tiene descuentos por niveles de volumen, según el anuncio oficial.
- Las reacciones quedan fuera del cupo de servicio. Hay exenciones para gobiernos y organizaciones sin fines de lucro que Meta identifique como elegibles; no prometerlas solo por el tipo de negocio.
- Los puntos de entrada gratuitos tienen reglas propias. La página actualizada de precios describe intervalos que pueden extenderse hasta siete días. Evitar copiar de blogs la afirmación universal de 72 horas; la elegibilidad de una conversación debe verificarse en Meta.
- La cuota por número es compartida; si se usan grupos u otras cuentas de mensajes con el mismo número, no presentar el contador local de Parallly como el consumo total de Meta. Una entrega grupal consume una unidad por destinatario que recibe el mensaje.
- Las tarifas por tokens de **Meta Business Agent** corresponden a ese producto de Meta. No trasladar sus cifras a los agentes de Parallly.
- Meta mantiene una [política separada para proveedores de IA](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers/), incluidos asistentes de propósito general. Usar IA para atender un negocio no basta para deducir automáticamente esa clasificación. Si Meta clasifica una cuenta bajo esa política, revisar su tratamiento particular.
- El mismo 1 de octubre hay ajustes de tarifas por mercado: entre los relevantes para Latinoamérica, marketing en México y utilidad/autenticación en Perú aumentan. Consultar la hoja por mercado y moneda antes de cotizar.

Las reglas de cupo, excepciones y mercados se documentan en [Precios de Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing). La diferenciación entre servicio y Meta Business Agent y la ausencia de niveles de volumen para servicio se documentan en el [anuncio oficial](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages).

## Cómo agregar o comprobar el método de pago

Ruta oficial comprobada en la [ayuda de Meta para agregar una tarjeta](https://www.facebook.com/business/help/488291839463771):

1. Entrar con un usuario que tenga permiso **Administrar cuenta de WhatsApp**.
2. Abrir [Administrador de WhatsApp](https://business.facebook.com/wa/manage/home/).
3. Identificar la cuenta de WhatsApp conectada a Parallly. Abrir **⋯ → Administrar la configuración de la cuenta**.
4. Ir a **Configuración → Configuración de pago**.
5. En **Facturación y pagos**, elegir **Añadir método de pago**.
6. Completar la información solicitada, los datos de la tarjeta y los datos de la empresa; guardar cada paso.
7. Comprobar que el método figure asociado a **esa cuenta de WhatsApp**, revisar los avisos de Meta y resolver cualquier validación o rechazo.
8. Volver a Canales → WhatsApp en Parallly y usar la acción de comprobación del método de pago, disponible para un administrador autorizado. Revisar el resultado para ese número y cualquier pendiente de zona horaria, registro o webhooks.
9. Como comprobación operativa recomendada, escribir desde otro teléfono al número del negocio y confirmar que una respuesta desde Parallly llega al destinatario. Una prueba dentro del cupo gratuito acredita entrega, pero por sí sola no acredita facturación configurada.

El [acceso directo al centro de facturación](https://business.facebook.com/latest/billing_hub/payment_methods/) es apropiado como botón del correo. El cliente debe seleccionar el portfolio y la cuenta correctos. La documentación reciente también usa el término «cuenta de mensajes»; no se verificó la interfaz autenticada de cada cliente ni se promete que todos vean las mismas etiquetas.

### Si ya hay una tarjeta en Meta

La [ayuda de Meta sobre tarjetas existentes](https://www.facebook.com/business/help/3146639885655187) exige asignarla a la cuenta de WhatsApp y seleccionarla como principal. Ruta: [Cuentas de WhatsApp](https://business.facebook.com/settings/whatsapp-business-accounts) → cuenta → Configuración → Configuración de pago → Agregar método → tarjeta existente → Elegir como principal → datos de empresa → Listo.

Para administrar tarjetas del portfolio se requiere control total del portfolio o permiso de finanzas; para asociarlas a WhatsApp, permiso para administrar esa cuenta. Una tarjeta de publicidad o una tarjeta registrada para pagar Parallly no acredita esta asociación.

Si un proveedor gestiona los cargos mediante una línea de crédito u otro acuerdo de facturación, confirmar con ese responsable que la cuenta está cubierta antes de agregar un método distinto. No pedir una nueva tarjeta a todas las cuentas sin conocer su situación.

### Problemas frecuentes

- **No veo la cuenta:** verificar el portfolio propietario y la cuenta conectada, especialmente si hay varios números.
- **No veo la opción de pago:** solicitar al administrador los permisos indicados por Meta.
- **Meta rechaza la tarjeta:** revisar los datos y las opciones que ofrece Meta para esa cuenta; consultar el rechazo con el banco o Meta. La ayuda consultada menciona Visa/Mastercard; no prometer aceptación de cualquier tarjeta o país.
- **Ya agregué el método y hay mensajes fallidos:** revisar los avisos de Meta, probar una entrega nueva y revisar los fallidos con soporte. No prometer su reenvío automático.
- **Necesito ayuda:** [it.executive@parallext.com](mailto:it.executive@parallext.com). Pedir el número afectado y el texto del error. El cliente debe ingresar la tarjeta directamente en Meta; no solicitar CVV, número completo de tarjeta o códigos bancarios por correo o chat.

## Nuevas conexiones a Parallly

Flujo de cliente recomendado, basado en el código actual:

1. Abrir [Canales → WhatsApp](https://admin.parallly-chat.cloud/admin/channels/whatsapp).
2. Elegir el flujo que corresponda al número y completar **Conectar con Facebook**, que abre el registro de Meta. Seguir las indicaciones para seleccionar o crear la cuenta y registrar el número.
3. Al terminar el registro, revisar el estado de preparación mostrado por Parallly: método de pago, zona horaria de facturación y posibles pendientes del registro. Si falta el pago o no se pudo confirmar, abrir la configuración de **la misma cuenta** en Meta y completar la guía anterior.
4. Volver a Parallly y usar la comprobación del método de pago con un administrador autorizado. Resolver los pendientes mostrados; una lectura desconocida no demuestra que falte la tarjeta.
5. Configurar, probar y publicar el agente asignado a esa conexión. Completar una prueba real de recepción y respuesta. Conectar un canal no publica por sí solo un agente.

Los flujos de número nuevo, coexistencia y migración requieren revisar qué cuenta soporta los cargos al finalizar. Una cuenta de prueba o sandbox no acredita que un número de producción tenga pagos habilitados. No desconectar ni recrear una cuenta existente solo para registrar una tarjeta.

**Estado comprobado tras la integración remota:** el registro técnico de una conexión y su preparación para responder se muestran por separado. Parallly dispone de `GET /whatsapp/spend/funding-readiness` para leer evidencia por número y `POST /channels/whatsapp/connection/check-funding` para consultar a Meta con un administrador autorizado. El estado final de conexión combina ese resultado con la zona horaria y los pendientes del registro; no debe describirse como una plataforma sin comprobación de pagos.

La consulta pide `primary_funding_id` de la cuenta de WhatsApp correspondiente. `attached` significa que Meta devolvió un identificador de financiación; no garantiza solvencia ni entrega. Una respuesta explícita sin financiación puede clasificarse `absent`; errores, permisos insuficientes o un campo omitido quedan `unknown`. Un rechazo de elegibilidad de cobro observado puede marcar `restricted` y prevalece sobre una lectura anterior. `not_checked` indica que todavía no se ha establecido el dato.

La regla comercial de Meta actualizada el 28 de septiembre cobra el excedente del cupo de servicio. Parallly conserva una evaluación técnica conservadora: una ausencia confirmada se informa como falta de preparación desde el 1 de octubre, y la interfaz puede mantener pendientes si no logra confirmarla. Las pausas activas y otros problemas técnicos también pueden impedir respuestas. **El cupo gratuito no es una promesa de que un número con pendientes vaya a enviar desde Parallly.** Resolver el estado mostrado y verificar una entrega real.

Referencias del repositorio:

- `apps/api/src/modules/whatsapp/services/whatsapp-connection.service.ts`, registro local y consulta `checkFunding` a Meta.
- `apps/api/src/modules/billing/whatsapp-spend/whatsapp-spend.controller.ts`, lectura de evidencia guardada por número.
- `apps/api/src/modules/channels/whatsapp-funding-readiness.ts` y `apps/api/src/modules/billing/whatsapp-spend/account-send-readiness.ts`, clasificación y preparación técnica. La regla comercial comunicada aquí se basa en la fuente oficial del 28 de septiembre, no en comentarios históricos de esos archivos.
- `apps/dashboard/src/app/admin/channels/whatsapp/WhatsAppEmbeddedSignup.tsx`, inicio del registro.
- `apps/dashboard/src/app/admin/channels/whatsapp/WhatsAppConnectedState.tsx` y `WhatsAppPaymentMethodNotice.tsx`, resultado del registro y acción de comprobación.
- `apps/whatsapp/src/modules/onboarding/onboarding.service.ts`, orquestación de la conexión.
- `apps/dashboard/src/app/admin/channels/whatsapp/WhatsAppRouteBrief.tsx`, orientación previa al registro.
- `apps/dashboard/src/components/channels/WhatsappFundingPanel.tsx`, evidencia y comprobación desde la configuración del canal.

## Materiales del paquete

- `output/pdf/parallly-guia-pagos-meta-whatsapp.pdf`: guía para clientes, con enlaces oficiales.
- `email-es.html`, `email-en.html`, `email-pt.html`, `email-fr.html`: correo preparado en los cuatro idiomas.
- `email-es.txt`, `email-en.txt`, `email-pt.txt`, `email-fr.txt`: alternativas de texto plano.
- `messages.json`: textos editables del correo, aviso y orientación para nuevas conexiones.
- `render-email.mjs`: genera los correos desde los textos traducidos.
- `build_guide.py`: genera la guía PDF.

Los nombres de archivos de correo y generadores son relativos a esta carpeta. El PDF está en la carpeta `output/pdf` de la raíz del repositorio. No se ha grabado un video ni se han publicado estos archivos en una URL pública.

Para regenerar la guía y su copia pública desde la raíz del repositorio, ejecutar
`python docs/communications/meta-whatsapp-2026-10/build_guide.py --copy-public`.
Requiere ReportLab. Renderizar las tres páginas y revisar su presentación antes de
distribuir; la copia pública debe ser idéntica a la de `output/pdf`.

## Avisos listos para copiar

### Aviso urgente del 30 de septiembre

**WhatsApp: revisa hoy tus pagos en Meta**

Desde el 1 de octubre de 2026, Meta cobrará los mensajes de servicio que superen 1.000 entregas por número al mes. Sin un método de pago, dejará de entregar los que excedan ese cupo. Revisa hoy, 30 de septiembre, la cuenta de WhatsApp conectada a Parallly. Los pagos de Meta son independientes de tu suscripción.

Botones propuestos: **Revisar pagos en Meta** y **Ver guía paso a paso**. El segundo requiere publicar primero la guía en un destino accesible para el cliente.

### Aviso permanente desde el 1 de octubre

**Mantén configurados los pagos de WhatsApp en Meta**

Meta cobra los mensajes de servicio que superan 1.000 entregas por número al mes. Sin un método de pago, los mensajes que exceden ese cupo no se entregan. Revisa la configuración de pago de tu cuenta de WhatsApp. Las plantillas de utilidad también pueden generar cargos dentro de las 24 horas.

### Mensaje breve de acompañamiento

Hola. Si usas WhatsApp en Parallly, revisa el método de pago de tu cuenta en Meta antes del cambio del 1 de octubre de 2026. Sin ese método, Meta dejará de entregar mensajes de servicio al agotar las 1.000 entregas gratuitas por número al mes. Te compartimos la guía para configurarlo. Si ya tienes un método asociado a esa cuenta, verifica que esté vigente. Los cobros de Meta son independientes de tu suscripción a Parallly.

Usar este mensaje como comunicación administrativa por los canales apropiados. No depender exclusivamente de WhatsApp para avisar de un problema que puede impedir entregas por WhatsApp.

## Distribución y seguimiento propuestos

| Audiencia | Comunicación | Acción esperada |
| --- | --- | --- |
| Todos los usuarios activos de Parallly | Aviso informativo en dashboard y correo en su idioma | Identificar si usan WhatsApp y compartir con el administrador responsable. |
| Administradores de negocios con WhatsApp conectado | Correo con guía y seguimiento prioritario | Comprobar método asociado a cada cuenta afectada y validar entrega. |
| Nuevos clientes o clientes sin WhatsApp | Guía en la conexión y correo informativo sin afirmar interrupción actual | Completar pagos al conectar un número de producción. |
| Cuentas con facturación por proveedor | Contacto con el responsable administrativo | Confirmar cobertura de facturación antes de cambiarla. |

Preparar la lista con usuarios activos, responsables de administración y correo de facturación pertinente; deduplicar destinatarios. Mantener correos individuales para no exponer las direcciones de otros clientes. Un correo aceptado por SMTP no prueba que fue entregado o leído.

Registro mínimo recomendado: tenant, cuenta/número afectado, responsable, idioma, destinatario, fecha de envío, resultado técnico, respuesta del responsable y fecha de comprobación. Distinguir **informado**, **confirmado por el cliente** y **verificado técnicamente**. No convertir un clic en el aviso en prueba de que Meta aceptó la tarjeta.

El correo de este paquete sirve como base; el envío requiere un emisor configurado, la lista real y un mecanismo de entrega. No se consultaron destinatarios de producción ni se enviaron mensajes.

## Herramientas que existían antes de este cambio

- **Banner global:** `/admin/settings/platform`. Admite texto de hasta 500 caracteres, severidad y expiración. Se muestra en el dashboard y se consulta aproximadamente cada minuto. Es descartable y no tiene botón de enlace. Si se usa, indicar que la guía está en el correo y describir la ruta de Meta.
- **Novedades:** `/admin/settings/platform/changelog`. Admite contenido en es/en/pt/fr e imágenes. No se abre automáticamente; el botón «Entendido» solo cierra el modal. En la primera sesión, la última novedad se marca como leída. No cubre por sí sola el requisito de nuevas cuentas.
- **Ayuda de WhatsApp:** `HelpPanel` ya usa `mediaKey="channelsWhatsapp"` y admite video/imágenes. Puede alojar el tutorial cuando haya una grabación real.
- **Correo:** no se encontró una campaña administrativa para todos los usuarios. `EmailService.send()` existe, pero no mantiene una campaña con entrega/rebotes y reintentos. El módulo Broadcast se dirige a contactos de un tenant; no debe usarse como lista de usuarios de Parallly.

Referencias: `MaintenanceBanner.tsx`, `MaintenanceModeCard`, `platform-status.controller.ts`, `AppSidebar.tsx`, `help-panel.tsx`, `email.service.ts` y `broadcast.service.ts`. Esta es una revisión del código local, no una comprobación del estado desplegado.

### Nueva sección preparada en este trabajo

Se incorporó `/admin/communications` para superadmin: borradores en cuatro idiomas, audiencia, prueba al propio correo, lista de destinatarios guardada antes de confirmar y resultados de envío individuales. Incluye el aviso de Meta como plantilla editable; no crea ni envía una campaña de producción automáticamente. La orientación de pagos se integró con los componentes de registro y comprobación que llegaron desde el remoto. Ver el [manual de Comunicaciones](../../platform-communications.md) para despliegue, alcance y límites.

### Orientación integrada y mejoras futuras

La orientación previa al registro, el aviso del método de pago y el panel de financiación de Canales → WhatsApp incluyen enlaces a Meta y a la guía PDF en español. El aviso está traducido a los cuatro idiomas y usa una fecha absoluta para seguir siendo correcto después del 30 de septiembre. La guía se sirve desde `/help/meta-whatsapp-pagos-2026-10.pdf` cuando se despliegue el dashboard; comprobar esa URL antes de enviar el correo con su enlace.

La comprobación de financiación ya existe. Su límite pendiente es la respuesta de Meta que omite el campo: no permite distinguir con certeza una ausencia de método de un dato no visible para el token. Conservar `unknown` y ofrecer una revisión en Meta hasta disponer de evidencia suficiente. Una declaración manual del cliente o un clic en el aviso no sustituyen la consulta; `attached` tampoco prueba un cargo aprobado. El conteo total de mensajes de Parallly no equivale al cupo gratuito facturable de Meta.

## Guion para un video de 90 segundos

Grabar una cuenta de demostración real, ocultando datos privados. No usar pantallas inventadas como si fueran capturas de Meta.

| Tiempo | Pantalla | Locución |
| --- | --- | --- |
| 0–12 s | Título con fecha 1 de octubre de 2026 | «Meta cambia los cobros de WhatsApp Business Platform. Revisa el método de pago de tu cuenta para mantener los envíos cuando sean cobrables». |
| 12–25 s | Tarjeta explicativa con 1.000 mensajes por número y mes | «Los mensajes de servicio tienen mil entregas gratuitas al mes por número. Sin método de pago, los siguientes mensajes no se entregan. Las plantillas de utilidad también pueden generar cargos». |
| 25–40 s | Administrador de WhatsApp, selector de cuenta | «Entra con permiso para administrar WhatsApp. Elige la cuenta conectada a Parallly y abre su configuración». |
| 40–58 s | Configuración, Configuración de pago, Añadir método | «Abre Configuración de pago. Agrega un método válido y completa los datos que pide Meta. Si ya tienes una tarjeta, verifica que esté asignada a esta cuenta». |
| 58–72 s | Método asociado, datos sensibles ocultos | «Comprueba que el método figure en la cuenta correcta y resuelve cualquier aviso pendiente. Pagar tu suscripción de Parallly no configura estos pagos». |
| 72–90 s | Comprobación en Canales → WhatsApp y recepción de prueba | «Vuelve a Parallly, comprueba el método de pago y revisa los pendientes de conexión. Con tu agente publicado, confirma una respuesta real y consulta la guía si necesitas ayuda». |

Agregar subtítulos y un enlace a la guía. Para la grabación, detener u ocultar la captura al ingresar datos de tarjeta, CVV, códigos o información fiscal privada. El video será un complemento; la guía y el correo ya explican la acción completa.

## Criterios de revisión antes de distribuir

- Texto correcto para la fecha de envío: no conservar «hoy 30 de septiembre» en un envío posterior.
- Consecuencia precisa: interrupción de mensajes cobrables sin método de pago; no prometer cierre de cuenta ni pérdida de conversaciones.
- Enlaces llevan a dominios oficiales de Meta y a soporte de Parallly.
- Guía adjunta o publicada y destinatarios reales deduplicados.
- Soporte preparado para distinguir permisos, cuenta equivocada, tarjeta rechazada, facturación por proveedor y otros errores de entrega.
- Publicación y envíos registrados como acciones pendientes hasta contar con confirmación de ejecución.
