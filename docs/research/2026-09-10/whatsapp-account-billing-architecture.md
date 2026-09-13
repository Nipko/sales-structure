# WhatsApp: cuentas, pago a Meta y arquitectura de Parallly

Investigación del 10 de septiembre de 2026. Código inspeccionado en `a35110aea28c8fcddc4863ba118b53e9bbd1ee8b`; hay trabajo concurrente de cierre de release que no se modificó. Revisión de código y documentación pública; no se consultaron credenciales, cuentas ni consumo de producción. Las conclusiones contractuales requieren validación del caso de negocio con Meta y asesoría competente antes de promover usos nuevos de IA.

## Decisión propuesta

Mantener como oferta predeterminada el modelo de **Tech Provider: cada negocio paga el uso de WhatsApp directamente a Meta y paga a Parallly la plataforma y la IA**. Integrar la configuración de pago de Meta en el asistente, con acceso a la pantalla correcta y verificación posterior. El pago se modelará por **Messaging Account**, conservando compatibilidad con el WABA ID actual. La alternativa de factura única requiere un Solution Partner y una línea de crédito real; no se obtiene por añadir un cobro Wompi ni por declarar créditos de WhatsApp en los planes. [F1, F2]

## Evidencia oficial verificada

| ID | Fuente y vigencia mostrada | Qué permite concluir |
|---|---|---|
| F1 | [Partners](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview), 21-may-2026 | Tech Provider/Tech Partner no tienen línea de crédito. El cliente agrega su medio de pago y Meta le factura; Solution Partner extiende crédito y factura al cliente. Existe la solución conjunta entre ambos tipos de socio. |
| F2 | [Embedded Signup overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview), 24-jul-2026 | Facturación es un requisito posterior al signup. Para Tech Provider remite a tarjeta del cliente; compartir crédito corresponde a Solution Partner. Business tokens para operaciones de clientes. Advanced Access depende de App Review. La página anuncia retiro de v2 el **8-oct-2026**. |
| F3 | [Agregar tarjeta](https://www.facebook.com/business/help/488291839463771), ayuda pública sin fecha visible | Ruta de WhatsApp Manager a Billing & payments. Requiere permiso de administrar la cuenta; admite Visa/Mastercard, puede requerir datos fiscales; muestra COP entre monedas. Su introducción aún dice servicio gratis: **no usar esta página como autoridad para precios futuros**. |
| F4 | [Access Tokens Guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens#business-integration-system-user-access-tokens), 30-jun-2026, original inglés comprobado | BISU/business tokens tienen alcance por cliente incorporado. Tech Provider debe utilizarlos; System User del proveedor se reserva al uso propio o crédito del Solution Partner. El usuario administrador del sistema tiene por defecto acceso a activos propios y compartidos del portfolio. |
| F5 | [Manage credit lines](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/share-and-revoke-credit-lines/), 21-may-2026 | API de compartir/adjuntar crédito, verificación por `receiving_credential` contra `primary_funding_id`, responsabilidad del socio por gasto de sus clientes. Revocar crédito de un cliente afecta sus WABAs asociadas a esa asignación. |
| F6 | [Account model evolution](https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/), 17-ago-2026, original inglés comprobado | Beta: identidad/número en WAAC; plantillas, facturación, webhooks y métricas en Messaging Account. WABA ID existente se conserva como Messaging Account ID. Fase 1 H2-2026 compatible; fase 2 H1-2027 expone WAAC/nuevas APIs; fase 3 H1-2028 obliga transición. |
| F7 | [Managing Messaging accounts](https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/messaging/), 29-ago-2026, original inglés comprobado | `messaging_account_id` desambigua qué cuenta paga si el token puede usar más de una en el mismo teléfono. Omitirlo puede cobrar otra cuenta o rechazar el envío. `GET /<MESSAGING_ACCOUNT_ID>?fields=primary_funding_id` comprueba método adjunto. Ausencia en respuesta válida significa que no puede enviar mensajes cobrables. |
| F8 | [Change billing currency via API](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/change-billing-currency), 23-jun-2026, original inglés comprobado | API clona WABA y migra activos en dos fases. Tarjetas **no** se adjuntan por API: requieren verificación del titular en Business Manager. Excluye Coexistence y Authorized Agents. Historial de costos queda en cuenta antigua. La guía actual dice que las líneas se denominan en USD; no exige línea en cada moneda objetivo. |
| F9 | [WhatsApp Business Solution Terms](https://www.whatsapp.com/legal/business-solution-terms/), modificados 6-mar-2026 | Restringe IA como funcionalidad primaria, con excepción por números EEA/Brasil; permite retener AI Provider como proveedor del negocio. Limita entrenamiento/mejora con Business Solution Data incluso derivada/anónima, salvo fine-tuning exclusivo del negocio sin mejorar otros modelos. |
| F10 | [Prepaid billing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/prepaid-billing/), 8-sep-2026, original inglés verificado en navegador por el agente coordinador | Prepago regional India/INR/UPI; requisitos, limitaciones y significado de errores detallados en la adenda siguiente. |

Las páginas de Developers dieron 429 al buscador, pero se pudieron leer públicamente con navegador, sin sesión. Se consultó el original inglés de F4/F6/F7/F8 para resolver ambigüedad de traducción. Esta investigación no demuestra el estatus contractual actual de Parallly en Meta ni sus permisos activos: eso debe inventariarse en la cuenta.

## Hallazgos del código

| Prioridad | Evidencia local | Riesgo / cambio necesario |
|---|---|---|
| P0 | `apps/api/src/modules/channels/channel-token.service.ts:55`: si no encuentra el teléfono pedido, consulta el primero del tenant; líneas 73–77 sólo avisan. | Resolver el número pedido exactamente o fallar. La devolución de otro número puede alterar remitente y cuenta de cobro. Validar llamadas reales, no sólo resolver credenciales en aislamiento. |
| P0 | `apps/whatsapp/src/modules/onboarding/onboarding.service.ts:341` intenta generar token desde `SYSTEM_USER_ID`; `meta-graph.service.ts:474` asigna WABA a ese usuario. `channel-token.service.ts:80` toma el último `system_user_token` del tenant. | Separar BISU por cliente/concesión de acceso del System User global. El nombre de la fila no prueba el tipo real: el mismo campo guarda el token alternativo. Inventariar tipo, app, propietario, activos y expiración antes de migrar; no revocar credenciales masivamente por etiqueta. |
| P0 | `apps/api/src/modules/channels/whatsapp/whatsapp.adapter.ts:53` envía con `channelAccountId`; cuerpo en línea 56 sin `messaging_account_id`. `strict-dispatch-transport.ts:29` carece de campo dedicado. Búsqueda en backend WA/shared/signup no encontró modelo WAAC/Messaging Account. | Conservar cuenta pagadora dentro de cada efecto durable y todos los contextos internos. Enviar el parámetro cuando el contrato, capacidad y cohorte lo soporten; si existen varias cuentas alcanzables y no se puede desambiguar, rechazar el envío. Mantener compatibilidad legacy probada. |
| P0 | `apps/whatsapp/src/modules/meta-graph/meta-graph.service.ts:440` sólo consulta id/name/currency/timezone/namespace. Signup persiste `connected` sin comprobar financiación. | Añadir estado de pago independiente del estado de conexión y verificarlo después de conectar, al volver de Meta y ante errores. |
| P1 | `apps/dashboard/src/app/admin/channels/whatsapp/WhatsAppPrerequisites.tsx:19` tiene tres prerrequisitos; no contiene pago. `WhatsAppEmbeddedSignup.tsx` no ofrece fase Meta billing. | El onboarding debe explicar dos facturas, estimar uso, guiar a Meta y mostrar qué falta. Conectado no implica listo para automatizar. |
| P1 | `apps/api/src/modules/channels/provider-error-classification.ts:100` ya clasifica el error Graph conocido sin recibo; por defecto devuelve rechazo no reintentable. No hay manejo explícito `131042` en rutas revisadas. | No afirmar que el outbox actual reintenta ocho veces ese código: lo suprime por defecto. Falta marcar cuenta con problema de pago, alertar, diagnóstico y reanudación selectiva después de solucionar. Revisar también transporte legacy. |
| P1 | `apps/whatsapp/src/config/meta.config.ts:9` fallback v21.0; adapter v25.0; frontend SDK v25.0 en `WhatsAppEmbeddedSignup.tsx:343`; messaging/template/connection services API conservan v21.0. | Una política de versiones probada, sin cambiar la variable y asumir que todos los consumidores la usan. Inventario de endpoints, migración a versión soportada y tests de contrato por ruta. |
| P1 | `apps/dashboard/src/app/admin/channels/whatsapp/embedded-signup-events.ts:20` usa v4 y featureType de coexistence; payload sólo captura business_id/waba_id/phone_number_id. | v4 está, pero hay que validar flujo phone-first actual, los eventos reales y preparar campos nuevos de forma aditiva. No prometer que `waac_id` está disponible hoy para todos. |
| P1 | `apps/api/prisma/seed-billing-plans.js:101` / 202 / 302 define créditos WA de 500/1000/2500 centavos; `plan-features.registry.ts:84` los registra. En rutas operativas inspeccionadas no hay consumo de esa bolsa contra Meta. | No venderlo como saldo financiado. Auditar runtime billing_plans y promesas existentes; retirar/redefinir con transición comercial y no mediante cambio retroactivo unilateral. |
| P1 | `apps/api/src/modules/learning/learning.service.ts:69` importa inbox por tenant/agent, conserva channel y procedencia, revisa contactos; `analyze` en línea 367 pasa datos al modelo. | Hay aislamiento y procedencia valiosos. Falta revisar política específica del origen WhatsApp, finalidad contractual y términos del proveedor de IA; no se constató fuga entre tenants. |

Otros puntos: `onboarding.service.ts:311` captura cualquier error de registro como posiblemente ya registrado; no prueba registro listo. Meta está retirando PIN por cohortes pero aún pide parámetro válido en register: no eliminarlo globalmente. `ChannelCredentials` tiene WABA/número; `getChannelToken` genérico descarta WABA al devolver sólo accountId/token. Propagar contexto pagador exige cambiar el contrato de envío y no sólo la pantalla.

## Tres circuitos de pago que deben quedar claros

| Circuito | Pagador → receptor | Dónde se configura | Qué no financia |
|---|---|---|---|
| Suscripción Parallly | Tenant → Parallly | Wompi/plataforma, módulo `billing` | No asocia tarjeta a Meta. |
| Mensajería WhatsApp | Tenant → Meta; excepcionalmente socio → Meta con refacturación | Cuenta de mensajes en Meta y verificación Parallly | No paga IA, hosting ni suscripción Parallly. |
| Venta del negocio | Consumidor → tenant | `tenant-payments`, credenciales propias Wompi/Mercado Pago | No paga Parallly ni Meta. |

Recomendación de producto: tarjetas separadas con nombre del receptor, responsable, divisa, propósito y enlace de gestión. Nunca pedir la tarjeta de Meta en el chat ni guardar PAN/CVV en Parallly. Una acción de Assist puede abrir el destino y releer estado, no declarar éxito por el clic ni aceptar términos financieros en nombre del tenant. [F2, F3, F8]

## Diseño propuesto de cuentas y preparación de pago

Este es diseño de Parallly, no una API que Meta haya prometido:

1. `WhatsAppIdentity`: tenant, conexión operativa, phone_number_id y futuro waac_id nullable, propietario del negocio.
2. `WhatsAppMessagingAccount`: legacy_waba_id/messaging_account_id, tenant/propietario, moneda, modo `customer_direct | partner_credit | unknown`, referencia de financiación no secreta y timestamp de comprobación.
3. Relación identidad→cuentas de mensajes autorizadas. Un agente por conexión sigue siendo regla Parallly; compartir número con otro proveedor requiere enrutamiento y propiedad del turno explícitos.
4. Concesión de acceso: tipo real BISU/System User, app_id, cliente, activos cubiertos, scopes, expiración/revocación, referencia cifrada al token. No usar token global como sustituto silencioso.
5. Estado `not_checked | checking | attached | missing | restricted | unknown`; evidencia `provider_query | provider_error | operator_attestation`, checkedAt, fuente, razón. `attached` no significa saldo disponible, ausencia de deuda ni canal operativo.
6. Cada efecto durable fija tenant, conexión, número, cuenta de mensajes, token grant y versión de política utilizada para estimación/reserva/cotización. Un reintento no puede escoger nueva cuenta por conveniencia. Esa versión **no congela el cargo de Meta**: antes de enviar y al recibir evidencia de entrega se debe comprobar la vigencia tarifaria y conciliar contra el cargo/factura real.

La selección interna del pagador debe existir en todos los caminos, aunque el transporte de una cuenta legacy probada todavía no utilice `messaging_account_id`. Añadir el parámetro externo según el contrato y capacidad de cada API/cohorte. Si un token alcanza varias cuentas pagadoras del mismo número, se exige una desambiguación válida: cuando la combinación no la soporte, bloquear esa configuración en vez de mandar ambiguamente. Las fases 2 y 3 de WAAC son trabajo futuro del cronograma de Meta; no convertirlas en un requisito universal para operar el 1 de octubre de 2026. [F6, F7]

Una cola reservada con tarifas de septiembre que entrega en octubre puede generar un cargo distinto. Mantener la estimación original para auditoría, recalcular la exposición al cruzar la vigencia, ampliar la reserva sólo dentro del presupuesto autorizado y detener la acción si no alcanza. Si además expiró la tarea, marcarla vencida. Registrar fechas y estados de aceptación y entrega, categoría/mercado efectivos y ajustes del proveedor; conciliar con la tarifa aplicable y factura real. Una tarifa interna congelada no puede sustituir la obligación económica real ni justificar un saldo ficticio.

Para `primary_funding_id`, **ausente** significa missing sólo ante respuesta exitosa del recurso correcto, con permiso y contrato válidos. HTTP 403, timeout, 429, error de parser o configuración de cuenta desconocida significa unknown. Si existe, registrar método adjunto; las restricciones de crédito/deuda se detectan por señales separadas. Evitar el booleano `funded` como resumen de hechos distintos. [F7]

Un error confirmado de pago debe pausar nuevos envíos cobrables de la cuenta afectada y mostrar resolución al administrador. Seguir recibiendo mensajes, conservar el turno y permitir que la persona atienda por un canal autorizado. No enviar una notificación WA adicional por el mismo canal impago. Después de reparar, revalidar ventana de 24h, consentimiento, vencimiento de la tarea, dueño del turno y cuenta pagadora antes de reintentar: nunca vaciar automáticamente el backlog viejo.

## Recorrido recomendado para añadir el medio de pago

La [especificación de tarjeta y seguridad](meta-card-setup-and-security-contract.md) fija el recorrido: guía en Parallly, página oficial externa de Meta, retorno y consulta de estado. Distingue la ventana de conexión del alta de tarjeta, las ramas de pagador y la frontera real del formulario SaaS con Wompi.

1. Antes de conectar: “Tu plan Parallly cubre plataforma e IA. Meta cobra el uso de WhatsApp por separado según destino y mensaje”. Mostrar simulador y presupuesto; no llamar gratuito a todo lo que ocurre dentro de 24h.
2. Completar Embedded Signup v4 y registrar activos/credencial; estado “Conexión realizada; falta revisar facturación”.
3. Consultar cuenta de mensajes. Si falta método, ofrecer “Configurar pago en Meta”. La ruta documentada es WhatsApp Manager → cuenta correcta → administrar configuración → configuración de pago → Billing & payments → añadir método. En cuentas migradas, explicar que la sección se llama Cuenta de mensajes. [F3, F6]
4. El administrador introduce tarjeta y datos fiscales en Meta. Enlace a ayuda oficial y números/nombres identificables de la cuenta correcta; no inventar parámetros de deep link que no se hayan probado.
5. Al volver, botón “Comprobar de nuevo”, relectura backend y estado con fecha. Demostrar éxito con evidencia; declaración manual visible como tal cuando Meta esté inaccesible.
6. Enviar un único mensaje real de prueba, elegido y consentido, dentro de presupuesto; obtener aceptación y entrega. El sandbox de Embedded Signup sirve para activos/token pero su número no envía ni recibe mensajes: no sustituye este piloto. [F2]
7. Activar agente/campañas sólo cuando conexión, pago, políticas y presupuesto sean suficientes para la acción. Separar validación de suscripción Parallly de validación Meta.

## Factura única mediante socio: decisión futura con condiciones

La oferta con tarjeta propia del tenant a Meta protege a Parallly de financiar consumo, deuda y tipo de cambio. Debe ser el lanzamiento predeterminado. Si se elige solución conjunta o Solution Partner, antes de venderla se necesitan contrato comercial, fees reales, línea y límite de crédito, monedas aplicables, responsabilidades de impago, conciliación, impuestos, retiro de crédito, offboarding y portabilidad. [F1, F5]

No basta con una billetera local: la reserva de saldo debe controlar concurrencia y sumar aceptados, pendientes inciertos y reservas vivas; la conciliación debe resolver diferencias con Meta por cuenta. No facturar mensajes aceptados como entregados ni facturar dos veces por webhook repetido. Los recibos pertenecen al emisor; el cargo pertenece a la cuenta de mensajes seleccionada. Esta distinción debe sobrevivir a que otro proveedor tenga la conversación. [F7]

La migración de moneda/pago clona cuenta, cambia IDs de plantillas y conserva el histórico en la antigua. Se necesita mapa de migración, pausa controlada de producers, actualización atómica de referencia pagadora y pruebas de reanudación. No aplicar esa API a Coexistence; no asumir que una línea necesariamente debe tener misma moneda que la WABA: F8 dice que las líneas son USD. Resolver elegibilidad con contrato de la ruta exacta y ensayo por cuenta. [F8]

## IA especializada y aprendizaje: cambio de enfoque

Hecho contractual: la prohibición cubre IA cuando es funcionalidad principal a criterio de Meta. Hay excepción de números del EEA/Brasil y permiso de contratar AI Provider para prestar servicio al negocio. Los datos del canal, incluidos derivados/anónimos, no pueden mejorar modelos generales o ajenos; la excepción descrita es fine-tuning para uso exclusivo del negocio. No basta con anonimizar ni con consentimiento local para ignorar esa restricción. [F9]

Recomendación: cada agente WA debe tener negocio, objetivo y catálogo de tareas concretos: vender ese catálogo, atender esas órdenes, agendar esos servicios y escalar con una persona. Assist de configuración permanece dentro del dashboard. No publicar un chatbot genérico para hacer cualquier tarea a través de WA ni afirmar que una etiqueta “agente de ventas” garantiza elegibilidad. Revisar con Meta el caso real y con asesoría contractual las prácticas de aprendizaje antes de habilitar usos nuevos.

Mantener procedencia WhatsApp también al exportar/importar archivos, redactar, resumir o derivar patrones. Crear un control de finalidad por source/release: uso dentro de ese tenant, retención, borrado, proveedor de inferencia sin entrenamiento y contrato de tratamiento. Probar que una plantilla global, benchmark compartido o corpus reutilizado no absorba conversaciones WA de clientes. RAG, ejemplos para inferencia y ajustes de prompt no deben anunciarse como una excepción contractual automática: documentar su uso operacional y confirmar el encaje. El fine-tuning real requiere pipeline separado y exclusividad verificable.

## Criterios de aceptación para incorporar al plan

- Dos números de un tenant y dos tenants: el número faltante falla; no sale por otro, no se cobra otra cuenta y no cruza token/cache.
- Un número con dos cuentas de mensajes: body/envío/recibo/costo usan la elegida. Retirada de permisos o cambio de pago entre reserva y envío detiene el efecto; reinicio conserva selección.
- Funding: attached/missing/403/timeout/429/cuerpo inválido, expiración de evidencia, 131042 síncrono y webhook fallido; recuperación no duplica ni revive tareas vencidas.
- Signup v4 real: nuevo número, Coexistence, cliente preexistente, callback parcial/cancelado, varias WABA y permisos incompletos. Mostrar facturación como paso faltante verificable.
- Token BISU: tipo y activos validados; token anterior válido no se sobrescribe por otro sin cobertura; revocación de un cliente no rompe otro; no System User global fallback.
- Búsqueda estática y de runtime de todos los emisores: IA, humano, campaña, automatización, recordatorio, template, Flow, media y pagos. Cada envío conserva cuenta, categoría y política de estimación. El parámetro externo se incorpora sólo con contrato/capacidad soportada; caso legacy sin ambigüedad sigue funcionando y caso ambiguo sin desambiguación válida falla.
- Cola que cruza una fecha tarifaria, incluida septiembre→octubre: revalida exposición, presupuesto y reserva sin reescribir la cotización histórica; aceptación/entrega y cargo real se concilian con su vigencia. Prueba también subida de categoría o ajuste de Meta posterior y reserva insuficiente.
- Regresión de publicaciones/rollback/outbox del plan de Claude tras modificar contextos y contratos de envío.
- E2E navegador del asistente: abrir Meta, volver, comprobar, error resoluble, teclado/móvil y es/en/pt/fr. No se guardan números de tarjeta ni secretos en texto, logs o trazas.
- Learning: origen WA persiste tras import/export/redacción; ninguna promoción entre tenants/global, borrado y retirada alcanzan ejemplos y derivados; contrato y configuración del proveedor de IA documentados.
- Piloto real con gasto acotado, evidencia de entrega y consumo visible en Meta. La suite sintética certifica ingeniería, no medio de pago ni facturación real.

## Pendientes externos concretos

Confirmar estatus Tech Provider/partner de Parallly, Advanced Access y business verification; inventariar cuentas/números, configuración BISU, moneda y pago sin recopilar PAN/CVV; elegir presupuesto/tenant/número del piloto; aclarar si algún contrato promete créditos Meta incluidos; obtener aprobación contractual del uso real de IA y datos. Si se desea factura única, pedir propuesta de Solution Partner antes de fijar rentabilidad y planes de esa modalidad.

## Adenda: prepago Meta anunciado el 8 de septiembre

La disponibilidad oficial de F10 es **India, INR y UPI**, para WABAs sin método de pago configurado. Excluye cuentas fuera de India, Meta Business Agent y cuentas financiadas con línea de un Solution Partner. Al configurar el pago por primera vez se elige UPI prepago o tarjeta con facturación posterior; la guía no permite cambiar después entre esas modalidades. El negocio añade fondos a su cuenta mediante Billing Hub. No hay API pública para cargar fondos ni consultar saldo, y los fondos no se comparten entre WABAs ni se convierten de moneda. Las alertas de saldo se muestran al administrador por email/Meta Business Suite/WhatsApp Manager, sin webhook de saldo. Una solicitud puede ser aceptada con HTTP 200 y después recibir fallo de entrega `131042`; también puede devolverlo directamente. Ese código agrupa problemas de elegibilidad de pago y no demuestra por sí mismo saldo insuficiente; `130429` corresponde a rate limiting. **Este producto no habilita prepago Meta para Colombia ni convierte a Parallly en reseller con cartera común.** [F10]

Recomendaciones de Parallly: mantener `customer_direct` para Colombia y no ofrecer una recarga local como si financiara automáticamente Meta. Si se admiten negocios indios, añadir `customer_prepaid` como modalidad regional independiente, con comprobación de elegibilidad y instrucciones de Billing Hub. Mostrar saldo como no disponible cuando no exista API, nunca como cero ni como una cifra calculada que pretenda ser saldo real. Incorporar el fallo posterior a aceptación en el ledger y en alertas: pausar nuevos envíos cobrables, conservar el recibo y revalidar la situación antes de admitir un nuevo intento. La conciliación económica debe distinguir aceptación, entrega y rechazo final. La restricción geográfica y la ausencia de API de saldo impiden usar este lanzamiento como fundamento de los márgenes de una bolsa prepaga para todos los tenants.

No se ejecutaron pruebas ni se implementó código de producto en esta investigación. Se creó sólo este documento.
