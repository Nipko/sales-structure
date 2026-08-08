# Registro final de decisiones — programa de 18 verticales

**Corte:** 8 de agosto de 2026
**Regla:** ninguna de estas decisiones se tomó implícitamente durante las remediaciones
**Estado de certificación:** 0/18 E2E
**Ejecución asociada:** [`vertical-waves-execution-2026-08.md`](./vertical-waves-execution-2026-08.md)

## 1. Cómo usar este registro

Cada decisión tiene una recomendación técnica, pero requiere aceptación de producto/negocio cuando cambia alcance, UX, pricing, datos o riesgo. `Bloquea` indica qué no debe anunciarse o construir hasta resolverla. Salvo que se indique `Estado`, la decisión permanece **abierta**; `adoptada parcial` significa que existe un contrato v1 acotado, no que se haya resuelto toda la política.

## 2. Decisiones de alcance y posicionamiento

### DEC-01 — Orden real de certificación y conectores

- **Pregunta:** ¿qué verticales recibirán primero integración real, E2E y soporte operativo?
- **Opciones:** certificar las seis de Ola 2 en paralelo; elegir 2–3 anclas; priorizar por cliente comprometido/ARR.
- **Recomendación:** elegir 2–3 anclas con demanda comprobada y mantener las demás en modo horizontal honesto. Usar la matriz competitiva, datos de pipeline y disponibilidad de sandbox/proveedor para decidir.
- **Bloquea:** claims de “solución profunda” y gasto en conectores sin ICP confirmado.

### DEC-02 — Profundidad de finanzas, technology y servicios profesionales

- **Pregunta:** ¿son verticales vendibles o presets horizontales hasta crear sus objetos y permisos?
- **Opciones:** toolsets propios; conectores-first; mantener preset CRM/RAG.
- **Recomendación:** mantenerlas como presets horizontales etiquetados hasta definir, respectivamente, application/KYC, ticket/entitlement y matter/project lifecycle.
- **Bloquea:** vender elegibilidad financiera, soporte técnico contextual o gestión profesional E2E.

### DEC-03 — Destino de `otro`

- **Pregunta:** ¿fallback mínimo o vertical builder estratégico?
- **Opciones:** CRM genérico estable; builder declarativo; eliminarlo de marketing.
- **Recomendación:** conservar fallback estable ahora y diseñar el builder como producto separado con schema versionado, preview, permisos, migración y tests generados.
- **Bloquea:** prometer objetos/tools/KPIs configurables que hoy no existen.

## 3. Decisiones de superficies conversacionales e IA

### DEC-04 — Agent Test: preview o sandbox paritario

- **Pregunta:** ¿el producto necesita probar writers/Booking Engine/canales o solo prompt/RAG/tools seguras?
- **Opciones:** preview actual; schema clon efímero; tenant sandbox completo.
- **Recomendación:** conservar el preview seguro y crear, como producto distinto, un sandbox efímero con DB/Redis/colas/proveedores stub y teardown verificable. No relajar `persistence: disabled`.
- **Bloquea:** llamar al endpoint actual “pipeline completo”.

### DEC-05 — Widget como canal completo

- **Pregunta:** ¿el widget debe ejecutar booking/tools/handoff y permitir respuesta humana?
- **Opciones:** FAQ/RAG seguro; canal completo; subconjunto por capability.
- **Recomendación:** convertirlo en `ChannelType` formal solo después de adaptar entrega humana, identidad, policy y revocación; habilitar capabilities por etapas.
- **Bloquea:** writers y handoff prometido sin adapter de retorno.

### DEC-06 — ActiveObjects y datos sensibles

- **Estado:** adoptada parcial v1; el contrato bounded y los loaders no sensibles existen, pero los dominios sensibles continúan pendientes.
- **Pregunta:** ¿qué operaciones se preinyectan al LLM y con qué assurance?
- **Opciones:** ampliar todo; mantener tool-only; política por kind.
- **Recomendación:** política por kind. Appointments/orders no sensibles pueden cargarse bounded; claims, casos, datos clínicos, pagos, documentos y access codes quedan tool-only con A2/A3/A4.
- **Bloquea:** loaders de claims/cases/clinical sin step-up y minimización.

