# Plan maestro de implementación de verticales 1:1 — agosto de 2026

**Estado:** propuesta detallada para aprobación; no autoriza ni implementa código  
**Entradas:** [auditoría competitiva](./vertical-subtype-market-audit-2026-08.md), [auditoría de prompts/navegación](./vertical-subtype-prompt-navigation-audit-2026-08.md), [auditoría integral de tools](./agent-tool-subtype-cohesion-audit-2026-08.md) y [packs lingüísticos por país](./country-language-behavior-packs-latam-2026-08.md)  
**Cobertura:** 18 verticales, 75 subtipos y `otro`

## 1. Resultado que debe producir el programa

Parallly debe pasar de un selector de 75 etiquetas sobre 27 perfiles efectivos a un portafolio gobernado de experiencias por subtipo. “Llegar a la par” no significa reconstruir 18 sistemas de registro especializados. Significa que, para el alcance comercial declarado de cada subtipo, la plataforma:

1. usa el lenguaje correcto del negocio;
2. solicita y valida las variables que requiere cada intención;
3. consulta datos vivos y ejecuta acciones confirmadas;
4. lleva al usuario humano directamente a su trabajo diario;
5. separa operación, catálogo/configuración y CRM;
6. integra el sistema de registro cuando fabricar uno propio sea inseguro o antieconómico;
7. bloquea activación y marketing cuando falten plan, datos, integración, consentimiento o certificación;
8. demuestra el resultado mediante evals, pruebas E2E, telemetría y pilotos sectoriales;
9. resuelve las tools efectivas desde subtipo, agente, plan, readiness, SoR, país y rol, sin depender de toggles aislados;
10. entiende variantes nacionales y formatos locales sin convertir expresiones ambiguas en consentimiento ni generar estereotipos.

## 2. Decisiones de producto que deben aprobarse antes de desarrollar

1. **Posicionamiento:** Parallly será capa conversacional y operativa ligera; no prometerá ser EHR, PMS hotelero, POS/KDS, DMS, core bancario, PAS de aseguradora o software de construcción completo.
2. **Taxonomía:** retirar del selector cualquier subtipo sin diferencia defendible o comprometerse a su contrato mínimo. `wedding_planner` debe salir de Fotografía; `construccion`, `fintech`, `marketplace` y `aseguradora` requieren definición o división antes de código.
3. **Semántica:** una oportunidad del CRM nunca adoptará el mismo nombre que una reserva, orden, caso, póliza, trabajo o solicitud operativa.
4. **Fuente de verdad:** cada variable crítica declara SoR, frescura y fallback. El LLM no es fuente de estado.
5. **Profundidad:** cada subtipo tendrá un alcance certificable explícito: `captación`, `calificación`, `cotización`, `operación ligera` o `operación integrada`.
6. **Mercados:** español neutral no basta para sectores regulados o con léxico regional. Se priorizarán países y paquetes terminológicos antes de afirmar cobertura LatAm.
7. **Planes:** navegación, onboarding, readiness, herramientas y backend compartirán el mismo contrato de entitlements; no habrá páginas visibles que luego fallen por plan.
8. **País operativo:** separar `operatingCountry`, `billingCountry`, ubicación del cliente, locale, timezone y monedas; no se certificará un mercado por estar aceptado en un DTO.
9. **Consentimiento:** un único clasificador determinista combinará pending state, efecto de tool, país y evidencia; una palabra contextual nunca autoriza dinero o cambios irreversibles.
10. **Herramientas externas:** MCP, Procedures y conectores no se anunciarán como operativos hasta tener scopes, policy, SoR, frescura, write-back, idempotencia y test.
11. **Alojamiento:** decidir si Channel Manager/Hostaway es SoR; no mantener writers locales que puedan producir doble reserva.

## 3. Arquitectura objetivo

### 3.1 Registro único por subtipo

Crear un contrato versionado `SubtypeExperienceProfile` como única fuente para API, dashboard, móvil, onboarding, agente, documentación, planes y pruebas. Debe contener:

- identidad: vertical, subtipo, alias legacy, estado y mercados certificados;
- alcance: trabajo principal, objetos operativos, SoR, capacidades y exclusiones;
- prompt: rol, objetivos, reglas, límites, handoff, intenciones, slots y políticas de confirmación;
- lenguaje: sustantivos, verbos, sinónimos, abreviaturas, términos a explicar, modismos prohibidos y variantes regionales;
- herramientas: lecturas, writers, aprobaciones, idempotencia, compensaciones y errores reparables;
- navegación: home por rol, ruta primaria, tareas diarias, catálogo, CRM, analítica, configuración y quick actions;
- entitlement: features y cuotas requeridas por plan;
- readiness: objetos/datos/integraciones mínimas, chequeos bloqueantes y mensajes de reparación;
- seguridad: sensibilidad, consentimiento, retención, auditoría y restricciones regulatorias;
- analítica: eventos, resultado principal, embudo y SLA;
- calidad: casos de eval, fixtures, idiomas y evidencia de certificación.

El contrato debe rechazar en CI perfiles incompletos, rutas sin página, herramientas sin executor, writers sin idempotencia, etiquetas duplicadas entre objeto CRM/operativo y términos ausentes en cualquiera de los cuatro idiomas.

### 3.2 Contrato conversacional por intención

No crear 75 prompts monolíticos. Componer cada experiencia con:

- contrato universal de seguridad y veracidad;
- módulo regulatorio/sectorial reutilizable;
- persona y registro de lenguaje del subtipo;
- catálogo de intenciones: descubrir, calificar, cotizar, reservar/pedir/inscribir, modificar, cancelar, pagar, consultar estado, reclamar y escalar;
- `SlotSchema` versionado por intención;
- workflow determinista para estado, validación, confirmación, tool call, idempotencia y recuperación;
- contexto vivo permitido, recuperado desde herramientas/SoR;
- ejemplos y evals, no instrucciones redundantes.

### 3.3 Arquitectura de información

Separar cinco espacios:

1. **Hoy / Trabajo diario:** colas, próximas acciones, llegadas, pedidos, citas, casos o servicios.
2. **Operación:** objetos confirmados y sus estados.
3. **Catálogo y capacidad:** productos, propiedades, vehículos, servicios, personal, recursos, horarios y disponibilidad.
4. **Comercial:** contactos, organizaciones, oportunidades y seguimiento.
5. **Control:** analítica, automatización, conocimiento, integraciones, pagos y configuración.

Cada entrada declara `purpose`, `objectKind`, `mode` (`operate|configure|sell|insight`), roles, feature/plan, readiness y prioridad por subtipo. Web y móvil consumen la misma proyección. La navegación debe llevar desde Inbox, cliente, calendario y alerta al mismo detalle operativo.

### 3.4 Contrato de herramientas efectivo

Crear `EffectiveAgentCapabilityContractV1`, resuelto en servidor por tenant/agente/turno. La intersección obligatoria es:

```text
SubtypeExperienceProfile
  ∩ overrides permitidos del agente
  ∩ plan/cuotas runtime
  ∩ readiness/datos
  ∩ provider health/scopes/freshness
  ∩ país/jurisdicción
  ∩ rol/canal
  = intents y tools publicables
```

Por cada tool debe incluir efecto, SoR, precondiciones, slots, plan, readiness, assurance, confirmation policy, idempotencia, active object, human route, error/retry/compensación y evidencia de outcome. Dashboard, Procedures, Agent Test y runtime consumirán el mismo snapshot; ningún JSON editable ampliará autoridad.

### 3.5 Contrato regional y jurisdiccional

Componer `BaseLanguagePack + CountryLanguageBehaviorPack + SubtypeOverlay + tenant/customer preferences`. El normalizador determinista reconocerá afirmación, rechazo, corrección, cancelación, humano, opt-out y seguridad; el prompt recibirá solo términos de generación y metadata versionada.

El perfil regional canónico debe separar país operativo/fiscal, locale BCP 47, timezone IANA, moneda ISO 4217, phone region, address schema y forma de tratamiento. RAG añade `jurisdiction`, `authority`, `validFrom`, `validTo` y `applicability`; en dominios regulados el filtro por jurisdicción es bloqueante.

## 4. Fases y puertas de salida

El orden siguiente expresa dependencias, no fechas comprometidas.

| Fase | Objetivo | Puerta de salida |
|---|---|---|
| 0. Gobierno | aprobar alcance, taxonomía, mercados y claims | 76 decisiones registradas; subtipos ambiguos resueltos o despublicados |
| 1. Contratos | construir registro único, tools efectivas, regionalización, slots, IA de menú y entitlements | CI valida 76 perfiles; runtime/UI/test comparten snapshot y ninguna proyección mantiene reglas paralelas |
| 2. Honestidad P0 | eliminar experiencias engañosas y writers/verdades divergentes | reservas ≠ pipeline; fotos/configuración accesibles; writers y disponibilidad usan el mismo SoR |
| 3. Prompt + lenguaje | crear perfiles, country packs, glosarios, normalizadores, workflows y evals | 4 idiomas base + mercados priorizados; confirmación unificada y evals por subtipo/país/riesgo |
| 4. Navegación operativa | rutas globales, homes por rol y paridad móvil | tarea principal a ≤2 interacciones; agentes acceden a operación sin permisos de catálogo |
| 5. Profundidad por vertical | construir/integrar faltantes según olas | cada subtipo cumple su mínimo competitivo declarado |
| 6. Certificación | E2E, observabilidad, pilotos y go-to-market | evidencia real por canal/modelo/plan/idioma; policy cambia solo tras aprobación |

## 5. Backlog transversal

### Épica A — Gobierno y taxonomía

**Entregables:** catálogo canónico, definición de segmento, política de aliases/migración, matriz build/integrate/stop y claim autorizado por subtipo.

**Tareas:**

