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
| Centro de calidad del agente | `agent-quality-contract.ts`, guards de `/quality/:tenantId/agents*` y `/admin/agent/quality` |
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
- **Copilot de conversación** usa
  `/copilot/:conversationId/suggestions`, `/summary`, `/intent`, `/rewrite` y `/ask`.
  Ayuda a operar un hilo autorizado; `ask` puede combinar conversación y RAG tenant.
  Los cinco endpoints tienen la misma lista explícita de roles tenant que `/chat`.

El body de `/chat` solo acepta `{message, page, locale, history}`. Nombre, rol y tenant
se derivan server-side del JWT y TenantGuard; el asistente no debe confiar en una
identidad o rol declarados dentro del mensaje.

## Cobertura obligatoria

La colección localizada debe cubrir, además de los artículos funcionales actuales:

1. Navegación nueva: grupos, búsqueda `Ctrl/Cmd+K`, favoritos, recientes,
   breadcrumbs y retorno desde Configuración.
2. Matriz real de roles y diferencia entre leer y editar.
3. Cinco planes sin fijar valores runtime en el texto.
4. Las 18 verticales, diferenciando con claridad las que aún no tienen certificación
   funcional integral.
5. App móvil y límites frente a la web.
6. Tour de configuración, incluido su comportamiento por rol y en móvil.
7. Centro de calidad por agente: tres pilares, estados, atribución por versión,
   evidencia insuficiente y diferencia entre lectura Supervisor y edición Admin.

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
