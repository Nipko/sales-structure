# Paquete para el gate de credenciales LLM y presupuesto

Generado por `docs/audits/2026-09-09/generate-certification-manifest.cjs`. **Ningún número está**
**escrito a mano**: el plan sale de `planCertificationRun`, cuyo universo de escenarios es el mismo
`requiredScenarios` que exige el reporte de certificación, y cuyas tarifas salen del catálogo del propio
router. La cifra que se pide autorizar y la que se factura no pueden ser dos listas de precios distintas.

Revisión: `e1ac3943d89ff6182e86244424e84c234d083c67`. **Este documento no contiene ni requiere ningún secreto**: las variables se
nombran, no se leen.

## Qué se pide

Autorización para ejecutar la matriz generativa: **78.120 casos**
por modelo (76 perfiles × 4 idiomas ×
5 canales × k=1), con una credencial de proveedor y un techo de gasto.

## Costo por modelo, que es la decisión

| Modelo | Proveedor | Tier | Variable | Llamadas | Techo de costo | Horas de modelo |
|---|---|---|---|---:|---:|---:|
| `gpt-4o-mini` | openai | tier_2_standard | `OPENAI_API_KEY` | 139.940 | US$258.80 | 233 |
| `grok-4-1-fast-non-reasoning` | xai | tier_2_standard | `XAI_API_KEY` | 139.940 | US$301.00 | 233 |
| `deepseek-chat` | deepseek | tier_4_budget | `DEEPSEEK_API_KEY` | 139.940 | US$464.20 | 233 |
| `gpt-4.1-mini` | openai | tier_2_standard | `OPENAI_API_KEY` | 139.940 | US$677.40 | 233 |
| `gpt-4o` | openai | tier_1_premium | `OPENAI_API_KEY` | 139.940 | US$4198.20 | 233 |
| `claude-sonnet-4-6` | anthropic | tier_1_premium | `ANTHROPIC_API_KEY` | 139.940 | US$5466.20 | 233 |

Del más barato al más caro hay un factor de **21.1×**
(US$258.80 contra US$5466.20) por el mismo trabajo. El techo sale de un
límite declarado de 8000 tokens de entrada y 1000
de salida por turno, redondeado hacia arriba: un presupuesto que redondea hacia abajo es un presupuesto que se pasa.

Quedan fuera del catálogo certificable, y se dice por qué en vez de omitirlos:

- `gemini-2.5-pro` (google): no_tool_support.
- `gemini-2.5-flash` (google): no_tool_support.

## Variables requeridas (nombres, sin valores)

- `OPENAI_API_KEY`
- `XAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `ANTHROPIC_API_KEY`

Se necesita **una** de ellas: la del proveedor del modelo elegido. Ninguna va a un commit ni a un log.

## Dónde aterriza la evidencia

Tablas del ledger, creadas por `ensureCertificationLedger`: `agent_certification_runs`, `agent_certification_cases`, `uidx_certification_case_attempt`, `idx_certification_case_claimable`.

Cada caso guarda identidad estable, hash de definición del escenario, modelo realmente servido, canal,
idioma, intento, costo, latencia, transcript, tools, verificación y estado. El reporte se calcula desde
esas filas (`certificationEvidenceFromLedger`), nunca desde objetos construidos por una prueba.

## Criterios de aborto

- `budget_usd_cents` alcanzado → el ejecutor deja de entregar casos y el run queda `finished` con
  `stop_reason=budget_exhausted`. El control es **antes** de arrendar el caso, así que el exceso máximo
  es un caso, no ilimitado.
- `deadline_at` pasado → `stop_reason=deadline_passed`, medido con `clock_timestamp()`.
- Cancelación del operador → `cancelCertificationRun`, y no se entrega ni un caso más.
- Tasa de error por proveedor: si `state=error` supera el 5 % de los casos registrados, cancelar y revisar
  antes de seguir gastando. La consulta está abajo.

## Rollback

No hay nada que revertir en producción: el ejecutor no toca tenants reales, no envía mensajes y no publica.
Un run abandonado se cancela y sus filas quedan como historial. Si el gasto fue en vano —por ejemplo porque
cambió la configuración del agente— la evidencia se invalida sola: `certificationEvidenceFromLedger` devuelve
`staleRun` y no entrega nada.

## Consultas de verificación

```sql
-- Progreso y gasto real (no el techo).
SELECT state, count(*)::int, COALESCE(SUM(cost_usd_cents),0)::int AS cents
  FROM agent_certification_cases WHERE run_id = $1::uuid GROUP BY state;

-- Tasa de error, el criterio de aborto por proveedor.
SELECT round(100.0 * count(*) FILTER (WHERE state = 'error')
             / NULLIF(count(*) FILTER (WHERE state <> 'pending'), 0), 2) AS error_pct
  FROM agent_certification_cases WHERE run_id = $1::uuid;

-- Casos sin ningún intento aprobado: el hueco, contado una vez por caso.
SELECT count(*)::int FROM (
  SELECT case_key, BOOL_OR(state = 'passed') AS proven
    FROM agent_certification_cases WHERE run_id = $1::uuid GROUP BY case_key
) c WHERE proven = false;

-- El modelo que de verdad contestó, que no siempre es el que se pidió.
SELECT served_model, count(*)::int FROM agent_certification_cases
 WHERE run_id = $1::uuid AND state = 'passed' GROUP BY served_model;
```

## Evidencia esperada al terminar

- 78.120 casos con estado distinto de `pending`;
- un `AgentReleaseRunEvidence` sellado por canal, con `models` nombrando el modelo servido;
- un `CertificationReport` con `evidenceKind: executed_runs` y un estado por perfil;
- el gasto real por debajo del techo autorizado, verificable con la primera consulta.

Mientras esta autorización no exista, **cero perfiles certificados** es el resultado correcto y así se
reporta. No es un defecto del ejecutor: es la ausencia de una corrida que nadie pagó.

Para actualizar: `node docs/audits/2026-09-09/generate-certification-manifest.cjs` desde la raíz.