- decidir `construccion` (venta de proyecto nuevo vs contratista);
- convertir `wedding_planner` en Event Planning o retirarlo;
- dividir o acotar `fintech` por caso de uso;
- separar operador de marketplace de comercio propio;
- separar broker/agency de aseguradora/carrier;
- decidir si peluquería canina vive en Veterinaria, Pet Services o ambas con contratos diferentes;
- eliminar subtipos label-only que no tendrán inversión;
- versionar cambios y migrar tenants sin cambiar silenciosamente sus herramientas.

**Aceptación:** cada opción del selector tiene buyer, trabajo principal, objeto, alcance, referente, SoR y owner de producto.

### Épica B — Prompt contract y variables

**Entregables:** `IntentContract`, `SlotSchema`, políticas de confirmación, repairs, approval, handoff y editor de prompt efectivo.

**Tareas:**

- retirar la supresión global de `requiredFields` y sustituirla por ownership explícito de cada slot;
- guardar estado por workflow, no depender del historial del LLM;
- declarar fuente, frescura, sensibilidad, tipo, unidad y validador de cada variable;
- añadir corrección de un paso y reanudación después de interrupciones;
- exigir éxito de writer antes de confirmar; mantener idempotencia y compensación;
- mostrar al administrador qué reglas vienen de plataforma, sector, subtipo y personalización;
- validar que modo libre no desactive sin aviso horario, handoff o restricciones;
- limitar tamaño de prompt: datos vivos solo por tool/active objects y carga bajo demanda.

**Aceptación:** cada intención crítica tiene tests de dato faltante, ambiguo, inválido, corregido, duplicado, tool error y cancelación.

### Épica C — Lenguaje, modismos e i18n

**Entregables:** `TerminologyPack` por subtipo/idioma, variantes regionales priorizadas, glosario y lint semántico.

**Tareas:**

- reemplazar slugs crudos por identidad semántica localizada;
- distinguir término interno de término que se dice al cliente;
- registrar sinónimos y abreviaturas (`VIN`, `SKU`, `KYC`, `check-in`, etc.) con política de explicación;
- prohibir familiaridad no solicitada (`peludo`, `papá/mamá perruno`, `parce`, `bro`) y regionalismos no gobernados;
- adaptar monedas, medidas, fechas, horas, direcciones y documentos al mercado;
- revisar el contenido con profesionales de sectores regulados y hablantes nativos;
- ejecutar pseudo-localización, cobertura de claves y evals por idioma.

**Aceptación:** cero strings sectoriales sin i18n; cero término de otro subtipo en evals; registro apropiado por canal y país objetivo.

### Épica D — Navegación y roles

**Entregables:** route registry semántico, home por rol, menú ordenado por subtipo, accesos rápidos, breadcrumbs y paridad móvil.

**Tareas:**

- separar permiso de administrar catálogo de permiso de operar reservas/pedidos/casos;
- crear rutas globales para reservas de alojamiento y tours, alquileres, sesiones y demás objetos hoy anidados;
- reservar “Pipeline/Oportunidades” para CRM y eliminar label overrides engañosos;
- definir home de agente, supervisor y administrador por subtipo;
- cruzar navegación con plan y readiness;
- añadir estados vacíos con CTA al dato/configuración faltante;
- instrumentar impresiones, clics, búsqueda, tiempo-a-tarea y callejones sin salida;
- hacer que móvil consuma el mismo contrato y priorice las 3–5 tareas del rol.

**Aceptación:** tarea primaria accesible en máximo dos interacciones; ningún rol ve un CTA que terminará en 403; ningún objeto operativo existe solo dentro de un catálogo restringido.

### Épica E — Plan, readiness y activación

**Entregables:** `requiredPlanFeatures`, cuotas por objeto, checklist bloqueante y preview honesto antes de activar.

**Tareas:**

- eliminar fallbacks de plan duplicados en frontend;
- unir manifest, sidebar, tools, controladores y onboarding a la misma resolución de entitlements;
- crear readiness para fotos, catálogo, stock, cupos, staff, recursos, horarios, políticas, pagos e integraciones;
- bloquear publicación cuando la promesa central no se puede cumplir;
- permitir modo demo explícito con datos ficticios identificados;
- mostrar el ajuste vertical-plan durante onboarding y upgrade.

**Aceptación:** ninguna capability publicada sin feature y datos necesarios; downgrade conserva lectura/conciliación segura y desactiva writers de forma explicada.

### Épica F — Integraciones y fuente de verdad

**Entregables:** framework de conectores, matriz SoR, freshness, health, reconciliación y fallback.

**Tareas:**

- priorizar PMS/Channel Manager, POS/KDS, DMS/taller, EMR/EHR, LMS/SIS, AMS/PAS y field-service según ola;
- implementar OAuth/credenciales, scopes, webhooks, idempotencia, rate limit y reintentos;
- mostrar fuente y `as_of` en UI/agente;
- evitar escrituras dobles con outbox/inbox y claves externas;
- crear reconciliación y cola humana para conflictos;
- certificar cada integración por país/versión.

**Aceptación:** una respuesta sobre precio, stock, cupo, reserva, póliza o estado crítico indica y respeta la fuente viva; una integración caída no se convierte en afirmación inventada.

### Épica G — Calidad, seguridad y certificación

**Entregables:** dataset de evals, pruebas de contrato, E2E real, red team, observabilidad, pilotos y evidencia.

**Tareas:**

- crear ≥25 conversaciones de eval por subtipo y por idioma prioritario;
- cubrir happy path, ambigüedad, corrección, interrupción, duplicado, stale data, error, handoff y adversarial;
- medir exactitud de slot, selección de tool, éxito de acción, afirmación no soportada, tiempo a resolución y escalamiento;
- ejecutar E2E con modelos, canales, pagos, calendarios e integraciones reales;
- aplicar privacidad/consentimiento/retención por tipo de dato;
- pilotear con 3–5 negocios representativos por perfil funcional antes de certificar;
- conservar rollback, feature flag y auditoría de cada versión de perfil.

**Aceptación:** no se cambia `implemented_not_certified` ni `deepMarketingAllowed` sin evidencia enlazada y aprobación de producto, seguridad y dominio.

### Épica H — Cohesión de tools y estado operativo

**Entregables:** registry de tools efectivas, policy compiler, readiness bloqueante, active-object framework completo, SoR/write-back contract y Agent Test parity.

**Tareas:**

- reparar `search_products`/`place_catalog_order` y probar persistencia real;
- exponer Resource Rentals a vehículo y boarding con list/check/create/get/cancel;
- derivar step-up/OTP de todas las policies A2 efectivas;
- aplicar `canBook`, `canCancel`, `canCheckStock` y `canRecommend` en registro y executor;
- compilar Procedures contra perfil/agente/plan, filtrar vertical e interpolar slots tipados;
- no publicar MCP hasta aprobar la policy individual de cada tool;
- expandir active objects a cada writer y su ruta humana;
- añadir writers CRM mínimos para lead, oportunidad/etapa, nota, tarea y consentimiento;
- distinguir `empty`, `stale`, `provider_down`, `unauthorized` y `error` en reads;
- exigir `source`, `asOf`, `health`, `writeBackMode` y reconciliación a integraciones;
- hacer que Agent Test resuelva y ejecute el mismo snapshot que live.

**Aceptación:** 95/95 tools estáticas y cada tool dinámica tienen contrato efectivo; cero tool fuera de subtipo/plan; todo writer deja active object y deep link visibles; fallos nunca se presentan como cero resultados.

### Épica I — País, locale, formatos y gatillos

**Entregables:** `TenantRegionalProfileV1`, registry `CountryLanguageBehaviorPack`, normalizador compartido, contexto regional server-side para tools, RAG jurisdiccional y directorio de seguridad versionado.

**Tareas:**

- separar `operatingCountry` de `billingCountry` y migrar discrepancias con revisión;
- unificar locale BCP 47, timezone, currency, phone region, address schema y tratamiento;
- eliminar defaults silenciosos COP/+57/Bogotá fuera de Colombia;
- unificar confirmaciones de Booking, tool guard, Procedures, opt-out y handoff;
- reconocer expresiones nacionales con intent/confidence/context; generar slang solo por opt-in;
- incorporar país/autoridad/vigencia/aplicabilidad a Knowledge/RAG;
- regionalizar fechas, horas, teléfonos, direcciones, monedas, documentos e identificadores mediante CLDR/metadata mantenida;
- crear 15 packs LatAm/BR prioritarios; mantener US/CA multiculturales y países no comercializados en `fallback_only`;
- validar cada pack con hablantes nativos, corpus consentido y profesionales de dominio;
- mostrar pack/version/fuente en Agent Test y traces.

**Aceptación:** ningún perfil regulado recupera contenido de otra jurisdicción; ninguna afirmación contextual aislada ejecuta una acción costosa; live/web/móvil/test comparten país, locale, timezone, moneda y términos.

## 6. P0 que debe preceder cualquier expansión comercial

