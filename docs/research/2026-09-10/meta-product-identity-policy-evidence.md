# Meta: identidad, producto, políticas y compatibilidad

Consulta: 10 de septiembre de 2026. Complementa la evidencia de precios y la auditoría de cuentas. Fuentes primarias consultadas públicamente en navegador; se contrastó el original inglés cuando había traducción automática. El análisis de código describe el árbol leído durante esta investigación; Claude trabaja en paralelo en el cierre del release.

## Identidad sin teléfono: cambio necesario en el recorrido completo

[Business-scoped user IDs](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids), actualizado 24-ago-2026: los usernames se despliegan gradualmente en 2026. El teléfono puede faltar; BSUID identifica al usuario dentro del portfolio. La API admite destino BSUID desde julio. Webhooks incorporan `from_user_id`/`user_id` y estados `recipient_user_id`; algunos estados fallidos omiten identificadores de contacto. El prefijo de país sirve para precios cuando falta teléfono. BSUID cambia al cambiar el número; username y BSUID son conceptos distintos. Las plantillas de autenticación copy-code/one-tap/zero-tap requieren teléfono. Meta ofrece solicitud explícita de información de contacto; no exige obtener teléfono para toda conversación.

La evidencia local muestra una brecha concreta:

- `apps/whatsapp/src/modules/jobs/webhook.processor.ts:74`: `fromPhone = message.from`, usado también como contacto y teléfono al persistir y reenviar.
- `apps/api/src/modules/channels/whatsapp/whatsapp.adapter.ts:222`: normaliza `contactId: message.from`; los constructores de envío usan `to`.
- `apps/whatsapp/src/modules/jobs/webhook.processor.ts:198` y `apps/api/src/modules/channels/channel-delivery-status.ts:136`: sólo proyectan `recipient_id`.
- La búsqueda de `BSUID`, `from_user_id` y `recipient_user_id` no encontró soporte en esos runtimes ni shared. Una búsqueda negativa no sustituye pruebas, pero estos consumidores concretos demuestran la dependencia del teléfono.

**Diseño recomendado:** identidad de canal tipada, con identificador opaco, scope de portfolio, alias telefónico opcional y procedencia de cada vinculación. Nunca pasar BSUID por normalización E.164 ni deducir un teléfono de sus dígitos. Conservar raw envelope con retención apropiada y transformar mediante una única normalización compartida por ambos ingresos.

La compatibilidad debe atravesar CRM, identidad, conversación, reserva/cobro, tools, media, Flow, humano, outbox, auditoría, aprendizaje y borrado. Una persona sin teléfono puede preguntar y resolver tareas que no lo necesitan. Si una entrega o autenticación lo requiere, solicitarlo en ese punto y explicar para qué. Los alias se vinculan sólo con evidencia legítima dentro del tenant, no por igualdad de nombres ni por un BSUID visto en otro negocio. Probar también cambios de identificador, estado fallido sin contacto, replay y contactos preexistentes.

## Meta Business Agent sí compite en ejecución

