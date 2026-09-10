# Qué hay adentro de este PR, y qué pasa con cada parte al desplegar

Derivado del diff contra `origin/main`, no escrito de memoria. Los números salen
de `git diff --numstat origin/main...HEAD` y las clasificaciones de leer los
archivos que el diff nombra. Cuando algo no se puede afirmar desde el código,
está dicho como tal.

**Rango:** `b1e87c71` (origin/main) → `3b51ab5a`.
**Tamaño:** 307 commits, 1.028 archivos, +158.088 / −8.759. Los tres commits de
documentación posteriores a este HEAD no cambian ningún grupo de abajo.

Un PR de este tamaño no se revisa leyéndolo de arriba abajo. Se revisa por
grupos, y cada grupo con la pregunta que le corresponde: *¿qué cambia para un
cliente el día que esto se despliegue, y cómo se vuelve atrás?*

---

## 1. El mapa, por tamaño

| Grupo | Archivos | +/− |
|---|---:|---|
| Runtime de la API (sin pruebas) | 345 | +37.969 / −5.320 |
| Pruebas y evidencia | 352 | +46.801 / −2.041 |
| Documentación | 130 | +47.919 / −0 |
| Dashboard (páginas y componentes) | 112 | +7.656 / −1.199 |
| `packages/shared` | 23 | +2.632 / −13 |
| Migraciones | 11 | +1.046 / −0 |
| Mobile | 10 | +305 / −35 |
| Prisma schema + DDL de tenant | 5 | +1.373 / −0 |
| i18n del dashboard (4 idiomas) | 4 | +7.204 / −120 |
| E2E (Playwright) | 5 | +488 / −2 |
| Workflows de CI | 2 | +512 / −0 |
| WhatsApp service | 1 | +83 / −20 |
| Landing | 0 | — |

Casi la mitad del diff es documentación y pruebas. El runtime real son 345
archivos, y de esos el 60% se concentra en seis módulos.

## 2. Runtime, por subsistema

| Módulo | Archivos | +/− | Qué es |
|---|---:|---|---|
| `conversations` | 58 | +7.060 / −2.126 | el turno: contrato de compromiso, outbox de salida, ledger, provenance |
| `channels` | 29 | +6.099 / −185 | outbox durable, transporte estricto, recuperación, reconciliación |
| `simulation` | 41 | +6.020 / −609 | candidatos de release, evaluación, certificación, benchmark, watchtower |
| `learning` | 15 | +3.485 / −0 | ejemplos de estilo con procedencia y presupuesto |
| `knowledge` | 10 | +1.811 / −237 | recuperación medida, umbral real, conflictos |
| `copilot` | 10 | +1.707 / −21 | Assist: propuestas, verificación, handoffs |
| `evaluation-revision` | 11 | +1.661 / −0 | manifiesto de dependencias, inventario de lectores comerciales |
| `quality` | 18 | +1.196 / −189 | muestreo, regresiones, revisión humana |
| `persona` | 12 | +1.072 / −320 | borradores, revisiones y **publicación** de configuración |
| `handoff` | 4 | +1.054 / −130 | recibo canónico de escalada |
| resto (30 módulos) | 137 | +7.900 / −1.500 | verticales, pagos por tenant, agenda, avisos, CRM externo |

## 3. Migraciones y datos afectados

Once migraciones nuevas. **Las once son estructurales y ninguna escribe una
fila**: no hay un solo `INSERT`, `UPDATE`, `DELETE`, `DROP`, `RENAME` ni
`TRUNCATE` en las 1.046 líneas (verificable con
`git diff origin/main...HEAD -- apps/api/prisma/migrations | grep -iE '^\+.*(DROP|RENAME|TRUNCATE|DELETE FROM|UPDATE )'`).