1. Cambiar el falso menú Turismo/“Reservas” y crear vistas globales de reservas y multicalendario accesibles al rol agente.
2. Unificar reserva de guardería/hotel pet: disponibilidad y writer deben usar el mismo registro que la UI.
3. Crear writers conversacionales de alquiler de vehículo y boarding, o declarar handoff y no prometer cierre automático.
4. Habilitar carga/orden/portada de fotos en Listings y alinear manual/documentación.
5. Reparar siembra y administración de paquetes fotográficos.
6. Mostrar Pedidos a Farmacia y corregir KPIs/assurance heredados.
7. Hacer onboarding, metas, herramientas y navegación realmente subtipo-aware.
8. Integrar plan y readiness de manera bloqueante.
9. Corregir taxonomías peligrosas: wedding planner, construcción, fintech, marketplace y aseguradora.
10. Eliminar divergencias web/móvil antes de certificar una vertical.
11. Corregir el contrato de prompts: `requiredFields` inválidos, especialización perdida fuera de español, guidance español en todos los idiomas y overrides subtipo sin delta.
12. Impedir que prompt libre, cambio de template o setup wizard eliminen invariantes sectoriales, handoff y reglas nativas.
13. Retirar políticas fijas no respaldadas de templates y reemplazarlas por Policies/SoR con versión y frescura.
14. Sustituir triggers exactos por clasificación semántica/determinista probada con paráfrasis, tildes y dialectos.
15. Eliminar el default universal `skillset=both`; definir `sales|support|both|coordination|none` por subtipo e intención, con no-pitch en salud, crisis, legal, finanzas y reclamos.
16. Tratar todo `<turn>` como dato no confiable, no solo RAG/tools, y añadir procedencia, nivel de confianza y frescura a los campos dinámicos.
17. Hacer auditable la procedencia efectiva de template/contract y reconciliar invariantes en todos los write paths.
18. Reparar `search_products` y `place_catalog_order`; mientras tanto bloquear pedidos conversacionales de catálogo y corregir claims de ocho perfiles.
19. Exponer Resource Rentals al agente para alquiler de vehículos y pet boarding, con el mismo SoR que la UI.
20. Unificar reservas de alojamiento con Channel Manager/Hostaway o deshabilitar el writer local para evitar doble reserva.
21. Dejar de anunciar MCP y `apply_discount` como ejecutables hasta completar policy/proveedor/enforcement.
22. Derivar OTP/step-up de la policy de cada tool, no de cuatro grupos manuales.
23. Impedir que Procedures salte tools/capabilities/planes del agente y tipar la interpolación de datos recogidos.
24. Distinguir fallo de lectura, dato stale y cero resultados; devolver `source/asOf/health/errorCode`.
25. Separar país operativo, país de facturación, locale, timezone, phone region y monedas; migrar todos los defaults colombianos silenciosos.
26. Unificar la confirmación transaccional por efecto/estado/país y filtrar RAG regulatorio por jurisdicción/autoridad/vigencia.
27. Hacer Agent Test equivalente a producción para tools, Procedures, integraciones, país, RAG y writers.

## 7. Plan 1:1 por subtipo

**Estrategia:** `B` construir en Parallly; `I` integrar un SoR; `H` híbrido; `D` definir taxonomía/producto; `STOP` no comercializar aún.  
**Ola:** `0` decisión; `1` fundamentos y honestidad P0; `2` profundidad nativa ligera; `3` integración sectorial; `4` alta regulación/core pesado. Las olas no reemplazan las fases transversales: ningún perfil se inicia sin el registro único, entitlements, navegación y eval harness.

### 7.1 Salud

| Subtipo | Resultado implementable | Prompt, variables y lenguaje | Operación/navegación | Estrategia / ola / dependencias |
|---|---|---|---|---|
| Dental | Capa de experiencia para captación, agenda, recall, formularios, plan y pagos conectados. | Contrato dental: procedimiento, urgencia, profesional/sillón, seguro, recall, consentimiento; glosario regional y límites clínicos. | Hoy/Agenda, Pacientes, Planes odontológicos, Recalls, Formularios, staff/recursos. | `H/I · 3`; PMS/EHR, privacidad, consentimiento y staff UI. |
| Medicina general | Coordinación e intake seguro, nunca consulta clínica autónoma. | Motivo, modalidad, cobertura, triage/red flags, consentimiento; crisis/urgencia determinista. | Agenda, Pacientes, Intake/Triage, profesionales, integración clínica. | `I · 4`; EHR/PMS y revisión clínica/jurídica. |
| Dermatología | Agenda y seguimiento integrados con media clínica/consentimiento. | Clínica vs estética, zona, procedimiento, sesión, equipo, fotos, lotes, contraindicaciones, pre/post. | Agenda, Pacientes, Tratamientos, Fotos, Consentimientos, equipos/lotes. | `H/I · 4`; EMR, media protegida, inventario regulado. |
| Psicología | Agenda, recurrencia, formularios, teleconsulta y pagos con expediente externo. | Tipo/modalidad/cadencia, terapeuta, privacidad, crisis y contacto de emergencia; tono sobrio. | Sesiones, Pacientes, Formularios, Planes, Teleconsulta, Pagos. | `I · 4`; EHR/telehealth, crisis y RBAC reforzado. |
| Farmacia | Flujo OTC nativo y dispensación Rx solo integrada/validada por farmacéutico. | Rx/OTC, medicamento/presentación, receta, sustitución, lote, tienda, fulfillment; no dosis/prescripción. | Pedidos, Recetas/validación, Inventario/lotes, Entregas, Clientes, Auditoría. | `P0+H/I · 1/4`; reparar búsqueda/writer de catálogo, publicar Pedidos, corregir KPI y conectar PMS farmacéutico. |

### 7.2 Belleza y bienestar

| Subtipo | Resultado implementable | Prompt/variables | Operación/navegación | Estrategia / ola / dependencias |
|---|---|---|---|---|
| Salón | Agenda multi-profesional, recursos, depósito, POS ligero, rebooking y preferencias. | Servicio/variante, cabello, profesional, silla, duración, extras, depósito; lenguaje inclusivo. | Agenda, Cola/check-in, Clientes, Caja, Rebooking, staff/sillas, productos. | `B/H · 2`; staff/resources UI, payments/POS connector. |
| Barbería | Turnos + walk-in/cola, silla, membresía y caja. | Corte/barba/combo, barbero, silla, queue ETA, estilo y membresía; sin modismos forzados. | Cola/Turnos, Agenda, Clientes, Caja, Barberos/sillas, Membresías. | `B · 2`; queue, resources, POS y check-in. |
| Spa | Secuencias multi-servicio, cabina/equipo, paquetes, consentimientos y checkout. | Tratamientos, participantes, therapist/room/equipment, buffers, contraindicación, paquete/crédito. | Agenda recursos, Llegadas, Clientes, Paquetes, Protocolos, Cabinas/equipos, Caja. | `B/H · 2`; capacity engine, treatment writer, POS. |
| Estética | Modo regulado para valoración, procedimientos, fotos, lotes y consentimientos. | Provider habilitado, procedimiento/zona, equipo/lote, foto, consentimiento, contraindicación, aftercare. | Agenda, Fichas, Planes, Fotos, Consentimientos, Equipos/lotes, Pagos. | `H/I · 4`; decisión médica/no médica, EMR y revisión legal. |

### 7.3 Inmobiliaria

| Subtipo | Resultado implementable | Prompt/variables | Operación/navegación | Estrategia / ola / dependencias |
|---|---|---|---|---|
| Venta | Búsqueda/listado vivo, media, matching, visitas, favoritos y estado de transacción. | Rol compra/venta, criterios, moneda, fotos, source/as_of, asesor, financiación, visita, milestones. | Interesados/tareas, Inmuebles, Visitas, Negociaciones, Favoritos, Documentos. | `P0+H/I · 1/3`; uploader Listings, feed/ERP/portales y deduplicación. |
| Arriendo | Disponibilidad, aplicación, documentos, screening consentido, contrato, depósito y mantenimiento conectado. | Canon, move-in, plazo, hogar/mascotas, requisitos, garante/seguro, lease y acceso mantenimiento. | Aplicaciones, Disponibilidad, Inmuebles, Visitas, Contratos, Cobros, Mantenimiento. | `H/I · 3`; modelo unit/application/lease y PM integration. |
| Comercial | Espacios/unidades, propietarios, comps, documentos y deal room. | Uso, área, zoning, rent/CAM, plazo, disponibilidad, owners/brokers, comps, confidencialidad. | Negocios, Espacios, Propietarios/ocupantes, Visitas, Comps, Documentos. | `I · 3`; data comercial/ERP; no reutilizar filtros residenciales. |
| Construcción | Dividir promotor de proyecto nuevo y constructor/contratista. | `business_model` obligatorio; luego unidad/entrega/financiación o alcance/presupuesto/hitos/cambios. | Promotor: Proyectos/unidades/ventas; contratista: Obras/presupuestos/cronograma/cambios/bitácora. | `D/STOP · 0`; aprobar taxonomía y elegir SoR antes de desarrollo. |

### 7.4 Restaurantes

| Subtipo | Resultado implementable | Prompt/variables | Operación/navegación | Estrategia / ola / dependencias |
|---|---|---|---|---|
| Casual dining | Reservas por capacidad/mesa, waitlist y CRM de huésped; pedidos conectados a POS/KDS. | Party/date/time/duration, seating, preferencias/alergias, depósito; menú/modificadores/estado. | Plano/Reservas, Hoy, Waitlist, Pedidos/KDS, Huéspedes, Menú, Caja. | `H/I · 2/3`; table engine, POS/reservations connector; Pipeline→Oportunidades. |
| Comida rápida | Pedido omnicanal, modifiers, pickup/delivery, pago, KDS, ETA y refund. | Menú vivo, sede, fulfillment, dirección, modifiers, fees/tax, promised time, payment/status. | Pedidos vivos, Cocina/KDS, Pickup/domicilio, Despacho, Menú/stock, Excepciones. | `H/I · 2/3`; POS/KDS/delivery, payments y refunds. |
| Cafetería | Onboarding decide quick service vs mesas; variantes, cola y loyalty. | Bebida/tamaño/leche/extras, alérgenos, pickup ETA, mesa opcional, stock y loyalty. | Pedidos/cola, Menú/recetas, Inventario, Clientes/fidelidad, Mesas opcionales, POS. | `B/H · 2`; modelo operativo, modifiers, loyalty/POS. |
| Dark kitchen | Multi-marca/canal, KDS, capacity throttling, courier, excepciones y conciliación. | Brand/location/channel, external order, SLA, stock, courier, fees/commission y failure reason. | Pedidos, Cocina/capacidad, Dispatch, Marcas/menús/canales, Excepciones, Conciliación. | `I · 3`; agregadores/POS/KDS; eliminar toda etiqueta Reserva. |

### 7.5 Automotriz