### DEC-07 — Roadmap de IA diferenciadora

- **Pregunta:** ¿priorizar next-best-action, multimodal, voz o optimización de modelos?
- **Opciones:** features visibles primero; lineage/evals primero; por vertical.
- **Recomendación:** lineage+freshness+evals por outcome antes de NBA; después multimodal en hogar/auto/seguros y voz solo donde exista consentimiento/retención claros.
- **Bloquea:** recomendaciones “explicables” sin fuente/TTL o procesamiento de media sin política.

## 4. Decisiones de identidad, autoridad y tools

### DEC-08 — Matriz formal de assurance A0–A4

- **Estado:** abierta globalmente; seguros ya aplica A2 a `check_policy_status`, `file_claim` y `list_my_claims`.
- **Pregunta:** ¿qué acciones exigen contacto, OTP, confirmación o aprobación humana?
- **Recomendación propuesta:** A0 información pública; A1 datos propios de bajo riesgo; A2 pólizas/claims/casos/datos clínicos/documentos; A3 firma/pago/PII de alta sensibilidad; A4 refund, descuento alto, decisión regulada o irreversible.
- **Bloquea:** cerrar `P1-16` y certificar verticales reguladas.

### DEC-09 — Controles faltantes de ToolPolicy

- **Hecho:** 90/90 tools están clasificadas; 37 reportan al menos un control faltante (23 idempotencia, 23 confirmación, 1 assurance y 1 aprobación humana).
- **Opciones:** controles por handler; middleware central; workflow approval service.
- **Recomendación:** enforcement central antes del switch: confirmation token firmado, idempotency key/ledger, assurance guard y approval ticket; los handlers conservan CAS/transacción de dominio.
- **Bloquea:** tratar clasificación como certificación o habilitar `apply_discount` autónomo.

### DEC-10 — Pago, depósito y reembolso como tools

- **Pregunta:** proveedor, países, ledger, aprobación y conciliación.
- **Opciones:** payment links provider-agnostic; integración directa; solo handoff humano.
- **Recomendación:** contrato provider-agnostic y ledger interno primero; payment link idempotente A3, refund/discount A4, webhooks firmados y reconciliación. Hasta elegir proveedor, usar handoff.
- **Bloquea:** `P1-18`, checkout/deposit/refund y varias brechas competitivas.

## 5. Decisiones de datos y operación

### DEC-11 — Moneda operativa y FX

- **Pregunta:** moneda única por tenant, multi-moneda o conversión.
- **Opciones:** base currency inmutable; currency por objeto; FX bajo demanda.
- **Recomendación:** `tenant.operatingCurrency` explícita e inmutable tras primeras transacciones, currency por línea/objeto, FX snapshot con fuente+fecha para agregados y prohibición de relabel. Seeds quedan ejemplos editables.
- **Bloquea:** reemplazar COP por país, sumar GMV de monedas distintas y corregir fallbacks USD de Shopify/Woo/Toast.

### DEC-12 — Semántica temporal y capacidad

- **Pregunta:** minutos, días/noches, servicio `open`, cupos y recursos.
- **Recomendación:** modelos separados: appointment en minutos; nightly/date-range con noches; day-capacity para daycare/open; class/tour session con cupo; recursos con exclusión temporal. No usar `60 min` como representación comercial de “fin de semana”.
- **Bloquea:** paquete fin de semana, boarding/daycare y capacidad real de varias verticales.

### DEC-13 — Modelo canónico de staff/resources

