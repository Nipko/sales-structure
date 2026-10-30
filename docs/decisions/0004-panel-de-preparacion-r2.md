# 0004 — Panel de preparación de solo lectura: historial, caché, enlaces y retiros (R2)

- Estado: aprobada (decidida por el agente con la autorización autónoma del dueño del 30-oct-2026; se revisa con él a su regreso)
- Fecha: 2026-10-30 · Decide: dueño · Autor: agente (rebanada R2)
- Ámbito: `apps/api/src/modules/readiness`, `readiness_evaluations` (por tenant), `packages/business-spec` (hash y listas del resultado), `/admin/readiness`, tarjeta de Inicio, Salud de agentes, imagen de la API

## Contexto
C0 §5 R2 pide el módulo `readiness` con historial y caché, el panel `/admin/readiness` de solo lectura con enlaces a las pantallas actuales, y la tarjeta de Inicio con el veredicto, y retira `ReadinessCitationV1`, las tareas `business`/`knowledge`/`hours`/`appointments`/`team` de la tarjeta y los 20 chequeos de datos de `AgentQualityService`. El diseño deja abiertos varios detalles de construcción.

## Decisión
1. **`resultHash` identifica el contenido.** El motor lo calcula sin `asOf` ni `snapshotHash` (la foto lleva su hora de captura). Así `readiness_evaluations` guarda una fila solo cuando el resultado cambió (C0 §2.7). La misma foto y la misma hora siguen dando el mismo hash.
2. **El motor entrega las listas que el panel muestra.** `ReadinessResult` suma `necessaryGaps`, `recommendedGaps` y `uiTarget` en `qualityWarnings`. El panel solo agrupa: ninguna regla de nivel ni de veredicto vive en el dashboard.
3. **Historial por tenant** en `readiness_evaluations` (`tenant-schema.sql` + migración aditiva `20261030120000_add_readiness_evaluations`). Sin poda en R2: la deduplicación por hash lo mantiene pequeño. Si la tabla falta (tenant sin migrar), la API muestra la preparación sin historial y no falla.
4. **Caché e invalidación.** Redis `readiness:{tenant}:{spec_version}`, 10 min. Se invalida con `agent.config.updated` y `agent.version.updated`. El panel reevalúa al abrirse y con «Recalcular»; la tarjeta de Inicio lee la caché. Las escrituras de valores avisarán con `business_fact.written` en R3. Se emiten `readiness.evaluated` y `readiness.verdict_changed`; el aviso al dueño cuando empeora llega con los avisos de R5.
5. **Permisos y enlaces.** El panel lo ven `tenant_admin`, `tenant_supervisor` y `super_admin` (con impersonación). Cada hueco enlaza a su pantalla solo si el rol que mira la puede abrir; si no, dice «Pídeselo a un administrador». Una ruta con segmento dinámico (`/admin/listings/[listingId]`) enlaza al listado. La CI de la especificación (`UNKNOWN_UI_TARGET`) exige ahora que `tenant_admin` pueda abrir cada `ui_target`; por eso `CORE.OFFER.PROMOTIONS` apunta a `/admin/catalog/offers` y no a los cupones de la plataforma.
6. **Endpoints de R2:** `GET /readiness/:tenantId` (`?refresh=1`), `/history`, `/requirements/:requirementId` (definición y evaluación; el descriptor de formulario llega con R3) y `/snapshot`, solo para `super_admin`, que devuelve la foto `business-spec/tenant-snapshot@1` que consume `business-spec qa-truth`. No hay vista entre tenants en la API: el diseño no la pide y `readiness:report --all-qa` cubre la vista de plataforma.
7. **Tarjeta de Inicio.** Las esenciales son `channel`, `agent` y `business`. La tarea `business` es «veredicto ≠ no_listo»: `limitado` cuenta como hecha (estado `prepared`), porque publicar en limitado es un camino aprobado (C0 §1.2) y la tarjeta no debe quedar abierta para siempre. Muestra el veredicto y los 3 primeros bloqueantes. Los chequeos técnicos de conocimiento (`rag_knowledge`, `rag_configuration`, `media_privacy_policy`) quedan en Salud de agentes, sin tarea.
8. **Imagen de la API.** Empaqueta `@parallext/business-spec` (`dist`, `spec/` y la entrada de Node `@parallext/business-spec/load`). Se retira la copia local `LegacyTenantRowsDto` del `SnapshotReader`.

## Consecuencias
- Cambian los `resultHash` respecto de R1, porque el contenido hasheado es otro. Ninguna fila los guardaba todavía.
- Un dato cambiado en una pantalla que no emite evento puede tardar hasta 10 min en verse en Inicio. En el panel, no: reevalúa al abrirse.
- Salud de agentes ya no opina sobre datos del negocio. Un test exige que ningún código retirado vuelva.

## Alternativas descartadas
- **Hash propio en la API** en lugar de cambiar `resultHash`: dos hashes del mismo resultado, uno de ellos inútil para deduplicar.
- **Agrupar por nivel en el dashboard:** sería una segunda copia de la regla del veredicto.
- **Interceptor HTTP que invalide en toda escritura:** hoy no hay un evento común de escritura de catálogo; con el TTL corto y la reevaluación al abrir alcanza hasta R3.
- **`limitado` como `warning` en la tarea `business`:** la tarjeta no se cerraría nunca para un negocio que el diseño deja publicar.