| Subtipo | Resultado implementable | Prompt/variables | Operación/navegación | Estrategia / ola / dependencias |
|---|---|---|---|---|
| Concesionario | Inventario vivo, leads, test drives, trade-in, cotización y financiación integrada. | VIN/model/trim/year, status/as_of, fotos, price/fees, ubicación, retoma, finance consent, deal. | Leads/tareas, Vehículos, Pruebas, Negociaciones, Retomas, F&I, Entregas. | `H/I · 3`; DMS/feed, deep link Test Drives, finance consent. |
| Taller | Orden de trabajo, inspección, estimate/aprobación, bahía/técnico, repuestos y estado. | Vehículo/VIN/km, concern/safety, appointment, bay/skill, inspection, labor/parts, approval, promised time. | Órdenes de trabajo, Agenda/dispatch, Inspecciones, Presupuestos, Vehículos, Repuestos, Facturas. | `H/I · 3`; crear work-order model o integrar shop management. |
| Repuestos | Compatibilidad confiable, stock multi-bodega, alternativas, pedido, devolución y garantía. | VIN/fitment, OEM/aftermarket, part IDs, live stock, warehouse, ETA, price, shipping/RMA. | Pedidos, Búsqueda/compatibilidad, Stock/bodegas, Cotizaciones, Despacho, RMA. | `P0+H/I · 1/3`; reparar búsqueda/writer, alinear catálogo/manifest y conectar EPC/ERP. |
| Alquiler | Writer de reserva, disponibilidad por intervalo, conductor, contrato, depósito, entrega/devolución y daño. | Fechas/zonas/sedes, clase, conductor/licencia/edad, tarifa/fees, coverage, extras, inspección y pago. | Reservas, Calendario flota, Entregas/devoluciones, Conductores, Contratos/depósitos, Daños, Flota. | `P0+B/H · 1/3`; writer idempotente, capacity/SoR y etiqueta específica. |

### 7.6 Turismo

| Subtipo | Resultado implementable | Prompt/variables | Operación/navegación | Estrategia / ola / dependencias |
|---|---|---|---|---|
| Agencia de viajes | Solicitud, propuesta, itinerario, reservas multi-proveedor, documentos y calendario de pagos. | Viajeros/edades, origen/destino/fechas, flexibilidad, presupuesto, preferencias, quote/as_of, legs, policies. | Solicitudes, Propuestas/itinerarios, Reservas, Viajeros, Proveedores, Documentos, Pagos/comisiones. | `H/I · 3`; GDS/supplier/itinerary connector; Pipeline separado. |
| Hotel/Hostal | Centro operativo global de reservas, calendario, llegadas/salidas, huéspedes, housekeeping y folio/pagos. | Property timezone, room type/unit, guests, dates, rate/tax/fees, source/status, payment/folio, ETA/ETD. | Reservas, Llegadas/salidas, Calendario, Huéspedes, Housekeeping, Habitaciones/tarifas, Canales, Pagos. | `P0+H/I · 1/3`; ruta global, RBAC operation/catalog, PMS/channel manager. |
| Tours | Salidas, manifest/check-in, cupo/recurso, reserva, pickup, waiver, pago y canales. | Product/session, timezone, participant categories, capacity/resources, pickup, language, waivers, balance/status. | Salidas, Reservas/manifiesto, Cupos/recursos, Viajeros, Productos, Pickups, Pagos/canales. | `P0+B/H · 1/3`; lista global/deep links, resources y payment completion. |
| Alquiler vacacional | Reservas multipropiedad, multicalendario, llegadas/salidas, huéspedes, tareas, canales y pagos. | Unit/dates/nights, guests, live calendar source, rate/fees/deposit, channel/status/payment, check-in authority, task state. | Reservas, Multicalendario, Llegadas/salidas, Huéspedes, Tareas/aseo, Alojamientos, Canales, Pagos. | `P0+H/I · 1/3`; reutilizar GET global, PMS/channel manager, quitar falso Kanban Reservas. |

### 7.7 Educación

| Subtipo | Resultado implementable | Prompt/variables | Operación/navegación | Estrategia / ola / dependencias |
|---|---|---|---|---|
| Idiomas | Placement, cohortes, horarios, inscripción, asistencia, paquetes y progreso básico. | Edad/tutor, idioma/nivel/meta, modalidad, profesor, cohorte/capacidad, placement, recurrencia, balance. | Clases/Hoy, Admisiones, Estudiantes, Grupos, Cursos, Asistencia/progreso, Cobros. | `B/H · 2/3`; cohort/attendance y LMS connector. |
| Universitaria | Capa de admisiones: programas, requisitos, documentos, application state y citas. | País/términos, programa/campus/intake, deadlines, applicant status, checklist, fee y authority. | Solicitudes, Aspirantes, Documentos, Programas/períodos, Decisiones, Matrículas/financiación. | `I · 3/4`; SIS/admissions; nunca prometer admisión. |
| Online | Matrícula/acceso, cohortes, soporte, progreso y certificados conectados al LMS. | Course/access model, prerequisites, enrollment/payment, progress/module, assessment, certificate/refund/timezone. | Matrículas, Acceso/soporte, Cohortes, Estudiantes/progreso, Cursos/contenido, Certificados, Pagos. | `H/I · 3`; LMS/ecommerce; Agenda opcional. |
| Capacitación | B2B/B2C explícito, eventos/cohortes, múltiples participantes, asistencia, certificado y facturación. | Organización, participantes, template, público/privado, sesiones, presenter/venue, capacity, PO/billing. | Cuentas/propuestas, Programas, Eventos/cohortes, Participantes, Asistencia, Certificados, Facturación. | `B/H · 2/3`; organizations, multi-enrollment, invoices. |

### 7.8 Finanzas y servicios profesionales

| Subtipo | Resultado implementable | Prompt/variables | Operación/navegación | Estrategia / ola / dependencias |
|---|---|---|---|---|
| Asesoría financiera | Onboarding/KYC, metas, citas, documentos y revisiones; consejo solo por profesional autorizado. | Jurisdicción/licencia, household, KYC, goals/horizon, risk, accounts/as_of, suitability, consent, advisor. | Clientes/hogares, Onboarding/KYC, Metas, Revisiones, Documentos, Compliance. | `I · 4`; sistema financiero, licencias y legal. |
| Fintech | Ningún producto hasta escoger familia: pagos, wallet, remesas, neobanco, inversión, etc. | `product_family`, licencia, KYC/AML, cuenta/ledger, límites/fees, riesgo, disputa, provider state. | Solo después de definición: Cuentas, Transacciones, KYC, Casos/disputas, Conciliación. | `D/STOP · 0`; product/legal/core obligatorio. |
| Créditos | Capa de solicitud, documentos, consentimiento, estado, oferta y desembolso conectada a LOS/core. | Jurisdicción, producto, monto/plazo, applicant, bureau consent, KYC, income/liabilities, decision/reason, offer. | Solicitudes, Documentos/KYC, Estudio/colas, Ofertas, Desembolsos, Pagos/cobranza. | `I · 4`; LOS/core, fair lending/explicabilidad. |
| Abogados | Intake/conflicto, asuntos, plazos, documentos, consulta, tiempo y facturación integrados. | Jurisdicción, matter type, partes/adversas, conflict status, deadlines, abogado, retainer/confidencialidad. | Intake, Asuntos/casos, Calendario/plazos, Clientes, Documentos, Tiempo/facturación; Ventas aparte. | `H/I · 3/4`; matter management, RBAC y legal review. |
| Contadores | Trabajos recurrentes, calendario fiscal, checklist/documentos, portal y factura. | País/autoridad, entidad/tax ID, período, servicio, due date, checklist, assignee, filing state, invoice. | Vencimientos, Clientes/entidades, Trabajos, Documentos, Declaraciones, Facturación. | `H/I · 3`; accounting practice connector; retirar prompt legal. |
| Arquitectos | Proyectos/fases, entregables, recursos, tiempo, presupuesto, cambios y facturas. | Project/site, phase, scope, deliverables, milestones, capacity, hours, fee/cost, change/approval. | Proyectos, Fases/hitos, Recursos, Documentos/planos, Tiempo/presupuesto, Facturas. | `I · 3`; PSA/project system; retirar caso legal. |
| Consultores | Oportunidad→SOW→engagement, recursos, entregables, tiempo, retainer y rentabilidad. | Client, SOW/scope, workstreams, deliverables, roles/rates/capacity, time/expense, billing/approval/risk. | Engagements, Recursos, Entregables, Tiempo/gastos, Retainers/facturación, Rentabilidad. | `H/I · 3`; PSA; separar Ventas de delivery. |

### 7.9 Retail y tecnología

