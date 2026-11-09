# 0026 — Salud de proveedores LLM: «sin créditos» y «clave inválida» se detectan, se avisan y se ven

- Estado: aprobada (decidida con la autorización autónoma del dueño; se revisa con él a su regreso)
- Fecha: 2026-11-09 · Decide: dueño · Autor: Claude
- Ámbito: `apps/api` (`modules/ai/health/*`, `llm-router.service.ts`, `modules/health/*`), `apps/dashboard` (`/admin/ops`).

## Contexto

El 8-nov-2026 a las 08:16 UTC la cuenta de OpenAI empezó a responder `429 You have no credits remaining`. Durante la medición E2ac se repitió más de 5.000 veces. El router pasó en silencio a los otros modelos y nadie recibió aviso. Se descubrió leyendo los logs del runner.

La infraestructura de aviso ya existía: `PlatformMonitorService` abre incidentes y avisa por Telegram (`TELEGRAM_ALERT_*`) y por email a los super_admin. En el VPS ambos canales están configurados. Falló la detección:

1. `isBreakableError` trata todo 4xx como «no es un problema de salud», incluido el 429. Un límite de velocidad pasajero y una cuenta sin saldo caían en la misma bolsa: ni contaban como fallo ni disparaban `llm.provider.alert`. Por eso el chequeo de 10 minutos (`llm:unhealthy`, `llm:failures:*`) nunca vio nada.
2. Como el proveedor nunca salía de rotación, **cada turno** pagaba primero un intento fallido contra OpenAI.
3. No había forma de saber si un proveedor estaba sin crédito cuando no había tráfico, ni qué parte de los turnos se atendía con un modelo de respaldo.

## Decisión

1. **Clasificar el error** (`classifyProviderError`, función pura): `quota` (sin créditos o cuota agotada: `insufficient_quota`, 402, «no credits», «credit balance is too low», «Insufficient Balance», créditos o límite de gasto de xAI), `auth` (401, 403, clave inválida, el 400 «API key not valid» de Gemini), `rate_limit` (429), `unavailable` (5xx, 529, timeouts, red), `model_not_found` (404 o modelo retirado), `bad_request` y `unknown`. El texto sobre créditos gana sobre el código HTTP, salvo en un 429 de Google, que usa el mismo texto de «quota» para sus límites por minuto.
2. **Estado por proveedor en Redis** (`llm:provider:state:{p}`), compartido por la API, el worker y los runners de QA: `sano / degradado / caído / sin créditos / clave inválida`, con desde cuándo, primer y último error, tipo, modelo y origen (tráfico o sonda), y último éxito. Un error de crédito o de clave basta para cambiar de estado. Tres caídas seguidas marcan «caído». Un límite de velocidad solo degrada. Un timeout no tapa un «sin créditos». Solo un éxito despeja. Además se cuentan los errores por proveedor, modelo y tipo, por día (`llm:provider:errors:{día}`).
3. **Aviso inmediato y deduplicado**. Se avisa al entrar en un estado grave: «caído», «sin créditos» o «clave inválida». El aviso crea un incidente crítico `llm:provider:{p}:{estado}` en el Centro de Operaciones, manda Telegram y email por el camino de siempre (`PlatformMonitorService.notify`), muestra un toast a los admins conectados y escribe un log de nivel error con la marca fija `[LLM_PROVIDER_ALERT]`. La deduplicación es un `SET NX` en Redis: un aviso al entrar y un recordatorio cada 6 h mientras siga así, más un guardia local de 5 min por si Redis falla. Al recuperarse llega un aviso «recuperado», se cierran los incidentes y el aviso queda listo para una recaída. Un modelo retirado avisa una vez al día como incidente de advertencia.
4. **Fuera de rotación de inmediato**. Ante `quota` o `auth`, el breaker del router se abre 10 minutos. La sonda lo renueva mientras el error siga y lo borra en cuanto la cuenta responde. El fallback sigue atendiendo, pero sin pagar un intento fallido por turno.
5. **El fallback siempre visible**. Cada turno con tarea registra si lo atendió el modelo preferido o uno de respaldo, en cubetas de 5 min (`llm:routing:{cubeta}`). Cuenta como fallback que haya fallado un intento en el turno, o que un modelo anterior de la cadena se haya saltado por salud. Cada turno de fallback deja un `warn` `[LLM] FALLBACK …`. Si en 15 min hay al menos 10 turnos y el 20 % o más van por fallback, se abre el incidente `llm:fallback` (advertencia, Telegram y email). El incidente se cierra cuando la proporción baja.
6. **Sonda proactiva** (`LlmProviderProbeService`). Corre cada 5 min (minutos 1, 6, 11…) bajo `CronLockService` y llama a cada proveedor configurado con su modelo más barato, `max_tokens = 1`. Se salta si el tráfico tuvo éxito hace menos de 4 min. Cuesta centavos al mes. Lee además lo que cada proveedor expone gratis con una API key normal:

   | Proveedor | Sin créditos / clave mala | Saldo antes de llegar a cero |
   |---|---|---|
   | OpenAI | sí (llamada mínima) | **no**: el saldo prepago solo se ve en la consola o con una Admin key de organización |
   | Anthropic | sí (llamada mínima) | **no**: no hay API de saldo con una API key |
   | Google Gemini | clave sí; una cuota agotada se confunde con un límite por minuto (429) | **no** |
   | xAI | sí (llamada mínima y `GET /v1/api-key`: `team_blocked`, `api_key_blocked`, `api_key_disabled`) | **no** sin una Management key |
   | DeepSeek | sí (llamada mínima) | **sí**: `GET /user/balance`; aviso de saldo bajo por debajo de `LLM_LOW_BALANCE_USD` (5 por defecto) |

   Variables de entorno: `LLM_PROVIDER_PROBE_ENABLED` (por defecto `true`) y `LLM_LOW_BALANCE_USD`.
