# 0022 — Control de las herramientas del agente en el superadmin

- Estado: aprobada
- Fecha: 2026-11-07 · Decide: Claude con la delegación del dueño (pedido: «control absoluto de todas las herramientas en el superadmin») · Autor: Claude
- Ámbito: `apps/api/src/modules/tool-observability/`, el envoltorio de `AiToolExecutorService.execute`, la tabla `public.platform_tool_usage_daily` y la página `/admin/tools` del dashboard.

## Contexto

El catálogo de herramientas (unas 121 en 26 familias) solo existía en el código. Desde el superadmin no se podía ver qué herramientas hay, qué tenant tiene cada una activada ni cómo funcionan. Solo las escrituras dejaban rastro (`<tenant>.tool_execution_ledger`); las lecturas (precios, FAQs, detalles) no dejaban ninguno fuera de las trazas por turno.

## Decisión

1. **Registro de cada uso en el único punto común.** `AiToolExecutorService.execute` es la puerta de todos los llamadores (loop del LLM, motor de reservas, Procedures, confirmación, Agent Test, aprobaciones, MCP). Su cuerpo pasa a `executeUnobserved`. `execute` mide la duración y el resultado (`ok`, `pending`, `blocked`, `error`) y se lo pasa a `ToolUsageRecorder`. El resultado y las excepciones no cambian, y una falla al medir nunca llega a la herramienta.
2. **Agregado por día, no por llamada.** El recorder acumula en memoria, sin I/O en el camino de la herramienta, por (día UTC, tenant, herramienta, modo, canal, resultado). Cada ~60 s hace un upsert aditivo en `public.platform_tool_usage_daily`, así que varias réplicas suman sin pisarse. Las latencias se guardan en cubos, y p50 y p95 se estiman a partir de ellos. La retención es de 400 días.
3. **Tres vistas de solo lectura para `super_admin`** (`admin/tools/catalog`, `tenants`, `usage`) y la página «Herramientas»:
   - el catálogo con sus controles;
   - la matriz por tenant: lo que permite el plan, lo que está activado y lo que se usó en 30 días;
   - el uso y la salud por herramienta.

## Consecuencias

- Se ve qué herramientas activadas nadie usa y cuáles se usaron sin estar activadas. Esta última se calcula contra la configuración actual, así que un cambio reciente puede dar falsos positivos.
- **Costo en el camino de la herramienta:** microsegundos, sin `await` nuevo.
- **Costo en la base:** un upsert por proceso y por minuto. Una caída brusca pierde hasta ~60 s de conteos.
- Migración ensayada dos veces en una base temporal del VPS, junto con el upsert y la retención.

## Siguiente paso

Planes que limiten familias de herramientas: crear y archivar planes, más un campo del plan que diga qué familias incluye, aplicado por el mismo control que hoy limita los pagos. Irá en su propio ADR.

## Reversión

Quitar el recorder del módulo, porque `execute` sin recorder delega directo. La tabla se puede borrar sin perder datos de negocio.
