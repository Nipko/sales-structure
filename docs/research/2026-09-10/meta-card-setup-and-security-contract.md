# Tarjeta Meta: recorrido, responsabilidades y textos de seguridad

Fecha: 10 de septiembre de 2026. Especificación para implementar, vinculada a [cuentas y financiación](whatsapp-account-billing-architecture.md), [landing](landing-positioning-and-content-plan.md) y [directiva Claude](../../handoffs/2026-09-10/claude-landing-meta-comparison.md). La inspección no configuró tarjetas, cuentas reales ni cargos.

## Decisión de experiencia

Para la modalidad de pago directo, **el negocio inicia la guía en Parallly y agrega su tarjeta en una página oficial de Meta**. El lanzamiento utiliza un enlace explícito que abre una pestaña de Meta y conserva el progreso en Parallly. La conexión mediante Embedded Signup y la preparación de facturación son pasos distintos.

Embedded Signup es una ventana oficial de autenticación y autorización que se inicia desde nuestro botón; devuelve activos y un código intercambiable. Su documentación deriva a los clientes de Tech Providers a configurar su método de pago. No demuestra un formulario público que Parallly pueda hospedar para adjuntar tarjetas. La API de migración de moneda también exige agregar la tarjeta manualmente en Business Manager por la verificación del titular. [Registro oficial](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview), [restricción de tarjetas en migración](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/change-billing-currency).

No construir un iframe de facturación, un formulario propio de tarjeta Meta ni una captura de datos para después enviarlos por una API supuesta. Tampoco afirmar que Meta nunca mostrará un paso de pago en su propia ventana: su interfaz puede variar por versión/cuenta. Si un flujo oficial lo incorpora, puede aprovecharse después de verificarlo; la tarjeta sigue introduciéndose en el origen de Meta y el backend debe comprobar el estado resultante.

## Qué verá el administrador