| Migración | Qué agrega |
|---|---|
| `…150000_backfill_agent_dispatch_tenant_tables` | 3 tablas + 8 índices de despacho por tenant |
| `…180000_add_agent_turn_ledger` | 1 tabla + 3 índices |
| `…190000_add_agent_handoff_effects` | 1 tabla + 2 índices |
| `…200000_add_dispatch_resolution_ledger` | 1 tabla + 2 índices |
| `…210000_provision_learning_tables` | 4 tablas |
| `…220000_bound_learning_evaluation_cost_and_deadline` | 1 tabla |
| `…230000_add_agent_content_proposals` | 1 tabla + 1 índice |
| `…120000_add_agent_certification_ledger` | 8 tablas + 11 índices |
| `…180000_add_agent_evidence_provenance` | `ADD COLUMN IF NOT EXISTS` nulables por schema |
| `…190000_add_crm_note_receipts` | 1 tabla + 3 índices |
| `…200000_add_benchmark_attempt_claim` | `ADD COLUMN IF NOT EXISTS` con default por schema |

Las dos últimas recorren `public.tenants` y saltan un schema nombrado que ya no
existe, en vez de detener el resto.

**Verificado localmente** (no en producción): las 39 migraciones de `origin/main`
sobre una base limpia, después las 11 nuevas encima de ese estado con filas
previas sembradas, y las filas siguen ahí; `_prisma_migrations` termina en 50, 0
sin terminar, 0 revertidas. La migración de schemas de tenant corre dos veces con
el mismo resultado. Bajo escritores concurrentes lo prueba
`migration-under-load.postgres.spec.ts` contra su propia base.

## 4. Lo que cambia para un cliente **el día del deploy**, sin tocar ninguna palanca

Esta es la sección corta y la más importante.

**Un cobro pasa a leer lo que el cliente aceptó, y no una columna viva.**
`fb1c1366` unifica el contrato de compromiso: la propuesta se arma del catálogo
cuando se le muestra al cliente y se arma de nuevo cuando el escritor va a
correr; si difieren, la confirmación fue por otra cosa. Las tres familias
pagables (agenda, reservas de propiedad, pedidos de catálogo) cobran desde la
propuesta aceptada en vez de desde `total_price`.

La consecuencia tiene fecha: **una fila creada antes de ese atado deja de ser
cobrable en el momento en que el runtime nuevo carga**, con outbox encendido o
apagado. Un ledger abierto antes de la compuerta se deja pasar y no registra
aceptación —refusarlo rompería cada conversación en vuelo durante el rolling
restart, e inventar la aceptación sería inventar el consentimiento—, así que la
fila queda impagable y **aparece en el reporte de huérfanos**.

Por eso el deploy ahora se detiene antes de migrar si encuentra alguna
(`a10bf87c`): el preflight recorre todos los tenants desde la autoridad global,
cuenta por familia y aborta con `blocks=1`. Runbook:
`docs/runbooks/agreed-terms-preflight.md`.

Todo lo demás del runtime es aditivo o está detrás de una palanca (§5).

## 5. Lo que queda apagado detrás de una palanca

| Palanca | Dónde vive | Default | Qué enciende |
|---|---|---|---|
| `dispatch.normalOutbox` | `platform_settings` | **apagado** | la salida durable por outbox, por tenant y por canal |

`DispatchRolloutService` falla cerrado: una configuración ilegible, ausente o
malformada significa apagado, y un canal nombrado sin transporte estricto se
ignora en vez de crear un lote que nadie puede enviar. Encenderlo es una
activación con piloto, no parte del deploy.

Los demás interruptores nuevos son **presupuestos y plazos** de evaluación
(`EVAL_AUTORUN_DAILY_MODEL_UNITS`, `LEARNING_EVALUATION_ATTEMPT_MINUTES`,
`LEARNING_EVALUATION_ATTEMPT_MODEL_UNITS`): sin credencial de modelo no hay nada
que gastar, así que hoy no cambian comportamiento.

## 6. Dashboard, mobile y landing

**Dashboard — 112 archivos.** Pantallas nuevas: publicación de agente
(`/admin/agent/[agentId]/publications`), calidad y evidencia de release,
simulación, despacho durable (`/admin/dispatch`), avisos operativos,
certificación de canales, revisión de conflictos de conocimiento. Ninguna es
accesible sin su regla en `roles.ts`, que deniega por defecto. Los 4 JSON de i18n
acompañan (+7.204 líneas): sin ellos las pantallas nuevas mostrarían la clave.

**Mobile — 10 archivos.** Sólo la tarjeta de cotización de pedido de catálogo y
su revisión, con sus pruebas. `apps/mobile` está en `paths-ignore` del deploy: se
publica por EAS, así que este PR no cambia lo que hay en Play Store.

