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
3. **Catálogo nuevo** (`MODEL_REGISTRY`), con precios de caché según ADR-0027. Cadenas:
   - `conversation`: gpt-6-luna → deepseek-flash → gemini-3.5-flash-lite → claude-haiku-5-5 → gpt-5.6-luna → gpt-6-sol → grok-4.3 → claude-sonnet-5-5.
   - `tool_calling`: gpt-6-luna → claude-haiku-5-5 → gpt-5.6-luna → deepseek-flash → gpt-6-sol → grok-4.3 → claude-sonnet-5-5.
   - `classify`: gemini-3.5-flash-lite → gpt-5.6-luna → gpt-6-luna → deepseek-flash → claude-haiku-5-5 → gpt-6-sol.
4. **Se reemplazan todos los modelos fijos**:
   - `gpt-4o-mini`, `gpt-4.1-mini` y `grok-4-1-fast-non-reasoning` pasan a `gpt-6-luna` en copilot, agent-console, nurturing, feature-requests, handoff, el clasificador de política, el intérprete de intenciones, el mensaje fuera de horario, knowledge-conflict, el juez de calidad, el juez de certificación y el extractor del copiloto de onboarding. El verificador de evidencia sigue la cadena `classify`, con gemini-3.5-flash-lite a la cabeza (ver Medición).
   - `deepseek-chat` pasa a `deepseek-flash` en crm-insights y en el juez del ensayo. Es el mismo modelo servido; el juez queda sin razonamiento de forma explícita.
   - Un nombre que no está en el registro no falla: cae en silencio a la cabeza de la cadena `conversation`. Por eso no puede quedar ningún nombre viejo.
5. **Modelo líder de medición** (`LLM_MEASUREMENT_LEAD_MODEL`). Solo lo define el contenedor del runner. Pone un candidato a la cabeza de los turnos `conversation` y `tool_calling`, sin tocar el plan, el piso, la afinidad ni los modelos fijos. Entra en la firma de ruteo de las evaluaciones. Sirve para la próxima migración.

## Medición (9-nov-2026, VPS)

Se usaron dos bancos. Ninguno se apoya en benchmarks públicos.

**1. Ensayo de un turno** (`scripts/rehearsal/measure.cjs`): el banco congelado de los 7 tenants QA, semilla `e1`, 40 casos por tenant, con el juez del ensayo.
- Cada candidato corrió en un runner `parallext-e2cat-*` con la imagen de producción y el `dist` de esta rama montado. `LLM_MEASUREMENT_LEAD_MODEL` lo ponía a la cabeza.
- La tasa excluye los casos `error`, que son de infraestructura. Fueron timeouts de lectura de 3 s y dos deploys ajenos que cambiaron la estructura de la BD durante la corrida (`evaluation_dependencies_changed:database.structure`).
- La línea base es E2ad/E2ad2 (main del 9-nov, con gpt-4o-mini, k=3).

| Configuración (líder · cabeza de `classify`) | Tasa | Casos | Costo por caso* |
|---|---|---|---|
| Línea base histórica: gpt-4o-mini · gpt-4o-mini, código anterior | 0,962 | 832 | $0,0047 |
| **Control**: gpt-4o-mini · gpt-6-luna, código nuevo | 0,874 | 270 | — |
| gpt-6-luna · gpt-6-luna | 0,913–0,920 | 473 + 150 | $0,0017 |
| gpt-6-luna · gpt-5.6-luna | 0,924 | 263 | — |
| **gpt-6-luna · gemini-3.5-flash-lite** | **0,940** | 267 | $0,0023 |
| gpt-5.6-luna · gpt-6-luna | 0,927 | 510 | $0,0030 |
| deepseek-flash · gpt-6-luna | 0,914 | 537 | $0,0018 |
| gpt-6-sol · gemini-3.5-flash-lite | 0,971 | 276 | $0,0289 |
| grok-4.3 · gemini-3.5-flash-lite | 0,925 | 279 | $0,0098 |

\* A precio de catálogo, sumando el turno y todas las llamadas auxiliares. La línea base se cobró con el código anterior, sin descuento de caché.