1. **Conectar WhatsApp.** Completa la ventana oficial de Meta y vuelve a Parallly.
2. **Revisar quién paga.** Parallly muestra negocio, número(s), cuenta de mensajes que los financia y modalidad. En pago directo, explica Meta y suscripción por separado. Si ya existe un método asociado, no obliga a agregar otro.
3. **Configurar pago en Meta.** Una tarjeta de ayuda explica el destino y abre `https://business.facebook.com/wa/manage/home/`, enlazado por la ayuda oficial. Si se valida un destino más preciso para la cuenta, se podrá utilizar; no inventar parámetros de enlaces profundos.
4. **Agregar la tarjeta en Meta.** En WhatsApp Manager: elegir cuenta → administrar configuración → configuración de pago → facturación y pagos → añadir método. El titular completa los datos y validaciones que solicite Meta. Este paso requiere permisos de administración de esa cuenta en Meta; un rol de Parallly no los concede. [Pasos oficiales](https://www.facebook.com/business/help/488291839463771).
5. **Volver y comprobar.** Parallly conserva la selección y permite “Comprobar de nuevo”; puede releer al recuperar foco. La comprobación es de estado, no un cobro ni un envío de prueba.
6. **Revisar preparación.** Mostrar resultado, fecha y pendientes. Un método asociado no acredita saldo, ausencia de deuda o entrega. Preparación del canal y presupuesto tienen comprobaciones independientes.

La navegación abre una pestaña externa desde una acción del usuario, con aviso accesible y enlace recuperable si el navegador impide abrirla. No depender de inspeccionar el DOM de Meta, de un retorno automático de facturación no documentado ni de un `postMessage` supuesto. Conservar el paso después de cerrar la pestaña, recargar o volver más tarde. No transportar secretos ni datos de tarjeta en URLs.

La página pública describe el recorrido; la vista autenticada selecciona la cuenta real. Una cuenta de facturación puede financiar varios números: no pedir una tarjeta por número cuando comparten la misma cuenta, ni asumir que una tarjeta asociada cubre todas las cuentas del tenant.

### Modalidades alternativas

- **Financiación por partner:** identificar quién factura, contrato y destino verificados. No solicitar otra tarjeta en Meta por defecto ni prometer que la facturación es directa.
- **Modalidad desconocida:** mostrar “Necesitamos comprobar cómo se paga esta cuenta de WhatsApp” y ayuda/reintento. No seleccionar un pagador por conveniencia.
- **Falta permiso Meta:** explicar que debe completar el paso un administrador autorizado. Preparar un enlace/instrucciones para compartir manualmente; no solicitar credenciales de Facebook ni enviar mensajes a terceros automáticamente.

## Fronteras de datos y autorizaciones

| Flujo | Dónde se introducen los datos | Tratamiento de Parallly | Alcance del cobro |
|---|---|---|---|
| Pago directo a Meta | Interfaz oficial de Meta | La guía propuesta no recibe PAN ni CVV; consulta identidad y estado de financiación con permisos autorizados | Mensajería de la cuenta, según tarifas/contrato Meta |
| Suscripción Parallly | Formulario propio de Parallly que tokeniza directamente con Wompi | En el camino normal, API recibe token/consentimiento y conserva fuente de pago y datos parciales; no recibe ni persiste PAN/CVC | Suscripción y cargos autorizados del contrato Parallly |
| Cobros del comercio a sus clientes | Checkout del proveedor del comercio | Credenciales y liquidación separadas en `tenant-payments` | Compras del cliente al negocio |

Puede usarse la misma tarjeta física si cada proveedor la acepta y el titular lo autoriza. Son registros, permisos de cobro y gestiones independientes. No se copia la tarjeta ni el token de Wompi a Meta; tampoco un grant OAuth de WhatsApp equivale a una fuente Wompi. Cambiar o eliminar el método en un proveedor no actualiza el otro. Cancelar la suscripción tampoco liquida o elimina por sí mismo obligaciones Meta.

**Matiz esencial:** aunque Parallly no reciba la tarjeta Meta, los envíos autorizados desde Parallly pueden generar cargos de mensajería. La claridad debe incluir agentes, humanos, recordatorios y campañas. Los límites de gasto de M3 sólo cubren el alcance que controlen realmente; no afirmar que bloquean cargos originados por otras apps/proveedores de la misma cuenta. La custodia de la tarjeta y el control del consumo son responsabilidades distintas.

### Evidencia del flujo SaaS actual

`apps/dashboard/src/components/billing/WompiPaymentForm.tsx:88` y `:473` contienen campos y estado React para la tarjeta. `:170`–`:211` envían desde navegador a `/tokens/cards` en Wompi. `:294` envía a Parallly el token y aceptaciones. Por ello **no decir que la tarjeta SaaS nunca pasa por el frontend de Parallly ni que este formulario es un iframe Wompi**.

`apps/api/src/modules/billing/recurring/payment-source.controller.ts:51` aplica guards; `:85` recibe la fuente. `payment-source.service.ts:76` y `:163` gestionan consentimiento; `:217` conserva referencia/metadatos; `:950` devuelve una proyección sin tokens del proveedor. `apps/api/prisma/schema.prisma:494` define fuente, marca, últimos cuatro, vencimiento y estado. `apps/api/src/modules/billing/adapters/wompi.adapter.ts:276` crea la fuente reutilizable con el token. Son evidencias del código, no una auditoría PCI ni una certificación de seguridad.

`apps/dashboard/src/app/admin/channels/whatsapp/WhatsAppEmbeddedSignup.tsx:439` y `:572` conectan los activos; no tienen formulario propio de tarjeta Meta. Comprobar estas referencias contra HEAD al implementar.

## Textos que debe compartir landing, onboarding y Assist

**Antes de abrir Meta:**

> Vas a configurar el pago de WhatsApp en una página oficial de Meta. Allí agregarás tu tarjeta. Parallly no recibe el número ni el código de seguridad de esa tarjeta. Los cargos de mensajería son independientes de tu suscripción a Parallly.

**Botón:** “Abrir facturación de Meta”. **Apoyo:** “Se abre un sitio externo. Al terminar, vuelve para comprobar el estado”. **Segundo botón:** “Comprobar de nuevo”.

**Suscripción Parallly:**

> El pago de tu suscripción se procesa con Wompi. Nuestro servidor utiliza una referencia de pago y datos parciales para administrar los cobros autorizados. Este método no configura ni paga tu mensajería de Meta.

**Consumo:**

> Los mensajes enviados desde Parallly pueden generar cargos de Meta. Revisa las tarifas y el presupuesto disponible antes de activar agentes o campañas.

Publicar la última frase sobre presupuesto cuando la función esté disponible; hasta entonces mostrar tarifas y estimación sin presentar un límite inexistente. El texto sobre la tarjeta Meta es exclusivo de la modalidad directa. No usar un sello de “100 % seguro”, “certificado por Meta” o “PCI compliant” sin evidencia específica y vigente.

## Contrato de implementación y aceptación

Añadir este recorrido a M1/M2 y L2/L5; no crear un segundo estado de financiación separado de la autoridad de cuentas. Mantener `attached`, `missing`, `restricted`, `unknown` y `not_checked`, fuente y fecha. `primary_funding_id` sólo se interpreta en una respuesta válida del recurso correcto y del contrato aplicable; errores de permiso/red no prueban ausencia. [Cuenta de mensajes](https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/messaging/).

- Aislar por tenant, cuenta y permisos; probar dos cuentas/números y una con financiación compartida. Un reintento no puede cambiar de pagador.
- Separar abrir destino, regresar, consultar y activar. Abrir Meta o pulsar “ya agregué mi tarjeta” no acredita financiación. Un resultado antiguo de otra cuenta no puede marcar ésta como lista.
- Permitir cancelación, recarga, falta de permiso, método ya asociado y errores recuperables. No duplicar altas ni abrir páginas de cobro automáticamente.
- Usar destinos oficiales permitidos y contexto mínimo; proteger secretos/tokens y excluir datos sensibles de logs, analytics, URLs, trazas, session replay y mensajes Assist. Verificar estas exclusiones con datos sintéticos, sin tarjetas reales.
- Verificar que PAN/CVC de prueba SaaS salgan sólo hacia Wompi, no hacia API/logs Parallly. Eliminar el estado sensible al concluir/cancelar y revisar instrumentación del formulario; tokenización no elimina la responsabilidad sobre el frontend.
- Autorizar por separado cambios/renovación SaaS y habilitación de consumo del canal. Una aceptación genérica no configura dos contratos financieros.
- Traducir a es/en/pt/fr, mantener teclado/foco/móvil y distinguir visualmente receptor, propósito y destino de gestión.
- Ensayo local con respuestas sintéticas: apertura, retorno, comprobación y estados. Piloto final con cuenta elegible y titular autorizado; agregar una tarjeta y enviar un mensaje son acciones reales separadas. No realizar cargos/envíos para comprobar un botón.

Resultado esperado: una persona puede explicar dónde pondrá cada método, quién cobra y cómo volver a comprobarlo. La experiencia no exige comprender tokens, APIs ni nombres de tablas.
