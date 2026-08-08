# Matriz competitiva verificable de las 18 verticales

**Corte:** 8 de agosto de 2026
**Estado Parallly:** código del worktree; no implica certificación E2E
**Fuentes:** páginas oficiales de producto/ayuda verificadas en el corte
**Auditoría relacionada:** [`vertical-system-audit-2026-08.md`](./vertical-system-audit-2026-08.md)

## 1. Cómo leer la matriz

El referente es una señal de capacidad del mercado, no una afirmación de equivalencia uno-a-uno. Varias metas combinan suites distintas y controles propios de seguridad. La prioridad significa:

- **A:** necesaria antes de vender la vertical como solución profunda;
- **B:** aumenta competitividad después de cerrar la operación principal;
- **C:** apuesta estratégica que requiere definición de producto.

La columna “Parallly hoy” enumera solamente capacidades respaldadas por código. La prueba de aceptación es el mínimo que convertiría la brecha en evidencia, no una demo visual.

## 2. Comparación por vertical

| Vertical | Parallly hoy, code-backed | Referente oficial verificado | Brecha competitiva principal | Prioridad | Prueba de aceptación mínima |
|---|---|---|---|---|---|
| Salud | Servicios, agenda/citas, tratamiento parcial, CRM, RAG, handoff y analítica | [NexHealth](https://www.nexhealth.com/), [Tebra](https://www.tebra.com/patient-experience), [Doctoralia](https://pro.doctoralia.co/producto/agenda-doctoralia-para-especialistas) | EHR/PMS bidireccional, staff/sedes, formularios/consentimiento, insurance/payment y assurance clínico | A | Crear/reprogramar/cancelar en sandbox PMS; conflicto concurrente; A2 para datos sensibles; cuatro idiomas; reconciliación webhook |
| Moda y belleza | Servicios, citas, staff scheduling básico, tratamientos parciales y analytics | [Zenoti](https://www.zenoti.com/pricing-zenoti) | Recursos físicos, habilidades, paquetes/membresías/créditos, POS, inventario/consumibles, propinas y comisiones | A | Reserva atómica servicio+profesional+cabina; depósito; consumo; rebooking; no double-booking bajo concurrencia |
| Inmobiliaria | Listings, búsqueda, visitas/citas vinculadas, CRM y analytics | [Lofty](https://lofty.com/), [Follow Up Boss](https://www.followupboss.com/), [Structurely](https://www.structurely.com/how-it-works) | Feed MLS/portal vivo, favoritos/búsquedas guardadas/alertas, routing y dedupe completo | A | Import incremental con freshness/source; alerta por cambio; visita conserva listing; cross-tenant y dato vencido fail-closed |
| Restaurantes | Menú, pedido transaccional, currency, ETA autoritativa, promociones y food-order context | [SevenRooms](https://sevenrooms.com/restaurants/), [Toast](https://pos.toasttab.com/products/online-ordering) | POS/KDS, modificadores/alérgenos, sucursal/mesa/pacing, stock vivo y delivery | A | Pedido con modificadores llega a sandbox POS/KDS una vez; stock/ETA se reconcilian; alergia escala; retry idempotente |
| Automotriz | Inventario/búsqueda, test drive/citas, currency lineage y analytics | [Tekion](https://tekion.com/products), [Impel](https://impel.ai/blog/impel-ai-certified-by-mitsubishi/), [Podium Auto](https://www.podium.com/t/experience/auto) | VIN/DMS, historial, repair order, trade-in, financiación/aprobación y pagos | A | Sync DMS por VIN; test drive conserva vehículo; work order y aprobación auditables; precio/stock con source+TTL |
| Turismo | Tours, properties, reservas activas, agenda, duración/unidad y moneda | [Cloudbeds](https://www.cloudbeds.com/channel-manager/), [Travefy](https://travefy.com/products/crm), [Rezdy](https://support.rezdy.com/hc/en-us/articles/19867793699612-What-Is-a-Resource-and-How-To-Set-Them-Up) | Tres modelos distintos: PMS/channel manager, tours/cupos/recursos y agencia/itinerario/proveedor | A | Certificar cada subtipo por separado; noches/cupos/impuestos/depósito; race de disponibilidad; voucher/itinerario reconciliado |
| Education | Cursos, cohortes/enrollments, duración, citas y analytics | [Element451 Admissions](https://element451.com/element-admissions-ai-agent-teams), [Element451 CRM](https://element451.com/product/enterprise-crm) | Applicant lifecycle, documentos/requisitos, SIS/LMS, eventos, pagos y permisos de menores | A | Prospecto→aplicante→matriculado en sandbox; documento/consentimiento; no prometer admisión/beca; ownership y auditoría |
| Finanzas | CRM/pipeline, citas, knowledge, persona y analytics | [Salesforce Financial Services](https://www.salesforce.com/financial-services/cloud/guide/) | Toolset propio, productos/tasas/costos versionados, KYC/AML, elegibilidad, disclosures y approvals | A | Cotización determinista con versión/fuente; A2/A4; KYC sandbox; disclosure aceptado; decisión humana trazable |
| Servicios profesionales | CRM, citas, case-status sensible, handoff y analytics | [Clio Grow](https://www.clio.com/grow/), [TaxDome](https://taxdome.com/), [Scoro](https://www.scoro.com/) | Separar legal/contable/PSA; intake/conflicto, proposal/SOW, firma, matter/project, tiempos y retainer | A | Caso propio bajo assurance; conflicto previo; contrato/firma/payment sandbox; horas/capacidad y rentabilidad reconciliadas |
| Retail | Catálogo, inventario, orders, currency lineage, RAG/policies y analytics | [Shopify Inbox](https://apps.shopify.com/inbox), [Shopify Sidekick](https://help.shopify.com/en/manual/ai-powered-tools/sidekick) | Checkout/payment link, shipping/tracking, devoluciones, loyalty, recovery y autorización de discount/refund | A | Catálogo/stock/moneda de proveedor; carrito→pago→pedido; refund A4; retry idempotente; atribución de venta asistida |
| Technology | CRM, RAG/policies, citas, handoff y analytics | [Intercom Fin](https://www.intercom.com/help/en/articles/7120684-fin-ai-agent-explained), [HubSpot Customer Agent](https://knowledge.hubspot.com/customer-agent/set-up-the-customer-agent) | Cuenta/workspace/plan/entitlement, tickets/SLA, status, telemetría y secret redaction | A | Ticket con entitlement/tenant; status source+TTL; runbook aprobado; secret corpus 100%; handoff conserva trazas |
| Veterinaria | Pets, vacunas, citas, `hospital_24h`, ownership y analytics | [PetDesk](https://petdesk.com/veterinary-client-engagement-software), [PetDesk App](https://petdesk.com/products/veterinary-mobile-app) | PIMS, múltiples mascotas, refill profesional, estimación/depósito y resultados liberados | A | Sync PIMS; mascota correcta; vacuna/resultado solo liberado; refill escala; dosis/diagnóstico bloqueados; cuatro idiomas |
| Gimnasios | Planes/membresías/clases, bookings, capacidad/duración y analytics | [Glofox](https://www.glofox.com/business-types/gym-management-software/) | Cobro recurrente, créditos, waitlist, freeze/upgrade/cancel, acceso, waiver, attendance y churn | A | Cupo/waitlist concurrente; contrato/waiver; cobro sandbox; freeze/cancel según policy; check-in y churn reconciliados |
| Seguros | Planes/cotización, pólizas/claims, ownership, A2 y analytics | [InsuredMine](https://www.insuredmine.com/), [Salesforce Digital Insurance](https://www.salesforce.com/financial-services/digital-insurance-software/) | Carrier/rating, quote versioning, firma, renewal, FNOL/claim core, licencia y pagos | A | Cotización source/version; A2 póliza/claim; FNOL sandbox; nunca vincula cobertura ni decide claim; firma/renewal auditables |
| Servicios del hogar | Requests/estimates, agenda, currency, handoff y analytics | [ServiceTitan](https://www.servicetitan.com/features), [Dispatch Pro](https://www.servicetitan.com/features/pro/dispatch) | Zona/media, workforce dispatch por skill/ubicación, partes/inventario, invoice/payment, warranty/rework | A | Request→dispatch→ETA→work order; aprobación de estimate; partes/factura/pago; emergencia escala; retry una sola vez |
| Pet services | Pets, servicios/citas, subtype resolver, ownership y analytics | [MoeGo Boarding](https://help.moego.pet/en/articles/14085066-how-your-clients-book-boarding-daycare-online), [Pet Profile](https://help.moego.pet/en/articles/14133911-pet-profile-overview), [Membership](https://help.moego.pet/en/articles/11380526-set-up-membership) | Boarding/daycare por rango, kennels/capacidad, vacunas/comportamiento/medicación, add-ons y membresías | A | Reserva multi-día por pet/kennel; vacuna válida; dieta/medicación protegida; capacidad concurrente; beta no anunciada como GA |
| Fotografía | Paquetes, quote/session writes, agenda, duración y analytics | [HoneyBook](https://www.honeybook.com/crm/photographers), [HoneyBook Galleries](https://help.honeybook.com/en/articles/15714707-create-and-share-photo-galleries-in-honeybook) | Date hold, contrato/depósito/cuotas, cuestionario, editing/delivery milestones, gallery y releases | B | Hold expira; firma+depósito antes de confirmar; milestones; gallery por owner; release/copyright; plan/tier documentado |
| Otro | CRM, pipeline, catálogo/orders, persona, knowledge y analytics | [Kommo](https://www.kommo.com/), [Respond.io](https://respond.io/ai-agents), [Zoho Custom Modules](https://help.zoho.com/portal/en/kb/crm/customize-crm-account/customizing-modules/articles/customize-modules) | Decidir fallback horizontal o builder de objetos/relaciones/tools/policies/KPIs/tests | C | Si es builder: schema versionado, preview, permisos, migración/rollback, tool generation validada y test suite generada |

## 3. Cautelas de interpretación

- NexHealth/Tebra/PetDesk suelen ser capas conectadas a sistemas clínicos; no sustituyen necesariamente el EHR/PIMS.
- Turismo combina PMS, tour operator y travel CRM; debe compararse por subtipo, no como una sola suite.
- Servicios profesionales combina legal, contable y PSA; `matter`, `SOW` y conflicto no aplican de forma idéntica.
- Shopify Sidekick asiste al comerciante; no demuestra por sí solo un agente comprador E2E.
- InsuredMine y Salesforce Digital Insurance representan capas y escalas distintas; no son comparación like-for-like.
- Dispatch Pro y varias capacidades avanzadas de los referentes pueden ser add-ons, tiers superiores o disponibilidad regional.
- MoeGo documenta algunas capacidades como beta/invitación; no deben presentarse como disponibilidad general.
- Las galerías nativas de HoneyBook y su disponibilidad por plan deben verificarse nuevamente antes de una promesa comercial.

## 4. Resultado competitivo

Parallly ya tiene una base horizontal diferenciable —omnicanal, multiagente, CRM propio, RAG, tools, handoff, cuatro idiomas y tenancy por schema—, pero su principal brecha contra los líderes no es el prompt. Es la **conexión transaccional, segura y observable con el sistema operativo de cada industria**. Por eso la certificación prioriza primero datos vivos, ownership, idempotencia, assurance, reconciliación y outcome; los diferenciadores de IA vienen después.
