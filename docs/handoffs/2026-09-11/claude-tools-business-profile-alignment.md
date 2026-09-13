# Addendum de ejecución: herramientas, 76 tipos de negocio y Assist

## Mandato y relación con el cierre en curso

Integra este frente en el cierre descrito en
[claude-parallel-execution-addendum.md](./claude-parallel-execution-addendum.md)
y [claude-whatsapp-runtime-and-release-local-closure-v2.md](./claude-whatsapp-runtime-and-release-local-closure-v2.md).
No reemplaza el trabajo de durabilidad, economía de WhatsApp, identidad ni cutover.
La configuración y el runtime deben describir y ejecutar las mismas operaciones.

El usuario autorizó corregir y construir lo necesario, priorizando la plataforma
completa sobre mantener comportamientos anteriores. No preservar opciones que
no hacen nada para aparentar compatibilidad. Si hace falta migrar una intención
guardada, producir inventario, transformación explícita y verificación; nunca
inventar permisos, consentimiento, pagos ni resultados comerciales.

El punto de partida de esta auditoría fue
`96ee640e40884742371889f19f916d1e80d9ed70`. Hubo commits concurrentes del frente de
mensajería durante el trabajo. Consultar los hashes de fuente de la
[matriz derivada](../../audits/2026-09-11/tool-profile-audit.json), los commits de
este addendum y el HEAD efectivo antes de continuar. No repetir fixes ya presentes.
No usar un rango que mezcle trabajo concurrente como prueba de autoría.

Conservar cambios ajenos; asignar archivos exclusivos a cada agente; commits
incrementales con paths explícitos. Mantener sin push, merge, despliegue,
activación de enforce, llamadas a proveedores ni gasto hasta la autorización
correspondiente. Un bloqueo externo no impide cerrar los puntos locales de abajo.

La [verificación](../../audits/2026-09-11/tool-profile-validation.md) registra
las corridas finales y una incidencia de sintaxis de la edición concurrente que
ya se corrigió antes de repetir el typecheck frío. No atribuir a esta auditoría
los cambios hechos por el otro frente.

## Contrato de producto que se debe completar

El catálogo actual contiene **20 verticales, 76 perfiles de tipo de negocio,
27 familias configurables y 123 herramientas estáticas**. La vertical es una
agrupación; el subtipo decide sus operaciones. No reducir el trabajo a 20 casos
representativos ni usar etiquetas históricas de 18 verticales como universo.
MCP es dinámico y necesita su propia evidencia.

Para cada perfil y cada herramienta debe poder recorrerse:

`misión → herramienta necesaria → permiso guardado → plan/rol/conexión → datos o proveedor → ejecución → efecto confirmado → explicación al cliente → evidencia → diagnóstico/Assist`.

La autoridad de ejecución sigue en backend. Menú, interruptor y texto de Assist
son proyecciones de esa autoridad. Una lectura disponible no autoriza una escritura;
una reserva interna no demuestra una operación aceptada por un proveedor; una
respuesta convincente no demuestra un resultado de negocio.

No activar todas las herramientas por defecto. El editor debe recomendar las
necesarias para la misión y explicar para cada una: qué resuelve, requisitos,
acciones de lectura/escritura, quién administra sus datos, coste cuando corresponda,
confirmación necesaria, estado actual, siguiente acción y prueba disponible.

## Correcciones ya implementadas en esta auditoría

No contarlas como pendientes de implementación; sí conservar sus regresiones.

- El editor deriva familias especializadas del perfil canónico. Una familia
  incompatible guardada queda disponible sólo para apagarla. Pagos requiere
  información vigente del plan; la consulta queda ligada al tenant y descarta
  respuestas tardías de otra cuenta. Los valores por defecto de los permisos
  específicos coinciden con el runtime.
- Catálogo de servicios vuelve a ser accesible para los 14 perfiles que lo
  declaran. La prueba de navegación recorre las rutas de los 76 perfiles.
- Toast, Mindbody y Cliniko respetan la familia y el subtipo del agente. Desactivar
  la familia no devuelve la autoridad al writer local desplazado. Si no se puede
  conocer la propiedad del proveedor, se retiran esos writers, conservando las
  operaciones independientes. El CTA de pagos lleva a su integración real.
