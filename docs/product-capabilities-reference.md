# Referencia de capacidades del producto

_Estado documental: agosto de 2026_

Esta referencia explica qué parte de Parallly puede esperar cada tipo de usuario y
cómo se decide qué aparece en web y móvil. No es una promesa comercial ni una
certificación de extremo a extremo. Cuando una pantalla, un plan o una integración
difiera de este texto, prevalecen los contratos de código y la configuración vigente
indicados abajo.

## Fuentes de verdad

| Tema | Autoridad vigente |
|------|-------------------|
| Navegación y rutas web | `apps/dashboard/src/lib/navigation-contract.ts` |
| Acceso por rol | `apps/dashboard/src/lib/roles.ts` y `navigation-access.ts` |
| Orden del menú | `apps/dashboard/src/components/layout/AppSidebar.tsx` |
| Hub de Configuración | `apps/dashboard/src/app/admin/settings/_settings-config.ts` |
| Capacidades verticales | `packages/shared/src/vertical-capability-manifest.ts` |
| Estado de certificación vertical | `packages/shared/src/vertical-product-policy.ts` |
| Workspace móvil | `apps/mobile/src/lib/verticalWorkspace.ts` |
| Acciones móviles por rol | `apps/mobile/src/lib/verticalOperationPolicy.ts` |
| Límites y precios de planes | Filas activas de `billing_plans`; el seed solo es un valor inicial |
| Ayuda de Parallly Assist | `apps/api/kb/assistant/{es,en,pt,fr}` cargada por la API |
| Calidad de cada agente IA | `packages/shared/src/agent-quality-contract.ts`, endpoints `/quality/:tenantId/agents*` y ruta `/admin/agent/quality` |

## Superficies del producto

| Superficie | Alcance |
|------------|---------|
| Web tenant | Configuración completa del negocio, canales, agentes IA, CRM, operación, analítica y facturación según rol/plan |
| App móvil | Compañera operativa: inbox, CRM, pipeline, tareas, disponibilidad y workspace vertical seguro; no replica toda la administración web |
| Consola de plataforma | Operación cross-tenant para `super_admin`; separada de los workspaces tenant salvo impersonación explícita |
| Portal público | Reserva, base de conocimiento y otras experiencias públicas habilitadas por el tenant |

## Canales y superficies conversacionales

| Superficie | Estado verificable |
|------------|--------------------|
| WhatsApp, Instagram, Messenger y Telegram | Canales conversacionales con flujos de conexión administrados desde la plataforma, sujetos a rol, plan y configuración vigente |
| Web Chat Widget | Superficie conversacional operativa con configuración, snippet público, sesiones y mensajería por Socket.IO |
| Email | Adaptador e ingreso técnico interno para integraciones administradas; la pantalla `/admin/channels/email` no tiene hoy handlers de lectura/escritura por tenant y **no es una configuración autoservicio certificada** |
| SMS | Producto separado de notificaciones salientes por créditos; no es un canal conversacional |

La existencia de un adaptador, una tabla o una pantalla no certifica por sí sola un
flujo de conexión. En particular, no se debe prometer conexión, envío, recepción en
Inbox ni respuesta automática por Email hasta que exista y se valide el contrato de
configuración de extremo a extremo.

## Roles tenant

| Capacidad | Admin | Supervisor | Agent |
|-----------|:-----:|:----------:|:-----:|
| Inbox, contactos, pipeline y citas | Sí | Sí | Sí |
| Operaciones de dominio permitidas | Sí | Sí | Según página/acción |
| Ver base de conocimiento | Sí | Sí | Sí, lectura |
| Editar base de conocimiento y FAQs | Sí | Sí | No |
| Automatización, campañas y analítica tenant | Sí | Sí | No |
| Ver el Centro de calidad de cada agente IA | Sí | Sí | No |
| Configurar etapas, scoring, macros, media y pre-chat | Sí | Sí | No |
| Agentes IA, conexiones de canales, empresa e integraciones | Sí | No | No |
| Usuarios, facturación, políticas, recall y API keys | Sí | No | No |
| Preferencias personales, seguridad, notificaciones y apariencia | Sí | Sí | Sí |

La fila de campañas describe acceso a la superficie de borradores, audiencia y
métricas. El lanzamiento WhatsApp/Email y la programación desde el editor no están
certificados de punta a punta en la versión actual; una campaña programada tampoco
tiene acción operativa de cancelación. No debe presentarse como envío de producción
hasta cerrar esos contratos.

`super_admin` usa la consola de plataforma. Para operar dentro de un tenant debe
entrar mediante impersonación; el acceso no se hereda de forma implícita.

`tenant_viewer` existe como compatibilidad para cuentas heredadas y solo conserva el
hub de Configuración y preferencias personales. No aparece como opción normal al
invitar o editar miembros.

> La capacidad interna `canSeeOwnPerformance` existe para el rol Agent, pero la
> página `/admin/agent-analytics` está protegida para Admin/Supervisor. Hasta que
> producto y código unifiquen ese contrato, no se debe prometer al agente acceso a
> esa página.

