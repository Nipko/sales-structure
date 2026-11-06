# Jelou y respond.io: controles de mensajes, progreso y gasto WhatsApp

Consulta y corte: **10 de septiembre de 2026**. Fuentes públicas oficiales de ambos proveedores; sin iniciar sesión, ejecutar agentes, enviar mensajes ni generar cargos. Prioridad de esta revisión: **el costo de efectos salientes WhatsApp, especialmente destinos caros**. La IA se incluye solamente cuando ayuda a distinguir contadores que no deben confundirse.

**Resultado:** ambos proveedores publican estrategias para reducir mensajes y controles concretos de seguimiento, interrupción o ejecución. No encontré en las fuentes examinadas una especificación suficiente para certificar un presupuesto monetario WhatsApp obligatorio por contacto, tarea y país que se reserve antes de cada envío y cubra todas las vías de salida. Eso significa **capacidad no verificada públicamente**, no que carezcan de ella.

Clasificación empleada: **producto documentado** describe comportamiento de una ayuda técnica, sin ensayo propio; **configuración/prompt** requiere instrucciones o diseño del cliente; **oferta comercial** identifica precios o compromisos publicados; **marketing** contiene resultados o capacidades anunciadas sin contrato técnico reproducible. Las fechas editoriales no prueban cuándo se desplegó una función.

## Diez hallazgos decisivos

### 1. Ambos ya comunicaron una respuesta al cambio de octubre, pero una estrategia de ahorro no equivale a un freno de gasto

