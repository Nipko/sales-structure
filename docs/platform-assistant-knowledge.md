# Conocimiento de Parallly Assist — contrato documental

_Estado: agosto de 2026_

Este documento evita una confusión importante: el manual de usuario y Parallly Assist
son dos superficies distintas. Editar `docs/user-manual.md` **no actualiza** las
respuestas del asistente.

## Fuente runtime

Parallly Assist carga artículos Markdown desde:

```text
apps/api/kb/assistant/es/*.md
apps/api/kb/assistant/en/*.md
apps/api/kb/assistant/pt/*.md
apps/api/kb/assistant/fr/*.md
```

La carga la realiza el módulo Copilot de la API. Los archivos se incluyen en la imagen
del backend, de modo que un cambio requiere build y despliegue de API; un despliegue
del dashboard por sí solo no lo publica.

## Fuentes que debe consultar cada tema

| Tema | Fuente de verdad |
|------|------------------|
| Rutas, breadcrumbs y nombres del menú | `navigation-contract.ts` + `AppSidebar.tsx` |
| Permisos | `roles.ts` + guards del controlador correspondiente |
| Configuración | `_settings-config.ts` |
| Plan vigente del tenant | Contexto de plan inyectado desde `billing_plans` |
| Vertical y herramientas | Manifest v2 y capacidades efectivas del tenant |
| Salud y calidad del agente | `agent-quality-contract.ts`, guards de `/quality/:tenantId/agents*`, `/attention-summary`, `/signals*` y `/admin/agent/quality` |
| Recorridos guiados ("Mostrarme dónde" / "Mostrarme cómo") | `packages/shared/src/guided-tour-contract.ts` (ids, ruta de entrada, rol mínimo, códigos de calidad que resuelve, artículos de KB relacionados) + `apps/dashboard/src/lib/guided-tours.ts` (pasos y anclajes reales de cada pantalla) |
| Etapa de onboarding y tarjeta de puesta en marcha | `packages/shared/src/onboarding-stage-contract.ts` (`OnboardingStage` + `resolveOnboardingGuide`), `tenant.settings.onboardingStage` y `components/InitialSetupCard.tsx` |
| Manual narrativo tenant | `docs/user-manual.md` como apoyo editorial, no como fuente runtime |
| App móvil | `docs/mobile-user-manual.md` contrastado con `apps/mobile/src` |

El contexto dinámico de plan prevalece sobre cualquier ejemplo estático incluido en
un artículo. Los artículos no deben duplicar precios o cuotas que puedan cambiar en
el panel de planes.

## Alcance actual

- Los artículos existentes están orientados a usuarios de un tenant.
- El componente puede estar presente en el layout administrativo, pero
  `POST /copilot/chat` autoriza explícitamente `tenant_admin`, `tenant_supervisor` y
  `tenant_agent`. Excluye `tenant_viewer`; `super_admin` no usa ese chat en modo
  plataforma y solo entra al contexto tenant mediante el flujo de impersonación
  autorizado.
- No existe una colección runtime equivalente para operaciones de plataforma; esos
  flujos se documentan en runbooks y documentación humana.
- No se debe inferir acceso por el solo hecho de conocer una URL: toda respuesta debe
  respetar rol, impersonación, vertical y plan.

## Parallly Assist y Copilot contextual

Son dos usos del mismo módulo, con fuentes y objetivos diferentes:

- **Parallly Assist** llama `POST /api/v1/copilot/chat`. Orienta sobre la plataforma
  usando la KB localizada y contexto tenant/rol/vertical; el detalle de plan se
  agrega solo para Tenant Admin.
- **Coach contextual de calidad** usa el mismo `/copilot/chat` con un `target`
  opcional `agent_quality`, únicamente para Admin/Supervisor. El servidor vuelve a
  validar agente y señal dentro del tenant y construye un resumen acotado del estado
  vigente; no confía en datos de calidad escritos en el mensaje.
- **Copilot de conversación** usa
  `/copilot/:conversationId/suggestions`, `/summary`, `/intent`, `/rewrite` y `/ask`.
  Ayuda a operar un hilo autorizado; `ask` puede combinar conversación y RAG tenant.
  Los cinco endpoints tienen la misma lista explícita de roles tenant que `/chat`.

El body de `/chat` acepta `{message, page, locale, history,target?}`. `target`, cuando
existe, solo admite `{kind:"agent_quality",agentId,signalId?}` con UUIDs válidos y no
está disponible para Tenant Agent. Nombre, rol y tenant se derivan server-side del JWT
y TenantGuard; el asistente no debe confiar en una identidad, rol o evidencia de
calidad declarados dentro del mensaje.

El contexto de calidad inyectado al modelo contiene códigos y agregados: versión,
estado, siguiente hito, bloqueadores codificados, vigencia de pruebas, muestra actual
y mínima, gravedad, pilar, dimensión y conteos. Excluye nombre del agente como
instrucción, transcripciones, texto de clientes, IDs de conversación, prompts, texto
libre del juez, consultas de recuperación, fingerprints, actores y secretos. La
respuesta solo puede explicar una prioridad y devolver rutas internas validadas;
nunca confirma una edición ni ejecuta el cambio.