El **Centro de calidad del agente** (`/admin/agent/quality`) es una superficie de
lectura para Admin/Supervisor. Separa preparación, pruebas repetibles y evidencia de
producción atribuida al agente y a su versión vigente. Sus estados y recomendaciones
son señales de diagnóstico: no certifican perfección, no garantizan resultados y no
modifican automáticamente el agente ni el conocimiento. El editor de agentes sigue
siendo exclusivo de Admin.

## Navegación web

El menú tenant prioriza el trabajo diario y agrupa los destinos en:

1. **Esenciales**: Inicio, Conversaciones y CRM.
2. **IA y crecimiento**: Agente IA, Procedimientos, Base de conocimiento,
   Automatización y Campañas, según rol.
3. **Operación**: destinos derivados de la vertical, subtipo y capacidades
   efectivas del tenant.
4. **Insights**: analítica, rendimiento, Centro de calidad, atribución e informes.
5. **Administración**: canales, usuarios, cumplimiento, facturación y solicitudes.
6. **Configuración**: zona estable al fondo, con retorno seguro a la página de origen.

`Ctrl/Cmd+K` abre la búsqueda global. Favoritos, recientes, breadcrumbs y atajos se
filtran por el mismo contrato de acceso; no deben revelar rutas incompatibles con el
rol o la vertical.

## Planes

Parallly reconoce cinco familias de plan: **Emprendedor, Starter, Pro, Enterprise y
Custom**. Precios, cuotas y features se administran en runtime, por lo que los
valores mostrados en **Configuración → Facturación** son los aplicables a la cuenta.
Las tablas de seeds o documentos fechados son referencias de fábrica, no una fuente
contractual de límites vigentes.

## Matriz de las 18 verticales

Las 18 verticales están implementadas en el manifiesto v2, pero su estado de producto
es **`implemented_not_certified`**: existe comportamiento respaldado por código, sin
certificación E2E completa ni autorización para prometer paridad total con referentes
del sector. La pantalla exacta depende del subtipo, capacidades publicadas, rol y plan.

| ID canónico | Nombre | Base funcional / operación principal |
|-------------|--------|--------------------------------------|
| `salud` | Salud | CRM, FAQs, agenda; tratamientos cuando la capacidad está habilitada |
| `moda_belleza` | Moda y belleza | CRM, agenda o pedidos para subtipos de catálogo |
| `inmobiliaria` | Inmobiliaria | CRM, agenda y listings |
| `restaurantes` | Restaurantes | Menú, pedidos y reservas |
| `automotriz` | Automotriz | Inventario vehicular; agenda, pedidos o alquiler según subtipo |
| `turismo` | Turismo | Tours o estadías/propiedades según subtipo |
| `education` | Educación | Cursos, cohortes e inscripciones |
| `finanzas` | Finanzas | Preset horizontal de CRM, FAQs y agenda; sin decisiones financieras automatizadas |
| `servicios_profesionales` | Servicios profesionales | CRM, FAQs, agenda y consulta de casos cuando esté publicada |
| `retail` | Retail | Catálogo, inventario y pedidos |
| `technology` | Tecnología | CRM y agenda; pedidos para hardware cuando corresponda |
| `veterinaria` | Veterinaria | Agenda y fichas de mascotas |
| `gimnasios` | Gimnasios | Membresías, clases y reservas |
| `seguros` | Seguros | Planes, cotizaciones, pólizas y reclamos con controles de rol |
| `servicios_hogar` | Servicios del hogar | Solicitudes y despacho operativo |
| `pet_services` | Servicios para mascotas | Agenda o hospedaje según subtipo |
| `fotografia` | Fotografía | Sesiones fotográficas y seguimiento de entrega |
| `otro` | Otro | Fallback genérico de CRM, catálogo y pedidos |

### Qué significa `implemented_not_certified`

- Sí puede documentarse el flujo que existe y su ruta actual.
- No debe afirmarse que la vertical está completa, certificada, regulatoriamente
  validada o que reemplaza todas las herramientas especializadas del sector.
- Finanzas, tecnología y servicios profesionales operan como presets horizontales
  mientras no se implemente y certifique un ciclo de dominio más profundo.
- Las anclas iniciales de certificación —restaurantes, turismo y servicios del
  hogar— siguen sin estar certificadas hasta contar con evidencia E2E protegida.

## Relación web–móvil

La API publica `manifestVersion` y `effectiveCapabilities`. La app móvil resuelve a
partir de esos datos un único workspace operativo seguro: agenda, estadías, tours,
restaurante, pedidos, clases, educación, seguros, solicitudes, sesiones, alquiler de
vehículos, hospedaje de mascotas o ninguno. Una lista explícita de capacidades vacía
produce **sin workspace**, no un fallback permisivo.

Las operaciones de creación y cambios de estado se vuelven a filtrar por rol y estado.
La ausencia de un botón en móvil no implica que el módulo no exista en web; puede ser
una decisión de seguridad o de alcance de la app compañera.

## Mantenimiento

Al cambiar navegación, roles, planes o verticales se deben revisar conjuntamente:

1. Este documento y `docs/user-manual.md`.
2. `docs/mobile-user-manual.md` si cambia la superficie móvil.
3. `docs/API_REFERENCE.md` y `docs/modules-reference.md` si cambia API o inventario.
4. La base runtime del asistente según `docs/platform-assistant-knowledge.md`.
