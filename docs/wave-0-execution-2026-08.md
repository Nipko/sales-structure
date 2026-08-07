# Ola 0 — ejecución, evidencia y gates pendientes

**Sistema:** Parallly / Parallext Engine  
**Corte:** 6 de agosto de 2026  
**Auditoría de origen:** [`vertical-system-audit-2026-08.md`](./vertical-system-audit-2026-08.md)  
**Plan de certificación:** [`vertical-master-test-plan-2026-08.md`](./vertical-master-test-plan-2026-08.md)

## 1. Estado ejecutivo

La Ola 0 está **implementada en el worktree y en validación**, pero todavía no equivale a una certificación de release. Se cerraron las rutas de explotación o inconsistencia más graves en código y se agregaron regresiones automáticas. Aún faltan gates con PostgreSQL, Redis, BullMQ y HTTP reales antes de declarar los doce P0 cerrados en un ambiente desplegado.

Universo canónico verificado:

- 18 verticales.
- 75 subtipos canónicos.
- `otro` como configuración sin subtipo.
- 76 configuraciones vertical/subtipo en total.
- 4 idiomas de producto: `es`, `en`, `pt`, `fr`.
- 5 planes efectivos: `emprendedor`, `starter`, `pro`, `enterprise`, `custom`.
- 6 adaptadores de mensajería registrados: WhatsApp, Instagram, Messenger, Telegram, SMS y Email.
- 7 superficies conversacionales al incluir el Web Widget.

La certificación funcional continúa en **0/18** hasta ejecutar los gates de integración y E2E descritos en este documento. “Corregido en código” no se usa como sinónimo de “certificado”.

## 2. Decisiones de contención adoptadas

1. El catálogo v1 de identidad vertical es estricto y versionado; no existe fallback silencioso a `otro`.
2. Los defaults canónicos consumen cuota. El pipeline es indivisible y los pisos de `emprendedor`/`starter` son 7 etapas y 4 servicios.
3. `finanzas/seguros` se normaliza explícitamente a `seguros/broker`.
4. El cambio directo de vertical o subtipo queda bloqueado con `vertical_migration_required` hasta construir una migración transaccional con preview y rollback.
5. Agent Test solo anuncia y ejecuta una allowlist auditada de tools de lectura; las escrituras y MCP dinámico quedan deny-by-default.
6. Toda etapa terminal declara `terminalOutcome: won|lost`; no se infiere por slug, traducción ni probabilidad.
7. El aprovisionamiento usa locks con token, heartbeat, comprobaciones fail-closed alrededor de cada etapa, estado durable, reintentos e invariantes antes de activar. Una operación externa o DDL ya iniciada no puede cancelarse; el fencing duro DB sigue siendo un gate explícito.
8. Las URLs cubiertas usan HTTPS, DNS público fijado, bloqueo de redirects/proxy, timeouts y límites; las integraciones de proveedor agregan allowlist exacta. Web Push valida y fija DNS tanto al registrar como al enviar.
9. Claims sin evidencia, testimonios sin consentimiento y demos con disponibilidad/precio inventados quedan bloqueados por el contrato automático ejecutado en `build` y en el gate de CI.
10. El manifest de Ola 0 cubre **identidad** —IDs, aliases y subtipos—. El manifest completo de capabilities, tools, objetos, rutas, KPIs, planes, assurance y certificación sigue siendo `VERT-P1-01`; no se declara terminado de forma implícita.

## 3. Matriz de remediación P0

