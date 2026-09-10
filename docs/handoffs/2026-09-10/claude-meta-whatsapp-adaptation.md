# Adenda para Claude: adaptación Meta/WhatsApp, costos y planes

Fecha: 10 de septiembre de 2026. Se agrega a [la directiva de cierre del release](claude-release-closure-after-pr-review.md). Investigación de partida: [informe completo](../../research/2026-09-10/meta-whatsapp-impacto-rentabilidad-plan.md), con fuentes primarias, auditorías, tarifas oficiales y modelo editable.

## Mandato y continuidad

El nuevo tema pendiente antes del despliegue es la adaptación a Meta/WhatsApp. Al recibir esta directiva, incorpórala al plan y continúa cerrando todo el trabajo local ejecutable. Conserva lo construido: términos acordados, outbox, ledger de turnos, procedencia de aprendizaje, publicación/rollback, certificación y benchmark. No construyas autoridades paralelas ni reduzcas garantías para cumplir una fecha.

No reinicies la auditoría de la plataforma. Valida contra HEAD los hallazgos concretos de esta investigación, reproduce las brechas y corrígelas con pruebas que fallen antes. El código cambia en paralelo; los hashes y cifras de documentos previos no sustituyen el árbol actual.

Continúan las restricciones del release: misma rama/PR draft, commits incrementales con rutas explícitas, sin `git add .`/`-A`, sin reescribir historia, sin merge/main, producción, migraciones en entornos de terceros, contratación, nuevas credenciales de cuentas reales, envíos externos o gasto sin autorización específica. Sí puedes crear credenciales sintéticas, usar bases locales desechables y ejecutar en ellas migraciones y pruebas PostgreSQL. No cambies precios ni condiciones de clientes reales. Prepara implementaciones, propuestas versionadas y ensayos sintéticos; expón los gates externos cuando corresponda.

Preserva todo cambio ajeno que veas al iniciar. La lista anterior de cuatro archivos no es exhaustiva: durante esta investigación había cambios concurrentes del preflight de términos huérfanos en workflow/package/scripts/specs. Determina autoría antes de tocar/stagear. Este paquete de investigación también debe preservarse; si un hecho queda obsoleto, corrígelo con evidencia y fecha en vez de borrarlo silenciosamente.

## Decisiones de trabajo y hechos que no debes convertir en supuestos

- Diseña **pago directo tenant→Meta** como flujo base, verificando que el contrato y cuenta reales lo permiten. Suscripción Wompi de Parallly y pagos consumidor→tenant siguen separados.
- Servicio/utility cambian el 1-oct-2026; preparación de pago antes del 30-sep. La cuota de 1.000 es por número/mes, no por tenant/país ni por respuesta IA. No prometas cuota sin método de pago.
- El prepago oficial India/INR/UPI no permite una recarga Meta colombiana vía API. No implementes una pantalla que simule hacerlo.
- Conservar contexto pagador es obligatorio para nosotros; el nuevo parámetro externo se usa según soporte/cohorte. No exigir APIs WAAC de 2027/2028 a toda cuenta legacy ahora.
- El seed no es la base de producción. Anual COP tiene descuento 15 %; no hay precio anual USD independiente. Custom cero no es gratis.
- 70 % de contribución es objetivo propuesto. Los costos del Excel son hipótesis; no los conviertas en defaults comerciales ni pruebas de margen.
- No declarar que Meta Business Agent carece de reservas/pagos/herramientas ni que somos superiores sin benchmark real.

## M0 — inventario derivado y plan ejecutable

Produce un inventario calculado del código, no una lista escrita que pueda omitir productores:

1. Ingresos y emisores WA: servicio WA, adaptador API, humano, IA, campañas, automatizaciones, recordatorios, Flows, media, herramientas de pago y pruebas de conexión. Para cada uno, camino de ejecución, endpoint/versionado, identidad, pagador, consentimiento, presupuesto y recibo.
2. Todos los usos de `message.from`, `recipient_id`, normalización telefónica, credenciales por número/WABA y fallbacks. Sigue consumidores hacia CRM, identidad, tools, learning, consola y móvil.
3. Todos los consumidores de LLM/media/RAG/Assist/certificación y sus contadores. Identifica dónde se pierde uso o se puede gastar concurrentemente por encima del techo.
4. Planes/features que prometen WhatsApp credit, ilimitados o capacidad de canales que no es operativa.
5. Exportador **de sólo lectura**, sin secretos/PII, para runtime de planes/contratos/overrides y configuración de cuentas. Errores son errores; cuenta desconocida no es financiada; no ejecutar producción por esta directiva.