**respond.io — oferta y recomendaciones, 7-sep-2026.** Anuncia mantener su suscripción, trasladar la tarifa Meta sin margen añadido y eximir la comisión de tarjeta de recargas WhatsApp **desde el 1 de octubre hasta nuevo aviso**. Recomienda agrupar contenido en menos mensajes y responder a entradas elegibles de anuncios/CTA para aprovechar FEP. No presenta allí un control automático por país o importe máximo por conversación. La [calculadora específica de octubre](https://respond.io/whatsapp-pricing-calculator-october-2026), sin fecha editorial visible, estima por categoría y destino; una calculadora no limita despachos. [Anuncio oficial](https://respond.io/blog/whatsapp-pricing-change-2026).

**Jelou — marketing y diseño, 8-jul-2026.** Propone objetivos de **hasta seis turnos**, formularios, botones, Flows y webviews; anuncia monitoreo de mensajes por conversación, límites de uso y selección entre modelos según país/caso. No especifica en el artículo la granularidad ni la aplicación transaccional de esos límites. Sus comparaciones de ahorro son resultados autodeclarados, sin corpus y verificación independiente examinados. **Seis turnos es una recomendación de diseño, no un máximo obligatorio documentado.** [Artículo oficial](https://jelou.ai/en/blog/nuevos-precios-whatsapp).

Estas fuentes prueban lo que los competidores anuncian; **las tarifas y excepciones Meta deben salir de fuentes Meta**, no de sus simplificaciones comerciales. Tampoco corresponde extrapolar el precio de Meta Business Agent API al agente de la app.

### 2. respond.io tiene saldo WhatsApp separado, alertas y suspensión; la recarga automática busca continuidad, no un techo mensual

**Producto documentado, 6-sep-2026.** El saldo se comparte entre números de una WABA. Se puede establecer umbral de aviso y de recarga automática, consultar consumo y pagar con una tarjeta distinta por WABA y distinta de la suscripción. Las recargas admiten **US$10–2.000 por transacción**. La ayuda aún publica comisión del **5,5%**, que debe leerse junto al anuncio futuro del hallazgo 1.

La ayuda advierte que el saldo puede hacerse **negativo** al enviar plantillas; entonces suspende los canales de esa WABA hasta recargar. Por tanto, no se puede prometer que el saldo sea un techo sin sobrepaso bajo concurrencia. Tampoco documenta en esa pantalla un importe mensual máximo acumulado de recargas, ni un cupo por contacto o destino. La factura mensual no desglosa cada conversación. [WhatsApp Fees](https://respond.io/help/organization-settings/whatsapp-fees).

**Implicación propia:** la falta de saldo puede terminar afectando a toda la WABA; el atacante o conversación improductiva necesita frenarse antes de consumir el saldo compartido.

### 3. Existen controles de campañas y velocidad; su alcance es distinto al de las respuestas de un agente

**respond.io — producto documentado, 31-ago-2026.** La cuota mensual de broadcasts cuenta mensajes, y si una campaña completa excede el restante, no se envía. Un complemento permite limitar la velocidad por segundo, minuto u hora. Una campaña ya enviándose no se puede cancelar según esa ayuda. Estos controles no se documentan como máximo monetario por destino ni como cuota de todas las respuestas conversacionales. [Broadcasts Overview](https://respond.io/help/broadcasts-module/broadcasts-overview).

**Jelou — documentación de facturación, sin fecha editorial visible.** Publica estimación de créditos antes de confirmar una campaña y descuento al enviarla, con precio según destino y categoría. Esto acredita una revisión previa del costo de campaña; no demuestra reserva atómica ni protección por contacto durante una sesión. La misma página conserva cobro de US$0,20 por conversación que no coincide con su página comercial actual, tratada en el hallazgo 9. **No usar su tabla de países como tarifa Meta vigente.** [Precios de facturación](https://docs.jelou.ai/guides/billing/precios).

La [introducción de API de Jelou](https://docs.jelou.ai/api/introduction), sin fecha visible, declara cinco solicitudes por segundo. Es un límite de solicitudes de API; no una autorización para traducirlo a cinco mensajes cobrables por segundo, ni un límite económico por conversación.

### 4. respond.io agrupa mensajes fragmentados antes de responder

**Producto documentado, 17-ago-2026.** Cada AI Agent permite una espera de **1–300 segundos**, por defecto un segundo. Un nuevo mensaje del contacto reinicia la espera. La respuesta sale después de ese intervalo y del procesamiento sin nuevos mensajes. Aplica a mensajes de chat iniciados por el contacto; no a seguimientos, acciones o mensajes del sistema. [Advanced Settings](https://respond.io/help/ai-agents/ai-agent-advanced-settings).

**Implicación propia:** puede reducir respuestas separadas a “hola”, “quiero”, “una cita”. No limita una conversación de muchos turnos cuando el contacto sigue respondiendo ni reserva su costo WhatsApp. No encontré una especificación equivalente de debounce en las páginas de Jelou examinadas; eso no prueba ausencia de la función.

### 5. Los seguimientos sí tienen límites documentados, pero cerrar también puede emitir otro mensaje

**Jelou — producto documentado, sin fecha visible.** El nodo AI Agent permite esperar **5–120 minutos** entre recordatorios y detenerse tras **1–5 intentos consecutivos sin respuesta**, por defecto dos. La expiración configurable por inactividad admite **1–1.200 minutos o 1–20 horas**, por defecto ocho horas; al expirar cesan recordatorios. No es un máximo de duración de una conversación que sigue recibiendo respuestas. [AI Agent](https://docs.jelou.ai/guides/nodos/ai-agent).

**respond.io — producto configurado mediante prompt, 7-sep-2026.** Publica hasta **cinco seguimientos por prompt**, cada uno dentro de 24 horas del mensaje anterior. Se detienen por respuesta del contacto, cierre, desasignación o evaluación de desinterés/objetivo cumplido. Su ejemplo de dos seguimientos y luego cierre produce **tres mensajes**, porque el cierre lleva una respuesta; aconseja combinar el cierre con el último seguimiento. Si vence la ventana WhatsApp, la secuencia puede ejecutarse: el mensaje falla y las acciones posteriores continúan. [Guía de prompts y seguimientos](https://respond.io/help/ai-agents/how-to-write-effective-ai-agent-prompts).

**Implicación propia:** hay que contar también recordatorios y despedidas, y no deducir del número de seguimientos un máximo global de mensajes cobrables. El reinicio por nuevas respuestas exige una política adicional contra intercambios interminables.

### 6. Pausar y tomar control humano son operaciones reales; pedir silencio al modelo tiene garantías diferentes

**respond.io — producto documentado, 5-sep-2026.** La acción dedicada **Takeover** detiene al agente y asigna la conversación a la persona; la IA no responde hasta volver a asignársela. [Getting Started](https://respond.io/help/ai-agents/getting-started-with-ai-agents).

La ayuda de **limitaciones, 6-sep-2026**, advierte que una desasignación ordinaria puede dejar salir una última respuesta según el momento de generación. También documenta el modo silencioso mediante instrucciones de respuesta vacía y reconoce que puede emitir alguna respuesta con instrucciones complejas. Por ello, un prompt de silencio no prueba ausencia de efectos salientes. [Known Limitations](https://respond.io/help/ai-agents/ai-agents-known-limitations-and-workarounds).

**Jelou — producto documentado, sin fecha visible.** Tras una herramienta se puede finalizar la función o pausar la interacción hasta reanudación externa. Son transiciones de ejecución configurables; la página no documenta una garantía equivalente a cancelar un envío ya aceptado por el proveedor. [AI Agent](https://docs.jelou.ai/guides/nodos/ai-agent).

### 7. El bloqueo de spam y la validación de ciclos no equivalen a detectar toda conversación improductiva

**respond.io — producto documentado.** Bloquear un contacto impide posteriores envíos y recepciones en la plataforma; la guía de spam indica cierre y detención de workflows. La ayuda del Inbox es del **4-sep-2026** y la guía de spam del **4-abr-2025**. [Bloqueo en Inbox](https://respond.io/help/inbox/managing-contacts-in-inbox), [Managing Spam](https://respond.io/help/convert-leads/managing-spam).

Su [página comercial de cualificación](https://respond.io/ai-agents-for-lead-qualification), sin fecha visible, anuncia filtrado automático de spam. No se pudo verificar allí el clasificador, umbrales, costo antes del bloqueo ni una detección específica de bot contra bot. No sería correcto afirmar que no ofrecen antispam automático; tampoco atribuirle garantías técnicas no descritas.

La ayuda **15-ago-2026** describe comprobaciones al publicar workflows que pueden detectar pasos enlazados en ciclos y recomienda evitar combinaciones que vuelvan a activar otro workflow. Es control del grafo de automatización, distinto a reconocer que una IA repite la misma pregunta sin obtener información. [Avoid Workflow Loops](https://respond.io/help/workflows/how-to-avoid-workflow-loops).

**Jelou — producto y recomendaciones, sin fecha visible.** Documenta filtros de seguridad de entrada y salida, además de instrucciones para rechazo, incertidumbre y errores de herramientas. No acredita por ello un límite de frecuencia de contactos, bot contra bot o dinero WhatsApp. [Seguridad](https://docs.jelou.ai/guides/agentes-ia/seguridad).

### 8. Medir una acción permite exigir progreso; ni la previsualización ni el autocierre genérico bastan para certificarlo

**respond.io — producto documentado, 6-sep-2026.** Las acciones incluyen actualizar datos y ciclo de vida, ejecutar workflows y asignar o cerrar conversaciones; se ejecutan antes de la respuesta. Esto permite diseñar rutas con cambios observables. [Using AI Agent Actions](https://respond.io/help/ai-agent-actions/using-ai-agent-actions).

Su autocierre de Workspace se inicia tras el último mensaje saliente **humano**; mensajes de IA, workflows y broadcasts no arrancan ni reinician ese temporizador. Por tanto, no debe presentarse como freno general a la inactividad de un agente autónomo. [Assigning and Closing](https://respond.io/help/inbox/assigning-and-closing-a-conversation), **6-sep-2026**.

La prueba de AI Agents no ejecuta seguimientos porque no dispone de sesión real del contacto. [How to Test](https://respond.io/help/ai-agents/how-to-test-ai-agents), **17-ago-2026**. Jelou permite condiciones evaluadas al finalizar el agente, pero no se disparan por expiración ni en el tester. [AI Agent](https://docs.jelou.ai/guides/nodos/ai-agent), sin fecha visible.

**Implicación propia:** medir éxitos sin abandonos sobreestima el progreso. Se necesitan pruebas de sesiones duraderas y contadores de entrega, no sólo que el texto o la simulación parezcan correctos.

### 9. Los pasos de Jelou y los créditos IA de respond.io no son límites de facturación WhatsApp

**Jelou — oferta actual, sin fecha editorial visible.** Publica máximo de pasos por workflow de **20/20/30/100+** para Free/Builder/Growth/Enterprise; cuentan mensajes, herramientas, nodos y workflows hijos. Timeouts de API/herramientas: **10/20/30/60 segundos**. Builder/Growth cobran US$0,019 por ejecución adicional, con IA/consumibles y claves propias separados. La página declara que abandonó la tarifa fija por conversación. [Pricing](https://jelou.ai/es/pricing).

La [guía de ejecuciones](https://docs.jelou.ai/guides/getting-started/ejecuciones-workflow), sin fecha visible, mantiene que múltiples mensajes de una sesión cuentan como una ejecución, y usa lenguaje de mensajes ilimitados. Contar ejecuciones y limitar pasos podrían coexistir, pero no queda armonizado el alcance del corte. Hace falta confirmar qué ocurre al exceder pasos y al reabrir sesiones. No convertir 20 pasos en 20 mensajes WhatsApp máximos por contacto o día.

**respond.io — producto y tarifa, 6-sep-2026.** Los AI Credits son independientes: en planes elegibles hay excedente automático, US$15 por cada bloque de mil créditos, redondeado hacia arriba, y pausa de IA al llegar a **200% del cupo incluido total**. No es un presupuesto WhatsApp ni por contacto. [AI Credits](https://respond.io/help/organization-settings/ai-credits). Su [pricing](https://respond.io/pricing), sin fecha visible, separa las tarifas WhatsApp de la suscripción.

### 10. No está demostrada públicamente la protección económica por destino que necesita Parallly

Esta tabla resume **lagunas de verificación de esta investigación**, no un inventario de funciones inexistentes. Se basa en las ayudas y anuncios anteriores.

| Control que interesa al negocio | Jelou | respond.io |
|---|---|---|
| Tope de dinero WhatsApp por contacto y período | Anuncio de límites de uso; falta contrato técnico preciso | No localizado en ayudas consultadas; saldo WABA es agregado |
| Tope de mensajes salientes por tarea, incluyendo despedidas, errores y seguimientos | Pasos y recordatorios con alcances parciales | Seguimientos y cuotas de broadcasts con alcances parciales |
| Presupuesto diferenciado por país y categoría, aplicado antes de enviar | Anuncia routing por país; no verificado presupuesto de despacho | Calculadora por destino; no verificado presupuesto de despacho |
| Reserva concurrente y conciliación por mensaje entregado | No verificado | No verificado; la ayuda permite saldo WABA negativo |
| Cubre agente, humano, workflow, campaña, herramienta y reintento | No verificado como autoridad común | No verificado como autoridad común |
| Detección de falta de progreso que frena nuevas salidas cobrables | Recomendaciones de diseño y medición; implementación exacta no verificada | Lifecycle, prompts y comprobación de ciclos; detector universal no verificado |
| Detección técnica de bot contra bot sin una cadena de respuestas pagadas | No verificado | Marketing antispam; detalle técnico no verificado |
| Costo máximo de recargas automáticas durante el mes | No verificado | Se documentan umbral e importe, no máximo acumulado |

## Cómo convertir los hallazgos en una decisión para Parallly

**Recomendaciones propias, no prestaciones atribuidas a competidores:**

1. Hacer que la autorización de **cada efecto WhatsApp saliente** evalúe destino tarifario, categoría, ventana y franquicia aplicables; reserve el costo previsto bajo concurrencia; y concilie lo realmente entregado. Contar efectos externos, aunque el agente haya producido una sola respuesta con varios adjuntos o fragmentos.
2. Definir presupuestos separados por tenant, número, contacto/período y tarea. El límite por mensajes y el límite monetario se complementan: el mismo número de mensajes puede costar cantidades distintas según destino. No inferir el mercado desde el idioma, una etiqueta CRM editable o la ubicación comercial del tenant.
3. Reducir mensajes mediante agrupación y captura de varios datos pertinentes juntos; pasar a formulario/Flow/web cuando beneficie la tarea. Optimizar **costo por resultado válido**, no imponer idénticos seis turnos a toda consulta.
4. Detectar repetición sin información nueva, recordatorios sin respuesta, errores reiterados y automatizaciones que se reactivan. Al alcanzar el límite, pausar la automatización o derivar a revisión con estado útil. Una despedida explicativa también requiere autorización presupuestaria; no generar una despedida por cada intento bloqueado.
5. Probar rutas con tarifas sintéticas de destinos baratos y caros, concurrentes, saldo insuficiente, cierre y reapertura, cambio de persona/robot, anexos, proveedores ambiguos y reintentos. Una pausa de IA no debe ser la única defensa si otros productores todavía pueden enviar mensajes.

Para comparar los competidores en una cuenta de prueba haría falta pedir demostración del mismo conjunto: máximo de gasto por contacto/destino, límite activo bajo concurrencia, exportación por efecto entregado y comportamiento tras agotar el presupuesto. No se han utilizado cuentas ni realizado esas pruebas aquí.

## Precauciones de interpretación de las fuentes

- Las condiciones comerciales de promociones deben confirmarse antes de una compra. No se asumió una exención de comisión vigente el 10-sep.
- La página de facturación histórica de Jelou no debe sumarse a la oferta actual como si fueran dos cargos obligatorios simultáneos. Para un cliente concreto manda el contrato aplicable.
- Los porcentajes de ahorro de proveedores, sus comparativas MBA y las restricciones geográficas resumidas en blogs no se usaron como prueba de superioridad ni como autoridad de tarifas o políticas Meta.
- No se verificaron contratos privados Enterprise, reglas configuradas por implementadores, pilotos restringidos ni comportamiento productivo. Ausencia de documentación pública no demuestra ausencia de capacidad.