| ID | Mitigación implementada | Evidencia automática actual | Gate aún requerido |
|---|---|---|---|
| `VERT-P0-01` | `VerticalsController` exige JWT/Roles y `TenantGuard` en config, presets y reseed; reseed queda en `tenant_admin` | Metadata del controller y matriz negativa/positiva del guard para admin, supervisor, agent y superadmin | HTTP real con tokens de dos tenants sobre las tres rutas |
| `VERT-P0-02` | Contexto explícito `persistence: disabled`; allowlist de lectura y deny-by-default también en el executor; contacto sandbox; loaders, RAG, tools y router LLM omiten DDL, caches, métricas, breakers, afinidad y eventos persistibles | Writers-trap sobre clases reales, allowlist, boundary del executor y efectos laterales de las capas internas | Snapshot real antes/después de DB, Redis, colas, eventos y llamadas externas |
| `VERT-P0-03` | Overrides de subtipo namespaced por `(industry, subtype)` | Contrato de las 75 parejas + `otro`; regresión turismo/hotel vs pet services/hotel | Bootstrap real de las 76 configuraciones |
| `VERT-P0-04` | `hospital_24h` usa siete días `00:00–23:59` | Regresión de siete inserts y contraste con horario veterinario normal | Verificar siete filas y disponibilidad consultable en PostgreSQL real |
| `VERT-P0-05` | Selección quota-aware; pipeline canónico indivisible; pisos de plan y landing sincronizados | Matriz vertical/plan, migración de floors y contrato landing↔seed billing | Runner DB de 76 × 5 planes; luego 1.520 con idiomas |
| `VERT-P0-06` | Estado pending/failed/complete, reanudación, invariantes, merge JSONB atómico, heartbeat y comprobaciones de ownership en onboarding/bootstrap/admin | Lock perdido al inicio/mitad, segundo worker, owner drift y merge concurrente | Dos procesos reales con Redis y fallos durante DDL/external calls; fencing epoch/advisory DB si se demuestra split-brain dentro de una operación en curso |
| `VERT-P0-07` | Resolver tenant-native, persistencia canónica `listo_para_cierre`, vínculo durable `opportunities.deal_id`, outcome explícito fail-closed y transacción única de opportunity/lead/deal/history; eventos solo después del commit | Batería focal de stages/opportunities, correlación exacta, rollback simulado y contrato de todas las terminales; búsqueda negativa de inferencia por probabilidad | Rollback PostgreSQL real, movimiento won/lost para las 18 verticales y reconciliación de KPIs |
| `VERT-P0-08` | Escape único para texto/atributos XML, saneamiento XML 1.0 y meta-instrucciones neutrales al idioma | Corpus determinista, controles, C1, surrogates, noncharacters, closers y fuzz de todos los campos dinámicos | Eval adversarial con modelos reales y cuatro idiomas |
| `VERT-P0-09` | Transporte seguro aplicado a HTTP genérico, Shopify/Woo, Toast/Cliniko/Mindbody, automatización HTTP, MCP, webhooks, Knowledge crawl, iCal, Slack y Web Push; allowlist exacta donde existe proveedor fijo | Suites de IPv4/IPv6, DNS mixto, rebinding/TOCTOU, redirects, proxy, payload, IDs y endpoints push | Test de red en staging con servidor malicioso, Web Push real y observabilidad de bloqueos |
| `VERT-P0-10` | Saga de purga con lease/heartbeat, queue fence, plan externo cifrado, `DROP` verificado antes de efectos remotos, purga pública transaccional, identidad eliminada al final y retención fiscal | Fallos de lock, cola/job activo, drop, proveedor y delete público; reintento idempotente sin evento prematuro | PostgreSQL/Redis/BullMQ reales con schema señuelo, fallos de proveedor/billing/media/Redis/transacción y reintento |
| `VERT-P0-11` | Alta superadmin usa catálogo/planes reales y mismo bootstrap; owner e invitación verificables; activa al final | Reintento, drift de owner, lock y invariantes de alta | E2E UI/API/DB completo, incluido billing y expiración de invitación |
| `VERT-P0-12` | DTO whitelist/class-validator, resolver estricto, aliases versionados y error explícito | Contrato de 18 IDs, 75 subtipos, aliases y rechazos inválidos | HTTP de payloads legacy y migración auditada de datos históricos |

## 4. Contrato de verdad comercial

El landing ahora aplica un contrato fail-closed en `build` y en CI:

- Las 18 demos se identifican como ilustrativas.
- Precios, cupos, ETA, inventario, vacunas, coberturas y recomendaciones no se presentan como datos reales sin fuente.
- Se eliminaron métricas de conversión, SLA de tres segundos, promesas numéricas de setup en 5/10 minutos, soporte 24/7, certificaciones/partners no acreditados y garantías absolutas de seguridad.
- Los testimonios no se publican si falta evidencia HTTPS, consentimiento fechado y habilitación explícita.
- Los conteos visibles se derivan de contratos verificables: 18 verticales, 6 adaptadores, 4 idiomas, 5 niveles de conocimiento y 3 capas de prompt.
- Las cuotas visibles de pipeline, servicios y canales se contrastan contra `seed-billing-plans.js`.
- Una regresión inyecta deliberadamente un claim prohibido y exige que el validador termine con error.