**Landing — 0 archivos.** Su contrato de claims (`npm run check:claims`) sigue
verde, pero nada de la landing cambia en este PR.

## 7. Pruebas y evidencia

352 archivos. Lo que agregan, en una línea cada uno:

- suites PostgreSQL reales para publicación, release, certificación, outbox,
  ledger, migraciones bajo carga y PgBouncer en modo transacción;
- el turno completo de punta a punta (`normal-turn-e2e.postgres.spec.ts`) con
  BullMQ, Valkey y Socket.IO reales;
- **el recorrido de publicación** desde la ruta hasta el turno siguiente y su
  vuelta atrás (`agent-publication-walk.postgres.spec.ts`, `31395c64`);
- Playwright autenticado: sesión, roles, Assist, recorridos guiados, contraste y
  zoom, y **publicación desde el navegador** (`agent-publication.spec.ts`);
- contratos que fallan si un workflow deja de invocar su control
  (`agreed-terms-preflight-workflow.spec.ts`, `staging-workflow.spec.ts`).

## 8. Documentación

130 archivos, +47.919 líneas, sin borrados. Runbooks nuevos (suite completa,
preflight de términos, staging), la bitácora del programa A1–H3 con sus
artefactos generados por script, y las auditorías. `verify-artifacts.cjs` falla
si un artefacto deja de reflejar el código del que salió.

## 9. Posibles efectos remotos

Qué de este PR puede, en principio, salir de la máquina:

| Efecto | Estado hoy |
|---|---|
| Mensaje saliente por outbox durable | **apagado** por `dispatch.normalOutbox` |
| Llamada a un proveedor LLM | sólo con credencial; los ejecutores de certificación y benchmark existen y no tienen ninguna |
| Llamada a un canal (WhatsApp/IG/Messenger/Telegram) | sin cuentas de prueba; el código nuevo no agrega un llamador nuevo |
| Cobro (Wompi) / factura (Factus) | sin cambios en este PR |
| CRM externo | `9a7dc5e1` agrega dirección a la nota que sale; el riel se gobierna por `INTEGRATION_WRITE_PROVIDERS`, hoy acotado |
| Alertas (Telegram/SMS/email) | sin cambios en este PR |

## 10. Cómo se vuelve atrás, por grupo

| Grupo | Vuelta atrás |
|---|---|
| Runtime de la API, dashboard, whatsapp | volver `IMAGE_TAG` al SHA anterior y recrear. Las migraciones son aditivas, así que el código viejo corre contra el schema nuevo — que es la propiedad que hace posible el rollback, no un problema de él |
| Migraciones | **no se revierten**. Son tablas y columnas nuevas que el código viejo ignora. Revertirlas rompería expand-contract en vez de restaurarlo |
| Publicación de agente | tiene su propia vuelta atrás en producto: `POST /agent-publications/:tenant/agents/:agent/rollback`, que restaura la configuración anterior bajo una versión nueva |
| Outbox durable | `POST /dispatch-rollout/disable`, efectivo inmediato (la caché se borra, no se espera a que venza) |
| El cobro desde la propuesta aceptada | **no tiene vuelta atrás por interruptor.** Es un cambio de comportamiento que viaja con la imagen; volver atrás es volver la imagen |
| Documentación | irrelevante para el runtime |
| Mobile | no viaja en este pipeline |

## 11. Cada commit pertenece a este release

307 commits, todos con prefijo convencional y todos dentro de las áreas de
arriba. Verificado: `git rev-list --merges --count` da 0, y ningún asunto empieza
con `revert`, `fixup` o `squash`. Los 6 más recientes son de dos hilos de trabajo distintos sobre la misma
rama (cierre técnico, y una investigación documental de precios de Meta); ambos
pertenecen al mismo release y ninguno toca los archivos del otro.

## 12. Lo que este PR **no** demuestra

Dicho acá para que no haya que buscarlo:

- **0 de 76 perfiles certificados con un modelo real.** Los ejecutores existen y
  se ensayan sin proveedor.
- **Ningún canal probado con una cuenta real.**
- **Staging no existe**: `3b51ab5a` prepara el workflow, las guardas y los
  scripts, y nada de eso corrió contra un host.
- **Ningún despliegue.** El PR sigue en borrador.