Anexa M0–M6 al reporte de cierre existente con condición comprobable, pruebas, estado y gate concreto. No convertir “falta presupuesto para piloto” en bloqueo de todo el trabajo de ingeniería.

## M1 — continuidad: identidad, remitente, pagador y pago

### Identidad BSUID de extremo a extremo

Normaliza teléfono opcional e identificador opaco con scope. Maneja `from_user_id`, `user_id`, `recipient_user_id`, alias verificados y eventos de cambio. No pase BSUID por E.164 ni intentes reconstruirlo con dígitos. Username sirve para mostrar, no como clave estable.

Conserva compatibilidad con contactos y envelopes antiguos. Sigue ambos ingresos y todos los emisores hasta el destinatario real: respuesta normal, tool, media, Flow, recordatorio, pago y humano. Una tarea que requiere teléfono debe solicitarlo sólo allí; una FAQ no puede romperse porque falte. Borrado y procedencia deben cubrir alias y datos derivados. No autoasociar personas entre tenants.

Pruebas: sólo BSUID, teléfono+BSUID, teléfono antiguo, contacto previamente conocido, cambio de número/username, estados fallidos sin destinatario, duplicado/replay, dos portfolios con igual identificador aparente, solicitud y negativa a compartir teléfono. Demuestra el recorrido UI/API/DB/outbox con proveedor sintético y mensaje sin `from`.

### Selección exacta y credenciales

Reproduce el fallback en `channel-token.service.ts` que devuelve otro teléfono del tenant cuando falta el solicitado. Elimina esa sustitución. Identifica cualquier llamada que dependía del fallback y obliga a resolver explícitamente la conexión autorizada antes del efecto.

Modela conexión/número, portfolio, Messaging Account pagadora, credencial/grant y futuro WAAC nullable. Conserva selección dentro del efecto durable. Una cuenta con múltiples pagadores debe desambiguarse; si no puede hacerlo de forma soportada, rechaza ese envío antes de producirlo. Prueba legacy compatible.

No revocar tokens por el nombre `system_user_token`: esa fila puede guardar distintos tipos. Diseña inventario y migración de BISU por cliente, validando app, owner, scopes, activos, expiración y rollback. No fallback silencioso a System User global o credencial de otro negocio.

Pruebas: dos tenants/dos teléfonos, token sin alcance, cuenta faltante, caché obsoleta, dos Messaging Accounts para un número, revocación/cambio entre reserva y envío y reinicio con efecto pendiente. Cero cambio de remitente/pagador por reintento.

### Financiación y recuperación operables

Estados diferenciados: no comprobado, adjunto, ausente, restringido y desconocido, con fuente y fecha. `primary_funding_id` ausente sólo prueba ausencia ante respuesta válida del recurso y permiso correctos. Adjuntado no equivale a solvencia. Error Graph/timeout no se convierte en verde ni en ausencia falsa.

Maneja 131042 tanto en respuesta de envío como en webhook posterior a HTTP 200. Es elegibilidad de pago, no necesariamente falta de saldo. Conserva aceptación/entrega/fallo como hechos distintos y reutiliza la autoridad durable de recibos. No revivir fallos ni duplicar transferencias/cobros.

Pausa productores cobrables de la cuenta afectada, conserva entrada y trabajo, muestra resolución al administrador por dashboard/canal autorizado. Al reparar, revalida vigencia, consentimiento, ventana, dueño del turno, estado de negocio y presupuesto. No reenvíes ciegamente todo el backlog. Prueba account-specific pause: otras cuentas no deben quedar detenidas por error ajeno.

## M2 — octubre: precio, cuota y onboarding

### Tarifas y eventos