- Reconsultar el diagnóstico relee la preparación e invalida su caché por
  generación de tenant. Una consulta antigua en vuelo no puede devolver datos
  obsoletos a la generación vigente.
- Las explicaciones de herramientas resuelven exclusiones por herramienta y
  familia canónica, y consideran todos los canales asignados, incluido uno no
  legible. La evidencia de una prueba negativa aislada ya no certifica la tarea.
- Se añadió ayuda de configuración por tipo de negocio a la KB de Assist en
  es/en/pt/fr. No confundir esta actualización con terminar todos los tours.

La [auditoría](../../audits/2026-09-11/tools-business-profile-review.md) delimita
qué se probó. Los contadores estructurales no certifican operaciones.

## T1 — Permisos completos y controles que producen un efecto

**Prioridad alta, local.** Derivar inventario de todas las propiedades configurables,
incluidos flags anidados y MCP: definición → persistencia/validación → editor →
Assist → consumidor productivo → resultado observable. No basta encontrar el nombre
de una propiedad en un archivo o que un mock devuelva true.

1. Exponer o explicar coherentemente `catalog.canCheckStock` y
   `ecommerce.canRecommend`: el backend los respeta, pero faltan controles específicos
   en el editor. Mantener los valores por defecto del contrato y probar guardar,
   releer y ejecutar con cada permiso encendido y apagado.
2. Resolver los controles `emailConfirmations` sin consumidor de estas 11 familias:
   `orders`, `treatments`, `realEstate`, `pets`, `restaurants`, `gyms`, `education`,
   `insurance`, `homeServices`, `petServices`, `photography`. Decidir por familia
   qué evento produce la confirmación, canal, destinatario, consentimiento y
   autoridad. Implementar el camino o retirar la promesa y comunicar su ausencia.
   No conectar todos a un correo genérico que no representa la operación.
3. Auditar también los flags tipados sin control visible: `vehicles`,
   `vehicleRentals`, `petBoarding`, `repairOrders`. Elegir un contrato común de
   notificaciones si eso evita duplicar lógica sin uso. Debe ser comprensible
   para un dueño de negocio.
4. Los consumidores existentes de appointments/properties/tours consultan en
   varias rutas `agent_personas WHERE is_active = true LIMIT 1`. Sustituir esa
   elección por la autoridad del agente y conexión de origen. Para acciones
   humanas/schedulers, definir política explícita; no inventar un agente. Coordinar
   con el frente de productores durables de Claude antes de editar estos archivos.
5. `canApplyDiscount` no debe autorizar si `ecommerce.enabled=false`. Hoy el
   proveedor productivo de pagos no implementa descuentos; no declarar el control
   operable por existir handler/política. Igual para refund: definir autorización,
   procedimiento, proveedor real y resultado, o mostrar honestamente no disponible.
6. Decidir y probar el alcance de herramientas MCP aprobadas por tenant frente al
   agente concreto. No asumir que todos los agentes deben recibir toda herramienta
   aprobada. No ampliar permisos por instrucciones, contenido recuperado o chat aprendido.

**Aceptación:** cada control visible modifica una conducta verificable del agente
correcto. Toggles desactivados, downgrade, cambio de subtipo, revocación y errores
de dependencias no producen efectos. Dos agentes con configuración opuesta no
heredan permisos ni notificaciones entre sí.

## T2 — Preparación y resolución guiada que cierran el bloqueo real

**Prioridad alta, local.** Mantener el refresco ya implementado. Conectar invalidación
a las escrituras pertinentes cuando sea necesario; fuera del diagnóstico explícito
puede seguir existiendo el TTL de 120 segundos. Auditar cada readiness contra el
predicado real de su herramienta: activo, disponibilidad, capacidad, precio/moneda,
propiedad del dato y relación con la cuenta; contar una fila cualquiera no basta.

Mostrar por herramienta sus requisitos y los de su tarea completa, sin copiar todos
los bloqueos del tenant a todas las tarjetas. Distinguir falta de datos de error de
lectura. Una cuenta sin capacidad no está lista sólo porque tenga un servicio.