7. **Simulacro sin tocar nada real**: `redis-cli SET llm:probe:drill openai EX 900`. La siguiente pasada de la sonda llama al proveedor con una clave inválida fija y registra el resultado bajo `drill:openai`. Recorre el mismo camino de aviso, marcado `[SIMULACRO]` y con severidad de advertencia. El incidente se cierra al instante. No toca la clave real, el estado del proveedor real ni la configuración de ningún tenant.
8. **Visibilidad**: `GET /health/llm-providers/status` (super_admin) y la tarjeta «Proveedores de IA» en `/admin/ops`. Muestra el estado de cada proveedor, desde cuándo, el último error con su modelo y tipo, la última sonda, el saldo donde se puede leer, los errores de hoy y el % de turnos por fallback en la última hora y en 24 h. Si un proveedor configurado está en estado grave, el semáforo del Centro de Operaciones pasa a crítico.

La salud del proveedor es un hecho operativo, no estado de negocio. Por eso se registra también en Agent Test, que paga y ve los mismos errores reales. El breaker y la afinidad siguen sin tocarse ahí, como antes.

## Consecuencias

- Un episodio como el del 8-nov produce **un** aviso crítico por Telegram y email en el primer turno fallido, o en la siguiente sonda si no hay tráfico. Después llegan recordatorios cada 6 h y un aviso de recuperación. Los turnos dejan de pagar un intento fallido cada uno.
- El aviso de saldo bajo **antes** de llegar a cero solo existe para DeepSeek. Para OpenAI, Anthropic, Gemini y xAI, lo más temprano posible es el primer error, o la sonda en un máximo de 5 min. Para tener saldo de OpenAI o xAI habría que guardar una Admin o Management key con más poder que la de inferencia. Queda fuera a propósito.
- Una cuota agotada de Gemini se ve como «degradado» (límite de velocidad), no como «sin créditos».
- El chequeo antiguo de 10 min (`llm:unhealthy`, `llm:failures:*`) se mantiene. Ahora también lo alimentan los breakers abiertos por crédito o clave.
- Las alertas de incidente las sigue mandando el proceso que observa el error: la API, el worker o un runner de QA, porque todos cargan `AppModule`.

## Alternativas descartadas

- **Abrir el breaker con cualquier 429**: un límite de velocidad pasajero sacaría de rotación a un proveedor sano. La clasificación separa los dos casos.
- **Canal nuevo (webhook genérico, Slack)**: Telegram y email ya existen, están configurados en el VPS y pasan por el mismo deduplicador de incidentes. Un tercer canal era más superficie sin más alcance.
- **Guardar Admin keys de OpenAI o Management keys de xAI para leer el saldo**: dan acceso a facturación y a la gestión de claves. Su riesgo es mayor que el beneficio de saber unos minutos antes que se acaba el saldo.
- **Sonda cada minuto**: no detecta antes de lo que ya detecta el tráfico real, y multiplica el costo y el ruido.