| Subtipo | Resultado implementable | Prompt/variables | Operación/navegación | Estrategia / ola / dependencias |
|---|---|---|---|---|
| Moda | Catálogo con variantes/tallas, stock por sede, pedido, fulfillment, cambio/devolución y promo. | SKU/variant/size system/fit/material, stock/as_of, price/tax, order, tracking, return policy/source. | Pedidos, Variantes/inventario, Cambios/devoluciones, Clientes, Productos/colecciones, Despachos. | `P0+B/H · 1/2`; reparar búsqueda/writer, luego variants, locations y fulfillment/returns. |
| Electrónica | Specs/compatibilidad, seriales, stock, pedido, garantía, RMA y servicio. | Model/specs/use case/compatibility/voltage, stock, serial, warranty/source, accessory, order/RMA. | Pedidos, Catálogo/compatibilidad, Inventario/seriales, Garantías/RMA, Soporte, Proveedores. | `P0+B/H · 1/3`; reparar búsqueda/writer, luego serial/RMA y ERP/POS. |
| Hogar | Configuraciones/dimensiones, special order, entrega/instalación y devolución. | Space dimensions, finish/configuration, stock/lead time, delivery access/zone, installation, price/order/restrictions. | Pedidos, Catálogo/configuraciones, Inventario, Cotizaciones/proyectos, Entregas/instalación, Devoluciones. | `P0+B/H · 1/2`; reparar búsqueda/writer, luego variants, logistics y measurement units. |
| Marketplace | Solo tras definir operador, merchant of record, multi-vendor, responsabilidad y payout. | Buyer/seller, listing, KYB, commission/split, multiseller order, fulfillment, dispute/return, payout/tax. | Órdenes/disputas, Vendedores/onboarding, Moderación, Compradores, Comisiones, Saldos/payouts, Riesgo. | `D/STOP · 0/4`; ocultar catálogo/writer roto actual; legal/payments/KYB/core marketplace. |
| SaaS | Customer support + tickets, cuentas/workspaces, entitlements, billing y ventas B2B conectados. | Identity/account/workspace, roles, plan/entitlement, billing, telemetry, ticket/incident/SLA, demo/use case. | Inbox/Tickets, Cuentas/usuarios, Incidentes, Suscripciones/entitlements, Knowledge, Oportunidades/demos. | `H/I · 3`; ticketing/billing/product telemetry. |
| Consultoría TI | Mesa de servicio/MSP o proyectos, elegido explícitamente. | Client/site/asset, issue impact/urgency, SLA/agreement, technician skill, remote consent o project scope. | Tickets/SLA, Dispatch, Clientes/sitios, Activos, Proyectos, Acuerdos, Tiempo/facturación. | `D+H/I · 0/3`; decidir MSP vs consulting; PSA/RMM. |
| Desarrollo | Proyectos, backlog, hitos/releases, issues, cambios, aceptación y capacidad. | Project/SOW, scope, backlog, release, repo/environment, capacity, estimate/actual, change/acceptance/risk. | Proyectos/sprints, Issues, Roadmap/releases, Equipo/capacidad, Clientes, Tiempo/presupuesto. | `I · 3`; PM/dev connector; no prometer delivery con Agenda. |
| Hardware | Catálogo técnico, compatibilidad, stock/seriales, pedido, entrega, instalación y RMA. | Use case/spec/compatibility/form factor/voltage, quantity, stock, price tier, PO, shipment, warranty. | Pedidos/órdenes, Productos, Inventario/seriales, Compras, Fulfillment, Garantía/RMA, Soporte. | `P0+B/H · 1/2`; reparar búsqueda/writer, identidad localizada y KPIs; ERP opcional. |

### 7.10 Veterinaria y fitness

| Subtipo | Resultado implementable | Prompt/variables | Operación/navegación | Estrategia / ola / dependencias |
|---|---|---|---|---|
| Clínica veterinaria | Agenda, triage seguro, ficha mascota/tutor, vacunas, recordatorios y órdenes conectadas. | Owner/patient IDs, species/breed/age/weight, reason/urgency, provider, vaccines, alerts, consent. | Agenda, Cola/triage, Pacientes/mascotas, Tutores, Vacunas, Tratamientos, Inventario. | `H/I · 3/4`; PIMS, RBAC, móvil con fichas. |
| Hospital 24h | ER triage, censo, hospitalización, treatment sheet, estimate/deposit y alta conectados. | Arrival/acuity/red flags, vitals authorized, consent, ward/bed, team, orders, estimate/deposit, discharge. | Urgencias/triage, Censo/hospitalizados, Hojas tratamiento, Diagnóstico, Pacientes, Facturación. | `I · 4`; hospital PIMS; 24h schedule no basta. |
| Exóticos | Agenda/triage y expediente específico de especie conectados. | Exact species, husbandry/diet/temp, handling risk, urgency, specialist availability, consent. | Agenda especializada, Pacientes, Protocolos especie, Especialistas, Diagnóstico/tratamiento. | `I · 4`; validación por especialistas y PIMS. |
| Peluquería canina veterinaria | Migrar a Pet Grooming o definir variante dentro de clínica con fronteras claras. | Breed/coat/size/behavior, service, groomer, duration, vaccines policy; quitar reglas clínicas ajenas. | Grooming board, Mascotas/clientes, Servicios, Staff/recursos, Check-in/out, Caja. | `D/P0 · 0/1`; migración sin duplicados. |
| Gimnasio general | Check-in, miembros, membresías, clases, acceso, freeze y cobros. | Member status/entitlement, membership dates/freeze, class/capacity, waiver, payment/access rules. | Check-ins, Clases de hoy, Miembros, Membresías, Cobros, Acceso, Staff. | `B/H · 2`; access/payment integrations. |
| CrossFit | WOD, attendance, scoring/PR, clases y membresías. | Athlete level, WOD, score unit, Rx/scaled, class/capacity, membership/waiver. | WOD/Hoy, Clases, Atletas, Asistencia, Rendimiento/PR, Leaderboard, Membresías. | `B/H · 2/3`; performance model; Wodify opcional. |
| Yoga/Pilates | Horario, puesto/reformer, waitlist, packs, instructores y accesibilidad. | Modality/style/level, spot/equipment, instructor, capacity/waitlist, credits, waiver/accessibility. | Clases/mapa, Waitlist, Miembros, Instructores, Salas/equipos, Pases/membresías. | `B · 2`; resource seats/equipment. |
| Cycling | Seat/bike selection, waitlist, check-in, shoes y maintenance blocks. | Class, bike/spot, rider profile, shoe size, membership, waitlist y block. | Clases/mapa bicicletas, Check-in, Riders, Bicicletas, Waitlist, Membresías. | `B · 2`; specific resource booking. |
| Artes marciales | Disciplina, clases elegibles, familias, asistencia, grados y evaluaciones. | Discipline, minor/guardian, rank/curriculum, class eligibility, attendance/evaluation, waiver/membership. | Clases, Alumnos/familias, Asistencia, Grados/habilidades, Evaluaciones, Membresías. | `B · 2`; rank/curriculum model. |

### 7.11 Seguros

| Subtipo | Resultado implementable | Prompt/variables | Operación/navegación | Estrategia / ola / dependencias |
|---|---|---|---|---|
| Broker | Cuentas, submissions/cotizaciones, pólizas, renovaciones, claims, documentos y comisiones integrados. | Jurisdiction/license, insured/risk/LOB, carrier quote/as_of, coverage/deductible/premium, policy/renewal/claim/authority. | Cotizaciones abiertas, Renovaciones, Asegurados, Pólizas, Siniestros, Compañías, Comisiones. | `H/I · 4`; AMS/carriers, legal; Pipeline→Oportunidades. |
| Aseguradora | No construir core; capa conversacional sobre underwriting, policy, billing y claims. | Product rules/version, risk, underwriting signals, authority, policy transaction, billing, claim reserve/audit. | Suscripción, Pólizas, Facturación, Siniestros, Producto/tarificación, Fraude/riesgo, Reaseguro. | `STOP/I · 4`; Guidewire/PAS/billing/claims obligatorios. |
| Vida | Solicitud, ilustración, evidencia, underwriting, beneficiarios, póliza y claim integrados. | Party roles, product/coverage/term, premium, illustration version, evidence, underwriting, beneficiary/policy state. | Solicitudes, Ilustraciones, Suscripción/evidencia, Pólizas, Beneficiarios, Siniestros. | `I · 4`; AMS/PAS, e-sign y compliance. |
| Auto seguro | Quote, objetos de riesgo, póliza/endoso, FNOL, inspección, reparación y renovación integrados. | Driver/vehicle/VIN/use, coverage/deductible, quote/effective dates, incident/photos, adjuster/shop, claim state. | Siniestros/FNOL, Cotizaciones, Pólizas, Vehículos/conductores, Inspecciones, Reparaciones, Renovaciones. | `I · 4`; carrier/AMS/claims. |
| Salud seguro | Eligibility/benefits, autorizaciones, red, claims/EOB y reembolso con verificación. | Member/dependent/plan, eligibility dates, benefits/limits, network, authorization, claim/EOB, consent. | Autorizaciones, Claims/reembolsos, Miembros/dependientes, Planes, Elegibilidad, Red. | `STOP/I · 4`; PHI, step-up auth y payer core. |

### 7.12 Servicios del hogar

| Subtipo | Resultado implementable | Prompt/variables específicas | Operación/navegación | Estrategia / ola / dependencias |
|---|---|---|---|---|
| Plomería | Request→estimate→job→invoice/payment con dispatch. | Address, issue/urgency, shutoff safety, photos, fixture, skill/ETA, approval, material/status. | Despacho, Sin asignar, Visitas/trabajos, Presupuestos, Clientes/sitios, Repuestos, Facturas. | `B/H · 2/3`; FSM/route opcional y safety flow. |
| Electricidad | Triage de riesgo, técnico certificado, permiso, estimate y trabajo. | Red flags, panel/circuit, address/photos, license/permit, ETA/approval. | Emergencias, Despacho, Órdenes/inspecciones, Presupuestos, Técnicos/certificaciones, Compliance. | `B/H · 2/3`; safety deterministic y license data. |
| Fumigación | Inspección, programas recurrentes, rutas, químicos y compliance. | Property/pest signs, occupants/pets, recurrence, route, license, chemical lot/qty, stations/forms. | Ruta, Programas/órdenes, Sitios, Técnicos, Químicos, Compliance, Cobros. | `H/I · 3`; field service/pest system y regulation. |
| Limpieza | Alcance/checklist, recurrencia, cuadrillas, acceso, QA y factura. | Site/rooms/area, scope, frequency/window, crew, supplies, sensitive access, price/QA. | Agenda/rutas, Órdenes recurrentes, Sitios, Cuadrillas, Checklists, QA, Facturas. | `B · 2`; series, crews y sensitive secrets vault. |
| Jardinería | Sitios/medidas, programas recurrentes, rutas, crews/equipment, materials y costs. | Property zones/dimensions, season/weather, recurrence, crew/equipment/route, materials, estimate/photos. | Ruta/crew, Programas/trabajos, Sitios, Presupuestos, Equipos/materiales, Costos/facturas. | `B/H · 2/3`; routing/weather/inventory. |
| Cerrajería | Cola urgente, geolocalización, verificación de autoridad, dispatch y audit. | Address/urgency/lock, identity/evidence/ownership, technician/ETA/estimate/audit. | Emergencias/mapa, Despacho, Trabajos, Verificación/auditoría, Técnicos, Cobro. | `B · 2`; step-up verification y prohibición bypass. |
| Pintura | Visita/estimate, proyecto, cuadrilla, materiales, hitos/cambios y factura. | Areas/measurements, surface/prep/coats/finish, photos, crew/time, materials, estimate/change/milestone. | Visitas/cotizaciones, Proyectos, Cuadrillas, Materiales, Cambios/progreso, Facturación. | `B/H · 2`; project/estimate extension. |