Para cada resolución F2 ejecutar bloqueo → propuesta/autorización donde aplique →
escritura → relectura → desaparece el bloqueo correcto → llamada de herramienta.
La FAQ escrita en `knowledge_resources` no debe declarar resuelto un check que
consulta `faqs`. Mantener explícita esa diferencia o implementar la escritura real.
Un tour, una ruta existente y una fila de cobertura no constituyen esa prueba.

## T3 — Evidencia actual y coherencia del diagnóstico

**Prioridad alta, local antes de pedir modelos.** Completar la integración detallada
en [tool-evidence-authority-design.md](./tool-evidence-authority-design.md).
El lector estricto está implementado, pero assessment todavía no entrega el scope
autoritativo actual. Por eso permanece `not_verified` en lugar de aprobar evidencia
de otra configuración. Esto es trabajo local abierto, no un gate externo.

No solucionar el pendiente copiando hashes del último run ni creando una nueva
réplica de evaluación en cada lectura de Assist. Los snapshots contienen tiempo y
autoridad de réplica: otro snapshot no equivale al mismo hash. Leer y validar la
vigencia con la autoridad existente de revisiones, de forma consistente.

Requisitos:

- agente, perfil, configuración, conocimiento/políticas/tools, modelo cuando
  corresponde, idioma, escenario y canal/conexión identificados;
- normalización canónica `web_chat`/`web_widget` sin crear un segundo canal;
- intento aceptado más reciente bajo la misma autoridad puede reemplazar un fallo
  anterior; resultado rechazado/dry-run no cuenta;
- positivo completo, negativos pertinentes y verificación del efecto final, sin
  convertir “pide un dato faltante” en éxito de una reserva;
- revalidación consistente ante cambio concurrente; retirar un release o cambiar
  conocimiento invalida evidencia aunque no cambie el número de versión del agente;
- `statedChannels` no debe decir prepared ignorando `writersBlocked`; estado global,
  herramientas, tareas y siguiente acción deben incluir la evidencia relevante y
  no contradecirse. Evitar también un estado imposible de mejorar para siempre.

Probar el camino público de assessment y Assist, además de la función pura. La
interfaz debe explicar exactamente qué falta para pasar de preparado a probado.

## T4 — Recorridos por tipo de negocio y configuración accesible

**Local, paralelizable una vez estable el contrato.** `DISCOVERY_ORDER` omite
`cases`, `stays`, `tourBookings`; `ToolsTour.A_BY_ITEM` omite esos tres y
`serviceCatalog`. Completar descubrimiento, enlace, explicación, vuelta al flujo y
traducciones. No enviar un hotel a crear servicios de agenda ni un despacho de
reparación a administrar disponibilidad de tours.

El editor debe explicar los permisos específicos y la preparación junto a cada
familia, con los datos del backend; hoy filtra lo aplicable, pero no termina ese
recorrido. Conservar capacidad para apagar configuración heredada incompatible.

Probar los 76 perfiles con tenant_admin, tenant_supervisor, tenant_agent y
super_admin en su contexto correcto; rutas directas además del sidebar, plan
cargando/restringido, cambio de cuenta, teclado, foco, nombre accesible, lector de
pantalla y cuatro idiomas. Una operación restringida ofrece una explicación y un
destino permitido, no un bucle de redirecciones.

Separar pruebas automatizadas locales de pruebas con personas nuevas. Preparar el
guion de estas últimas; no declarar que se hicieron por pasar Playwright.

## T5 — Herramientas por tarea y competencia de los 76 perfiles

La matriz canónica declara **268 tareas, 146 que comprometen al negocio**. Para
cada una revisar todas las fases: descubrir oferta, detalle/precio, disponibilidad,
identidad y datos faltantes, condiciones acordadas, confirmación, escritura,
resultado, notificación, consulta posterior, modificación/cancelación y escalamiento.
Usar sólo las fases que correspondan, declarando por qué una no aplica.