Lectura:
- **El control explica la caída frente a la línea base histórica.** Con el mismo código, gpt-4o-mini como líder queda por debajo de todos los candidatos. La diferencia de 0,962 a ~0,93 no la causa el modelo nuevo: viene del cambio de cadenas auxiliares y del código fusionado ese día (#408, #411, #412 y #413).
- **La cabeza de `classify` sí importa.** El verificador de evidencia y el triaje de seguridad usan esa cadena (`task: 'classify'`, que ignora su `model` fijo).
  - Con gpt-6-luna, el verificador borraba la frase de traspaso y dejaba «Claro que sí.» o «No tengo ese dato confirmado en este momento.». C30 («quiero hablar con una persona») falló 4–9 veces en cada corrida.
  - Con gemini-3.5-flash-lite, C30 tuvo 0 fallos y el global fue el mejor de los modelos baratos.
- Los fallos que quedan con gpt-6-luna son, sobre todo, negaciones sin respaldo: C19/C20, «No tiene reservas registradas». Son la misma familia que ya tenía la línea base.

**2. Confirmación firmada multi-turno** (aislada del pipeline).
- Se intentó en Agent Test sobre los 7 tenants QA, pero **ninguno tiene la escritura habilitada**. Su `WRITE_MODE` está sin definir, que equivale a `none`, y la disponibilidad no tiene fuente confirmada. El agente responde «no tengo acceso a la herramienta para crearla» con cualquier modelo: 0/14 en todos, también en la línea base.
- Se midió entonces el modelo con el protocolo literal de `ToolExecutionControlService`:
  1. El cliente pide con todos los datos.
  2. El modelo llama a la herramienta de escritura.
  3. Se le devuelve el `confirmation_required` con el texto de producción.
  4. El cliente responde «Sí, confirmo».
  5. El modelo debe repetir la llamada con el **mismo sha256 de argumentos canónicos** (el `args_hash` del ledger).
- 7 escenarios en español (cita dental y de salón, tour, hotel, visita inmobiliaria, pedido de comida y de tienda), 4 repeticiones por escenario, con los parámetros de `model-request-params.ts`.

| Modelo | Escritura ejecutada con el mismo hash | Deriva de hash | Pide confirmación en prosa antes de llamar |
|---|---|---|---|
| **gpt-6-luna** | **28/28** | 0 | 0 |
| gpt-6-sol | 28/28 | 0 | 0 |
| grok-4.3 | 26/28 | 0 | 2 |
| gpt-4.1-mini (sale el 14-ene) | 23/28 | 0 | 5 |
| deepseek-flash | 19/28 | 0 | 9 |
| gpt-5.6-luna | 12/28 | 0 | 16 |
| gpt-4o-mini (sale el 14-ene) | 11/28 | 0 | 17 |

Pedir confirmación en prosa no es un error, pero suma un turno: la puerta vuelve a pedir confirmación cuando por fin llama. Ningún modelo cambió argumentos entre la propuesta y el «sí».

## Elección por tier

| Tier | Modelo elegido | Por qué |
|---|---|---|
| tier_1 | **gpt-6-sol**; grok-4.3 como respaldo de otro proveedor; claude-sonnet-5-5 sin clave | El mejor en los dos bancos (0,971 · 28/28) |
| tier_2 | **gpt-6-luna**, que lidera `conversation` y `tool_calling`; gpt-5.6-luna y claude-haiku-5-5 detrás | 0,940 · 28/28, a $0,10/$0,50 por M |
| tier_3 | **gemini-3.5-flash-lite**, cabeza de `classify` y sin herramientas | Mejor verificador medido. El adaptador no devuelve la `thoughtSignature` que Gemini 3.x exige tras una llamada de función. |
| tier_4 | **deepseek-flash** sin razonamiento | 0,914 · 19/28, el más barato en la mitad del día no pico |

El código final difiere del medido solo en el orden de los respaldos: el resto de `classify` y la posición de gpt-6-sol frente a grok-4.3. Ninguna de las dos cosas cambia quién sirve el turno cuando todo está sano.

## Consecuencias

- **El costo por caso medido baja un 51 %**: de $0,0047 con gpt-4o-mini a $0,0023 con gpt-6-luna + gemini. Frente a gpt-4.1-mini, que era el 84 % del gasto real, la diferencia es mayor: 4× más barato en entrada y 10× en caché. Los topes de $3/$8/$25/$80 ganan holgura.
- La calidad del ensayo queda en ~0,94 frente al 0,962 histórico. El control muestra que el modelo anterior, con el código de hoy, saca 0,874. Recuperar el resto es trabajo de guardas y prompts, no de catálogo.
- **No hay clave de Anthropic.** Haiku 5.5 y Sonnet 5.5 están en el catálogo con el adaptador corregido, pero sin medir. Si el dueño da de alta la clave, hay que medirlos con `LLM_MEASUREMENT_LEAD_MODEL` antes de subirlos en la cadena.
- **Los 7 tenants QA no pueden escribir.** El banco del ensayo mide honestidad de un turno, no escrituras. Para medir la confirmación firmada dentro del pipeline hace falta un tenant QA con `WRITE_MODE` definido y disponibilidad confirmada.
- La sonda de salud (ADR-0026) también usaba `max_tokens` y `thinkingBudget: 0`. Con el catálogo nuevo habría dado 400 contra OpenAI y Google cada 5 minutos. Ahora usa los mismos helpers.
- `deepseek-chat`, `gpt-4o-mini`, `gpt-4.1-mini`, `grok-4-1-fast-non-reasoning` y `gemini-2.5-flash` salen del registro. Un servicio que todavía los nombre caería en silencio a la cabeza de `conversation`; no queda ninguno en el código.
- Las claves `analytics:*:model:<nombre>` de analítica (`analytics.service.ts`) siguen con los nombres viejos. Son contadores heredados que ningún camino actual escribe, y quedan como pendiente.

## Alternativas descartadas

- **Quedarse con gpt-4.1-mini/4o-mini hasta enero**: deja la migración para la semana del apagado, sin margen para medir.
- **Elegir por benchmarks públicos (τ²-bench)**: no miden español ni nuestras guardas. La medición propia mostró regresiones que esos benchmarks no ven.
- **Usar la API Responses de OpenAI** para tener herramientas con razonamiento: obliga a reescribir el adaptador y el razonamiento no está medido como mejora en el banco.
- **Proveedores sin clave** (Anthropic, Z.ai, Alibaba): no se pueden medir. Dar de alta una clave es decisión del dueño.