## 5. Manifest canónico v1

`GET /verticals/definitions/all` mantiene el payload histórico de selectores en `data` y publica metadata compatible. El siguiente bloque abrevia el mapa de aliases, que en runtime no está vacío:

```json
{
  "version": 1,
  "contract": "vertical-identifiers",
  "count": 18,
  "subtypeCount": 75,
  "configurationCount": 76,
  "aliases": {
    "educacion": "education",
    "professional_services": "servicios_profesionales"
  }
}
```

Onboarding y alta administrativa consumen este mismo catálogo y fallan cerrados si no llegan las 18 verticales. El landing todavía mantiene un catálogo de presentación propio; debe converger mediante el capability manifest de Ola 1, no mediante otra copia manual de reglas de runtime.

## 6. Evidencia ejecutada

La evidencia se separa por frente para no sumar dos veces suites reruneadas:

- API TypeScript: **PASS** (`tsc --noEmit`).
- API Jest: **41/41 suites focales PASS, 303/303 pruebas PASS**, en cinco lotes disjuntos. Esas 41 suites son todos los archivos `*.spec.ts` actuales salvo `app.bootstrap.spec.ts`.
- Invariantes estáticos del pipeline: **PASS**; no queda inferencia `won/lost` por probabilidad y `listo_cierre` solo aparece como alias legacy de entrada/canonicalización.
- Claims: contrato principal **PASS** y regresión deliberadamente inválida **PASS** porque el validador la rechaza.
- Locales: los nueve JSON modificados de dashboard y landing (`es/en/pt/fr/es-AR`) parsean correctamente.
- CI: los workflows `deploy.yml` y `release.yml` parsean como YAML; el contrato de claims está conectado tanto al `build` del landing como al job de validación y al Dockerfile.
- Landing: TypeScript de fuentes **PASS** con `.next` excluido. El typecheck estándar permanece bloqueado por artefactos `.next/types` de otra versión de Next (`PrefetchForTypeCheckInternal`).
- Dashboard: el typecheck de fuentes llega únicamente a tres errores por el módulo local ausente `onborda`; no se cuenta como pase global.

`app.bootstrap.spec.ts` no se presenta como aprobado: el intento local no fue hermético porque requiere Redis y secretos de arranque que no están disponibles en esta sesión. El workflow de CI ya define PostgreSQL, Redis y variables efímeras, pero su ejecución efectiva —junto con los gates de integración siguientes— sigue siendo requisito de release.

## 7. Gates que impiden declarar Ola 0 completa

1. HTTP cross-tenant con cuatro roles y dos tenants reales.
2. Agent Test con snapshots reales de PostgreSQL, Redis, BullMQ, eventos y red.
3. Bootstrap PostgreSQL de las 76 configuraciones y cinco planes.
4. Verificación DB de los siete slots 24/7.
5. Dos workers reales compitiendo y perdiendo el lock de provisioning.
6. Movimiento won/lost y KPIs reales para las 18 verticales.
7. DNS rebinding y respuesta sobredimensionada contra un servidor de staging.
8. Reutilización/fallo de schema y reintento de purga en PostgreSQL, Redis y BullMQ, incluidos fallos de proveedor, billing, media y transacción pública.
9. E2E del alta superadmin, invitación, billing y activación final.
10. Pruebas real-model adversariales del prompt en cuatro idiomas.
11. HTTP de aliases y payloads vertical/subtipo inválidos, más migración auditada de identificadores históricos.

Ninguno de estos gates debe reemplazarse por mocks para la decisión de release. Las unitarias demuestran el contrato del código; los gates demuestran que infraestructura, transacciones y wiring respetan ese contrato.

## 8. Criterio de salida

La Ola 0 se declara completa solo cuando:

- no quedan `S0/S1` abiertos;
- cada `VERT-P0-*` tiene regresión automatizada y evidencia de integración pertinente;
- el pipeline de CI publica el manifest, matriz, JUnit y snapshots de efectos;
- no existe claim comercial sin capability o marca ilustrativa;
- los mismos artefactos pasan en staging con rollback probado;
- la decisión queda registrada por vertical, aunque la certificación siga siendo `0/18` hasta las olas de profundidad operativa.

La siguiente ola no debe ampliar prompts aislados. Debe convertir el manifest de identidad en un contrato operativo compartido por runtime, Agent Test, widget, dashboard, tools y analítica.