[Overview](https://developers.facebook.com/documentation/meta-business-agent/overview), actualizado 3-sep-2026: Meta documenta conocimiento del negocio, tono, APIs/webhooks, reservas, confirmaciones de pago, handoff y evaluación. Su elegibilidad depende de país, cuenta, integraciones y categoría; excluye, entre otras, Finance, Government y Health. Esto contradice la tesis local de que carece por definición de herramientas operativas.

[Get started](https://developers.facebook.com/documentation/meta-business-agent/get-started), actualizado 25-ago-2026: el onboarding del agente Meta requiere pago. Expone `messages`, `standby` y `messaging_handovers`, junto con operaciones de control del hilo. Una aplicación en standby no debe interpretarse como agente activo; enviar puede cambiar el control. El versionado propio de esta API no es la versión Graph de Cloud API.

**Recomendación de producto:** competir por tareas completas verificadas: venta con condiciones acordadas, reserva sin doble ocupación, cobro conciliado, seguimiento oportuno, conocimiento vigente y traspaso con contexto. Medir resolución, errores, satisfacción, costo total por tarea resuelta y esfuerzo de configuración. CRM integrado y omnicanalidad aportan valor sólo si el recorrido funciona; no basta una lista de funciones.

No activar Meta Business Agent automáticamente en el número que ya atiende Parallly. Detectar coexistencia de productos y representar dueño externo del turno; si se decide integrarlo, diseñar y probar arbitraje, handoff bidireccional y presupuesto independiente. Los candados internos de Parallly no conceden autoridad frente a otra aplicación de Meta. No declarar superioridad ni ahorro frente a Meta con respuestas sintéticas o una comparación de tokens.

## Marketing, disponibilidad regional y discrepancias

[MM API: Get started](https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/get-started#geographic-availability-of-features), actualizado 30-jun-2026, original inglés: marketing hacia números estadounidenses está suspendido desde 1-abr-2025 en las APIs comerciales. No equivale a suspender servicio ni todos los números +1. EEA, UK, Japón, Corea del Sur, Nigeria y Sudáfrica tienen restricciones de optimización/métricas; no son una prohibición general de mensajes. Rusia/Bielorrusia tienen excepciones de funciones, no un bloqueo general en esa página.

**Discrepancia oficial que debe quedar abierta:** esa página incluye Venezuela entre regiones sin onboarding/envío y afirma alcance a todas las APIs. Sin embargo, [Support: Country restrictions](https://developers.facebook.com/documentation/business-messaging/whatsapp/support#country-restrictions), actualizado 17-jun-2026, original inglés, enumera Cuba, Irán, Corea del Norte, Siria y Crimea/Donetsk/Luhansk, **sin Venezuela**. No se resolvió con una fuente primaria adicional. No prometer habilitación venezolana ni imponer una conclusión jurídica universal basándose en una página discordante; solicitar confirmación de Meta para mercado/producto/cuenta concretos antes de comprometer la oferta. Türkiye dejó de estar restringida para Cloud API en mayo de 2024 según Support.

Diseño recomendado: disponibilidad versionada por producto, país, origen/destino, categoría y fecha, separada de capacidad del plan. Un plan Enterprise no evita reglas Meta. Ante contradicciones, mostrar “elegibilidad por confirmar”; preservar recepción e histórico y no borrar conexiones existentes. Registrar la decisión y su evidencia, en vez de dispersar listas de países en varios frontends.

## Política del negocio y aprendizaje

La [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy) exige consentimiento, respeto de bajas, protección de datos y escalamiento claro cuando se automatiza. El permiso para texto libre dentro de 24 horas y la categoría de plantilla siguen importando aunque cambie el precio. Sectores regulados tienen restricciones específicas por actividad y país; una plantilla vertical de Parallly no autoriza por sí misma el canal. La elegibilidad de Meta Business Agent es otra regla, distinta de la de Cloud API.

Las restricciones de IA y tratamiento de conversaciones se desarrollan en la auditoría [de cuentas y pagos](whatsapp-account-billing-architecture.md#ia-especializada-y-aprendizaje-cambio-de-enfoque), con los [Business Solution Terms](https://www.whatsapp.com/legal/business-solution-terms/) de 6-mar-2026. Deben revisarse el uso efectivo y los contratos, sin suponer que “anonimizado” permite mejorar un modelo compartido.

Diseño recomendado para aprender de “lo mejor”:

1. Seleccionar conversaciones por resolución comprobada, exactitud, consentimiento, tono y ausencia de incidentes; longitud, venta o satisfacción aisladas no bastan.
2. Conservar tenant, canal, fuentes, derechos de uso, release y sujetos afectados incluso después de resumir o redactar.
3. Proponer ejemplos/instrucciones al revisor, comparar contra una batería que penalice errores y publicar una versión reversible.
4. No promover conversaciones reales del canal a plantillas globales o benchmark compartido. Usar corpus sintético para comparar entre negocios.
5. Auditar inferencia, subprocesadores, retención, retirada y borrado; no afirmar que RAG o cambiar el prompt constituye automáticamente una excepción contractual.

Esto complementa la procedencia y retirada ya construidas por Claude; no afirma que se haya encontrado una fuga entre tenants.

## Otras novedades y su prioridad real

El [changelog oficial](https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog), consultado hasta sus entradas de 8-sep-2026, permite separar compatibilidad obligatoria de productos optativos. No todas las betas están disponibles para todas las cuentas.

| Cambio | Impacto y tratamiento propuesto |
|---|---|
| Embedded Signup v2 termina 8-oct-2026; v4 y experiencia phone-first/coexistence evolucionan | Parallly ya usa v4, pero debe inventariar todos los entrypoints y probar callbacks/cancelación/permisos. Tours por objetivo y estado, sin depender de posiciones rígidas en la UI Meta. `sessionInfoVersion` es una dimensión distinta. |
| Registro de cuenta/número y eventos de desconexión/coexistence cambian por cohortes | Consumir pérdida de acceso y reconexión; revalidar credencial, suscripciones y pagador. No retirar PIN ni alterar registro para todas las cuentas por un anuncio gradual. |
| Límites se agregan por portfolio, campos anteriores retirados | Revisar capacidad y webhooks; distinguir cuota del plan, presupuesto, límites Meta y throughput. Detalles en evidencia oficial de precios. |
| Direct Send utility disponible para cuentas elegibles; auth beta | [Direct Send](https://developers.facebook.com/documentation/business-messaging/whatsapp/direct-send), actualizado 31-jul-2026, genera/compara plantillas en segundo plano. Es solución premium gradual, no texto gratis ni forma de eludir categorías. Integración optativa tras verificar elegibilidad, precio y controles. |
| Marketing máximo/`optimization_spec` | Añadir transporte y presupuesto como producto optativo; no romper Cloud API de precio fijo. Detalles y fechas exactas en evidencia oficial de precios. |
| Calling, transcripción, grupos, Local/No Storage, nuevos in-app login y pagos nativos por país | Inventariar como opciones separadas; no declararlas implementadas ni necesarias para el primer release. Cada una necesita elegibilidad, seguridad, costo, retención y prueba propia. Pagos nativos del consumidor no configuran pago de mensajes. |
| Flows y versiones de Data API | Distinguir versión de intercambio de datos de versión del mensaje. Revisar criptografía, endpoint, consentimiento y productor ya construido; no subir una constante por semejanza de nombre. |
| `request_welcome` retirado | La búsqueda no encontró uso runtime; conservar esa evidencia de no aplicabilidad en el inventario, sin agregar código vacío. |

Al preparar implementación, producir un inventario de endpoints realmente usados con versión configurada y efectiva. En el código conviven referencias v21.0 y v25.0. Esta investigación **no determinó el fin de soporte de cada versión**; verificarlo contra el changelog de Graph antes de fijar destino, y ejecutar contratos por endpoint. “Cambiar META_API_VERSION” por sí solo no corrige consumidores hardcodeados.

## Límite de completitud

Se cubrieron precios vigentes/anunciados, límites, pagos, identidad, cuentas, onboarding, marketing, política/IA, competidor nativo y novedades del changelog relevantes al código. Es una revisión completa de impacto con fecha de corte, no una garantía de que no aparecerán cambios futuros o flags específicos de una cuenta. Las discrepancias, contratos y pilotos pendientes se listan en el informe principal y la directiva de ejecución.
