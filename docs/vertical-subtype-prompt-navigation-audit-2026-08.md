# Auditoría 1:1 de prompts, variables, lenguaje y navegación — agosto de 2026

**Producto:** Parallly / Parallext Engine  
**Corte:** 20 de agosto de 2026  
**Alcance:** 18 verticales, 75 subtipos canónicos y `otro`  
**Naturaleza:** análisis y diseño; no implementa cambios ni certifica producción  
**Documento base:** [Auditoría competitiva 1:1](./vertical-subtype-market-audit-2026-08.md)  
**Plan derivado:** [Plan maestro de implementación](./vertical-full-implementation-plan-2026-08.md)  
**Complementos normativos:** [cohesión integral de tools](./agent-tool-subtype-cohesion-audit-2026-08.md) y [comportamiento lingüístico por país](./country-language-behavior-packs-latam-2026-08.md)

## 1. Dictamen ejecutivo

La plataforma no tiene hoy un contrato conversacional ni una arquitectura de información 1:1 por subtipo. El selector presenta 75 subtipos, pero la experiencia se compone con piezas mayoritariamente heredadas de la vertical:

- solo seis subtipos tienen reglas nativas y localizadas propias: `salud/farmacia`, `automotriz/repuestos`, `automotriz/alquiler`, `technology/hardware`, `pet_services/guarderia` y `pet_services/hotel`;
- solo 19/75 cambian de forma determinista respecto del default vertical —13 por selección de template y seis por reglas nativas—; 56/75 heredan el prompt base y cinco overrides nominales apuntan al mismo template que ya tenían;
- esos cambios se reducen a 12 perfiles especializados compartidos, no a 75 contratos de negocio;
- la terminología que entra al prompt se limita a cuatro sustantivos de la vertical y una guía general; el slug del subtipo entra crudo como `business_type`;
- no existe un glosario por subtipo, región y canal, ni una lista de sinónimos, términos que se deben explicar o modismos que se deben evitar;
- cuando Agenda está activa, el constructor del prompt omite por completo `requiredFields`, de modo que los campos declarativos de la persona no sirven como contrato de intake para la mayoría de los negocios con cita;
- la navegación del dashboard no contiene reglas por subtipo: deriva páginas de capacidades compartidas, las ordena en una lista global y después aplica permisos de rol. El plan tampoco participa en esa decisión;
- varias etiquetas convierten un objeto comercial en uno operativo. El caso más grave es Turismo: el hijo CRM `/admin/pipeline` se llama **Reservas**, aunque es un Kanban de oportunidades, no el registro de reservas.
- las 95 tools estáticas sí tienen definición, política y executor, pero no un resolver común subtipo→plan→readiness→SoR→menú; el promedio de cohesión del subsistema es 48,3/100 y 17/76 perfiles quedan bloqueados;
- la regionalización end-to-end está cerca de 1/5: país operativo no canónico, RAG sin jurisdicción, confirmaciones duplicadas y defaults simultáneos de Colombia, México y voseo argentino.

El problema no se resuelve escribiendo 75 párrafos largos. La implementación correcta necesita un registro tipado por subtipo que una: trabajo principal, objetos, intenciones, variables, herramientas, lenguaje, navegación, permisos, plan, readiness, integraciones y evaluaciones. Las instrucciones estables deben ir en el prompt; los datos vivos y el estado deben permanecer en herramientas y workflows deterministas.

## 2. Evidencia técnica transversal

### 2.1 Prompt efectivo

El prompt se ensambla en tres capas:

1. **Contrato universal:** seguridad, uso de herramientas, grounding, no afirmar acciones sin éxito, confirmaciones y protección contra inyección.
2. **Persona:** identidad, tono, reglas, prohibiciones, handoff, horario y skillset; en modo libre, el texto personalizado sustituye el cuerpo guiado.
3. **Turno:** idioma, zona horaria, fecha, negocio, contacto, servicios, catálogo, memoria, objetos activos, conocimiento recuperado, directiva y contexto vertical.

La base universal es sólida. La brecha está en el contrato de dominio: `VerticalContext` solo conoce `customerNoun`, `customerNounPlural`, `transactionNoun`, `serviceNoun`, `industry`, `subType`, metas y audiencias. No representa una taxonomía de intenciones ni slots por subtipo, sensibilidad, procedencia, validación, política de confirmación o herramienta responsable.

Hallazgos críticos:

- `business_type` recibe valores técnicos como `casual_dining`, `medica_general`, `yoga_pilates` o `wedding_planner`, no una identidad semántica localizada.
- Metas y audiencias también entran como códigos (`appointments`, `b2c`, `fit_groups`). Cuando se eligen varias metas, una prioridad global decide cuál gana; los conflictos solo se escriben al log y no se explican ni persisten para el tenant.
- La localización no española conserva las herramientas de cada tarjeta, pero reemplaza reglas, prohibiciones y triggers de todas sus variantes por una única persona de la industria. Por eso se pierde la especialización textual de dental, listings, delivery, taller, tours/agencia y clases en inglés, portugués y francés.
- Los seis contratos nativos parten de `tpl_sales`; para portugués y francés el built-in puede mantener identidad/saludo inglés y recibir solo tres reglas nativas localizadas.
- La paridad de contenido no es solo estilística: 11/18 verticales en portugués y 10/18 en francés tienen menos del 60% de las palabras de las reglas españolas. Fotografía, Pet Services, Seguros y Hogar son casos extremos.
- El vocabulario es vertical, no subtipo. Por ejemplo, Turismo llama `paquete` al servicio y usa una **asesora de viajes** tanto para agencia como para hotel y apartamento turístico; Restaurantes llama `comensal` y `reserva` a clientes y transacciones de dark kitchens; Veterinaria mantiene lenguaje clínico para peluquería canina.
- Los 13 templates que declaran campos obligatorios usan una estructura incompatible con el renderer, por lo que este los descarta. Además, la sección se suprime cuando Agenda está activa. El booking engine recoge su agenda genérica, pero no sustituye variables clínicas, operativas o comerciales del subtipo. Hoy ningún `requiredField` vertical llega al prompt efectivo.
- No existe `locale` regional conversacional (`es-CO`, `es-MX`, `es-AR`, etc.). El detector reduce la lengua a `es|en|pt|fr`; el país del negocio está disponible, pero no gobierna un paquete terminológico.
- Una guía de flujo adicional se inyecta íntegramente en español incluso cuando la lengua del turno es inglés, portugués o francés, y mezcla voseo rioplatense (`resumí`, `entendé`) con tuteo de Bogotá.
- El modo de prompt libre conserva el contrato universal y el turno, pero deja fuera toda la estructura guiada: reglas nativas, temas prohibidos, handoff, horario y skillset. Debe explicitarse qué configuración prevalece, impedir que se desactiven invariantes sectoriales y mostrar el prompt efectivo antes de publicar.
- `forbiddenTopics` depende del cumplimiento del LLM. Los triggers de handoff sí se evalúan antes, pero por coincidencia textual exacta; expresiones como “grupo mayor a 8”, “monto > USD 50000” o una condición BANT rara vez coincidirán con lenguaje natural, variantes regionales o tildes.
- Varias plantillas contradicen la capa universal de una sola pregunta y hardcodean políticas no verificadas: devolución de 30 días, cancelación de gimnasio de 2 horas, boda con mínimo de 2 semanas, visita de garantía gratis, descuentos infantiles, trial gratis o recomendar seguro. Ninguna política de negocio debe vivir como hecho fijo en una plantilla compartida.
- Ninguna plantilla define `skillset`; el renderer usa `both` como default y añade siempre instrucciones de venta consultiva y soporte. Así recepción médica, psicología, finanzas, legal, veterinaria y postventa reciben una orden de vender. En perfiles regulados o de crisis debe existir `coordination|support|none` por intención y una regla **no pitch**.
- La protección contra prompt injection menciona conocimiento, resultados de tools y memoria, pero no declara que todo `<turn>` es dato no confiable. Nombre del contacto, títulos de producto/servicio, `business.about` y hechos recientes pueden contener instrucciones en lenguaje natural; escapar XML no neutraliza ese contenido. Cada dato necesita fuente, confianza y frescura, y todo el turno debe tratarse como evidencia, nunca como instrucción.
- Los write paths de setup pueden clonar y fusionar tools sin reconciliar reglas nativas ni actualizar la procedencia de template. Un agente puede conservar un `template_id` que ya no describe su prompt efectivo. Se requiere `contractId/version`, provenance auditable y reconciliación en cada alta, edición y migración.

### 2.2 Navegación efectiva

El dashboard conoce capacidades como Agenda, Propiedades, Tours, Listings, Vehículos, Alquileres, Menú, Pedidos, Membresías, Clases, Cursos, Seguros, Solicitudes, Tratamientos, Mascotas, Sesiones, Inventario y Pedidos generales. No conoce el trabajo diario de cada subtipo.

