# 0029 — Migración del catálogo LLM antes del apagado de GPT-4 (14-ene-2027)

- Estado: aprobada (decidida con la autorización autónoma del dueño; se revisa con él a su regreso)
- Fecha: 2026-11-09 · Decide: dueño · Autor: Claude
- Ámbito: `apps/api` (`modules/ai/router/llm-router.service.ts`, `modules/ai/router/llm-cost.ts`, `modules/ai/providers/*`, los servicios con un modelo fijo) y `apps/dashboard` (etiquetas de tier y la lista de modelos de la configuración de IA).
- Relacionadas: [0026](0026-salud-de-proveedores-llm.md), [0027](0027-costo-llm-cache-y-rechazos.md), [0028](0028-piso-de-herramientas-dentro-del-plan.md), [0015](0015-juez-del-ensayo-errores-graves-e11b.md).

## Contexto

De los siete modelos del catálogo, cuatro estaban retirados o tenían fecha de apagado:

| Modelo | Estado (verificado el 9-nov-2026) |
|---|---|
| gpt-4o, gpt-4o-mini, gpt-4.1-mini | OpenAI los apaga el **14-ene-2027**. El reemplazo oficial es `gpt-6-luna`. gpt-4.1-mini es el 84 % del costo LLM. |
| grok-4-1-fast-non-reasoning | xAI lo retiró el 15-may-2026. El nombre sigue respondiendo, pero lo sirve `grok-4.3` a $1,25 / $0,20 / $2,50 por M, más de 6 veces lo que el catálogo suponía. Encabezaba la cadena `conversation`. |
| gemini-2.5-flash | Desde el 1-dic-2026 Google lo redirige a `gemini-3.5-flash-lite` y lo cobra a esa tarifa. |
| deepseek-chat | El anuncio de discontinuación era para el 24-jul-2026, pero **sigue respondiendo**. La API lo sirve con `deepseek-flash` sin razonamiento (`model: "deepseek-flash"` en la respuesta). Lo confirman 10.623 llamadas exitosas en el libro hasta el 9-nov y una prueba directa. `/models` solo lista `deepseek-flash` y `deepseek-v4-pro`. |
| claude-sonnet-4-6 | Sigue activo (retiro no antes del 17-feb-2027). **No hay clave de Anthropic** en la plataforma: el valor en `platform_settings` está vacío y no hay variable de entorno. |

## Verificación (9-nov-2026)

Los precios y nombres se tomaron de la página oficial de cada proveedor. Los parámetros se probaron contra la API real desde el VPS, con las claves de la plataforma.

| Modelo | Entrada / caché leída / caché escrita / salida (USD por M) | Razonamiento por defecto → cómo se apaga |
|---|---|---|
| gpt-6-luna | 0,10 / 0,01 / 0,125 / 0,50 | `medium` → `reasoning_effort: "none"` |
| gpt-5.6-luna | 0,20 / 0,02 / 0,25 / 1,20 | `medium` → `none` |
| gpt-6-sol | 2,00 / 0,20 / 2,50 / 10,00 | `medium` → `none` |
| claude-haiku-5-5 | 0,10 / 0,01 / 0,125 / 0,50 (prompts de hasta 100k) | adaptativo, effort `medium` → `thinking: {type: "disabled"}` |
| claude-sonnet-5-5 | 2,00 / 0,10 / 2,50 / 10,00 | effort `high`; rechaza `disabled` → `thinking: {type: "between_tools"}` |
| gemini-3.5-flash-lite | 0,30 / 0,03 / — / 2,50 | `minimal`; **no se apaga** (`thinkingBudget: 0` → 400) |
| deepseek-flash | 0,30 / 0,006 / — / 1,20 en hora pico; la mitad el resto del día | `high` → `thinking: {type: "disabled"}` |
| grok-4.3 | 1,25 / 0,20 / — / 2,50 | razona (458 tokens y 7,7 s en un «sí, resérvala») → `reasoning_effort: "none"` |

