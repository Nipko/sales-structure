# Comunicación de inteligencia y configuración de Parallly

Fecha: 14 de septiembre de 2026. Alcance: home, hub de plataforma y páginas de Agente IA, Conocimiento, Parallly Assist y Calidad.

## Diferencias que debe entender el comprador

| Superficie | Para quién y para qué | Evidencia principal |
|---|---|---|
| Agente IA | Habla con clientes usando identidad, fuentes, reglas y herramientas habilitadas para el negocio | `apps/api/src/modules/persona/persona.service.ts`; `apps/api/src/modules/conversations/prompt-assembler.service.ts`; `effective-capability.service.ts` |
| Base de conocimiento | FAQs, documentos y artículos aportan información; catálogo y políticas complementan esas fuentes desde sus propias secciones | `apps/api/kb/assistant/es/14-base-conocimiento.md`; `apps/api/src/modules/knowledge/knowledge.controller.ts`; `docs/product-capabilities-reference.md` |
| Parallly Assist | Ayuda interna para comprender la plataforma, preparar configuración y encontrar el siguiente paso permitido | `docs/platform-assistant-knowledge.md`; `apps/api/src/modules/copilot/copilot.controller.ts`; `copilot.service.ts` |
| Centro de calidad | Permite revisar preparación, pruebas y producción atribuida al agente y su versión | `apps/api/kb/assistant/es/26-centro-calidad-agente.md`; `packages/shared/src/agent-quality-contract.ts`; `docs/product-capabilities-reference.md` |

El copy presenta facilidad mediante orientación y pasos claros. No fija tiempo de implementación ni promete que el asistente configure todo sin revisión.

## Dos significados distintos de «rol»

- **Función del agente IA:** `PersonaService` admite `skillset` con `sales`, `support` y `both`; `persona.role` describe su papel. Recepción es un ejemplo de papel configurable, no una certificación de operación especializada.
- **Roles del equipo:** administrador configura y publica; supervisor revisa calidad y coordina; agente humano atiende las conversaciones y tareas permitidas. Los permisos se contrastan con `navigation-contract.ts`, los guards y la referencia de capacidades.
- Las herramientas dependen del negocio, las conexiones, la configuración y el plan. Elegir una función de ventas no habilita automáticamente cualquier operación.

## Qué hace y qué no hace la orientación

`POST /copilot/chat` autoriza administrador, supervisor y agente tenant. Su ayuda usa artículos localizados de `apps/api/kb/assistant/{es,en,pt,fr}`, rol y pantalla.
El contexto de calidad solo está disponible para administrador y supervisor. El servidor valida agente y señal y construye un resumen acotado.
Ese resumen no incluye transcripciones ni texto de clientes. Assist explica una prioridad y propone destinos autorizados; la orientación de calidad no ejecuta reparaciones.
El código también admite propuestas revisables en ciertos casos; eso no se presenta como edición automática ni publicación autónoma.
Los recorridos visuales de escritorio, cuando existen, muestran dónde realizar una tarea. No sustituyen la decisión ni el guardado de la persona autorizada.

## Preparación y publicación

Fuentes: `apps/api/kb/assistant/es/07-probar-agente.md`, `06-agentes-ia.md` y `docs/product-capabilities-reference.md`.
Guardar un agente conserva un borrador; conectar un canal no publica sus cambios. La persona autorizada prueba, revisa y aprueba la versión antes de publicarla.
Las pruebas deben interpretarse por versión, fecha y escenarios. Cambiar la configuración puede desactualizar resultados anteriores.
En producción, una muestra insuficiente limita las conclusiones. No se sustituye por cero ni se comunica como éxito.
Reconocer o posponer una señal organiza la atención; no corrige su causa. Un estado de calidad no certifica perfección ni resultados comerciales.

## Ejemplos del rediseño

- Selector de pregunta frecuente, política y catálogo: muestra pregunta, fuente ficticia y respuesta ilustrativa. No consulta datos ni llama a un modelo.
- Selector de roles y preguntas de puesta en marcha: cambia la orientación de Assist y el destino presentado para administrador, supervisor y agente.
- Selector de revisión: fuente insuficiente, pruebas desactualizadas o evidencia escasa; enlaza conceptualmente señal, orientación de Assist y revisión humana.
- Pedidos/pagos, equipo y analítica del hub tienen detalles desplegables con alcance concreto, sin enlaces a páginas inexistentes.

Los ejemplos muestran su carácter ilustrativo y el estado implementado sin certificación, reutilizando el vocabulario de `labelledDemos`.
Se conserva el registro existente de demos; ninguna ilustración se convierte en test real, caso de cliente o certificación.

## Límites de los claims

No prometer respuesta perfecta, obediencia infalible, autorreparación, ahorro medido, venta garantizada, certificación sectorial o activación instantánea.
No confundir la fuente del negocio con entrenamiento propio del modelo ni afirmar que todo contenido vive en la misma pantalla.
No presentar a Assist como el agente que habla con clientes, ni al agente humano como una función de ventas del agente IA.
No prometer calidad por correo o push: los avisos descritos viven dentro del dashboard.
No afirmar que emitir un enlace confirma un pago; la pasarela propia del comercio y la suscripción de Parallly son relaciones distintas.
La app Android mantiene acceso privado. Disponibilidad y límites dependen del catálogo y de la configuración vigente.

## Implementación editorial

Componente compartido: `apps/landing/src/components/sections/PlatformIntelligence.tsx` y su CSS Module.
Namespaces: `intelligence` y `platformHub`, con copia equivalente en español, inglés, portugués y francés.
Fragmento de integración: `drafts/intelligence-copy.json`. Este trabajo no añade tracking ni llamadas externas a las demostraciones.