Importa tarjetas con fecha, moneda y versión desde los archivos oficiales conservados. Mantén precisión decimal y mercados nuevos. No recomputes COP por TRM ni conviertas `n/a` en cero. La estimación puede ser conservadora; el importe facturado se concilia y conserva fuente.

Extiende el envelope y proyección de estados para preservar información de categoría/precio, no sólo raw JSON aislado. Deduplica cargos dentro de tenant/cuenta/recibo, sin descartar un evento de costo más completo por compartir estado. `accepted`, `sent`, `delivered`, `read` y factura no son unidades intercambiables. Dos estados delivered/read no duplican gasto.

Implementa contador por número/mes y tarifas por país/categoría con timezone aplicable. Audiencia mixta comparte los 1.000, no una cuota por país. No dar por verificado el comportamiento FEP/cuota cuando la fuente no lo precisa: conserva unknown, intervalo estimado y ajuste posterior. No alteres facturas históricas al actualizar tarifas.

Prueba 999/1000/1001, dos números con distribución desigual, varios países, mes/zona, eventos fuera de orden, duplicados, costo omitido, categoría corregida, cambio septiembre→octubre en cola, utility dentro de ventana, FEP vs permiso de texto libre, humano/media/Flow sin turno IA y actualización de costo del recibo. Tarifas reservadas y tarifa aplicada por Meta al entregar pueden diferir: revalidar exposición y detener sobrepresupuesto no autorizado.

### Assist y configuración guiada

Aplicar [el contrato de tarjeta Meta y separación de seguridad](../../research/2026-09-10/meta-card-setup-and-security-contract.md): ingreso en página oficial Meta, guía/retorno/comprobación en Parallly y autorización de consumo separada de la suscripción. Conserva las ramas directo/partner/desconocido y la frontera real del formulario Wompi de Parallly.

Integra el paso pago Meta en el contrato real de readiness y resoluciones de Assist, no sólo en un tour. Explica quién cobra, por qué, estimación y límite antes de activar. Abre el destino correcto, relee al volver, muestra última comprobación y no confunde suscripción Parallly con financiación Meta.

La tarjeta se introduce en Meta. No pedir PAN/CVV en chat, guardarlo en logs ni simular un formulario de tarjeta con una API inexistente. Una atestación manual no es verificación del proveedor.

Actualiza tours por tareas y estados, es/en/pt/fr, teclado, móvil y errores recuperables. Prueba signup v4, coexistence, conexión existente, varias WABA, permisos incompletos, cancelación, retorno y fallo de relectura. Comprobar v4 en todas las entradas antes del retiro de v2 el 8-oct. No confundir versión SDK, Graph, Embedded Signup y sessionInfoVersion.

## M3 — control económico completo sin degradar la función

Reutiliza ledger de uso/presupuesto donde exista, con una autoridad transaccional. Antes de cada operación que genera costo, reservar techo estimado y concurrencia; después, registrar costo real y liberar diferencia. Si el proveedor cobra más que la reserva, registrarlo honestamente y impedir gasto nuevo según política; no falsificar el costo para conservar el límite.

Incluye chat, loop de tools, fallback, Assist, copiloto, media, RAG/embeddings, extracción, aprendizaje, certificación, benchmark, jobs y campañas. Usage por proveedor debe tener categorías disjuntas: reasoning puede estar incluido en output; caché tampoco se suma como tokens nuevos si ya está incluida.

No sumar Redis como factura final ni asumir error de telemetry=cero. Conserva incertidumbre por timeout/cancelación/uso omitido; reconciliación por proveedor. Define comportamiento contractual de alerta, límite técnico y cupo de plan. Si no hay modelo certificado dentro del presupuesto, ofrece resolución segura/explicada o humano, no una compra ejecutada por un fallback incompetente.

Corrige financiero: precio contractual, anual devengado/12, ingresos netos de impuestos según configuración validada, fees, FX, todos los proveedores, soporte/infra asignados y costo de evaluación. Distingue caja, contribución y resultado operativo. No cobrar sobrecostos automáticamente sin aceptación.

Prueba concurrencia real PostgreSQL, caída Redis, COMMIT incierto, proveedor sin usage, gasto parcial, reintento, reserva vencida con efecto incierto, annual/refund/coupon, contrato cero/incompleto y mayor costo real que reserva. La calidad del agente debe quedar evaluada bajo los límites, no sólo el ledger.