Descartados sin medir:
- **glm-5.3-flash**: su razonamiento no se puede apagar (el valor por defecto es `max`). No sirve para turnos de 30 tokens de salida.
- **qwen3.8-flash**: no hay clave ni proveedor.
- **Claude Haiku 5.5 y Sonnet 5.5**: no hay clave de Anthropic. Entran al catálogo con su precio y con el adaptador corregido, pero al final de cada cadena y sin medición.

## Lo que rompía en los adaptadores

Con el código anterior, el nuevo catálogo habría fallado en la primera llamada:

1. **OpenAI GPT-5.6+/GPT-6 rechaza `max_tokens`** (400 `unsupported_parameter`). Exige `max_completion_tokens`.
2. Con herramientas, **Chat Completions exige `reasoning_effort: "none"`**. Sin él devuelve 400 («Function tools with reasoning_effort are not supported»). Una `temperature` distinta de 1 también da 400 si no va con `none`.
3. **Anthropic, Claude 4.7+ y 5.x**: `temperature`, `top_p` y `top_k` dan 400. El adaptador mandaba `temperature` siempre.
4. **deepseek-flash y grok-4.3 razonan por defecto**. Con eso, costo y latencia se multiplican y el perfil de 30 tokens de salida deja de cumplirse.
5. La escritura en caché de OpenAI llega en `prompt_tokens_details.cache_write_tokens`, dentro de `prompt_tokens`, y se cobra a 1,25× la entrada. No se leía.

## Decisión

1. **Parámetros por familia en un solo lugar** (`providers/model-request-params.ts`, funciones puras con test):
   - OpenAI de razonamiento: `max_completion_tokens` y `reasoning_effort: "none"`.
   - xAI grok-4.3+: `reasoning_effort: "none"`.
   - DeepSeek: `thinking: {type: "disabled"}`, salvo con `deepseek-reasoner`.
   - Anthropic 4.7+/5.x: sin parámetros de muestreo y con el pensamiento mínimo de cada modelo.
   - Visión (`image-vision.service.ts`) usa los mismos helpers. gpt-6-luna, grok-4.3 y gemini-3.5-flash-lite reconocieron una imagen de prueba.
2. **`usageFromOpenAICompatible` lee `cache_write_tokens`** como `cacheWritePromptTokens`, con la convención de ADR-0027.
3. **Catálogo nuevo** (`MODEL_REGISTRY`), con precios de caché según ADR-0027. Ver la tabla de tiers y cadenas más abajo.
4. **Se reemplazan todos los modelos fijos**:
   - `gpt-4o-mini`, `gpt-4.1-mini` y `grok-4-1-fast-non-reasoning` pasan a `gpt-6-luna` en copilot, agent-console, nurturing, feature-requests, handoff, el clasificador de política, el intérprete de intenciones, el mensaje fuera de horario, knowledge-conflict, el juez de calidad, el juez de certificación, el extractor del copiloto de onboarding y el verificador de evidencia.
   - `deepseek-chat` pasa a `deepseek-flash` en crm-insights y en el juez del ensayo. Es el mismo modelo servido; el juez queda sin razonamiento de forma explícita.
   - Un nombre que no está en el registro no falla: cae en silencio a la cabeza de la cadena `conversation`. Por eso no puede quedar ningún nombre viejo.
5. **Modelo líder de medición** (`LLM_MEASUREMENT_LEAD_MODEL`). Solo lo define el contenedor del runner. Pone un candidato a la cabeza de los turnos `conversation` y `tool_calling`, sin tocar el plan, el piso, la afinidad ni los modelos fijos. Entra en la firma de ruteo de las evaluaciones. Sirve para la próxima migración.

## Medición

PENDIENTE

## Consecuencias

PENDIENTE

## Alternativas descartadas

- **Quedarse con gpt-4.1-mini/4o-mini hasta enero**: deja la migración para la semana del apagado, sin margen para medir.
- **Elegir por benchmarks públicos (τ²-bench)**: no miden español ni nuestras guardas. La medición propia mostró regresiones que esos benchmarks no ven.
- **Usar la API Responses de OpenAI** para tener herramientas con razonamiento: obliga a reescribir el adaptador y el razonamiento no está medido como mejora en el banco.
- **Proveedores sin clave** (Anthropic, Z.ai, Alibaba): no se pueden medir. Dar de alta una clave es decisión del dueño.