### 7.13 Servicios para mascotas

| Subtipo | Resultado implementable | Prompt/variables | Operación/navegación | Estrategia / ola / dependencias |
|---|---|---|---|---|
| Peluquería | Grooming board, recursos, vacunas/forms, paquetes, check-in/out y caja. | Pet/breed/size/coat, behavior/health, vaccines, preferences/media, service/add-ons, groomer/duration/deposit. | Agenda/Grooming board, Check-in/out, Mascotas/clientes, Staff/recursos, Servicios, Caja. | `P0+B · 1/2`; separar seeds de daycare/hotel y term pack neutral. |
| Guardería | Capacidad diurna real, evaluación, writer, check-in/out, grupos, cuidado y pagos. | Date/daypart, evaluation/vaccines, compatibility group, live capacity, feeding/meds, agreement/status/payment. | Ocupación/Hoy, Check-in/out, Reservas, Mascotas, Espacios/grupos, Evaluaciones, Tareas/cobro. | `P0+B/H · 1/3`; unificar SoR, writer, capacity engine. |
| Hotel | Inventario nocturno, writer, ocupación, llegadas/salidas, ficha de cuidado y pagos. | Dates/nights, lodging capacity, check-in/out, feeding/meds, vaccines/behavior, extras, vet, deposit/payment. | Llegadas/salidas, Ocupación, Reservas, Alojamientos, Mascotas, Cuidado, Acuerdos/pagos. | `P0+B/H · 1/3`; boarding SoR, writer y care model. |
| Paseos | Series, rutas, walker/backup, acceso seguro, GPS/evidencia, reportes y factura. | Location/window, pet, duration/recurrence, walker, sensitive access, behavior, GPS consent, report/status. | Ruta de hoy, Visitas, Mascotas/clientes, Staff, Programación, Acceso seguro, GPS/reportes. | `B/H · 2/3`; route/GPS and secure access. |
| Adiestramiento | Evaluación, programas/paquetes, sesiones, trainers, tareas y progreso. | Behavior goals/risk, evaluation, prerequisites, trainer, format, package balance, progress/homework/consent. | Evaluaciones, Sesiones/clases, Programas, Mascotas/clientes, Trainers, Progreso/tareas, Facturas. | `B · 2`; progress/program model; no outcome guarantees. |

### 7.14 Fotografía y eventos

| Subtipo | Resultado implementable | Prompt/variables | Operación/navegación | Estrategia / ola / dependencias |
|---|---|---|---|---|
| Estudio | Sesión/proyecto, paquetes, recursos, contrato, anticipo, galería/proof y entrega. | Session type, client, date/resource/team, package/deliverables, brief, contract/payment, usage rights/deadline. | Sesiones/Hoy, Producción/proyectos, Clientes, Paquetes, Recursos, Contratos/pagos, Galerías. | `P0+B/H · 1/2`; reparar packages, role access y gallery connector. |
| Bodas | Evento maestro, timeline, shot list, equipo, contrato/pago y entregables. | Couple, venue/date, coverage/timeline, team, package/add-ons, shot list, retainer, rights/deadlines. | Proyectos boda, Calendario, Timeline/shot list, Equipo, Contratos/pagos, Galerías/álbumes. | `B · 2`; event/project extension y double-booking guard. |
| Eventos | Producción B2B, timeline, crew/equipment, brief, PO, rights y asset delivery. | Event/location, billing contact, run of show, privacy, deliverables/formats, crew, turnaround, PO. | Eventos/proyectos, Calendario, Clientes, Timeline, Crew/equipo, Briefs, Entrega/facturas. | `B/H · 2`; project/asset workflow. |
| Producto | Job/campaign, SKUs/samples, shot list, production, proof/revision/approval y DAM. | Brand/campaign, SKU batch, brief/style, specs, set, due dates, revisions/approval, metadata/rights. | Jobs/campañas, SKUs/muestras, Briefs, Producción, Pruebas/revisión, Assets/DAM, Derechos. | `H/I · 3`; DAM/proofing integration. |
| Wedding planner | Nueva vertical Event Planning o retiro inmediato de Fotografía. | Couple/event, guests/RSVP, budget, vendors/contracts/payments, checklist, timeline, seating/design/permissions. | Evento, Checklist, Timeline, Presupuesto, Proveedores, Invitados/RSVP, Seating, Contratos/pagos. | `D/STOP · 0`; taxonomía y producto propio/Aisle Planner integration. |

### 7.15 Otro

| Perfil | Resultado implementable | Prompt/variables | Navegación | Estrategia / ola / dependencias |
|---|---|---|---|---|
| `otro` | Constructor gobernado de experiencia; no tienda automática. | Business model, primary object/plural, lifecycle/status, actions, roles, capacity, payment, compliance, label/synonym map. | Menú generado por módulos realmente elegidos, plan y readiness; preview antes de activar. | `D+P0+B · 0/2`; retirar supuesto de tienda y writer roto; modular onboarding/profile builder. |

## 8. Descomposición ejecutable por fase

### 8.1 Fase 0 — Gobierno, alcance y migración

**Trabajo:**

1. Nombrar owner de producto y revisor de dominio para cada perfil.
2. Inventariar tenants existentes por vertical/subtipo, idioma, plan, template, tools y rutas usadas.
3. Congelar claims de marketing y selector para perfiles `STOP`/`MISCLASS`.
4. Crear ADR de taxonomía para construcción, fintech, marketplace, aseguradora, grooming y wedding planner.
5. Aprobar país/idioma inicial por perfil; `es` sin país no cuenta como certificación regional.
6. Definir alcance comercial por nivel: captación, coordinación, writer nativo o integración operativa.
7. Diseñar mapeo de alias legacy y rollback; nunca cambiar el producto de un tenant silenciosamente.
8. Inventariar país operativo probable, país fiscal, locale, timezone, moneda, phone defaults y mercados atendidos; toda discrepancia queda para confirmación del tenant.
9. Congelar como no operativas las affordances MCP, descuento, catálogo roto y rentals huérfanos hasta resolver sus P0.

**Artefactos:** catálogo canónico versionado, matriz de tenants afectados, claim policy, ADRs, mapa de migración y owner matrix.

**Gate 0:** 76/76 decisiones; cero subtipo ambiguo publicado como operativo.

### 8.2 Fase 1 — Contratos compartidos

**Backend/shared:**

1. Especificar `SubtypeExperienceProfile`, `VerticalPromptContractV2`, `IntentContract`, `SlotSchema`, `TerminologyPack`, `NavigationPolicy`, `ReadinessPolicy`, `EffectiveAgentCapabilityContractV1`, `TenantRegionalProfileV1`, `CountryLanguageBehaviorPack` y `CertificationEvidence`.
2. Hacer que manifest, bootstrap, persona resolver, tools, pipeline, active objects, UI, móvil y docs consuman el mismo ID/version.
3. Declarar por slot: required/optional/sensitive, fuente, validador, persistencia, retención, consentimiento, confirmation policy y writer precondition.
4. Declarar por acción: read→confirm→write, autoridad, feature/plan, idempotency key, result evidence, timeout, compensation y handoff.
5. Crear registry semántico de rutas con objeto, propósito, modo, rol, plan, readiness y deep links.
6. Exponer un endpoint/debug de **perfil efectivo**: versión, prompt modules, tools, menu, entitlements, readiness y fuentes.
7. Hacer que cada tool declare SoR, freshness/health, effect, slots, policy, active object, deep link, plan, readiness y failure contract.
8. Crear un resolver único para país/locale/timezone/currency/phone/address y otro para confirmación/handoff/opt-out compartido por todos los motores.

**CI:**

- exhaustividad de 76 perfiles × 4 idiomas;
- prohibición de `source=subtype` sin diferencia real;
- prohibición de capability sin tool executor/ruta o ruta sin página;
- writer sin idempotencia/confirmación falla build;
- términos operativos no pueden colisionar con `Pipeline`;
- cada política literal necesita `source/version`;
- snapshots por rol/plan/locale.
- 76 perfiles × packs prioritarios con composición determinista, sin duplicar prompts;
- ninguna tool A2 sin step-up publicable y ninguna integración read-only presentada como write-through;
- ninguna fuente RAG regulada sin jurisdicción, autoridad y vigencia.

**Gate 1:** todas las superficies se proyectan desde el registro y las reglas paralelas quedan deprecadas con plan de eliminación.

### 8.3 Fase 2 — Honestidad P0 y reparación de callejones sin salida