Consecuencias:

- el catálogo y la operación se mezclan en una sola sección;
- el orden es global, no por subtipo ni rol;
- varias páginas de catálogo contienen dentro la operación, pero la entrada exige `canEditPipeline`, por lo que un agente operativo no puede llegar a ella;
- el CRM puede adoptar el mismo nombre que el objeto operativo y crear una falsa equivalencia;
- no hay una página global de reservas de alojamiento ni de reservas de tours, aunque los backends sí ofrecen listados globales o por producto;
- el móvil omite varios workspaces verticales y cae en Agenda o en una superficie horizontal.

### 2.3 El caso de Turismo que motivó esta revisión

En `turismo/hotel` y `turismo/alquiler_vacacional` el objeto primario del manifest es `property_booking`, pero la única ruta publicada es `/admin/properties`. La pantalla principal muestra tarjetas de propiedades; para encontrar una reserva se debe abrir una propiedad y después la pestaña **Reservas**. El detalle sí tiene Calendario, Información, Fotos, Reservas, feeds iCal y Check-in, pero no existe un registro operativo global en el menú.

Paralelamente, la definición de Turismo cambia el nombre del hijo `/admin/pipeline` a **Reservas**. Ese destino sigue siendo el Kanban CRM con etapas Consulta → Cotización → Reserva → Confirmado → Completado/Cancelado. No es la tabla `property_bookings`. Para el rol agente el problema es mayor: **Propiedades** exige capacidad de gestión, mientras el Pipeline permanece como el acceso visible. El backend ya expone `GET /vacation-rental/:tenantId/bookings` para próximas reservas de todas las propiedades, pero el cliente web no ofrece página o acceso global que lo use.

El menú objetivo de alojamiento debe separar sin ambigüedad:

1. **Reservas** — lista global, búsqueda, filtros, estados, fuente, saldo, acciones y detalle;
2. **Calendario** — multicalendario de todas las unidades, disponibilidad, bloqueos y creación rápida;
3. **Llegadas y salidas** — operación de hoy, check-in, check-out y pendientes;
4. **Huéspedes** — perfil y estadías;
5. **Propiedades** — catálogo/configuración de unidades, fotos, tarifas, políticas y feeds;
6. **Tareas** — limpieza, mantenimiento e incidencias;
7. **Pagos** — depósitos, saldos, reembolsos y conciliación;
8. **CRM / Oportunidades** — cotizaciones o prospectos sin confundirlos con reservas confirmadas.

