# Fuentes de aprendizaje durante la generación de respuestas

Continuación: `learning-external-source-authority.md` comprueba embeddings y cada solicitud HTTP de los reintentos de generación. Los resultados de este documento son evidencia de la tanda anterior y conservan sus límites originales.

7 de septiembre de 2026. Cambios locales posteriores a `b6db0507`, sin commit ni despliegue. Continúa `learning-inbox-source-authority.md`.

## Frontera implementada

Recuperar ejemplos vigentes no bastaba: el chat podía cambiar entre esa lectura, un intento de proveedor, la siguiente iteración con herramientas o una reescritura. Además, fallar por una fuente retirada podía confundirse con una caída del proveedor y provocar otro intento con el mismo prompt obsoleto.

`LearningService.runtimeSourceAuthority` captura los ejemplos elegidos por el servidor. En cada uso valida tenant/agente, release permitido, hash del snapshot, proyección exacta de cada ejemplo, fuentes train/holdout y estado de los ejemplos. Las candidatas requieren contexto de evaluación sin persistencia. Mantiene el lock compartido de privacidad durante el intento externo y revalida después, sin bloquear conversación/contacto ni la tabla de identidades mientras espera al proveedor. Una edición de Inbox puede avanzar; su respuesta tardía se descarta.

`LLMRouterService.execute` aplica esa autoridad a cada `provider.generate`, tanto en selección por tarea como directa. La revocación detiene el fallback, conserva el uso facturado disponible y no genera una traza de respuesta válida, ni una alarma de caída del proveedor. Un error ordinario de proveedor conserva el fallback habitual, precedido por una comprobación nueva de fuente. La función de autoridad no se envía al proveedor.

| Uso del runtime | Comportamiento |
|---|---|
| Primera respuesta e iteraciones con herramientas | Acumula los ejemplos utilizados en el turno; cambiar la selección visible no elimina la procedencia de texto generado anteriormente |
| Cierre al agotarse el bucle de herramientas | Usa la misma autoridad antes de solicitar una respuesta sin herramientas |
| Correcciones de acción inventada, promesa diferida o precio | Conservan la misma autoridad del turno |
| Fuente retirada/cambiada en operación normal | Descarta el resultado rechazado, limpia ejemplos y prosa/argumentos generados durante el turno y vuelve a responder con persona, contexto y resultados canónicos existentes, sin habilitar más herramientas |
| Fuente inválida en Agent Test/evaluación | Conserva el fallo; no sustituye silenciosamente la candidata por una respuesta sin aprendizaje |

`learningRecoveryMessages` reconstruye el protocolo de resultados a partir de las herramientas ya ejecutadas. No reutiliza los argumentos ni el texto generados bajo los ejemplos rechazados. Las herramientas conservan sus propias transacciones y autorizaciones; la recuperación no vuelve a ejecutarlas ni revierte una acción real.

La prueba de paridad detectó además que el guard de precios podía emitir `response.guardrail.failed` desde una sesión sin persistencia. Ahora esa sesión conserva una señal efímera; la operación normal mantiene el evento. Se corrigió un fixture antiguo de procedimientos para cargar el procedimiento en la captura congelada que realmente consume Agent Test.

## Evidencia y límites

Validación final: **ocho suites / 98 pruebas pasan**, incluidas **25 PostgreSQL/Prisma de fuentes de aprendizaje**, seis casos propios de router y cuatro de recuperación en la orquestación, además de paridad Agent Test, integridad y bootstrap de `AppModule`. Las cifras incluyen pruebas de la tanda anterior y no se suman a ellas como casos independientes. TypeScript de API y `git diff --check` pasan.

Las pruebas PostgreSQL/Prisma verifican el lock real, retiro entre intentos, edición durante la llamada, proyección manipulada, agente ajeno y candidata fuera del contexto de evaluación. Las pruebas del router verifican cada intento, costo descartado, ausencia de fallback tras revocación y fallback normal. La orquestación real comprueba recuperación sin repetir un writer, cierre forzado y correcciones. Los efectos/proveedores de las pruebas de orquestación son dobles controlados: no certifican consentimiento, rendimiento ni entrega externa de ese writer; esos contratos tienen sus propias pruebas canónicas.

El fence es por intento de generación, con transacción acotada a 120 segundos, no por toda la conversación. Si se pierde la transacción, el resultado no se acepta. Esto no cancela ni borra un request ya recibido por un proveedor externo. Los clientes configurados tienen timeout propio; faltan pruebas externas de fallos de red y vencimiento del proceso/DB. El runtime con aprendizaje usa `execute`/`generate`; no se afirma cobertura de `generateStream`.

La continuación `learning-evaluation-retention.md` agrega autoridad del replay/juez y llamadas auxiliares, índice durable de copias, retiro de descendientes, limpieza periódica y guardado protegido. `learning-worker-ownership.md` agrega reclamación con CAS y control de escrituras ante reemplazo de workers. Aún continúan pruebas de particiones de proceso/cola, salidas externas fuera del router —incluidos embeddings—, procedencia/retención de todas las trazas derivadas y validación hasta el despacho diferido. No se promete retirar una respuesta que ya fue entregada. El manifiesto global de evaluación sigue intacto; quedan los lectores congelados/réplica de negocio y conocimiento y la calibración semántica con mejora medida. Estas tandas no certifican perfiles, canales, proveedores ni calidad de mercado.