| Paquete P0 | Trabajo concreto | Dependencias | Tamaño | Aceptación |
|---|---|---|---|---|
| Reservas alojamiento | ampliar listado global con filtros, histórico, paginación y estados; cliente web; `/admin/stays`, calendario y llegadas; links a huésped/propiedad/conversación; RBAC agente. | Route registry, permisos operation/catalog. | `L` | Agente ve/crea/cancela una reserva sin Kanban ni abrir primero una propiedad. |
| Turismo semántico | Pipeline→Oportunidades; Properties→Alojamientos o Habitaciones/tarifas; templates hotel/STR; home/quick actions/badges. | Term pack y profile registry. | `M` | Cero superficie distinta llamada Reservas; prompt no dice paquete/agencia a un anfitrión. |
| Tours global | `/admin/tour-bookings`, salidas/manifiesto, deep links y default por rol. | API list/pagination, route registry. | `M/L` | Operador accede a reservas/salidas globales en un clic. |
| Boarding pet | una tabla/SoR para disponibilidad y reserva; writer idempotente; capacity/grouping; UI de ocupación; etiquetas guardería/hotel. | Capacity engine, slot contract. | `L` | Tool y UI reportan el mismo cupo; writer confirmado crea el mismo objeto visible. |
| Alquiler vehículo | writer, intervalo, conductor, depósito, contrato, calendario flota y estado. | Rental domain/SoR, payments. | `L` | No existe confirmación conversacional sin rental persistido. |
| Fotos Listings | uploader en alta/detalle/import, portada/orden, validación/media y readiness. | Media service, permissions. | `M` | Tenant carga fotos; agente y UI muestran la misma portada/galería. |
| Fotografía | sembrar/editar paquetes sin depender de Agenda; route de paquetes y readiness. | Service/package model. | `M` | Nuevo tenant publica al menos un paquete real antes de usar el agente. |
| Farmacia | publicar Pedidos, separar OTC/Rx, corregir KPI/assurance y bloquear claims clínicos. | Order route/profile V2. | `M` | Pedido creado aparece en web y móvil; Rx no se dispensa sin validación. |
| Prompt correctness | reparar shape o retirar legacy `requiredFields`; eliminar guidance monolingüe; conservar invariantes en custom mode; remover políticas hardcoded; resolver goals explícitamente. | Prompt V2/eval harness. | `L` | Prompt efectivo por 76 perfiles no pierde reglas por idioma/editor y no contiene política sin fuente. |
| Plan/readiness | plan en navigation profile; backend/web/mobile comparten feature decision; readiness bloqueante con repair CTA. | Profile registry, billing runtime. | `L` | Cero opción visible que termina en 403 o writer activo sin datos requeridos. |
| Catálogo/pedidos | corregir columna/disponibilidad, eliminar fallback cruzado a cursos, writer transaccional y pruebas reales. | Tool contract, OrdersService. | `M` | Ocho perfiles crean pedido visible; no se ofrece producto no disponible. |
| Resource Rentals | publicar list/check/create/get/cancel para vehículo y boarding; OTP, active object y deep link. | ResourceRentalsService, policy compiler. | `L` | Conversación y web muestran el mismo rental/boarding sin solapamiento. |
| Channel Manager | definir SoR de alojamiento; mapping, webhooks/sync, locks, write-back, reconciliación y degraded mode. | Hostaway/CM discovery. | `XL` | No puede existir doble reserva entre store local y externo. |
| Tool honesty | ocultar MCP/descuento no autorizados; compilar Procedures; publicar OTP por policy; errores tipados. | Effective tool resolver. | `L` | LLM solo recibe tools ejecutables; fallo nunca parece lista vacía. |
| Regional foundation | separar país operativo/fiscal; resolver locale/timezone/currency/phone/address; eliminar defaults CO globales. | TenantRegionalProfile, migración. | `XL` | Un tenant no colombiano no recibe COP/+57/Bogotá sin configuración explícita. |
| Consentimiento/RAG | clasificador único por estado/efecto/país y metadata jurisdiccional con filtro duro. | Country packs, Knowledge schema. | `L/XL` | Alias contextual no ejecuta dinero; fuente regulada de otro país no se recupera. |

`S/M/L/XL` son tamaños relativos: módulo acotado, varios módulos, cambio cross-app o nuevo dominio/integración. No son estimaciones de calendario.

### 8.4 Fase 3 — Autoría de prompts, variables, plantillas y lenguaje

Para cada uno de los 76 perfiles:

1. Escribir scope, role disclosure, límites y claims permitidos.
2. Modelar intenciones soportadas/no soportadas y excepciones.
3. Crear slots con pregunta localizada de a una, validación, sensibilidad, fuente y destino.
4. Definir tool plan, precondiciones, confirmación y fallbacks.
5. Crear plantillas de estado operativo con deep link y fuente viva.
6. Construir glosario canónico, aliases regionales, términos internos, términos a explicar y avoid-list.
7. Revisar ES/EN/PT/FR por equivalencia semántica; luego variantes de mercados priorizados.
8. Eliminar modismos no configurados y términos con género/rol equivocado.
9. Cargar eval pack y golden traces; revisar con experto de dominio.
10. Asignar skillset por intención y probar escenarios de **no pitch** en atención sensible, crisis, reclamo y postventa.
11. Componer y validar el country pack sin inyectar una lista masiva de slang al prompt.
12. Normalizar aliases nacionales antes de slots/tool retrieval y conservar evidencia de la frase original.
13. Probar lenguaje mixto, corrección, negación calificada, fecha/hora/moneda/dirección/teléfono por mercado.

**Gate 3:** no hay fallback silencioso, política literal, pregunta múltiple ni acción sin tool/handoff; cuatro idiomas tienen paridad semántica y los mercados habilitados tienen pack pilot/certified, confirmación determinista y formatos coherentes.

### 8.5 Fase 4 — Navegación, home, Inbox y móvil

1. Reordenar el shell: Inicio → Inbox → Trabajo diario → Clientes → Comercial → Catálogo/recursos → IA/crecimiento → Analítica → Administración.
2. Crear `dailyWork`, `customers`, `commercial`, `catalogAndResources`, `administration` por perfil y rol.
3. Dividir permisos `view|operate transaction`, `manage catalog` y `manage settings`.
4. Crear rutas/listas globales para objetos hoy anidados; soportar `?tab=` y defaults por rol.
5. Crear panel contextual del Inbox con allowlist de datos: reserva/estadía, tour, cita, orden de taller, solicitud, asunto, pedido, membresía o boarding.
6. Hacer Home, command palette, TopBar, badges, notificaciones y quick-create dependientes del perfil.
7. Cambiar móvil de un solo `workspace kind` a `dailyWorkspaces[]`; misma semántica y conteos que web.
8. Corregir i18n residual (`Info`, `Schedule`, `Bookings`, `Click`) en los cuatro idiomas.
9. Añadir telemetría de tiempo-a-tarea, click depth, búsqueda, backtracking, 403 y dead ends.

**Gate 4:** operación primaria a un clic en web y máximo dos taps en móvil; catálogo restringido sin bloquear operación; ningún par de objetos diferentes comparte etiqueta.

### 8.6 Fase 5 — Profundidad e integraciones

Ejecutar las olas 2–4 de la sección 7. Cada integración pasa por discovery, data mapping, auth/scopes, sandbox, webhooks, idempotencia, reconciliación, source priority, freshness/health, read/write-back modes, failure UX, observabilidad, privacy review y certification. Los perfiles `I` no avanzan con mocks presentados como dato vivo. Channel Manager, Toast, Mindbody y Cliniko deben demostrar explícitamente qué sistema acepta cada writer.

**Gate 5:** flujo central de cada perfil funciona de punta a punta en su alcance declarado, o el perfil sigue `STOP`.

### 8.7 Fase 6 — Piloto y certificación

1. Seleccionar 3–5 tenants representativos por perfil funcional, no solo por vertical.
2. Migrar en shadow mode; comparar respuestas y navegación sin writers.
3. Activar readers; luego writers con aprobación; después automatización limitada.
4. Medir tool success, slot accuracy, unsupported claims, handoff, completion, no-show/cancel/refund y tiempo-a-tarea humano.
5. Ejecutar E2E por canal, plan, rol, idioma, modelo, payment/provider e integración.
6. Obtener sign-off de producto, dominio, seguridad, legal y soporte.
7. Promover profile version gradualmente; conservar rollback y evidencia enlazada.
8. Pilotear country pack por separado de traducción base; US/CA y mercados `fallback_only` no heredan certificación.
9. Ejecutar el mismo golden trace en live y Agent Test, incluyendo provider down, OTP, procedure y active object posterior.

**Gate 6:** solo entonces cambiar policy de certificación o habilitar deep marketing.

## 9. Plan de datos y migración

### 9.1 Principios

- Los IDs de vertical/subtipo son versionados e inmutables; aliases no alteran semántica.
- Cada tenant conserva snapshot de profile version y puede hacer rollback.
- La migración nunca reemplaza reglas personalizadas sin diff/aceptación.
- Objetos operativos nuevos usan claves externas y `source_system`; no se duplican contra el SoR.
- Campos sensibles tienen clasificación, purpose, retención, redacción y audit trail.
- País operativo, fiscal, locale, timezone y monedas son campos separados con procedencia; timezone solo infiere país como último recurso.
- Cada tenant/agente conserva snapshots de perfil efectivo, country pack, plan y tool contract usados en cada publicación.

### 9.2 Flujo de migración por tenant

1. Descubrir config, template, custom prompt, tools, routes, plan, idiomas e integraciones actuales.
2. Resolver target profile y detectar conflictos/no-op overrides.
3. Mostrar diff: términos, tools, menú, required data, policy y comportamiento de handoff.
4. Ejecutar dry run y evals con conversaciones anonimizadas/autorizadas.
5. Backfill de objetos/indices/readiness sin activar writers.
6. Activar por feature flag; observar; confirmar o rollback.
7. Registrar evidencia, aceptación y versión.
8. Reconciliar active objects y sources externos antes de habilitar writers; detectar duplicados y conflictos.
9. Validar país/locale/phone/currency/address y pedir confirmación cuando billing, BusinessInfo, timezone o agente discrepan.

### 9.3 Casos de migración especiales

- `wedding_planner`: mantener tenant congelado y ofrecer migración a Event Planning, nunca reasignar a fotografía.
- `construccion`: pedir business model antes de mover.
- peluquería canina: detectar vertical origen y consolidar sin duplicar mascotas/citas.
- perfiles legacy `boutique`, `delivery`, `tienda`: aliases de compatibilidad no vuelven al selector.
- prompt libre: conservar texto, pero envolverlo dentro de invariantes sectoriales y mostrar diferencias.
- agentes existentes: recalcular tools efectivas en shadow mode; no asumir que defaults de alta siguen vigentes.
- alojamiento con Hostaway/CM: importar/reconciliar antes de permitir writer local; conflicto mantiene perfil read-only.
- números normalizados históricamente con `+57`: no reescribir automáticamente; generar cola de revisión/merge segura.

## 10. Estrategia de pruebas y evals

### 10.1 Matriz mínima

Por cada perfil: ≥25 escenarios base × idiomas soportados × roles relevantes. El conjunto incluye:

- happy path de cada intención;
- dato faltante, ambiguo, inválido y corregido;
- interrupción y reanudación;
- duplicate/idempotent replay;
- dato stale o integración caída;
- tool timeout/error/partial success;
- after-hours y handoff;
- cambio/cancelación/refund;
- PII/consent/step-up/minor/authority;
- prompt injection y conocimiento malicioso;
- dialectos, tildes, aliases y code switching;
- custom prompt que intenta borrar invariantes;
- rol/plan/readiness insuficiente;
- web/móvil sobre el mismo objeto.
- tool publicada/apagada por subtipo, agente, plan, quota, provider health y readiness;
- read con resultados, vacío real, stale, provider down, unauthorized y error;
- active object y deep link al siguiente turno después de cada writer;
- Procedure que intenta invocar tool fuera de capability y Procedure con slots interpolados;
- aliases nacionales de afirmación, reconocimiento, negación, corrección, cancelación, humano, opt-out y riesgo;
- fechas DMY/MDY, DST/múltiples zonas, moneda ambigua, phone E.164 y dirección por país;
- RAG positivo de jurisdicción correcta y prueba negativa de contaminación entre países;
- paridad live vs Agent Test para OTP, integración externa y writer.

### 10.2 Métricas de aceptación

| Métrica | Condición de promoción |
|---|---|
| Selección de intención/tool | umbral por riesgo, con 100% en acciones de alto impacto del golden set |
| Exactitud de slots | todos los campos críticos validados; cero inferencia no permitida |
| Unsupported claim | cero en precio, stock, cupo, política, cobertura, estado y resultado regulado |
| Writer integrity | 100% de confirmaciones corresponden a evidencia persistida/idempotente |
| Handoff | reconoce paráfrasis/dialecto y entrega contexto mínimo necesario |
| Navegación | tarea primaria dentro del click/tap budget y cero 403 visibles |
| Paridad | web, móvil y agente reportan mismo objeto/estado/fuente |
| Seguridad | cero fuga cross-tenant y cumplimiento de minimización/step-up |
| Tool publication | 100% corresponde al snapshot efectivo; cero tool fuera de subtype/plan/readiness |
| Read semantics | 100% distingue vacío, stale y error; cero afirmación negativa ante fallo |
| Active continuity | 100% de writers deja objeto recuperable y ruta humana autorizada |
| Confirmación dinero/consentimiento | precisión ≥99,5%; cero alias contextual aislado ejecuta |
| Cancelación/seguridad | recall ≥99% en golden set de cada pack |
| Jurisdicción RAG | cero recuperación de fuente no aplicable en dominios regulados |
| Regional terms/formats | ≥95% de exactitud por pack certificado; cero default CO silencioso fuera de CO |

Los umbrales estadísticos finales se fijan por criticidad y tamaño de muestra; no se inventa un único porcentaje para todos los sectores.

## 11. Observabilidad y operación

Registrar en cada turno y acción: profile/version, country pack/version, operating country, locale/timezone/currency, intent y evidencia normalizada, slots presentes/faltantes, plan snapshot, tool-policy/source versions, integration health/as_of/write-back mode, tool plan/result, approval, active object, handoff reason y deep link. En UI registrar profile, route purpose, role/plan/readiness, click path y error.

Dashboards necesarios:

- fallbacks y conflictos de resolución;
- acciones anunciadas sin evidencia —debe permanecer en cero—;
- tool failures por integración/profile;
- campos que causan abandono;
- handoff precision/recall auditado;
- callejones de navegación y 403;
- divergencia web/móvil/SoR;
- desempeño por idioma/región;
- confusiones `affirm|acknowledge|correct|reject` por país/efecto;
- reads vacíos vs stale/error y tools descartadas por resolver;
- active objects faltantes después de writers;
- contaminación RAG entre jurisdicciones;
- tenants con profile obsoleto o readiness degradado.

Alertas P0: confirmación sin writer, alias contextual ejecutando dinero, disponibilidad divergente, Channel Manager/local split-brain, policy/RAG stale o de otra jurisdicción, objeto duplicado, pago sin objeto primario, pérdida de regla nativa, tool publicada pero bloqueada, menú que abre objeto equivocado y cross-tenant access.

## 12. Seguridad, privacidad y regulación

- Clasificar cada slot y active object; default deny para clínica, financiera, legal, llaves/accesos, menores y documentos.
- Verificación/step-up antes de revelar pólizas, reservas sensibles, estados clínicos, saldos, documentos o accesos.
- Consentimiento explícito para screening, buró, fotos clínicas, GPS, media de mascotas, biometría o salud.
- Notas clínicas/jurídicas completas nunca entran al prompt por defecto; usar resúmenes allowlisted.
- Guardar jurisdicción/licencia/authority de quien actúa; la IA no hereda autoridad del tenant.
- Separar marketing consent, service consent y legal/clinical consent.
- Redactar logs/evals y definir retención/DSAR/audit por país.
- Red team específico para diagnóstico, discriminación crediticia, cobertura falsa, bypass de cerraduras, claims y menores.
- Tratar toda entrada dinámica de `<turn>` y toda fuente externa/MCP como evidencia no confiable, nunca como instrucciones.
- Resolver teléfonos de crisis y autoridades desde directorio versionado por territorio, no desde literals en prompts.
- Aplicar filtro jurisdiccional duro a RAG regulado y registrar autoridad/vigencia/aplicabilidad.
- Impedir que Procedures, custom prompts o toggles del agente amplíen scopes/assurance definidos por policy.

## 13. Organización y control del programa

Cada perfil necesita un squad virtual con Product, Domain Expert, Backend, Web/Mobile, Conversation Design/i18n, Data/Integration, QA/Evals y Security/Legal según riesgo. El equipo de plataforma mantiene contratos y tooling; los equipos de ola solo aportan perfiles y dominio, evitando forks.

Cadencia de gobierno:

- revisión semanal de P0 y blockers;
- design review antes de crear objeto/ruta/tool;
- content review multilingüe antes de merge;
- readiness/certification council antes de piloto o claim;
- changelog y migration note por profile version.

## 14. Riesgos y condiciones de parada

| Riesgo | Señal | Respuesta |
|---|---|---|
| Intentar construir 18 cores | backlog dominado por expedientes/PAS/POS/PMS | volver al alcance de capa conversacional e integrar |
| Explosión de 76 forks | reglas duplicadas en apps | detener y mover la diferencia al registro/componente compartido |
| Traducción sin equivalencia | claves completas pero intents/reglas faltantes | bloquear release y revisar semánticamente |
| Demo confundida con producción | dato seed/mock sin label | readiness bloqueante y source/as_of visible |
| Prompt como workflow | estado solo en historial | mover a state machine/DB y bloquear writer |
| Menú por copy | misma ruta con nombres distintos | separar objetos/rutas antes de renombrar |
| Integración inestable | stale/error produce respuesta afirmativa | fail closed, handoff y health/readiness |
| Regulación no resuelta | país/licencia/consentimiento desconocido | mantener `STOP` en ese mercado |
| Scope sin capacidad | fechas impuestas antes de estimar conectores | replanificar por gate y tamaño relativo |
| Toggle como autoridad | UI activa tool fuera de subtipo/plan | resolver server-side y fail closed |
| Dos SoR para el mismo objeto | reservas/stock/estado divergen | elegir master, reconciliar y congelar writer |
| Expresión local como consentimiento | `listo`, `dale`, `ya`, `pode ser` dispara acción | pending state + resumen + policy por efecto; aclarar |
| País de facturación como dialecto | respuesta/formatos incorrectos a cliente extranjero | separar identidades y respetar preferencia del cliente |
| RAG de otra jurisdicción | respuesta regulatoria incorrecta | metadata/filtro duro y handoff si no hay fuente aplicable |

## 15. Definition of Done por subtipo

Un subtipo está terminado únicamente si:

1. resuelve a un contrato único y versionado, sin fallback silencioso;
2. tiene intenciones, slots, tools, policies, handoff y lenguaje revisados;
3. cada variable declara pregunta, validación, sensibilidad, fuente, persistencia y destino;
4. no contiene política, precio, umbral ni promesa sin fuente/version;
5. custom prompt no puede borrar invariantes;
6. navegación, objeto, tool y copy usan la misma semántica;
7. operación primaria es directa por rol y el catálogo queda separado;
8. plan/readiness/backend/UI/móvil coinciden;
9. dato crítico proviene de SoR vivo con `as_of` y failure behavior;
10. evals y E2E cubren flujo feliz, error, corrección, duplicado, seguridad y cuatro idiomas;
11. migración/rollback y observabilidad están probados;
12. piloto aporta evidencia y sign-off;
13. documentación y claims describen exactamente el alcance certificado.
14. snapshot de tools efectivas coincide en live, Agent Test, dashboard, móvil y Procedures;
15. todo writer produce active object, evidencia, `source/asOf` y deep link humano;
16. reads distinguen `empty|stale|error|unauthorized` y nunca convierten error en “no existe”;
17. country pack/version está trazado; términos, formatos y confirmaciones están certificados para el mercado habilitado;
18. RAG regulado respeta jurisdicción, autoridad y vigencia;
19. no existe default silencioso COP/+57/Bogotá ni timezone/moneda divergente;
20. aliases contextuales nunca autorizan por sí solos dinero, consentimiento o acciones irreversibles.

## 16. Secuencia de entrega y control de cambio

Cada subtipo atraviesa los estados `defined → contracted → implemented → integrated → evaluated → piloted → certified`. Un cambio de estado requiere evidencia automática y aprobación. La activación se hace por **perfil + versión + mercado/country pack + plan + integración**, no por vertical completa. El rollout usa feature flags, tenants piloto, shadow reads, comparación de métricas, monitoreo de errores y rollback coordinado de profile/tool/country-pack versions.

No se publicarán fechas hasta estimar cada épica contra capacidad real del equipo, conectores elegidos y países objetivo. El orden por dependencias y las puertas de salida sí son obligatorios.
