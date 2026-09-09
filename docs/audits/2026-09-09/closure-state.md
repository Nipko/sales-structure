# Estado del remanente local, leído del código

Generado por `docs/audits/2026-09-09/generate-closure-state.cjs`. **Ningún número de este documento**
**está escrito a mano**: cada uno lo responde la autoridad que lo decide. Todos los contadores de este
programa que sí se escribieron a mano envejecieron —el 32/10 de la matriz, el `complete` de canales,
«otras salidas», «faltan términos en otras familias»—, y ése es exactamente el motivo.

Revisión: `713823c408dc5c4eda78bf02c85d6ba86163ed10`. Sin base de datos, sin modelo, sin proveedor, sin tenant.

## Matriz de tareas

| Perfiles | Tareas | Comprometen al negocio | Sin positivo verificable | Sin verificador | Certificados |
|---:|---:|---:|---:|---:|---:|
| 76 | 268 | 146 | 5 | 5 | 0 |

## Lo que costaría certificar el catálogo

Un modelo (`gpt-4.1-mini`), 5 canales, 4 idiomas, k=1:

- **78.120** casos requeridos
- **139.940** llamadas al modelo (derivadas de los mensajes de cliente de cada escenario)
- techo **US$677.40** con un límite declarado de 8000 tokens de entrada y 1000 de salida por turno
- **233 h** de tiempo de modelo
- rechazos del plan: —

## Certificación de canales

| Autoservicio | Implementados | Operando | Certificados |
|---:|---:|---:|---:|
| 5 | 3 | 0 | 0 |

| Canal | Estado | Sin implementar | Declarado, nunca operado | Operando sin prueba |
|---|---|---|---|---|
| instagram | prepared | — | `outbound_media`, `payment_link`, `token_lifecycle`, `reconnect`, `rate_limits`, `handoff`, `multi_account`, `privacy_erasure`, `agent_per_connection` | `inbound`, `outbound_text`, `delivery_receipt`, `read_receipt`, `durable_dispatch` |
| messenger | prepared | — | `outbound_media`, `payment_link`, `token_lifecycle`, `reconnect`, `rate_limits`, `handoff`, `multi_account`, `privacy_erasure`, `agent_per_connection` | `inbound`, `outbound_text`, `delivery_receipt`, `read_receipt`, `durable_dispatch` |
| telegram | pending | `delivery_receipt`, `read_receipt` | `outbound_media`, `payment_link`, `token_lifecycle`, `reconnect`, `rate_limits`, `handoff`, `multi_account`, `privacy_erasure`, `agent_per_connection` | `inbound`, `outbound_text`, `durable_dispatch` |
| web_widget | pending | `read_receipt` | `outbound_media`, `payment_link`, `reconnect`, `rate_limits`, `handoff`, `multi_account`, `privacy_erasure`, `agent_per_connection` | `inbound`, `outbound_text`, `delivery_receipt`, `durable_dispatch` |
| whatsapp | prepared | — | `outbound_media`, `payment_link`, `flow`, `token_lifecycle`, `reconnect`, `rate_limits`, `handoff`, `multi_account`, `privacy_erasure`, `agent_per_connection` | `inbound`, `outbound_text`, `delivery_receipt`, `read_receipt`, `durable_dispatch` |

## Dónde descansan las palabras del agente

19 lugares inventariados, **8 abiertos**:

| Store | Qué lo cerraría |
|---|---|
| `eval_runs` | Invalidate the run when its release is retired — the snapshot already names it — and reach it from the contact-erasure fan-out the way simulation replays already are. |
| `simulation_runs` | Same as `eval_runs`: invalidate by release id when the release is retired. |
| `agent_release_evidence` | Invalidate on retirement of the release the snapshot names, and join the contact-erasure fan-out. |
| `quality_regression_cases` | Record the release id beside the source contact id when the case is frozen, so a retraction has a key. |
| `handoff_summary` | Clear both in the contact-erasure statement that already resets the conversation metadata, and record the external CRM note id so the copy can be retracted with it. |
| `quality_scores` | Record the release ids of the turn being judged, so a withdrawn release can take its verdicts with it. |
| `benchmark_attempts` | Give the attempt ledger a release id and a contact id when it is built, so both keys reach it from the first row rather than being retrofitted onto a corpus that already exists. |
| `outbound_queue_job` | Turn the durable dispatch switch on for the tenant, which routes the same reply through `agent_dispatch_outbox` — already reached by both keys. Until then this is the widest hole in the sweep. |

## Términos que el cliente aceptó

15 familias. Sin comando vinculado: `appointment_transitions`, `repair_orders`, `class_bookings`, `insurance_quotes`, `property_bookings`, `tour_bookings`, `restaurant_orders`, `service_requests`, `photo_sessions`, `resource_rentals`.

Sin cobro vinculado: `catalog_orders`, `property_bookings`, `tour_bookings`, `restaurant_orders`.

Para actualizar: `node docs/audits/2026-09-09/generate-closure-state.cjs` desde la raíz.
