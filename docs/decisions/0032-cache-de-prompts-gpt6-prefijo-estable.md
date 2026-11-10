# 0032 — Caché de prompts en GPT-6: breakpoint en el prefijo estable del system

- Estado: aceptada; implementada en este PR. La medición en tráfico real queda pendiente: la cuenta de OpenAI se quedó sin crédito el 10-nov.
- Fecha: 2026-11-10 · Decide: Claude (autonomía de rediseño) · Autor: Claude
- Ámbito: `apps/api` (`ai/providers/openai.provider.ts`, `ai/providers/model-request-params.ts`, `ai/router/llm-router.service.ts`).
- Relacionadas: [0027](0027-costo-llm-cache-y-rechazos.md) (convención `LLMUsage` y precios de caché), [0029](0029-migracion-del-catalogo-llm-nov-2026.md) (migración a gpt-6-luna).

## Contexto

Datos del panel de OpenAI (cuenta nueva, 9 y 10-nov-2026): $20,30 de gasto en 16.405 llamadas, con 113 M tokens de entrada. Las escrituras de caché son el 77 % del gasto ($15,72). En GPT-5.6 y posteriores, cada token de entrada que no se lee de caché se cobra como escritura, a 1,25× la entrada. La ficha del modelo lo dice así: «Cache writes are billed at 1.25x the uncached input token rate» ([gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna)). gpt-6-luna cobra $0,10/M de entrada, $0,01/M de lectura de caché y $0,125/M de escritura con TTL de 30 min ([pricing](https://developers.openai.com/api/docs/pricing)).

Acierto de caché medido con los contadores Redis `llm:stats:{tenant}:2026-11-10:openai:{tokens_cached,tokens_in}` de los 7 tenants QA: 20,7 M de 54,4 M tokens, es decir **38 %**. Con gpt-4.1-mini era de ~52 %.

### Por qué se perdía el prefijo

El agente manda un solo mensaje `system` con tres capas (`PromptAssemblerService.assembleWithCacheBoundary`):

1. `<contract>`: unos 30.000 caracteres (~7 k tokens), iguales para todos los tenants.
2. `<persona>`: estable para cada agente.
3. `<turn>`: cambia en cada llamada. Lleva `<now>`, el conocimiento recuperado, el estado de la reserva, etc.

Detrás vienen el historial y el mensaje del cliente. El servicio ya calculaba `cachePrefixChars` (el final de la capa 2), pero solo lo usaba el adaptador de Anthropic.

En los modelos anteriores, OpenAI cacheaba cualquier prefijo común redondeado a bloques de 128 tokens. Por eso el contrato y la persona se reutilizaban aunque el `<turn>` cambiara, y el acierto rondaba el 52 %. En GPT-5.6+ eso cambió. La [guía de prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) describe la coincidencia como «Exact eligible boundary, excluding hidden tokens». OpenAI solo prueba los «cache lookup boundaries» de la petición, que en modo implícito son:

> «The first 2 and latest 50 explicit breakpoints, the implicit breakpoint, up to 20 earlier eligible message endings, and the endpoint of the initial consecutive block of developer messages.»

El único límite dentro de nuestro system está al **final** del mensaje, después del `<turn>`. Por eso el contrato y la persona nunca se releían entre turnos ni entre conversaciones. Solo había aciertos dentro del bucle de herramientas de un mismo turno, donde el system no cambia: de ahí el 38 %. Y cada turno volvía a escribir los ~8–10 k tokens estables a 1,25×.

### Lo que dice la documentación

Citas de la guía y de la [referencia de Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create):

- `prompt_cache_breakpoint` es un objeto `{ mode, ttl }` que se pone en un content part (text, image_url…) de los mensajes developer, system, user, tool y assistant. La referencia lo describe así: «Marks the exact end of a reusable prompt prefix». Los breakpoints explícitos tampoco se redondean: «the boundary is not rounded to a token block».
- Se puede combinar con el modo implícito: «You can add explicit breakpoints without turning off the implicit breakpoint; an implicit breakpoint uses one of the four cache write slots to leave three usable explicit cache write slots.»
- `prompt_cache_options` es `{ mode: "implicit" | "explicit", ttl }`, «Supported for `gpt-5.6` and later models». El modo por defecto es `implicit`. En Chat Completions, `ttl` solo admite `"30m"`; el TTL de 12 h es exclusivo de la Responses API.
- `prompt_cache_retention` está marcado «Deprecated». Para modelos nuevos solo admite `24h` y no gobierna las escrituras de GPT-5.6+.
- Sobre `prompt_cache_key` en GPT-5.6+: «OpenAI handles cache routing automatically; the key is not needed to optimize caching». La guía lo recomienda para «separate cache accounting for customers, users, or workspaces».
- Las escrituras no se pueden apagar en modo implícito. En modo explícito, «Content after the last selected breakpoint is processed at the uncached input-token rate without a cache-write charge».
- `usage.prompt_tokens_details` trae `cached_tokens` y `cache_write_tokens` («The unadjusted number of prompt tokens written to cache»). Ambos están incluidos en `prompt_tokens`.
- El hash de enrutamiento incluye las herramientas: «Preserve tool definitions, ordering, and schemas.»

## Decisión

1. **Breakpoint al final del prefijo estable.** Para GPT-5.6 y posteriores (`openAISupportsCacheBreakpoints`), cuando llega `cacheableSystemPromptChars`, `openAISystemContent` parte el system en dos bloques de texto. El primero es el contrato y la persona, con `prompt_cache_breakpoint: { mode: 'explicit' }`. El segundo es el `<turn>`. Los dos bloques concatenados son el texto original carácter por carácter, así que el modelo recibe el mismo prompt. Se queda el modo implícito por defecto, de modo que el breakpoint implícito al final del último mensaje sigue sirviendo al bucle de herramientas del turno. Aplica a `generate` y a `generateStream`. Los modelos anteriores (gpt-4.1, gpt-5.5…) siguen recibiendo el system como texto.
2. **Red de seguridad.** No se pudo probar contra la API, porque la cuenta no tenía crédito. Si un modelo responde 400 por un campo `prompt_cache…` (`isCacheBreakpointRejection`), el adaptador repite la llamada una vez sin breakpoint, recuerda ese modelo y deja de mandárselo. Lo registra en el log con la marca `[LLM_CACHE]`. Ningún otro error se repite.
3. **Contador de escrituras.** `trackStats` suma `cacheWritePromptTokens` en `llm:stats:{tenant}:{fecha}:{proveedor}:tokens_cache_write`, junto a `tokens_cached` y `tokens_in`. El normalizador `usageFromOpenAICompatible` ya leía `cache_write_tokens` (ADR-0027), y el catálogo ya cobra `costCacheWritePer1k`, que para gpt-6-luna es 0,000125. Lo nuevo es poder leer la proporción de escrituras por tenant y día sin pasar por el panel de OpenAI.
4. **Sin `prompt_cache_key`.** En GPT-5.6+ no mejora el enrutamiento. Ya hay contabilidad por tenant en Redis y en `llm_spend_reservations`, y las cachés no se comparten entre organizaciones.

## Consecuencias

- **Acierto esperado.** El prefijo estable (herramientas + contrato + persona, unos 8–10 k de los ~11 k tokens de entrada medios por llamada) pasa a releerse entre turnos y conversaciones del mismo agente, durante 30 min desde su último uso. Con tráfico QA sostenido, la estimación es de **65–80 %**, frente al 38 % actual. Cada combinación distinta de herramientas (`conversation` sin herramientas, `tool_calling` con su lista filtrada) calienta su propio prefijo.
- **Ahorro estimado** con el volumen de gpt-6-luna del 10-nov (~54,6 M tokens de entrada, $4,41 de entrada). Al 65 % de acierto, la entrada cuesta ~$2,74: **−$1,7/día**. Al 75 %, ~$2,12: **−$2,3/día**, un 52 % menos. gpt-6-sol cuesta 20× más por token. Con el volumen del 9-nov ($7,57 en escrituras), el mismo cambio ahorraría del orden de **$3–4/día** si sol vuelve a recibir tráfico.
- **Verificación pendiente.** Hay que comprobar con la API real que gpt-6-luna acepta el campo en un mensaje system: la referencia lo lista, pero sin subcampos para ese rol. También hay que medir el acierto. Protocolo: con crédito disponible y 1 tenant QA (≤$1), comparar `tokens_cached / tokens_in` y `tokens_cache_write / tokens_in` del día antes y después del despliegue, o la `usage` de cada respuesta. Si `[LLM_CACHE]` aparece en el log, el campo fue rechazado y todo funciona como antes.
- **Margen futuro, fuera de este ADR porque cambia el prompt que ve el modelo.** El `<turn>` va delante del historial, así que el historial nunca se reutiliza entre turnos. Moverlo detrás del historial subiría el acierto en conversaciones largas, pero cambia el orden que el modelo recibe y habría que medirlo con el banco QA. Otra opción es el modo `explicit`, que evita pagar 1,25× por la cola de las llamadas sin bucle de herramientas, aunque obliga a colocar a mano el breakpoint del bucle.

## Alternativas descartadas

- **Dos mensajes system (estable + `<turn>`).** La guía solo garantiza el límite al final del grupo inicial de mensajes developer consecutivos. Dos system seguidos probablemente cuentan como un solo grupo, así que no ganaríamos nada, y además cambia la estructura del prompt.
- **`prompt_cache_key` por tenant y tarea.** La documentación dice que en GPT-5.6+ no hace falta para la caché.
- **`prompt_cache_retention: "24h"`.** Está deprecado y no gobierna el TTL de las escrituras de GPT-5.6+. El TTL de 12 h solo existe en la Responses API, y cuesta 2,5× por escritura.