Este patrón coincide con referentes especializados: Guesty expone el Multi-Calendar desde la navegación lateral, permite buscar disponibilidad y crear o gestionar reservas sobre todas las unidades; Cloudbeds lleva el calendario y el resumen diario a reservas, llegadas, salidas, ocupación y disponibilidad. Véanse [Guesty Multi-Calendar](https://help.guesty.com/hc/en-gb/articles/28012752150685-Navigating-the-Multi-Calendar), [gestión de reservas en Guesty](https://help.guesty.com/hc/en-gb/articles/35248534418461-Managing-reservations-in-the-Multi-Calendar), [calendario de Cloudbeds](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/235146587-Calendar-Everything-you-need-to-know) y [dashboard de Cloudbeds](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/115000400634-Dashboard-Everything-you-need-to-know).

### 2.4 Fuentes internas que gobiernan el resultado efectivo

| Contrato auditado | Fuente de código |
|---|---|
| Reglas nativas de los seis subtipos | `apps/api/src/modules/persona/vertical-subtype-persona-contract.ts:29-142,232-239` |
| Selección inicial de template y prioridad de metas | `apps/api/src/modules/persona/onboarding-persona-resolver.ts:13-24,41-222` |
| Render de persona, required fields, skillset, templates y localización | `apps/api/src/modules/persona/persona.service.ts:148-299,1110-2940` |
| Capas universales y variables del turno | `apps/api/src/modules/conversations/prompt-assembler.service.ts:75-325` |
| Guidance vertical y creación de `verticalContext` | `apps/api/src/modules/conversations/conversations.service.ts:108-135,1995-2042` |
| Términos/agente/pipeline/FAQ/servicios por vertical | `apps/api/src/modules/verticals/vertical-definitions.ts:31-1212` |
| Proyección capability→página, sin reglas subtipo | `apps/dashboard/src/lib/vertical-dashboard-resolver.ts:9-250` |
| Árbol, orden, roles y label overrides del sidebar | `apps/dashboard/src/components/layout/AppSidebar.tsx:202-332,641-754` |
| Pipeline realmente conectado a CRM Kanban | `apps/dashboard/src/app/admin/pipeline/page.tsx:47,86,382` |
| Reservas anidadas en propiedad | `apps/dashboard/src/app/admin/properties/page.tsx:221-325`; `apps/dashboard/src/app/admin/properties/[propertyId]/page.tsx:160-172` |
| Lista backend global de reservas de alojamiento | `apps/api/src/modules/vacation-rental/vacation-rental.controller.ts:145-156` |
| Workspace móvil y lista global ya consumida | `apps/mobile/src/lib/verticalWorkspace.ts:195-373`; `apps/mobile/src/screens/ReservationsScreen.tsx:124-133,288-348` |
| Metas/audiencias visibles por industria y keys persistidos | `apps/dashboard/src/app/onboarding/page.tsx:176-282,1200-1262` |

### 2.5 Herramientas y país completan el contrato, no son anexos opcionales

La tool correcta debe corresponder al objeto que el prompt nombra y al registro que el humano ve. La auditoría complementaria verifica las 76 configuraciones y encontró:

- writer de catálogo/pedidos roto para ocho perfiles;
- Resource Rentals no expuesto a alquiler de vehículos ni boarding;
- reservas locales de alojamiento separadas de Channel Manager/Hostaway;
- MCP anunciado pero bloqueado;
- continuidad viva limitada a cinco dominios;
- procedures capaces de saltarse el gating del agente;
- integraciones de proveedor mayormente read-only y sin write-back;
- confirmaciones distintas entre Booking y el guard central.

La matriz tool 1:1 está en [`agent-tool-subtype-code-scorecard-2026-08.csv`](./agent-tool-subtype-code-scorecard-2026-08.csv) y la cadena integral estricta en [`agent-tool-subtype-cohesion-scorecard-2026-08.csv`](./agent-tool-subtype-cohesion-scorecard-2026-08.csv).

El overlay nacional tampoco puede ser una lista de frases en el prompt. Debe alimentar determinísticamente normalización de intención, formatos, tools, RAG, handoff y política de confirmación. La especificación de los 15 packs prioritarios, EE. UU./Canadá y los mercados `fallback_only` está en [`country-language-behavior-packs-latam-2026-08.md`](./country-language-behavior-packs-latam-2026-08.md).

## 3. Escala de esta auditoría

Cada subtipo se evalúa en cuatro dimensiones de 0 a 5. No sustituye la preparación competitiva del informe principal; explica por qué la experiencia puede sentirse genérica o engañosa aunque exista una herramienta backend.

| Nivel | Prompt | Variables | Lenguaje | Navegación |
|---:|---|---|---|---|
| 0 | producto equivocado o contradictorio | no existen o pertenecen a otro flujo | términos de otro negocio | no existe destino operativo |
| 1 | persona horizontal/vertical genérica | datos generales de contacto | sustantivos de industria | destino genérico, escondido o engañoso |
| 2 | alguna plantilla/regla o tools adecuadas | argumentos parciales en herramientas | 4 idiomas, sin glosario subtipo/región | módulo útil, pero anidado o mal ordenado |
| 3 | contrato nativo parcial | mínimo tipado del flujo feliz | glosario subtipo básico | acceso directo al objeto principal |
| 4 | intenciones, excepciones y políticas completas | procedencia, validación, sensibilidad y corrección | registro regional controlado y explicable | rol, plan, estado y tareas diarias resueltos |
| 5 | validado con evals y usuarios del sector | cobertura E2E certificada | validado por país/canal | validado por rol con analítica de uso |

Ningún subtipo alcanza hoy nivel 4 o 5 en las cuatro dimensiones.

En las 76 configuraciones, los promedios son **Prompt 1,25/5**, **Variables 1,86/5**, **Lenguaje 1,20/5** y **Navegación 1,97/5**. El máximo observado en cualquier dimensión es 3. Los peores desajustes integrales son `wedding_planner`, construcción, fintech, aseguradora y los profesionales no legales que heredan el prompt jurídico. Hotel y alquiler vacacional no están en el fondo funcional porque sus tools de estadía son relativamente completas, pero sí están entre los peores en lenguaje y discoverability: precisamente la combinación que hace sentir que “Reservas” no existe aunque el backend la tenga. La matriz ordenable está en [`vertical-subtype-experience-scorecard-2026-08.csv`](./vertical-subtype-experience-scorecard-2026-08.csv); `ajuste_experiencia_100` normaliza por igual estas cuatro dimensiones y no reemplaza la preparación competitiva.

## 4. Principios para variables y lenguaje

La lista de variables de las tablas es el **mínimo de negocio**, no una orden de inyectarlas todas en el system prompt. Cada campo debe declarar:

- intención y estado del workflow donde aplica;
- fuente (`usuario`, `tenant`, `tool`, `SoR`, `derivada`);
- tipo, unidad, moneda, zona horaria y validador;
- sensibilidad y política de retención;
- si se puede inferir o siempre debe preguntarse;
- confirmación implícita o explícita según costo del error;
- herramienta de lectura/escritura y fallback humano;
- sinónimos por idioma/región y texto de reparación.

El contrato transversal V2 también necesita `locale`, tratamiento (`tú|usted|vos`), label localizado, moneda/impuestos/unidades/formato de fecha, sede/área de servicio, rol y autoridad del interlocutor, jurisdicción/consentimiento, sensibilidad/retención, SoR y salud/frescura de la integración, capacidad/staff/recurso, política y fuente, estado de pago, canal, workflow/intento, owner/SLA y versión/evidencia. Un `requiredField` escrito como instrucción no es captura persistente: el backend debe distinguir hechos requeridos, opcionales y sensibles, validar su fuente, persistir estado y bloquear el writer hasta cumplir precondiciones.

Las acciones irreversibles o costosas —pago, reserva final, cancelación, reclamo, prescripción, contrato— requieren confirmación explícita. Para parámetros de bajo riesgo conviene confirmación implícita y corrección en un paso, siguiendo la guía oficial de [Google Conversation Design](https://developers.google.com/assistant/conversation-design/confirmations?hl=en).

## 5. Matriz 1:1

**Convención:** `P/V/L/N` = Prompt / Variables / Lenguaje / Navegación actuales (0–5). “Menú objetivo” solo enumera el bloque específico del subtipo; Bandeja, Inicio, CRM, Analítica y Configuración siguen siendo transversales y deben ordenarse por rol.

### 5.1 Salud

| Subtipo | Prompt/plantilla actual | Variables mínimas que faltan gobernar | Lenguaje y menú objetivo | P/V/L/N | Alerta |
|---|---|---|---|---:|---|
| Dental | Override `tpl_salud_dental`; cita + lectura de tratamiento. | motivo/procedimiento; nuevo/recurrente; profesional/sede/sillón; urgencia no diagnóstica; seguro; fecha; recall; consentimiento. | `odontólogo/dentista`, `cita/turno/hora` por país. Menú: **Agenda → Pacientes → Tratamientos → Recalls → Formularios → Profesionales/recursos**. | 2/2/2/2 | No llamar historia clínica al plan de tratamiento; integrar PMS. |
| Medicina general | `tpl_salud_recepcion` o template por meta; sin delta subtipo. | motivo; modalidad; médico/sede; asegurador; datos de intake; red flags de urgencia; derivación; consentimiento. | Evitar diagnóstico y “consulta” cuando solo se agenda. Menú: **Agenda → Pacientes → Intake/Triage → Profesionales → Integración clínica**. | 1/1/2/2 | `STOP/REG`: Agenda no es EHR ni atención médica. |
| Dermatología | Persona de Salud; tools de tratamiento, sin plantilla subtipo. | consulta médica/estética; zona corporal; procedimiento/sesión; equipo; profesional; fotos y consentimiento; contraindicaciones; pre/post. | Distinguir dermatología clínica de estética. Menú: **Agenda → Pacientes → Tratamientos → Media clínica → Consentimientos → Inventario/equipos**. | 1/2/1/2 | Media clínica y reglas regulatorias no pueden quedar en RAG libre. |
| Psicología | Persona de Salud; tools de tratamiento, sin plantilla subtipo. | tipo de terapia; primera/recurrente; modalidad; terapeuta; recurrencia; pago; privacidad; contacto de emergencia y crisis. | `psicólogo/terapeuta`, `cita/sesión` por mercado; tono sobrio. Menú: **Sesiones → Pacientes → Formularios → Planes → Teleconsulta → Pagos**. | 1/2/2/2 | Crisis debe activar flujo determinista, no conversación improvisada. |
| Farmacia | `tpl_sales` + contrato nativo de catálogo/pedido y límites clínicos. | Rx/OTC; principio activo/marca; presentación/concentración; cantidad; receta válida; sustitución autorizada; tienda; entrega/retiro; lote/vencimiento. | `receta` vs `fórmula médica`; nunca recomendar dosis. Menú: **Pedidos → Inventario → Recetas/validación → Entregas → Clientes → Auditoría**. | 3/2/2/1 | Ruta canónica omite Pedidos; catálogo genérico solo es defendible para OTC. |

### 5.2 Moda, belleza y bienestar

| Subtipo | Prompt/plantilla actual | Variables mínimas que faltan gobernar | Lenguaje y menú objetivo | P/V/L/N | Alerta |
|---|---|---|---|---:|---|
| Salón de belleza | `tpl_belleza_reservas`; label-only. | servicio/variante; largo/tipo de cabello; profesional; sede; duración/precio; recursos; extras; depósito; preferencias previas. | Evitar asumir género o textura. Menú: **Agenda → Clientes → Servicios/paquetes → Profesionales/sillas → Caja/inventario → Rebooking**. | 1/2/2/2 | Staff backend sin UI impide agenda real multi-profesional. |
| Barbería | Misma plantilla de salón; label-only. | corte/barba/ritual; barbero/silla; turno vs walk-in; tiempo; membresía; preferencia de estilo. | No usar `bro`, `parce` o trato hipermasculino por defecto. Menú: **Cola y Agenda → Clientes → Servicios → Barberos/sillas → Membresías → Caja**. | 1/2/1/2 | Falta cola/walk-in, eje operativo del segmento. |
| Spa | `tpl_belleza_reservas`; añade lectura de tratamientos. | tratamiento; terapeuta; cabina/equipo; duración; paquete/crédito; contraindicaciones; consentimiento; preferencia declarada; depósito. | `cabina`, `circuito`, `bono/paquete` según país. Menú: **Agenda → Tratamientos/paquetes → Clientes → Cabinas/equipos → Consentimientos → Caja**. | 1/2/2/2 | Treatment writer y capacidad concurrente ausentes. |
| Estética / medspa | Misma persona de Belleza + tratamiento. | procedimiento; zona; profesional habilitado; sesión; lote/consumible; fotos antes/después; consentimiento; contraindicaciones; protocolo. | No prometer resultados ni banalizar procedimientos médicos. Menú: **Agenda → Pacientes/clientes → Planes → Media clínica → Consentimientos → Inventario/lotes → Profesionales/equipos**. | 1/2/1/2 | `REG`: requiere modo regulado e integración EMR/PMS. |

### 5.3 Inmobiliaria

| Subtipo | Prompt/plantilla actual | Variables mínimas que faltan gobernar | Lenguaje y menú objetivo | P/V/L/N | Alerta |
|---|---|---|---|---:|---|
| Venta | `tpl_inmobiliaria_listings`; tools de inmueble + visita. | comprar/vender; presupuesto/moneda; financiación; ciudad/zona; tipo; área; habitaciones; amenities; asesor; favoritos; oferta/etapa. | `inmueble/propiedad`, `apartamento/departamento`, `alcobas/habitaciones` regionales. Menú: **Inmuebles → Interesados → Visitas → Oportunidades → Favoritos → Ofertas/documentos**. | 2/2/2/2 | Fotos existen en backend pero no se cargan desde Listings UI. |
| Arriendo | Misma plantilla/listings, aunque el ciclo es distinto. | canon; fecha de mudanza; plazo; ocupantes; mascotas; amoblado; depósito; requisitos; garante/seguro; documentos; aplicación. | `arriendo/alquiler/renta`, `canon`, `fianza/depósito`. Menú: **Disponibilidad → Aplicaciones → Inmuebles/unidades → Visitas → Contratos/depósitos → Mantenimiento**. | 2/2/1/2 | No existe objeto aplicación/contrato; no confundir visita con reserva de unidad. |
| Comercial | Misma plantilla/listings; solo cambia persona inicial. | uso/asset class; compra/lease; área útil; zoning; potencia; muelles; parqueos; ubicación; plazo; NOI/cap rate si procede; brochure. | `local/oficina/bodega/nave`, `arrendamiento/lease`; explicar métricas. Menú: **Espacios → Prospectos → Visitas → Negociaciones → Propietarios → Documentos/comps**. | 2/1/1/2 | El modelo residencial no representa unidades, propietarios ni deal room. |
| Construcción | Plantilla inmobiliaria genérica; clasificación ambigua. | Si promotor: proyecto, torre/unidad, etapa, entrega, financiación. Si contratista: alcance, presupuesto, cronograma, hitos, cambios, avance. | No hay glosario válido hasta definir el producto. Menú promotor: **Proyectos/unidades → Leads → Visitas → Separaciones**; contratista: **Proyectos → Presupuestos → Cronograma → Cambios → Avances**. | 0/0/0/1 | `MISCLASS/STOP`: resolver taxonomía antes de escribir prompt. |

### 5.4 Restaurantes

| Subtipo | Prompt/plantilla actual | Variables mínimas que faltan gobernar | Lenguaje y menú objetivo | P/V/L/N | Alerta |
|---|---|---|---|---:|---|
| Casual dining | `tpl_restaurante_reservas`; menú/pedido + Agenda genérica. | mesa/turno; fecha/hora; party size; sede/zona; preferencias; alergias; ocasión; depósito; waitlist; platos, modificadores y estado. | `comensal` puede sonar formal; separar **reserva de mesa** de oportunidad CRM. Menú: **Reservas y mesas → Waitlist → Pedidos/cocina → Menú → Clientes → Caja**. | 2/2/2/2 | Agenda no modela mesa/capacidad; Pipeline también se llama Reservas. |
| Comida rápida | `tpl_restaurante_delivery`; delta real sin Agenda. | pickup/delivery; dirección/zona; sede; ETA; ítems; variantes/modificadores; combos; alergias; pago; estado; cancelación/refund. | `para llevar/recoger/pickup` y nombres regionales de ingredientes. Menú: **Pedidos → Cocina/KDS → Despacho → Menú/stock → Promos → Clientes**. | 2/3/2/3 | Sin POS/KDS/pago, el pedido confirmado produce doble digitación. |
| Cafetería | Default de reservas; no diferencia servicio de mesa vs quick service. | consumo local/pickup; mesa opcional; bebida/tamaño/leche/extras; comida; stock; lealtad; suscripción; nombre de pedido. | `tinto` no significa lo mismo fuera de Colombia; evitar asumir. Menú: **Pedidos/cola → Menú → Fidelidad → Inventario → Mesas opcionales → Clientes**. | 1/2/1/2 | Definir el modelo operativo durante onboarding. |
| Dark kitchen | `tpl_restaurante_delivery`; mismas tools que fast food. | marca virtual; canal; menú/sede; capacidad; preparación/ETA; modificadores; dirección; courier; tracking; pago/refund; SLA. | No hablar de mesa o comensal; usar `pedido`, `cliente`, `despacho`. Menú: **Pedidos omnicanal → Cocina/capacidad → Despacho → Marcas/menús → Stock → Conciliación**. | 2/3/1/3 | Terminología vertical aún llama reserva a la transacción. |

### 5.5 Automotriz

| Subtipo | Prompt/plantilla actual | Variables mínimas que faltan gobernar | Lenguaje y menú objetivo | P/V/L/N | Alerta |
|---|---|---|---|---:|---|
| Concesionario | `tpl_automotriz_ventas`; vehículos + test drive. | nuevo/usado; marca/modelo/año/versión; presupuesto; financiación; trade-in; sede; disponibilidad; asesor; test drive; oferta. | `carro/auto/coche/vehículo`, `cuota inicial/enganche/pie`. Menú: **Leads → Vehículos → Pruebas de manejo → Cotizaciones → Retomas → Financiación**. | 2/3/2/3 | Stock y precio necesitan DMS/feed vivo. |
| Taller | `tpl_automotriz_servicio`, pero conserva vehículo/test drive + Agenda. | placa/VIN; vehículo; kilometraje; síntoma; severidad; inmovilizado; servicio; técnico/bahía; repuestos; estimate; autorización; estado. | `taller/servicio`, `orden de trabajo`, `presupuesto/cotización`; no diagnosticar. Menú: **Órdenes de trabajo → Agenda/recepción → Vehículos/clientes → Técnicos/bahías → Repuestos → Cotizaciones**. | 2/2/2/2 | Tools actuales no crean ni actualizan orden de reparación. |
| Repuestos | `tpl_sales` + contrato nativo de compatibilidad, stock y pedido. | placa/VIN; marca/modelo/año; motor/versión; número de parte; OEM/alterno; lado/posición; cantidad; sede; entrega; pago. | `repuesto/refacción/autoparte`, `baúl/cajuela`, etc.; confirmar compatibilidad, no prometer. Menú: **Pedidos → Búsqueda/compatibilidad → Inventario → Cotizaciones → Despacho → Garantías/devoluciones**. | 3/3/2/3 | Catálogo utilitario histórico contradice manifest; integrar EPC/ERP cuando aplique. |
| Alquiler | `tpl_sales` + contrato nativo; consulta vehículo y UI de recurso, sin writer IA. | retiro/devolución con hora y sede; clase; conductor; edad; licencia; país; pasajeros/equipaje; cobertura; depósito; kilometraje; extras; estado de flota. | `alquiler/renta`, `cobertura/seguro`, `franquicia/deducible`. Menú: **Reservas → Flota/disponibilidad → Entregas → Devoluciones/daños → Clientes/conductores → Pagos**. | 3/2/2/1 | `WRITER/CAP`: el agente debe escalar porque no puede crear la reserva. |

### 5.6 Turismo

| Subtipo | Prompt/plantilla actual | Variables mínimas que faltan gobernar | Lenguaje y menú objetivo | P/V/L/N | Alerta |
|---|---|---|---|---:|---|
| Agencia de viajes | `tpl_turismo_agencia`; tours/agencia según tools. | origen/destino; fechas flexibles; viajeros/edades; presupuesto/moneda; documentos; vuelos/hotel; preferencias; proveedor; cotización; pago; seguro. | `viajero`, `pasajero`, `itinerario`, `reserva`; no dar requisitos migratorios como verdad oficial. Menú: **Solicitudes → Cotizaciones → Itinerarios → Reservas → Viajeros → Proveedores/pagos**. | 2/2/2/2 | Pipeline llamado Reservas sigue siendo CRM; falta booking agregado multi-proveedor. |
| Hotel / Hostal | `tpl_turismo_ventas`: asesora de viajes, “paquetes”; tools de propiedad/estadía. | check-in/out; huéspedes/edades; tipo de habitación/unidad; ocupación; tarifa/impuestos; plan de comida; fuente; depósito/saldo; estado; llegadas/salidas; requests. | `huésped`, `habitación`, `estadía/alojamiento`; no “viajero/paquete” por defecto. Menú: **Reservas → Calendario → Llegadas/salidas → Huéspedes → Habitaciones/tarifas → Housekeeping → Pagos**. | 1/3/0/1 | `P0 UX`: reservas globales sin página; agente solo ve Kanban llamado Reservas. |
| Tours y actividades | `tpl_turismo_tours`; writer/lista/cancelación de booking. | salida/fecha/hora; participantes/edades; idioma; meeting point; capacidad; guía/vehículo; inclusiones; restricciones; contacto; pickup; pago/waiver. | `tour/excursión/actividad/salida`; “cupos”, no disponibilidad genérica. Menú: **Salidas → Reservas → Disponibilidad → Tours → Viajeros → Guías/recursos → Pagos**. | 2/3/2/1 | Reservas reales anidadas dentro del paquete y catálogo restringido al agente. |
| Alquiler vacacional | Default turístico de paquetes; tools de propiedad/estadía. | check-in/out; huéspedes; propiedad/unidad; mascotas; tarifa/fees/impuestos; fuente; depósito/saldo; instrucciones; identidad; llegada; limpieza/incidencia. | `huésped/anfitrión`, `alojamiento/apartamento`, `estadía`; evitar lenguaje de agencia. Menú: **Reservas → Multicalendario → Llegadas/salidas → Huéspedes → Propiedades → Tareas/limpieza → Pagos/canales**. | 1/3/0/1 | Es el caso más claro de choque entre prompt correcto, objeto correcto y menú equivocado. |

### 5.7 Educación

| Subtipo | Prompt/plantilla actual | Variables mínimas que faltan gobernar | Lenguaje y menú objetivo | P/V/L/N | Alerta |
|---|---|---|---|---:|---|
| Idiomas | `tpl_educacion_inscripciones`; igual a toda Educación. | idioma objetivo; nivel; meta; edad; modalidad; sede/zona; disponibilidad; prueba; curso/cohorte; docente; inicio; pago. | `clase/curso`, `nivel`, `prueba de ubicación/nivelación`; no asumir “alumno”. Menú: **Inscripciones → Cursos/cohortes → Horarios/clases → Estudiantes → Pruebas de nivel → Docentes/pagos**. | 1/2/2/2 | Agenda + Cursos no modelan cohortes, asistencia ni progreso. |
| Universitaria | Misma plantilla de inscripciones. | programa; nivel académico; campus/modalidad; período; requisitos; documentos; estado de admisión; cita; financiación; applicant ID. | `aspirante` antes de matrícula, `estudiante` después; `admisión/postulación/aplicación` regional. Menú: **Admisiones → Programas → Aspirantes → Documentos → Citas → Matrículas/financiación**. | 1/1/1/2 | Inscribir a curso no equivale a admitir a universidad; requiere SIS/CRM de admisiones. |
| Educación online | Misma plantilla. | curso; self-paced/live; zona horaria; inicio; duración; prerrequisitos; acceso; progreso; certificado; soporte; pago. | Explicar `asincrónico`, `cohorte`, `LMS` si se usan. Menú: **Cursos → Inscripciones → Cohortes/sesiones → Estudiantes/progreso → Soporte → Certificados**. | 1/2/2/2 | Falta LMS/progreso/acceso; Agenda puede ser ruido en self-paced. |
| Capacitación | Misma plantilla; no distingue B2C/B2B. | persona/empresa; competencia; participantes; modalidad; fechas; instructor; sede; cotización; orden de compra; asistencia; evaluación; certificado. | `capacitación/formación/treinamento`; diferenciar participante y comprador. Menú: **Solicitudes/cotizaciones → Programas → Cohortes → Empresas/participantes → Instructores → Certificados/facturación**. | 1/2/1/2 | Requiere cohortes B2B, contratos y facturación, no solo cursos individuales. |

### 5.8 Finanzas

| Subtipo | Prompt/plantilla actual | Variables mínimas que faltan gobernar | Lenguaje y menú objetivo | P/V/L/N | Alerta |
|---|---|---|---|---:|---|
| Asesoría financiera | `tpl_finanzas_calificador`; solo Agenda visible. | objetivo; horizonte; situación general; tolerancia al riesgo; jurisdicción; asesor/licencia; consentimiento; documentos; cita. No pedir PII innecesaria por chat. | `asesoría/orientación` y disclaimers; nunca “te conviene” sin profesional autorizado. Menú: **Prospectos → Citas → Clientes/perfiles → Documentos → Tareas → Cumplimiento**. | 1/1/1/1 | `REG/SOR`: la IA solo califica y coordina hasta integrar sistema autorizado. |
| Fintech | Misma plantilla; subtipo demasiado amplio. | Depende del producto: onboarding/KYC, cuenta, transacción, tarjeta, pago, fraude o soporte; identidad, consentimiento y estado. | No existe glosario válido para “fintech” genérico. Menú tentativo: **Casos → Onboarding/KYC → Clientes/cuentas → Transacciones → Riesgo/soporte**. | 0/0/0/1 | `STOP`: definir producto y licencia antes de prompt, variables o navegación. |
| Créditos | Misma plantilla de calificación. | propósito; monto/moneda; plazo; ingreso verificable; empleo/empresa; obligaciones; garantía; jurisdicción; consentimiento de consulta; documentos; application ID/estado. | `crédito/préstamo`, `cuota`, `tasa efectiva`, `desembolso`; no prometer aprobación. Menú: **Solicitudes → Precalificación → Documentos → Decisiones/estado → Clientes → Desembolsos/pagos**. | 1/1/1/1 | Agenda no es origination; integrar LOS/core y revisión legal por país. |

### 5.9 Servicios profesionales

| Subtipo | Prompt/plantilla actual | Variables mínimas que faltan gobernar | Lenguaje y menú objetivo | P/V/L/N | Alerta |
|---|---|---|---|---:|---|
| Abogados | `tpl_legal_consulta`; único tool profesional consulta estado. | materia/jurisdicción; conflicto de interés; partes; fecha límite; resumen; documentos; consulta; responsable; matter ID; consentimiento. | `caso/asunto/expediente/proceso` no son intercambiables; no dar asesoría no cualificada. Menú: **Intakes → Asuntos/casos → Calendario/plazos → Clientes → Documentos → Tareas/tiempo/facturación**. | 2/1/2/1 | Pipeline llamado Casos no sustituye matter management; no hay UI propia. |
| Contadores | Hereda plantilla legal; solo servicios semilla distintos. | país; persona/empresa; entidad; obligación; período fiscal; fecha límite; software; documentos; responsable; estado; honorarios. | `contador/contable`, `declaración`, `retención`, `IVA` por jurisdicción; evitar “caso legal”. Menú: **Trabajos/obligaciones → Clientes → Calendario fiscal → Documentos → Tareas → Facturación**. | 0/1/0/1 | Prompt, pipeline y tool `case_status` pertenecen a otra profesión. |
| Arquitectos | Hereda plantilla legal; privacidad de cita cambia. | tipo de proyecto; sitio/ubicación; área; uso; alcance; presupuesto; fase; permisos; entregables; visita; plazo; stakeholders. | `anteproyecto`, `planos`, `licencia`, `obra`; no llamar “caso”. Menú: **Proyectos → Leads/propuestas → Fases/hitos → Visitas → Entregables/documentos → Presupuesto/facturación**. | 0/1/0/1 | `STOP`: Agenda + caso no alcanzan gestión de proyecto. |
| Consultores | Hereda plantilla legal; servicios semilla propios. | problema/resultado; industria; empresa; stakeholders; alcance; diagnóstico; modalidad; presupuesto; plazo; propuesta; engagement; entregables. | `proyecto/engagement/asesoría`; evitar jerga interna como BANT ante el cliente. Menú: **Oportunidades → Propuestas → Proyectos → Clientes → Entregables/tareas → Tiempo/facturación**. | 0/1/0/1 | El único tool de caso no escribe ni representa proyectos. |

### 5.10 Retail

| Subtipo | Prompt/plantilla actual | Variables mínimas que faltan gobernar | Lenguaje y menú objetivo | P/V/L/N | Alerta |
|---|---|---|---|---:|---|
| Moda | `tpl_retail_ventas`; catálogo/pedido horizontal. | categoría; talla/sistema; color/variante; medidas/fit; material; disponibilidad por sede; cantidad; entrega; pago; cambio/devolución. | `talla/talle`, `chaqueta/campera`, etc.; evitar inferir cuerpo o género. Menú: **Pedidos → Productos/variantes → Inventario → Clientes → Cambios/devoluciones → Promos**. | 1/2/1/3 | Catálogo actual necesita variantes y stock por ubicación. |
| Electrónica | Misma plantilla/catalog. | categoría; marca/modelo; especificaciones; compatibilidad; voltaje; cantidad; stock; entrega; garantía; serial; soporte/RMA. | Explicar siglas; distinguir capacidad, memoria y almacenamiento. Menú: **Pedidos → Productos/compatibilidad → Inventario → Garantías/RMA → Soporte → Clientes**. | 1/2/2/3 | Sin seriales/variantes/garantía no cubre postventa real. |
| Hogar | Misma plantilla/catalog. | ambiente/uso; dimensiones/unidad; material/color; variante; cantidad; disponibilidad; envío/instalación; garantía/devolución. | unidades métricas/imperiales y nombres regionales de mobiliario. Menú: **Pedidos → Productos/variantes → Inventario → Entregas/instalación → Clientes → Devoluciones**. | 1/2/1/3 | Requiere dimensiones, variantes y logística, no solo producto plano. |
| Marketplace | Misma plantilla de tienda propia. | rol comprador/vendedor/operador; seller; listing; comisión; disponibilidad; orden; pago; envío; disputa; devolución; payout; SLA. | Separar `vendedor`, `comprador`, `comercio` y operador. Menú: **Órdenes → Publicaciones → Vendedores → Compradores → Disputas/devoluciones → Pagos/payouts**. | 0/1/0/2 | `STOP/MISCLASS`: definir si es marketplace operator o seller antes de desarrollar. |

### 5.11 Tecnología

| Subtipo | Prompt/plantilla actual | Variables mínimas que faltan gobernar | Lenguaje y menú objetivo | P/V/L/N | Alerta |
|---|---|---|---|---:|---|
| SaaS | `tpl_technology_ventas`; Agenda, sin producto/account state. | empresa; rol; use case; usuarios; stack/integraciones; requisito de seguridad; plan/trial; presupuesto; timeline; decisión; cuenta; ticket/billing. | Explicar acrónimos; BANT es método interno, no guion literal. Menú: **Cuentas/trials → Leads → Demos → Onboarding → Soporte/tickets → Suscripción/product health**. | 1/1/2/1 | Solo Agenda no soporta lifecycle SaaS. |
| Consultoría TI | Misma plantilla, servicio semilla propio. | incidente vs proyecto; impacto/severidad; entorno/stack; usuarios; SLA; alcance; acceso; presupuesto; responsable; estado. | `incidente/solicitud/cambio/proyecto`; no afirmar causa técnica sin evidencia. Menú: **Tickets/cola → Clientes/activos → Proyectos → SLA → Conocimiento → Contratos/facturación**. | 1/1/2/1 | Debe decidir MSP/helpdesk vs consultoría de proyectos. |
| Desarrollo | Misma plantilla, servicio semilla propio. | producto/problema; plataforma; usuarios; alcance; funcionalidades; integraciones; datos/seguridad; presupuesto; plazo; hitos; aceptación. | `MVP`, `sprint`, `backlog` se explican; no prometer estimate prematuro. Menú: **Oportunidades → Discovery/propuestas → Proyectos → Backlog/hitos → Clientes → Tiempo/facturación**. | 1/1/2/1 | Agenda de demo no es delivery de software. |
| Hardware | `tpl_sales` + contrato nativo de catálogo/pedido. | categoría/modelo; caso de uso; compatibilidad; especificaciones; cantidad; stock/sede; entrega; instalación; garantía; serial/RMA. | Glosario técnico con unidades y compatibilidad; no inventar specs. Menú: **Pedidos → Catálogo/compatibilidad → Inventario/seriales → Entregas → Garantías/RMA → Soporte**. | 3/3/2/3 | Necesita catálogo técnico estructurado; hardware no debe heredar KPIs de demos. |

### 5.12 Veterinaria

| Subtipo | Prompt/plantilla actual | Variables mínimas que faltan gobernar | Lenguaje y menú objetivo | P/V/L/N | Alerta |
|---|---|---|---|---:|---|
| Clínica general | `tpl_veterinaria_clinica`; Agenda + Mascotas. | mascota; especie/raza; edad/peso; tutor; motivo; síntomas; inicio/severidad; red flags; profesional/sede; vacunas; consentimiento. | `tutor/responsable` es más neutral que “papá/mamá”; `mascota/paciente` según contexto. Menú: **Agenda → Pacientes/mascotas → Consultas → Vacunas/recordatorios → Profesionales → Inventario**. | 1/2/2/2 | Triage solo orienta urgencia; integrar PIMS para historia clínica. |
| Hospital 24h | Misma plantilla; único delta es horario 24×7. | emergencia; especie; signos críticos; ubicación; ETA; triage; cola; hospitalización; responsable; autorización; estado. | Frases directas en urgencia, sin emojis ni interrogatorio largo. Menú: **Triage/urgencias → Cola → Hospitalizados → Agenda → Pacientes → Turnos/staff**. | 1/1/1/2 | Un horario 24h no crea un flujo hospitalario. |
| Exóticos | Misma clínica, label-only. | especie exacta; peso; hábitat; temperatura; dieta; exposición; síntoma; especialista disponible; transporte seguro; urgencia. | No llamar perro/gato; usar nombre de especie y términos comprensibles. Menú: **Triage → Agenda especializada → Pacientes → Hábitat/dieta → Especialistas → Seguimiento**. | 1/1/1/2 | Reglas genéricas pueden ser clínicamente inadecuadas para especies exóticas. |
| Peluquería canina | Hereda clínica, vacunas/desparasitación y “patient journey”; solo privacidad cambia. | perro; raza/tamaño; pelaje/nudos; servicio; estilo; temperamento; restricciones; vacunas requeridas por política; groomer; hora. | `peluquería/grooming`; evitar lenguaje clínico y apodos por defecto. Menú: **Agenda → Perros/clientes → Servicios/paquetes → Groomers/mesas → Historial de estilo → Pagos**. | 0/2/0/2 | `MISCLASS`: debe usar Pet Grooming, no persona clínica veterinaria. |

### 5.13 Gimnasios y estudios fitness

| Subtipo | Prompt/plantilla actual | Variables mínimas que faltan gobernar | Lenguaje y menú objetivo | P/V/L/N | Alerta |
|---|---|---|---|---:|---|
| Gimnasio general | `tpl_gimnasio_ventas`; membresías/clases/Agenda. | miembro/prospecto; plan/entitlement; sede; clase/capacidad; créditos; check-in; waiver; pago; congelación; renovación. | `miembro/socio/afiliado` configurable; no prometer resultados físicos. Menú: **Hoy/Check-in → Clases → Miembros → Membresías → Acceso → Cobros → Staff**. | 1/3/2/3 | Falta check-in/acceso y dunning aunque las tools cubren membresía básica. |
| CrossFit | Override `tpl_gimnasio_clases`, compartido con otros estudios. | atleta/nivel; clase; cupo; on-ramp; WOD; Rx/escalado; score/PR; coach; membresía; waiver. | `box`, `WOD`, `Rx`, `PR` solo en este subtipo y explicables. Menú: **WOD/Hoy → Clases → Atletas → Rendimiento/PR → Coaches → Membresías**. | 2/3/1/3 | La template no aporta contrato CrossFit ni registro de rendimiento. |
| Yoga / Pilates | Mismo template de clases. | modalidad/estilo; nivel; instructor; sala; mat/reformer/puesto; cupo/waitlist; pase/créditos; accesibilidad; waiver. | No mezclar vocabulario de yoga con Pilates ni usar afirmaciones médicas. Menú: **Horarios/mapa → Clases/talleres → Miembros → Instructores → Salas/equipos → Pases**. | 2/3/1/3 | Reformer y puesto son recursos concurrentes no modelados. |
| Cycling | Mismo template de clases. | clase; instructor; bicicleta/puesto; preferencia; waitlist; zapatos/talla; membresía; mantenimiento/bloqueo. | `rider` opcional, no obligatorio; `cadencia/resistencia` solo si el tenant lo usa. Menú: **Horarios/mapa de bicicletas → Riders/miembros → Bicicletas → Instructores → Membresías → Check-in**. | 2/3/1/3 | Reserva de clase sin bicicleta específica puede sobreasignar capacidad. |
| Artes marciales | Mismo template de clases. | disciplina; edad/tutor; nivel/cinturón; clase elegible; instructor; asistencia; currículo; evaluación; waiver; membresía. | `dojo/sensei` solo para disciplinas japonesas; `alumno/practicante` neutral. Menú: **Clases → Alumnos/familias → Asistencia → Grados/habilidades → Evaluaciones → Membresías**. | 2/3/1/3 | Las tools genéricas no modelan grado, elegibilidad ni progreso. |

### 5.14 Seguros

| Subtipo | Prompt/plantilla actual | Variables mínimas que faltan gobernar | Lenguaje y menú objetivo | P/V/L/N | Alerta |
|---|---|---|---|---:|---|
| Broker | Override nominal `tpl_seguros_cotizador`, igual al default; tools de seguros. | jurisdicción/licencia; prospecto/asegurado; ramo; riesgo; carriers; cotización y timestamp; coberturas; deducible; prima; vigencia; renovación; claim; autoridad. | Distinguir corredor/broker/agente/productor según país. Menú: **Cuentas/asegurados → Cotizaciones → Pólizas → Renovaciones → Siniestros → Compañías/documentos/comisiones**. | 1/3/1/2 | El override bloquea metas alternativas sin aportar template distinto. |
| Aseguradora | Mismo template de broker/cotizador. | producto/reglas versionadas; applicant/risk; underwriting; autoridad; transacción de póliza; billing; claim/reserva; fraude; reaseguro; auditoría. | `tomador`, `asegurado`, `suscripción`, `endoso`; no hablar como intermediario. Menú: **Suscripción → Pólizas → Facturación → Siniestros → Producto/tarificación → Riesgo/fraude → Reaseguro**. | 0/1/0/1 | `STOP/SOR`: imposible sin PAS, billing, claims y autoridad carrier. |
| Vida | Default cotizador. | solicitante/asegurado/tomador; beneficiarios; producto; cobertura/plazo; prima; ilustración versionada; evidencia; underwriting; emisión; vigencia; claim. | No usar “beneficiario” como sinónimo de asegurado; explicar términos. Menú: **Solicitudes → Ilustraciones → Suscripción/evidencia → Pólizas → Beneficiarios → Servicio/siniestros**. | 1/2/1/2 | Requiere consentimientos, licencias y SoR de carrier/broker. |
| Auto | Default cotizador. | conductor; vehículo/VIN/placa; uso; jurisdicción; cobertura/deducible; cotización; vigencia; endoso; FNOL; fotos; ajustador/taller; claim state. | `siniestro/reclamo/claim`, `deducible/franquicia`. Menú: **Cotizaciones → Pólizas → Vehículos/conductores → Siniestros/FNOL → Inspecciones → Renovaciones**. | 1/3/1/2 | El módulo genérico no representa objetos de riesgo ni FNOL completo. |
| Salud | Default cotizador. | afiliado/miembro; dependientes; plan; elegibilidad; vigencia; beneficios/límites; red; autorización; claim/EOB; reembolso; verificación/consentimiento. | `EPS`, `prepagada`, `obra social` solo por país; `afiliado/miembro`. Menú: **Afiliados → Planes → Elegibilidad/beneficios → Red → Autorizaciones → Reclamaciones/reembolsos**. | 1/2/0/2 | Alto riesgo de privacidad y respuesta de cobertura obsoleta. |

### 5.15 Servicios del hogar

Todos usan la misma plantilla `tpl_hogar_cotizador` y el mismo objeto `service_request`; el slug no cambia prompt, formulario, tool ni menú. La superficie Solicitudes es una buena base, pero faltan cotización, despacho, trabajo, factura y pago. Jobber muestra el flujo mínimo separado **Solicitud → Cotización → Trabajo → Factura → Pago** ([workflow oficial](https://help.getjobber.com/en/articles/jobber-workflow-overview/)).

| Subtipo | Variables y límites propios que faltan | Lenguaje y menú objetivo | P/V/L/N | Alerta |
|---|---|---|---:|---|
| Plomería | dirección; fuga/obstrucción/artefacto; severidad; corte de agua seguro; fotos; ETA; técnico; estimate; material; estado. | `plomero/fontanero/gasfiter`. **Solicitudes → Despacho → Trabajos → Cotizaciones → Clientes/inmuebles → Repuestos → Facturas**. | 1/2/1/3 | Preguntas de seguridad deben ser deterministas. |
| Electricidad | dirección; apagón/chispa/olor/calor; circuito/tablero; riesgo; fotos; licencia; permiso; ETA; estimate. | `electricista`, `breaker/interruptor/disyuntor`. **Triage → Despacho → Trabajos/inspecciones → Cotizaciones → Técnicos/certificaciones → Compliance**. | 1/2/1/3 | No guiar reparaciones peligrosas por chat. |
| Fumigación | propiedad/unidades; señales/plaga; extensión; niños/mascotas; inspección; recurrencia; ruta; técnico/licencia; químico/lote; reporte. | `fumigación/control de plagas`; no confirmar especie sin inspección. **Rutas → Sitios/clientes → Programas → Inspecciones/trabajos → Técnicos → Químicos/compliance**. | 1/2/1/3 | Regulación y químicos requieren trazabilidad. |
| Limpieza | tipo de sitio; habitaciones/área; alcance/checklist; frecuencia; ventana; cuadrilla; acceso; insumos; mascotas; precio; QA. | `aseo/limpieza`, `empleada` no debe ser rol genérico. **Agenda/Despacho → Trabajos recurrentes → Sitios → Cuadrillas → Checklists → Cotizaciones → QA**. | 1/2/1/3 | Accesos/llaves son datos sensibles. |
| Jardinería | zonas/medidas; servicio; temporada/clima; recurrencia; ruta; cuadrilla/equipo; materiales; estimate; fotos; costo. | `jardinería/paisajismo`, `césped/pasto/grama`. **Rutas → Propiedades → Programas/trabajos → Presupuestos → Cuadrillas/equipos → Materiales**. | 1/2/1/3 | Capacidad, clima y rutas no están modelados. |
| Cerrajería | ubicación; tipo de cerradura; urgencia; identidad; evidencia de autoridad; ocupación/propiedad; técnico; ETA; estimate; audit log. | `cerrajero`, `apertura`, `control de acceso`; nunca dar bypass. **Cola urgente → Despacho → Trabajos → Verificación/auditoría → Técnicos → Facturas**. | 1/2/1/3 | `SEC`: verificar autoridad antes de ejecutar cuando corresponda. |
| Pintura | áreas/medidas; superficie/estado; preparación; capas/acabado/color; fotos; cuadrilla; tiempo; materiales; estimate; cambios/hitos. | `pintor`, `presupuesto/cotización`, unidades regionales. **Solicitudes → Presupuestos → Proyectos/calendario → Cuadrillas → Materiales → Cambios → Facturas**. | 1/2/1/3 | Un request simple no cubre proyecto, avance ni change order. |

### 5.16 Pet services

| Subtipo | Prompt/plantilla actual | Variables mínimas que faltan gobernar | Lenguaje y menú objetivo | P/V/L/N | Alerta |
|---|---|---|---|---:|---|
| Peluquería | `tpl_pet_atencion`; label-only, hereda servicios que mezclan grooming, guardería y hotel. | mascota; raza/tamaño/manto; conducta/salud; vacunas por política; preferencia/foto; servicio/add-ons; groomer; duración; depósito. | `responsable/tutor`, no `papá perruno` ni `peludo` por defecto. Menú: **Grooming board/Agenda → Mascotas/clientes → Staff/recursos → Servicios → Vacunas/formularios → Caja**. | 1/2/1/2 | Seed y prompt mezclan tres negocios. |
| Guardería | `tpl_sales` + reglas nativas; lectura de cupo usa fuente distinta de la UI y no hay writer. | fecha/franja; mascotas; evaluación; vacunas; grupo compatible; espacio/capacidad viva; alimentación/medicación; contacto; acuerdo; pago/status. | `guardería de día`, `ingreso/salida`, `cupo`; evitar humanizar en exceso. Menú: **Hoy/check-in-out → Reservas → Mascotas → Espacios/capacidad → Evaluaciones/vacunas → Tareas/reportes → Paquetes**. | 3/2/2/1 | `P0 SOR/WRITER`: puede informar cupo falso y no cerrar reserva. |
| Hotel | `tpl_sales` + reglas nativas; mismo rental genérico, sin writer. | fechas/noches; mascota(s); alojamiento/capacidad; entrada/salida; alimentación/medicación; vacunas/conducta; extras; contacto/vet; acuerdo; depósito/pago. | `hospedaje/estadía`, `suite/kennel` solo si tenant lo usa. Menú: **Ocupación/calendario → Reservas → Llegadas/salidas → Alojamientos → Mascotas/clientes → Tareas de cuidado → Pagos**. | 3/2/2/1 | No confundir alquiler de recurso con una ficha de cuidado. |
| Paseos | Default Pet; label-only y hereda catálogo de servicios incorrecto. | ubicación/ventana; mascota; duración/recurrencia; paseador/backup; acceso sensible; conducta; GPS/consentimiento; reporte/media; estado/factura. | `paseador`, `visita`, `ventana`; no decir guardería/hotel. Menú: **Agenda/rutas → Solicitudes → Mascotas/clientes → Staff → Acceso seguro → GPS/evidencia → Facturas**. | 1/1/0/2 | No hay rutas, GPS, series ni custodia de llaves. |
| Adiestramiento | Default Pet; label-only y servicios heredados incorrectos. | objetivo conductual; riesgo de mordida; evaluación; programa/prerrequisitos; entrenador; formato; paquete; progreso/tareas; consentimiento. | `adiestramiento/entrenamiento`, no garantizar resultado. Menú: **Evaluaciones → Agenda → Mascotas/clientes → Programas/paquetes → Entrenadores → Progreso/tareas → Facturas**. | 1/1/1/2 | Requiere evaluación, programa y progreso, no cita aislada. |

### 5.17 Fotografía y eventos

| Subtipo | Prompt/plantilla actual | Variables mínimas que faltan gobernar | Lenguaje y menú objetivo | P/V/L/N | Alerta |
|---|---|---|---|---:|---|
| Estudio | `tpl_foto_reservas`; packages pueden nacer vacíos. | proyecto/sesión; cliente; fecha/duración; sala/equipo; fotógrafo; paquete/entregables; brief; contrato; anticipo/saldo; derechos; entrega. | `sesión`, `toma`, `galería`, `prueba/selección`. Menú: **Sesiones/reservas → Proyectos → Clientes → Paquetes → Estudios/recursos → Contratos/pagos → Galerías**. | 1/2/2/2 | Sin paquetes sembrados, el agente no puede ofrecer el núcleo del negocio. |
| Bodas | Override nominal al mismo template default. | pareja; fecha/venue; cobertura; timeline; equipo/segundo fotógrafo; paquete/add-ons; shot list; contrato/anticipo; entregables/plazos; derechos. | `pareja` neutral; `preboda`, `álbum`; evitar doble booking. Menú: **Proyectos de boda → Calendario → Timeline/shot list → Equipo → Contratos/pagos → Galerías/álbumes**. | 1/2/2/2 | Ser `source=subtype` no cambia el contenido efectivo. |
| Eventos | Default fotografía. | empresa/cliente; evento/venue; fecha; run of show; acreditación; cobertura; crew/equipo; privacidad; entregables/formatos; SLA; PO/facturación. | `cobertura`, `acreditación`, `entrega`; registro B2B. Menú: **Proyectos/eventos → Calendario → Clientes/empresas → Timeline → Crew/equipo → Briefs → Entrega/facturas**. | 1/2/1/2 | Sesión genérica no cubre producción ni entregables empresariales. |
| Producto | Default fotografía. | marca/campaña; SKU/lote/muestras; brief/estilo; shot specs; set/props; deadline; pruebas/revisiones; aprobación; formatos/metadatos; licencia. | `foto de producto`, `packshot`, `asset`, `retoque`; explicar términos al cliente. Menú: **Proyectos/campañas → Productos/SKUs → Briefs/shot lists → Producción → Pruebas/revisión → Assets/DAM → Derechos**. | 1/1/1/2 | El trabajo es project/DAM, no una simple fecha de sesión. |
| Wedding planner | Recibe producto fotográfico completo. | pareja; evento; invitados/RSVP; presupuesto; proveedores/contratos; checklist; pagos; timeline; floorplan/seating; diseño; permisos. | `boda/evento`, `proveedor`, `cronograma`, no “sesión/galería”. Menú: **Dashboard evento → Checklist → Timeline → Presupuesto → Proveedores → Invitados/RSVP → Seating → Contratos/pagos**. | 0/0/0/0 | `MISCLASS`: mover a Event Planning; Aisle Planner es el referente, no Pixieset. |

### 5.18 Otro

| Configuración | Prompt/plantilla actual | Variables mínimas que faltan gobernar | Lenguaje y menú objetivo | P/V/L/N | Alerta |
|---|---|---|---|---:|---|
| `otro` sin subtipo | `tpl_otro_ventas`; manifest asume catálogo/pedidos. | modelo de negocio; objeto principal y plural; estados; acciones; roles; unidad de capacidad; pago; regulación; etiquetas; sinónimos; SoR. | El tenant debe definir sustantivos, verbos y registro. Menú generado solo con módulos seleccionados y verificados. | 1/1/0/1 | No asignar comercio electrónico a todo negocio “otro”. |

## 6. Resultado cuantitativo de prompts y plantillas

De los 75 subtipos, solo **19 cambian de manera determinista** respecto del default de su vertical: 13 seleccionan otro template vertical y seis usan `tpl_sales` más reglas nativas. Esos cambios representan apenas **12 perfiles especializados compartidos**. Los otros **56/75 heredan el prompt base**. Además, cinco perfiles aparecen como resolución `source=subtype` pero apuntan al mismo template default (`casual_dining`, `abogados`, `broker`, `aseguradora`, `bodas`): bloquean la plantilla que podría resultar de las metas sin añadir contenido del subtipo.

La situación de variables es aún más severa. Trece templates contienen `requiredFields`, pero usan una estructura incompatible con el contrato que renderiza el prompt: guardan objetos como `{name:{required:true}}`, mientras el renderer espera `Record<context, RequiredField[]>` y omite los valores que no son arrays. Aun si la forma fuera correcta, toda la sección se suprime cuando Agenda está activa. En consecuencia, **ningún `requiredField` vertical actual llega al prompt efectivo**.

### 6.1 Mapa del resolver de templates actual

Hay 39 IDs de template en el catálogo y 18 políticas verticales. La tabla muestra la plantilla inicial; una personalización posterior puede cambiar el resultado y debe auditarse mediante el prompt efectivo del tenant.

| Vertical | Default | Overrides canónicos reales | Cambios por meta |
|---|---|---|---|
| Salud | `tpl_salud_recepcion` | dental→`tpl_salud_dental`; farmacia→`tpl_sales` + reglas nativas | support/reminders→`tpl_salud_seguimiento` |
| Belleza | `tpl_belleza_reservas` | ninguno canónico | sales→`tpl_belleza_productos`; `boutique` es legacy |
| Inmobiliaria | `tpl_inmobiliaria_ventas` | venta/arriendo/comercial→`tpl_inmobiliaria_listings` | support→`tpl_inmobiliaria_soporte` |
| Restaurantes | `tpl_restaurante_reservas` | rápida/dark→`tpl_restaurante_delivery`; casual apunta al mismo default | sales→delivery |
| Automotriz | `tpl_automotriz_ventas` | taller→`tpl_automotriz_servicio`; repuestos/alquiler→`tpl_sales` + reglas nativas | support→servicio |
| Turismo | `tpl_turismo_ventas` | tours→`tpl_turismo_tours`; agencia→`tpl_turismo_agencia` | support→`tpl_turismo_soporte` |
| Educación | `tpl_educacion_inscripciones` | ninguno | solo metas compatibles conservan el mismo template |
| Finanzas | `tpl_finanzas_calificador` | ninguno | support/reminders→`tpl_finanzas_renovaciones` |
| Profesionales | `tpl_legal_consulta` | abogados apunta al mismo default | support→`tpl_legal_seguimiento` |
| Retail | `tpl_retail_ventas` | ninguno | support→`tpl_retail_postventa` |
| Tecnología | `tpl_technology_ventas` | hardware→`tpl_sales` + reglas nativas | support→`tpl_technology_soporte` |
| Veterinaria | `tpl_veterinaria_clinica` | ninguno | metas compatibles conservan el mismo template |
| Gimnasios | `tpl_gimnasio_ventas` | crossfit/yoga/cycling/martial→`tpl_gimnasio_clases` | appointments→clases |
| Seguros | `tpl_seguros_cotizador` | broker/aseguradora apuntan al mismo default | support/reminders→`tpl_seguros_postventa` |
| Hogar | `tpl_hogar_cotizador` | ninguno | support→`tpl_hogar_seguimiento` |
| Pet services | `tpl_pet_atencion` | guardería/hotel→`tpl_sales` + reglas nativas | sales→`tpl_pet_tienda`; `tienda` es legacy |
| Fotografía | `tpl_foto_reservas` | bodas apunta al mismo default | support→`tpl_foto_entrega` |
| Otro | `tpl_otro_ventas` | no aplica | support→`tpl_otro_soporte` |

Los cinco overrides que apuntan al mismo default son especialmente engañosos: aparentan especificidad, pero solo hacen que el subtipo gane sobre una meta seleccionada. El tenant no ve ese conflicto.

## 7. Plantillas operativas que faltan en todos los subtipos

Cada dominio necesita mensajes asociados a una máquina de estados, no solo saludos y confirmaciones genéricas:

- disponibilidad/cotización consultada con fuente y timestamp;
- solicitud recibida, todavía no confirmada;
- hold con vencimiento;
- confirmación con referencia;
- dato, documento, consentimiento o pago pendiente;
- recordatorio y no-show;
- modificación/reprogramación;
- cancelación, política y reembolso;
- lista de espera/cupo liberado;
- estados operativos propios;
- finalización/entrega;
- recall, renovación o rebooking;
- excepción, seguridad, compliance y handoff.

Cada plantilla debe declarar `event_type`, `preconditions`, `required_variables`, `allowed_statuses`, `locale/channel_variant`, `term_map`, `cta/deep_link`, `expiry`, `authority`, `fallback_if_missing` y `audit_source`. Precio, stock, cobertura, cupo, saldo, ETA y estado nunca deben interpolarse sin dato vivo y `as_of`.

## 8. Fuentes y patrones de referencia

La matriz usa, además de los referentes del informe principal, documentación oficial de [Cloudbeds](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/16464111837211-General-Information-Cloudbeds-PMS-Menus-and-Site-Map), [Guesty](https://help.guesty.com/hc/en-gb/articles/11877241350685-Navigating-the-Guesty-dashboard), [Jobber](https://help.getjobber.com/en/articles/navigating-jobber/), [Clio](https://help.clio.com/hc/en-us/articles/10272935235099-Clio-Grow-Matters-Overview), [Shopify](https://help.shopify.com/en/manual/shopify-admin/shopify-admin-overview?links=false), [Intercom](https://www.intercom.com/help/en/articles/6436600-tickets-explained), [Rezdy](https://support.rezdy.com/hc/en-us/articles/19867757782812-How-To-Use-the-Manifest), [Glofox](https://www.glofox.com/features/), [Applied Epic](https://www1.appliedsystems.com/en-us/solutions/for-agents/agency-management-system/applied-epic), [Guidewire](https://www.guidewire.com/products/core-products), [MoeGo](https://help.moego.pet/en/articles/13864029-pet-client-experience-grooming-booking-flow), [Pixieset](https://help.pixieset.com/hc/en-us/articles/32870718673677-Getting-Started-with-Studio-Manager) y [Aisle Planner](https://integration.aisleplanner.com/).

La evidencia muestra un patrón consistente: los líderes separan el objeto que se opera varias veces al día del catálogo que lo configura y del embudo que lo vendió.
