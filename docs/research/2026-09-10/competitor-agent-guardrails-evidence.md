# Evidencia comparada: bucles, falta de progreso, abuso y gasto de agentes

Consulta: **10 de septiembre de 2026**. Referentes: Intercom Fin, Zendesk AI agents, Manychat y Botpress. Sólo documentación oficial; sin probar cuentas comerciales, modelos ni proveedores. Se separan comportamiento documentado, restricciones de ejecución y recomendaciones en lenguaje natural. No se evalúan funcionalidades generales ni se declara superioridad de Parallly.

## Foco solicitado: proteger el gasto de respuestas WhatsApp

La aplicación prioritaria de esta investigación es **mensajería WhatsApp, especialmente destinos caros**. El costo IA queda fuera del cambio solicitado; los controles de IA se conservan abajo como contraste para explicar por qué no sustituyen el control de entregas. No se requiere reabrir su implementación para adoptar las conclusiones de mensajería.

| Mecanismo del referente | ¿Protege directamente el dinero gastado en WhatsApp? |
|---|---|
| Wallet Manychat y pausa por fondos insuficientes | Sí documenta control financiero de sus envíos de plantillas; no acredita precisión concurrente ni cobertura íntegra del servicio de octubre. |
| Límite diario de autorrecarga Manychat | Acota nuevas cargas automáticas a tarjeta; no el consumo de todo saldo previamente acumulado. |
| Active Contacts Manychat | No: el contacto ya activo puede continuar gastando mensajes. |
| Outcomes Fin / resolutions Zendesk | No acreditado: limitan la unidad comercial de IA; no son presupuestos monetarios por destino WhatsApp. |
| Iteraciones o AI Spend Botpress | No: controlan ejecución/IA, no precio de entrega Meta. |
| Pausa por contacto o fin de automatización | Reduce nuevos envíos sólo si todos los productores respetan esa autoridad; no fija por sí sola costo unitario ni saldo. |