## M4 — propuesta de planes y transición

Usa los cinco planes actuales y datos efectivos para generar escenarios por país/canal/tarea/ciclo, uso 10/50/100 %, costo p50/p95/p99 y stress. Importa costos reales cuando se autorice; antes de ello etiqueta hipótesis.

Entrega propuestas de precio/cuota/calidad/soporte que cumplan el margen objetivo propuesto, mostrando sensibilidad y límites. No impongas los números del Excel de investigación. Mantén Custom bajo contrato y corrige ilimitados cuyo costo no esté acotado.

Implementa catálogo/versiones/vigencia y mecanismos de migración revisables, preservando los contratos. Inventaría “crédito WhatsApp” vendido; no eliminar unilateralmente derechos. Asegura paridad runtime/landing/checkout/factura/feature flags/cuatro idiomas. No publicitar checkout en moneda o país no habilitado.

Deja el cambio comercial concreto listo para aprobación: precio anterior/nuevo, capacidad, clientes afectados, fecha y comunicación. No actives una reprecificación en producción ni mandes comunicación comercial por esta directiva.

## M5 — política, aprendizaje, calidad y release

Conserva el negocio y tareas autorizadas del agente en WhatsApp. Revisa elegibilidad por actividad/país/producto; no uses la existencia de una plantilla para afirmar autorización de Meta. Documenta la discrepancia oficial sobre Venezuela y requiere confirmación del caso antes de prometer servicio, sin borrar cuentas existentes.

En learning, preserva origen WhatsApp y restricciones de finalidad a través de import/export/redacción/resumen. No promover chats privados a corpus compartido/global. Seleccionar buenos ejemplos por resultado verificable y revisión; publicación/rollback y erasure siguen llegando a derivados. Preparar revisión de contratos LLM/retención; no declarar que anonimización o RAG concede una excepción automática.

Mantén Meta Business Agent apagado salvo decisión específica. Si una cuenta ya lo usa, detectar control externo y evitar respuestas dobles. No inventar arbitraje externo a partir del candado interno. Marketing avanzado, Direct Send, calling/grupos y wallet de reventa son M6: separados, con flags y elegibilidad, sin bloquear continuidad básica innecesariamente.

Conecta estos cambios con las pruebas de release ya exigidas: publicación/rollback real, no repetición de writers/handoff, migraciones clean/upgrade y preflight compatible antes de despliegue. Ejecuta contratos/integración/UI relevantes al cambiar cada bloque y la puerta completa sobre HEAD final. No repetir toda la suite tras cada cambio documental ni omitir PostgreSQL.

Prepara staging, canario y rollback: cuenta/número sintéticos para ensayo; piloto real sólo con tenant, destinatario consentido, credenciales y techo de gasto autorizados. Verificar entrega, categoría, cuenta pagadora, consumo observado y conciliación; pruebas sintéticas no certifican financiación. Fuera del permiso de texto libre, el piloto debe usar una plantilla válida y no inventar interacción previa.

## Cierre y entrega

El reporte final debe distinguir:

1. Implementado y probado localmente, con commits y evidencia que habría fallado antes.
2. Preparado para staging, todavía no desplegado.
3. Verificado con proveedor real, sólo si se autorizó y ejecutó.
4. Decisión comercial/contractual pendiente, con impacto cuantificado.
5. Betas opcionales diferidas y razón concreta.

Incluye HEAD, diff, estado de árbol, pruebas/omisiones, evidencias derivadas del código, cuentas/costos desconocidos, datos necesarios, runbook de canario, abortos y rollback. No declarar margen real, todos los perfiles certificados o listo para activación general por tener pruebas unitarias verdes.

La entrega local termina cuando no quede brecha implementable conocida en M0–M5, el cierre técnico previo siga íntegro y todo remanente sea dato/credencial/infra/presupuesto/decisión externa identificada. El usuario aprueba la propuesta comercial y el despliegue concreto una vez revisables; no detener el trabajo antes para pedir permiso por arreglos locales ya autorizados.