En pruebas comprobar base persistida, ausencia de efectos cuando se rechaza,
resultado de proveedor cuando exista, idempotencia, stock/capacidad bajo
concurrencia, tenant/conexión correctos y redacción consistente con lo ocurrido.
El plan económico y el outbox deben cubrir cualquier mensaje que resulte de estas
herramientas; reducir mensajes no autoriza perder información necesaria.

Priorizar escenarios representativos por arquitectura para detectar defectos,
pero cerrar mediante la matriz completa de perfiles y tareas. Los perfiles
`construccion/contratista_general` y `event_planning/weddings` contienen hoy un
alcance consultivo reducido; no presentarlos comercialmente como automatización
transaccional completa. Definir intención y herramientas necesarias si se amplía
el alcance; actualizar plantilla, rutas, readiness, prompt y verificador juntos.

Los cinco `file_claim` sin positivo/verificador en el censo son casos negativos
deliberados del catálogo para rechazar una operación por identidad insuficiente
(step-up) en evaluación. Mantener su
excepción explícita; no añadir un positivo ficticio para llevar el contador a cero.

## T6 — Assist, conocimiento y aprendizaje

Consumir el diagnóstico común para explicar y proponer configuración. No mantener
un segundo listado de capacidades en prompts. Completar las operaciones guiadas
que realmente puedan escribir y releer; para las demás mostrar el paso concreto
en la pantalla correspondiente, sin simular que Assist ya lo aplicó.

Mantener KB de Assist, manual web/móvil y landing coherentes en es/en/pt/fr.
La nueva guía 27 explica perfil, permisos, preparación y prueba; no demuestra por
sí sola reparación automática, éxito por canal ni formación completa de usuarios.

Al aprender de chats separar estilo útil y conocimiento confirmado de permisos y
estado comercial: un ejemplo excelente de tono no concede una herramienta ni
demuestra que el pedido exista. Conservar procedencia, revisión, publicación,
rollback y retiro de datos según el plan de aprendizaje existente. Probar chats
con precios antiguos, operaciones inventadas y solicitudes de ignorar permisos.

## T7 — Cierre derivado y coordinación paralela

Añadir filas T1–T6 al generador de cierre junto con M0–M6/R0–R6, sin declarar
aceptación desde prosa o número de tests. Cada condición cita autoridad, prueba,
resultado, hash y alcance. Este nuevo censo se ejecuta con:

```powershell
node docs/audits/2026-09-11/generate-tool-profile-audit.cjs --write
node docs/audits/2026-09-11/generate-tool-profile-audit.cjs --check
```

Integrar su check con el flujo de artefactos/CI existente y pruebas que demuestren
que detecta una ruta/familia/handler ausente; regenerar cuando cambie una fuente.
No exigir que el hash del commit documental coincida consigo mismo: las fuentes
consumidas llevan hashes y el check admite avance de HEAD sin cambio de fuente.

Reparto recomendado con cuatro agentes:

1. **Integrador:** autoridad de configuración, T1 notificaciones y contratos que
   atraviesan productores; enlazar con el trabajo de outbox ya iniciado.
2. **Runtime/evidencia:** T2–T3, snapshots actuales y coherencia del diagnóstico.
3. **Producto:** T4, controles e i18n, Assist/KB/manuales de T6; no editar contratos
   centrales mientras el integrador los modifica.
4. **Validación:** matriz T5, adversarial, filas de cierre T7 y pruebas independientes;
   no “verificar” copiando el cálculo del código bajo prueba.

Primero acordar tipos/contratos compartidos; después trabajar por archivos
exclusivos. Integrar y probar una tanda antes de ampliar otra. No detenerse tras
preparar el harness si puede ejecutarse localmente.

Al entregar: commits exactos propios, correcciones antes/después, comandos y
resultados reales, filas abiertas locales y gates externos concretos. Ejecutar
typecheck frío, suites afectadas y las verificaciones de release del plan vigente
después de integrar. El cierre de esta auditoría no habilita por sí solo despliegue.

Los gates externos son exclusivamente los que de verdad requieran acceso,
credencial, gasto autorizado, cuenta/consentimiento de prueba o personas nuevas.
Un control sin consumidor, snapshot sin conectar, tour faltante o test no corrido
es trabajo pendiente, aunque ya existan tablas, funciones o documentos.