La guía Manychat confirma categoría y país del número destinatario como dimensiones del precio por plantilla entregada. Su tabla publicada se titula vigente **hasta 30-jun-2026**, pese a edición 27-ago; no debe alimentar nuestras tarifas de octubre. [WhatsApp pricing guide](https://help.manychat.com/hc/en-us/articles/14281380243740-WhatsApp-pricing-guide).

En las fuentes consultadas **no se encontró un máximo monetario configurable por respuesta o país destinatario** de estos cuatro productos. No es prueba de ausencia interna. El patrón útil es adaptar control previo de dinero y pausa, sin copiar la línea de crédito Manychat. Para Parallly, el presupuesto operativo puede limitar lo que la plataforma autoriza enviar aunque Meta cobre directamente al tenant; no es un wallet que custodie dinero.

**Inferencia de diseño:** un límite de cantidad de respuestas debe combinarse con costo estimado de cada entrega según categoría, país, moneda, fecha y beneficio aplicable. Antes de producir una respuesta cara, comprobar la reserva disponible; si no alcanza, detener nuevos envíos conforme a una política clara. Ni una negativa ni un handoff enviado por WhatsApp son necesariamente gratis. Un tope por contacto evita que una sola conversación agote el presupuesto, y un tope del tenant limita el conjunto. El detalle de reservas y conciliación corresponde al diseño propio, no está demostrado por los proveedores analizados.

## Resultado

**Los referentes combinan controles diferentes; ninguno de los documentos revisados demuestra un límite universal de costo que resuelva también repetición, abuso, herramientas y mensajería externa.** Un límite de facturación por resultado puede proteger la factura comercial y seguir dejando conversaciones improductivas; un límite de iteraciones corta una ejecución pero puede reiniciarse en el siguiente mensaje. Un handoff no siempre termina la automatización de forma permanente.

| Referente | Unidad económica observada | Freno concreto documentado | Qué no se debe inferir |
|---|---|---|---|
| Fin | Outcome por conversación; ciertas calificaciones comerciales tienen otra tarifa | Límite de outcomes y ruta humana; oferta de escalación ante repetición | No es una reserva exacta de dinero ni tres intentos como corte universal |
| Zendesk | Resolución automatizada verificada | Pausar al agotar allowance; rechazo de bucles puros de bot al publicar | El juez de resolución y el cierre por tiempo no son un control preventivo de costo |
| Manychat | Contactos activos; wallet de mensajería separado | Tope de contactos nuevos, pausa de automatización y límite de bloques sin espera | El mismo contacto activo puede seguir conversando; wallet no demuestra atomicidad concurrente |
| Botpress | Plan, uso de IA y cuotas de invocación/eventos | Iteraciones por ejecución, cancelación, timeout y cuotas | No equivale a límite por caso completo ni a presupuesto de cargos Meta |

Las fuentes y condiciones de cada fila están desarrolladas a continuación. Los límites numéricos son propios del producto citado, no valores recomendados automáticamente para Parallly.

## 1. Intercom Fin

### Repetición y fin conversacional

Fin documenta como bucle tres rondas en las que el cliente repite sin aportar información nueva. En ese caso **ofrece** escalación; una solicitud inequívoca de persona normalmente escala directamente. Las instrucciones configuradas pueden modificar ese comportamiento. La documentación reconoce que expresiones de espera pueden confundirse con aceptación y cerrar una conversación indebidamente. También describe un seguimiento tras cuatro minutos para chat/Messenger, que puede desactivarse. Ese tiempo no debe generalizarse a WhatsApp o todos los canales. [Conversational Fin experience, 19-jun-2026](https://www.intercom.com/help/en/articles/11433030-conversational-fin-experience).

**Control versus prompt:** Escalation Rules actúan sobre atributos detectados; Escalation Guidance es instrucción textual al modelo. Intercom lo expresa como «Guidance is a text-level instruction to Fin's language model». Guidance puede pedir ofrecer, preguntar, escalar o evitar escalación; no controla elementos de UI. Que una regla use un atributo estructurado no demuestra que su clasificación semántica sea infalible. Fin Voice no soporta las mismas Escalation Rules. [Escalation guidance and rules, sin fecha editorial recuperada](https://www.intercom.com/help/en/articles/12396892-manage-fin-ai-agent-s-escalation-guidance-and-rules).

Para procedimientos, la propia ayuda advierte que saltos hacia pasos anteriores y condiciones superpuestas pueden causar bucles. Sugiere ramas exclusivas y código determinista para lógica compleja. Documenta un reintento automático ante 401 y un timeout por inactividad configurable en el bloque que ejecuta Fin. Son mecanismos específicos; no se encontró allí un máximo público general de todos los reintentos de herramientas. [Troubleshooting Fin Procedures and Data connectors, 31-jul-2026](https://www.intercom.com/help/en/articles/13704396-troubleshooting-fin-procedures-and-data-connectors).

### Qué cobra y qué limita

La ayuda distingue resolución, handoff completado por Procedure, descalificación y calificación comercial. Para chat/email con Intercom, publica USD 0,99 para los tres primeros y USD 9,99 para calificación; como máximo un outcome por conversación. Un handoff diseñado dentro de Procedure puede ser cobrable; la escalación por petición del cliente, comportamiento por defecto o reglas globales no lo es. Una resolución puede ser confirmada o asumida cuando no se pide más ayuda. No reducir esta oferta a «sólo cobra cuando nadie humano interviene». [Fin AI Agent outcomes, 30-jul-2026](https://www.intercom.com/help/en/articles/8205718-fin-ai-agent-outcomes).

Hay alertas y límites de outcomes; una alerta sola no detiene Fin. Al llegar al límite, nuevas conversaciones siguen el handoff y las existentes lo disparan en la siguiente interacción. Intercom reconoce que el corte puede ocurrir antes o después del número fijado. El predicado de workflow para límite alcanzado se recalcula cada hora, en la media hora; no es una reserva síncrona. No se configuran estos límites durante el trial, y no eliminan mínimos contractuales. En Voice el tope excluye explícitamente telefonía externa. [Usage management, sin fecha editorial recuperada](https://www.intercom.com/help/en/articles/8991894-how-to-see-and-manage-your-usage).

La página de precios separa los cargos de Fin de usos de canal, incluido WhatsApp. Se usa aquí sólo como evidencia de esa separación, no como autoridad de las tarifas Meta de octubre. [Intercom pricing, consultada 10-sep-2026](https://www.intercom.com/pricing). La ayuda de uso permite alertas de canales; no se encontró allí un tope monetario específico por país WhatsApp. [Usage management](https://www.intercom.com/help/en/articles/8991894-how-to-see-and-manage-your-usage).

### Abuso: alcance concreto

El Inbox documenta limitación por remitente para aperturas de email, pero no bloquea respuestas a hilos existentes; el umbral numérico no se publica en esa página. Bloquear un usuario depende de su identidad/email y puede eludirse creando otra identidad; recomienda verificación JWT para Messenger y revisión de falsos positivos. No es prueba de un control equivalente por contacto de WhatsApp ni de un bloqueo financiero del bot que conversa con otro bot. [Inbox FAQs, sin fecha editorial recuperada](https://www.intercom.com/help/en/articles/8838656-inbox-faqs).

## 2. Zendesk AI agents

### Bucles, escalación y terminación

El constructor rechaza publicar un ciclo de mensajes del bot sin un bloque intermedio de mensaje del visitante. El error es «This message leads into an infinite bot message loop». Incluir una intervención del usuario permite ese tipo de ciclo: por tanto, este control estructural no detecta por sí mismo una conversación semánticamente estancada. La página aclara la transición de la denominación Ultimate/Advanced al producto unificado en mayo de 2026. [Publishing errors, editada 11-jun-2026](https://support.zendesk.com/hc/en-us/articles/8357756614426-Publishing-errors-in-AI-agents-Ultimate).

La estrategia de escalación se configura mediante bloques; puede comprobar disponibilidad humana y usar una vía alternativa fuera de horario, además de un fallback cuando la escalación falla. **En email**, permite detener la automatización tras completar cierto número de casos de uso. Un caso de uso puede necesitar varios turnos: ese número no es límite de mensajes ni regla global para WhatsApp. [Configuring escalation strategies and flows, editada 21-ago-2026](https://support.zendesk.com/hc/en-us/articles/8357756604186-Configuring-escalation-strategies-and-flows-for-AI-agents).

BotQA informa escalaciones, repetición, eficiencia y sentimiento. Es observación posterior para mejorar el sistema; la página no describe que esas métricas corten una ejecución en curso. [BotQA dashboard, editada 19-mar-2026](https://support.zendesk.com/hc/en-us/articles/7418648572826-Using-the-BotQA-dashboard-to-understand-AI-agent-escalations-and-performance).

### Resolución facturable y presupuesto

Los tiers introducidos el 18-may-2026 distinguen escalación asistida, resolución contenida y resolución verificada. Las dos primeras no consumen allowance; la verificada debe superar evaluación por LLM del texto de la conversación al terminar. En mensajería se considera terminada por defecto dos horas después del último mensaje, ampliable hasta 72 horas mediante soporte; email usa 72 horas. **Ese reloj es para cierre/medición**, no un máximo de duración de una conversación activa ni prueba de éxito del negocio. [About automated resolution tiers, editada 24-ago-2026](https://support.zendesk.com/hc/en-us/articles/9570369117338-About-automated-resolution-tiers).

Puede mantenerse la IA con sobrecostos o elegir «Pause functionality and don't allow overage». Con pausa, las solicitudes pasan a agentes y la configuración se conserva hasta recuperar allowance. Contratos pueden deshabilitar la opción de sobreconsumo. La página describe la política comercial, pero no publica margen de sobrepaso concurrente o algoritmo de reserva. [What happens when I exceed my automated resolutions limit?, editada 7-sep-2026](https://support.zendesk.com/hc/en-us/articles/9751536041754-What-happens-when-I-exceed-my-automated-resolutions-limit).

**Temporalidad:** las cuentas revendidas por partners tienen un rollout anunciado: visibilidad desde 15-sep-2026 y cobro automatizado de sobreconsumos desde 15-nov-2026, sin retroactividad. No afirmar que ese cambio ya opera universalmente el 10 de septiembre. [Anuncio de cuentas revendidas, 31-ago-2026](https://support.zendesk.com/hc/en-us/articles/11152835173658-Announcing-automated-usage-tracking-and-overage-billing-for-partner-resold-accounts).

No se encontró en estas fuentes un máximo general de gasto LLM por conversación ni una protección económica específica contra usuarios que nunca llegan a una resolución verificada. Esa ausencia documental no prueba que no existan controles internos.

## 3. Manychat

### Límites del flujo y autoridad humana

Una automatización admite hasta 30 bloques sin pausa por contacto suscrito; al superar ese límite, se pausa. Un botón o Smart Delay introduce una pausa. Es una defensa del motor frente a cadenas automáticas, no un límite de 30 respuestas IA ni de 30 mensajes mensuales. Un ciclo con esperas puede seguir acumulando consumo. [How to build a Manychat automation, actualizada 3-dic-2025](https://help.manychat.com/hc/en-us/articles/14281166306332-How-to-build-a-Manychat-automation).

La acción Pause all automations permite pausa por contacto desde 30 minutos hasta indefinida. No admite pasos posteriores; las otras acciones del mismo nodo se ejecutan antes de pausar. Se puede combinar asignación y pausa, y un operador puede reanudar manualmente. [Pause all automations, actualizada 17-feb-2026](https://help.manychat.com/hc/en-us/articles/19957883687708-How-to-pause-all-automations).

Al responder una persona desde Inbox se aplica una pausa automática de 30 minutos. Es una ventana temporal, no una cesión permanente e irrevocable al humano. [Manychat Inbox, consultada 10-sep-2026](https://help.manychat.com/hc/en-us/articles/14281070478748-Manychat-Inbox).

AI Step describe metas, tareas, contexto e instrucciones. En esa guía no se encontró un número máximo verificable de turnos por AI Step ni un límite monetario. No trasladar a su funcionamiento interno los 30 bloques del constructor ni tratar «alcanzar una meta» como una garantía de salida. [Manychat AI Step, actualizada 31-jul-2026](https://help.manychat.com/hc/en-us/articles/14281187288860-Manychat-AI-Step).

### Contactos y wallet: dos presupuestos distintos

El modelo de Active Contacts introducido el 2-mar-2026 se aplica por defecto a cuentas nuevas, con migración regional de anteriores. Al superar el plan se aplican sobrecostos salvo configuración restrictiva. El administrador puede fijar contactos adicionales o no permitirlos. **Al alcanzar ese umbral, las automatizaciones siguen para contactos ya activos en el ciclo.** Por ello el límite controla expansión de audiencia, no intercambios repetidos con una misma persona. Un importado sólo cuenta como activo si participa en las interacciones documentadas, incluido Live Chat. [Active Contacts, actualizada 27-ago-2026](https://help.manychat.com/hc/en-us/articles/25800323349020-Active-Contacts).

El wallet paga plantillas WhatsApp y email por separado de la suscripción. Comprueba saldo antes del envío, descuenta después y pausa automatizaciones asociadas si no alcanza. La autorrecarga viene desactivada; se pueden fijar umbral, importe y límite diario de recargas. **Límite de recarga no es límite de consumo del saldo acumulado**, y la página no documenta reserva concurrente. Su texto es de diciembre de 2025: no usarlo como prueba de implementación de todas las nuevas categorías Meta de octubre. [Manychat Wallet, actualizada 3-dic-2025](https://help.manychat.com/hc/en-us/articles/14281283755164-Manychat-Wallet-for-Email-Message-Templates).

Manychat declara que, en su modalidad WhatsApp, comparte su línea de crédito y paga a Meta; no admite un método alternativo para sus envíos. Un wallet positivo no basta si esa línea no está compartida. La página ya menciona la cuota de servicio 1.000, sin explicar allí su fecha efectiva: debe contrastarse con documentación Meta, no extrapolar una exención de pago a Parallly. Esta arquitectura comercial requiere acuerdos propios; no nace de implementar una tabla de saldo. [Credit Line troubleshooting, actualizada 27-ago-2026](https://help.manychat.com/hc/en-us/articles/16339428975900-WhatsApp-Credit-Line-troubleshooting).

## 4. Botpress

### Iteraciones y cancelación: límite fuera del prompt

En **ADK v1.17**, `execute()` admite `iterations`: por defecto 10, restringido a 1–100. Termina al responder y esperar al usuario, al activar una salida o al alcanzar el límite. Admite `AbortSignal` para cancelar durante el loop. Esto es un parámetro de ejecución, no una sugerencia al LLM. No establece una cuota acumulada de todas las ejecuciones del mismo caso o usuario. [Run AI agents in a conversation, documentación versionada v1.17, consultada 10-sep-2026](https://botpress.com/docs/adk-v1-17/conversations/ai-execution/).

En la misma versión los workflows tienen timeout predeterminado de cinco minutos, ajustable; incluyen cancelación, finalización/fallo y pasos persistidos. No debe confundirse ese timeout de workflow con el tiempo de inactividad de una conversación. Cancelar el proceso tampoco demuestra por sí solo reversión de una herramienta externa que ya produjo efectos. [Create workflows, ADK v1.17](https://botpress.com/docs/adk-v1-17/workflows/create/).

### Fin, handoff y gasto

En Studio, Error y Timeout terminan mediante End Node. Conversation End sólo se ejecuta ante un fin explícito; los Autonomous Nodes no transicionan a ese cierre por defecto cuando el usuario termina. Es necesario diseñar esa salida, no confiar en que decir adiós la ejecuta. [Workflows, sin fecha editorial visible](https://botpress.com/docs/studio/concepts/workflows/).

HITL Agent permite timeout de espera humana; al agotarlo, el bot continúa el workflow actual. Se puede cancelar el pedido de atención y configurar mensajes de estados. La cesión a una persona requiere política explícita para reanudación, espera vencida y canal; no es un bloqueo permanente automático. [HITL Agent, sin fecha editorial visible](https://botpress.com/docs/studio/concepts/agents/hitl-agent/).

El workspace separa AI Spend —generación, conocimiento y otras acciones IA, facturadas al costo declarado del proveedor— de cuotas de mensajes/eventos; esta última puede detener respuestas al agotarse. Hay desglose por acción y avisos de cuotas. La Academy indica que, agotado el presupuesto IA, debe aumentarse para continuidad. No se encontró allí garantía pública sobre precisión bajo concurrencia ni presupuesto de las herramientas externas. [Configure your workspace](https://botpress.com/docs/studio/get-started/configure-your-workspace/), [AI Spend Academy](https://botpress.com/academy-lesson/ai-spend), ambas consultadas 10-sep-2026, sin fecha editorial visible.

Los límites de plataforma documentan cuotas y velocidad por bot. Eso limita capacidad, pero un atacante puede consumir a una velocidad inferior; un rate limit no equivale a progreso útil ni reparto justo por contacto. Los valores dependen de producto/plan: no se usa esa página para cotizar capacidad universal. [Platform Limits](https://botpress.com/docs/studio/guides/advanced/additional-information/limits-and-quotas-of-botpress-cloud/).

La guía para sumar gasto después de Conversation End advierte que un Autonomous Node puede esperar al timeout antes de actualizar el total. Es medición posterior, insuficiente como autorización preventiva de la siguiente llamada. [Track AI spend in a table](https://botpress.com/docs/studio/guides/how-to/track-ai-spend-in-table/).

## 5. Qué debe llevarse al diseño propio — inferencias, no claims del mercado

1. **Separar cuatro frenos:** iteraciones/tiempo por ejecución; falta de progreso por caso; frecuencia/abuso por identidad; reservas de gasto LLM y mensajería. El mismo contador no representa los cuatro.
2. **Medir progreso con resultados observables:** dato nuevo útil, estado del trámite, verificación de herramienta o decisión del cliente. La repetición textual es una señal; una conversación larga y productiva no es abuso.
3. **No usar el cobro por resultado como guardrail:** una conversación sin resultado puede gastar recursos. Definir resolución, pausa, espera, handoff y abandono como estados distintos y auditar su efecto financiero.
4. **Handoff con autoridad y recuperación:** decidir quién puede responder después, cuándo se reanuda y qué ocurre si no hay humano. Una pausa de 30 minutos o un timeout no demuestra que el siguiente mensaje deba reactivar IA.
5. **Presupuesto preventivo y visible:** distinguir aviso, límite blando, reserva estricta, saldo y autorrecarga; explicar qué costos quedan fuera. Un débito posterior o agregado horario no prueba un techo exacto.
6. **Tratar fraude sin castigar dificultad legítima:** aplicar pausas o verificación progresiva, estados revisables y recuperación. No trasladar filtros de email a WhatsApp ni bloquear por idioma/frustración como sustituto de evidencia de abuso.
7. **Reintentos por tipo de error y operación:** autenticar/corregir permisos no es repetir la misma tool indefinidamente. Antes de reintentar un writer, resolver si el primer intento dejó efecto; un límite de loops no resuelve duplicidad.

Estos patrones requieren pruebas propias: bots conversando entre sí; cliente que repite sin información; cliente que aporta información nueva; respuesta humana; espera de pago/proveedor; fallos repetidos; múltiples conversaciones de un contacto; múltiples contactos de un tenant; presupuesto concurrente; saldo desconocido; reanudación; y límites que se agotan sin acceso a una persona. Las pruebas deben medir costo y estado final además del texto.

## Límites de la investigación

No se validaron implementaciones internas ni contratos particulares. La documentación puede diferir entre cohortes, superficies y versiones: se conservaron esas diferencias. Las páginas de pricing de Botpress fallaron al abrirse con el lector web; sus promesas de marketing no se usaron como prueba de exactitud presupuestaria. No se utilizó contenido de foros, competidores indirectos o comparadores como evidencia.

Para reglas y cargos WhatsApp de octubre, la autoridad continúa siendo [la evidencia oficial Meta del paquete](./meta-official-pricing-evidence.md), no la ayuda de estos proveedores. Este documento no declara que Parallly ya implemente los controles inferidos ni autoriza gastos o cambios productivos.