## Cobertura obligatoria

La colección localizada debe cubrir, además de los artículos funcionales actuales:

1. Navegación nueva: grupos, búsqueda `Ctrl/Cmd+K`, favoritos, recientes,
   breadcrumbs y retorno desde Configuración.
2. Matriz real de roles y diferencia entre leer y editar.
3. Cinco planes sin fijar valores runtime en el texto.
4. Las 18 verticales, diferenciando con claridad las que aún no tienen certificación
   funcional integral.
5. App móvil y límites frente a la web.
6. Tour de configuración y la tarjeta Puesta en marcha esencial que reemplaza la
   antigua pastilla flotante de progreso, incluido su comportamiento por rol y plan.
7. Salud y Centro de calidad por agente: visibilidad en Inicio/Insights, badge solo
   Críticas+Altas abiertas, aviso global crítico/En riesgo con posposición, tres
   pilares, estados, atribución por versión, evidencia insuficiente y diferencia entre
   lectura Supervisor y edición Admin.
8. Coach contextual de calidad: contexto server-side acotado, privacidad, revisión
   humana y ausencia de autoedición o comunicaciones externas.
9. Orden real del onboarding: alta → asistente de bienvenida de 4 pasos → asistente
   "Conocé a tu agente" de 3 pasos (el paso 1 confirma el agente ya derivado de la
   industria, no elige plantilla) → verificación de correo no bloqueante; "Conectar
   después" queda registrado y se recuerda desde Inicio; el asistente se reabre desde
   **Configuración → Asistente de configuración**.
10. Recorridos guiados: qué hace **Mostrarme dónde/cómo**, que es de solo lectura, que
    corre en escritorio y que Admin ve los de edición mientras Supervisor ve los de
    revisión; y la barra de contexto que muestra la pantalla destino tras **Revisar**.
11. Diferencia entre asignación, conexión y credencial de un canal: qué bloquea al
    agente (`channel_connection`) y qué solo advierte (`channel_coverage`), más el
    estado "Conectado, pero requiere reautorizar".

## Reglas editoriales

- Mantener el mismo ID de artículo en `es`, `en`, `pt` y `fr`.
- Usar rutas registradas; las rutas vacías solo son válidas para orientación sin una
  pantalla directa.
- Separar acciones admin-only de acciones supervisor/agent aunque compartan artículo.
- No usar nombres históricos como “Gestión”, “Crecimiento” o “Integraciones y
  alertas” como ubicación actual del menú.
- No afirmar aprobación de Play Store, certificación vertical ni disponibilidad de
  una integración sin evidencia vigente.
- No presentar un estado o puntaje del Centro de calidad como certificación, garantía
  comercial o permiso para publicar sin revisión; tampoco prometer autoedición de
  prompts, políticas o conocimiento.
- No describir el badge como un score: cuenta solo señales Críticas y Altas abiertas.
  Posponer o reconocer administra la atención, no resuelve la causa.
- No prometer correo ni push para Salud de agentes. La superficie proactiva vigente es
  interna del dashboard.
- No prometer que un recorrido guiado cambia configuración. Abre la pantalla y resalta
  dónde se hace el cambio; la persona lo hace y lo guarda.
- No describir la barra de contexto como una notificación: es parte de la pantalla
  destino, derivada de los parámetros `qa`/`qagent` que agrega **Revisar**.
- No describir un número de prueba o sandbox de WhatsApp como ruta de conexión. Las
  rutas certificadas son coexistencia (recomendada), número nuevo y migración.
- No incluir transcripciones, datos de clientes, IDs de conversación, prompts, texto
  libre del juez, consultas RAG, secretos ni actores de una señal en el contexto de
  Parallly Assist.
- No prometer como operativo un control que la KB marca `no certificado`; las
  limitaciones de pipeline, campañas, calendario, drip, CSAT, Email y triggers deben
  mantenerse coherentes en todos los artículos que las mencionen.
- Para datos regulados o decisiones sensibles, describir límites y handoff humano.

## Flujo de actualización y publicación

1. Cambiar los cuatro locales en el mismo PR.
2. Validar frontmatter, IDs, roles, enlaces/rutas y términos retirados.
3. Comparar contra `docs/user-manual.md` y
   `docs/product-capabilities-reference.md`.
4. Ejecutar las pruebas de Copilot/KB disponibles.
5. Construir la imagen de API y desplegarla.
6. Probar Parallly Assist con una cuenta por rol y, cuando aplique, por vertical.

## Validaciones recomendadas

El repositorio debe mantener una prueba que falle si:

- falta un artículo en alguno de los cuatro idiomas;
- el frontmatter usa un rol desconocido;
- una ruta no pertenece al contrato de navegación;
- reaparecen etiquetas históricas;
- falta un tema obligatorio;
- un artículo contradice el bloque dinámico de plan.

Esta política documenta el mecanismo y debe revisarse junto con los artículos runtime
en cada cambio de navegación, roles, planes, verticales o alcance móvil.
