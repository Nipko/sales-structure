# 0027 — Costo LLM: la caché de prompts se cobra a su tarifa y los rechazos sin cobro se liquidan en 0

- Estado: aprobada (decidida con la autorización autónoma del dueño; se revisa con él a su regreso)
- Fecha: 2026-11-09 · Decide: dueño · Autor: Claude
- Ámbito: `apps/api` (`modules/ai/router/llm-cost.ts`, `llm-router.service.ts`, `llm-spend-guard.service.ts`, `modules/ai/providers/*`, `conversations/agent-turn-session.ts`) y `apps/api/scripts/llm-spend/`.
- Depende de: [0026](0026-salud-de-proveedores-llm.md) (`classifyProviderError`).

## Contexto

El costo LLM que calcula la plataforma alimenta tres cosas: los contadores de Redis (`llm:stats:*`, `llm:cost:{tenant}:{mes}`), el libro `public.llm_spend_reservations` con el que el guardián admite o rechaza cada llamada, y los dos topes por tenant. El tope blando baja a modelos baratos. El tope duro deja al agente sin responder. Un costo inflado no es solo un mal número en un panel: degrada o calla a un tenant que todavía tiene presupuesto.

El 9-nov-2026 se encontraron dos fuentes de inflación:

1. **La caché de prompts no se descontaba.** Del 16-sep al 8-nov, el panel de OpenAI facturó **$99,39**. La plataforma estimó **$169,89** para el mismo tráfico; las solicitudes coinciden al 99,95 %. El 52 % de los tokens de entrada salió de caché, y OpenAI los cobra al 25 % (gpt-4.1-mini: $0,10/M frente a $0,40/M). El router (`trackStats`) y el guardián (`modelCostMicro`) cobraban toda la entrada a precio completo. Los proveedores ni siquiera pasaban el dato de caché a `LLMResponse.usage`. Con Anthropic el error iba en sentido contrario: `input_tokens` excluye la lectura y la escritura de caché, así que esa parte de la entrada ni se contaba.
2. **Los rechazos sin cobro se cargaban.** `settleFailedAttempt` liquidaba cualquier 4xx con el «piso de entrada». Un `429 You have no credits remaining`, un `insufficient_quota`, un 401/403 o un 402 se rechazan antes de llegar al modelo y no se facturan. El 8-nov, entre las 08:16 y las 08:26 UTC, se cargaron así **$17,25** a 4 tenants QA (2.043 intentos de gpt-4.1-mini y gpt-4o-mini, según el libro).

## Decisión