- **Pregunta:** relación entre `staff_members`, usuarios, `service_staff`, calendarios, sedes y recursos físicos.
- **Opciones:** IDs compartidos; entidades ligadas; modelos separados.
- **Recomendación:** entidades separadas pero enlazadas explícitamente: staff profile ↔ user opcional; skills/services; location; calendar integration; resource/capacity. Nunca asumir igualdad de UUIDs.
- **Bloquea:** `P1-17`, asignación confiable y UI administrativa completa.

### DEC-14 — Propiedad y reconciliación de calendario externo

- **Hecho:** PATCH/retry/CAS están protegidos, pero la cita no persiste `calendar_integration_id` y no hay outbox.
- **Recomendación:** persistir owner/provider/event ID; transacción DB + outbox; worker idempotente; estado `pending/synced/failed`; reconciliación y retry. No ejecutar proveedor dentro del commit de dominio.
- **Bloquea:** multi-cuenta del mismo proveedor y recuperación de fallo posterior al commit.

### DEC-15 — Migración vertical y reseed

- **Pregunta:** cambio de industria, backfill legacy y conflictos con personalización.
- **Opciones:** tenant nuevo; migración preview/rollback; bloquear siempre.
- **Recomendación:** mantener bloqueo actual; diseñar preview con inventario de datos, mappings, archive, transacción/outbox y rollback. Reseed permanece aditivo; cualquier overwrite exige diff y aprobación.
- **Bloquea:** retirar `vertical_migration_required` y el fallback amplio de tenants legacy.

## 6. Decisiones de confianza y comercialización

### DEC-16 — Registro positivo de claims

- **Pregunta:** quién aprueba y caduca evidencia comercial.
- **Recomendación:** archivo/tabla versionada `claimId → copy/locales → capabilityId → evidenceId → scope/plan/region → verifiedAt/expiresAt → owner`; build fail-closed para claim visible sin evidencia vigente. Mantener denylist como segunda defensa.
- **Bloquea:** cerrar `P1-20` y usar el landing como fuente de verdad.

### DEC-17 — Gobierno del benchmark competitivo

- **Pregunta:** frecuencia y responsable de revalidar links, tiers, beta y región.
- **Recomendación:** revisión trimestral y antes de cada claim; guardar URL canónica, fecha, extracto permitido, tier/región/beta y test interno asociado.
- **Bloquea:** afirmar paridad por una homepage o feature beta.

## 7. Decisiones de certificación e infraestructura

### DEC-18 — Pipeline de calidad real

- **Pregunta:** qué gates corren en PR, nightly, weekly y release, y con qué presupuesto.
- **Recomendación:** PR: static+unit+contract; merge: bootstrap afectado+HTTP; nightly: 1.520 DB/mock conversation; weekly: real-model/sandboxes/perf; release: chaos/rollback/canary. Publicar JUnit, snapshots y manifest versionado.
- **Bloquea:** interpretar el workflow actual como certificación completa.

### DEC-19 — Política de Web Push y transporte externo

- **Hecho:** Axios seguro ya tiene DNS y deadline absoluto; la librería Web Push aún necesita cap/deadline verificable frente a respuestas maliciosas.
- **Opciones:** proxy/worker aislado con límites; fork/transporte propio; restringir hosts oficiales.
- **Recomendación:** worker aislado con deadline, límite de memoria/respuesta y allowlist de push services conocidos, conservando compatibilidad explícita solo si se justifica.
- **Bloquea:** cerrar el gate de red de P0-09 en staging.

## 8. Orden sugerido para decidir

1. `DEC-01`, `DEC-02`, `DEC-03`: foco comercial.
2. `DEC-08`, `DEC-09`, `DEC-10`: autoridad y dinero.
3. `DEC-11` a `DEC-15`: modelo operativo y migración.
4. `DEC-04` a `DEC-07`: superficies y diferenciación IA.
5. `DEC-16` a `DEC-19`: gobierno, evidencia y release.

Hasta registrar estas decisiones, el comportamiento seguro implementado —preview, bloqueos, fallos cerrados y preservación de datos del usuario— prevalece sobre una expansión implícita.