1. **Una sola convención de uso** (`LLMUsage` en `llm-cost.ts`). `promptTokens` es SIEMPRE toda la entrada. `cachedPromptTokens` es la parte leída de caché y `cacheWritePromptTokens` la parte escrita en caché. Cada proveedor se normaliza en una función pura:
   - OpenAI y xAI: `usage.prompt_tokens_details.cached_tokens`, que ya va incluido en `prompt_tokens`.
   - DeepSeek: el mismo campo o `prompt_cache_hit_tokens`.
   - Anthropic: `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. Los tres campos no se solapan.
   - Gemini: `usageMetadata.cachedContentTokenCount`, que ya va incluido en `promptTokenCount`.
2. **Precio de caché por modelo en el catálogo** (`MODEL_REGISTRY`, USD por 1k tokens, precios de lista a nov-2026):

   | Modelo | Entrada | Entrada en caché | Escritura en caché |
   |---|---|---|---|
   | claude-sonnet-4-6 | 0,003 | 0,0003 | 0,00375 |
   | gpt-4o | 0,0025 | 0,00125 | — |
   | grok-4-1-fast-non-reasoning | 0,0002 | 0,00005 | — |
   | gpt-4.1-mini | 0,0004 | 0,0001 | — |
   | gpt-4o-mini | 0,00015 | 0,000075 | — |
   | gemini-2.5-flash | 0,0003 | 0,000075 | — |
   | deepseek-chat | 0,00027 | 0,00007 | — |

   Si un modelo no declara precio de caché, la caché se cobra como entrada normal: nunca se inventa un descuento. Gemini 2.5 Flash usa el precio de caché más alto que publicó Google ($0,075/M). Si la tarifa vigente es más baja, el error queda del lado conservador.
3. **Router, guardián y traza usan la misma cuenta** (`usageCostUsd` y `splitPromptTokens`). `modelCostMicro` recibe la entrada en caché y la escritura en caché como argumentos opcionales. `trackStats` agrega el contador diario `llm:stats:…:tokens_cached`. `callCostUsd`, el costo que muestran las pruebas del agente y las certificaciones, también descuenta la caché.
4. **Los rechazos sin cobro se liquidan en 0.** `settleFailedAttempt` clasifica el error con `classifyProviderError` (ADR-0026). Si es `quota`, `auth`, `rate_limit` o `model_not_found`, la reserva queda en `accounted_micro = 0` (basis `failed_estimate`). Esto cubre «no credits», `insufficient_quota`, 401, 403, 402, el 400 de Anthropic por saldo y el 429 de Google. Además de lo pedido, se incluyen el límite de tasa y el modelo inexistente: también se rechazan antes de procesar y ningún proveedor los factura.
5. **Se conserva lo conservador.** Un 5xx y un 400 `bad_request` mantienen el piso de entrada: algunos proveedores validan después de tokenizar, y no podemos demostrar que no se cobró. Un timeout nuestro mantiene la reserva completa. Las reservas previas a la llamada siguen estimándose a precio completo, porque de antemano no se sabe qué parte saldrá de caché.
6. **El histórico se corrige solo con un script idempotente.** Es `apps/api/scripts/llm-spend/2026-11-08-zero-unbilled-refusals.sql`. Respalda cada fila con su valor original en `public.llm_spend_adjustments_20261108` y después pone `accounted_micro = 0`. Solo toca filas `failed_estimate` de modelos OpenAI en la ventana del apagón del 8-nov. No borra filas, y el mismo archivo trae la consulta de reversión. Se ensayó en el VPS dentro de una transacción con ROLLBACK: 2.043 filas, $17,25.

## Consecuencias

- Con la mezcla de sep–nov (52 % de caché), la estimación de OpenAI debería pasar de ~171 % a cerca del 100 % de la factura. Se comprueba contra el panel de OpenAI después del despliegue. Los topes por tenant dejan de dispararse por un gasto que no existió.
- Las filas de sep–nov que el guardián liquidó con `reported_tokens_estimate` **no** se recalculan. El libro no guardó cuántos tokens salieron de caché y reconstruirlo sería inventar. Esos meses quedan sobreestimados, del lado seguro. Lo mismo pasa con el arrastre `opening_estimate` de noviembre, que viene del contador de Redis.
- Un intento fallido por «sin créditos» ya no consume presupuesto. El aviso de ADR-0026 sigue siendo el que hace visible el problema.
- `classifyProviderError` pasa a decidir también la contabilidad. Si clasifica mal un 5xx como `quota`, ese intento se cobraría en 0. Por eso sus tests cubren los textos reales de cada proveedor.

## Alternativas descartadas

- **Leer el costo de la API de facturación de cada proveedor**: requiere Admin keys con acceso a facturación (descartado en ADR-0026), llega con horas de retraso y no sirve para admitir la llamada siguiente.
- **Aplicar un factor fijo de corrección (×0,585)**: depende de la mezcla de tráfico y del modelo. Se rompe en cuanto cambia el prompt o el proveedor.
- **Liquidar en 0 todo 4xx**: un 400 tras tokenizar puede cobrarse. Se deja el piso donde no podemos demostrar lo contrario.
- **Reescribir todo el histórico**: no hay dato de caché por fila. Ver Consecuencias.
