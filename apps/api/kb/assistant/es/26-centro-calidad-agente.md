---
id: centro-calidad-agente
title: "Salud de agentes y Centro de calidad"
routes: ["/admin/agent/quality", "/admin"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["salud de agentes", "centro de calidad", "calidad del agente", "preparacion", "calidad probada", "evidencia de produccion", "agente en riesgo", "configuracion incompleta", "acciones criticas", "badge", "posponer", "Parallly Assist", "mejorar agente", "cobertura de canales", "conexion operativa del canal", "mostrarme donde", "recorrido guiado", "barra de contexto", "requiere reautorizar"]
---

# Salud de agentes y Centro de calidad

**Salud de agentes** muestra qué falta configurar, qué se ha probado y qué ocurre en
conversaciones reales para cada agente IA. El detalle está en **Insights → Salud de
agentes**. Admin y Supervisor pueden consultarlo; solo Admin puede editar agentes,
conexiones o configuración desde **IA y crecimiento → Agente IA**.

## Dónde aparece y qué significa

- La tarjeta **Salud de tus agentes** de Inicio siempre resume el peor estado y las
  acciones abiertas para Admin/Supervisor.
- El badge de **Insights → Salud de agentes** suma solamente señales **Críticas y
  Altas abiertas**. Es un conteo de atención, no un puntaje.
- El aviso global aparece solo ante una señal crítica abierta o un estado **Agente en
  riesgo**. Puedes **Revisar**, **Preguntar a Assist** o **Posponer 24 h**.
- Posponer oculta esa señal temporalmente; no la corrige. Estos avisos viven en el
  dashboard y no envían correo ni notificación push.

## Las tres capas de evidencia

- **Preparación:** revisa negocio y alcance, conocimiento, conversación y marca,
  acciones, seguridad y handoff, y robustez operativa. Una capacidad fuera del
  alcance puede aparecer como **No aplica** y no reduce el resultado.
- **Calidad probada:** muestra la evaluación crítica y la simulación más recientes,
  con versión, fecha, umbral y escenarios. Si cambió el agente, la evidencia anterior
  puede quedar desactualizada. Es evidencia automatizada, no una certificación.
- **Producción:** usa interacciones reales atribuidas al agente y a su versión.
  Separa resolución verificada, calidad conversacional observada, handoffs, fallos de
  herramientas y vacíos de conocimiento. Si todavía falta muestra, verás **Evidencia
  insuficiente**, no un cero.

La evidencia histórica que no identifica de forma inequívoca al agente no se asigna
retroactivamente. Por eso una versión recién publicada puede necesitar nuevas
interacciones antes de mostrar una señal de producción útil.

## Qué verifica "Conexión operativa del canal"

Este control de **Preparación** separa tres cosas que suelen confundirse:

- **Asignación** — en el editor del agente marcaste los canales que este agente atiende.
- **Conexión** — esa cuenta existe y está activa en **Administración → Canales**.
- **Credencial** — el permiso sigue vigente, así que el canal todavía puede enviar
  respuestas.

Un canal marcado en el agente pero sin conectar **ya no bloquea** al agente cuando otro
canal asignado sí opera: aparece como **Cobertura de los canales asignados**, una acción
alta y no crítica, con cuántas asignaciones tiene el agente, cuántas están conectadas y
cuáles quedaron sin conexión.

**Conexión operativa del canal** bloquea como crítica solo en dos casos:

- ningún canal asignado puede **recibir** mensajes (no hay conexión activa), o
- una credencial **requiere reautorizar** (vencida, revocada, con error o ausente), así
  que el agente no puede **enviar** la respuesta.

Hay un tercer control crítico, aparte, para las asignaciones que no corresponden a un
canal conversacional certificado: **Alcance operativo del canal** rechaza al agente
asignado a un tipo de canal que no atiende conversaciones (por ejemplo, SMS, que solo
envía notificaciones, o email, que hoy no tiene configuración autoservicio certificada).
No alcanza con desconectarlo: hay que desmarcar ese tipo en el editor del agente y dejar
solo canales certificados — WhatsApp, Instagram, Messenger, Telegram o el chat web.

Un vínculo que apunta a una cuenta que ya no existe (por ejemplo, el número se reconectó
y cambió de identificador) cuenta como asignación sin conexión: se corrige volviendo a
marcar la cuenta vigente en el editor del agente.

## Qué pasa al hacer clic en Revisar

**Revisar** abre la pantalla donde se hace el cambio y, arriba de esa pantalla, aparece
una **barra de contexto** que explica por qué llegaste ahí. Muestra la acción pendiente,
el agente afectado, una explicación en lenguaje llano con la evidencia del control (por
ejemplo, "asignado a 2 canales, 1 conectado, sin conexión: instagram") y hasta cuatro botones:
**Mostrarme dónde**, **Preguntar a Assist**, **Posponer 24 h** y cerrar. **Mostrarme dónde**
aparece solo cuando hay un recorrido que cubre esa señal y tu rol puede ejecutarlo; si no,
la barra muestra los otros tres. Es parte de la
pantalla, no una notificación: no se envía a ningún lado y desaparece al cerrarla o al
volver a esa pantalla sin ese enlace.

**Revisar** ya no te deja en la puerta: el enlace lleva la pestaña y el campo, así que el
editor abre esa pestaña, se desplaza hasta el campo y lo resalta. Si la señal es el mensaje
de respaldo, aterrizas con ese campo marcado; si son las reglas o los canales asignados,
lo mismo. No tienes que recorrer un formulario largo buscando qué te faltaba.

## Mostrarme dónde (recorrido guiado)

**Mostrarme dónde** abre la pantalla correcta y resalta paso a paso dónde se hace el
cambio: qué campo, qué pestaña, qué botón. El recorrido **no modifica** ninguna
configuración; solo señala el lugar, y la persona decide qué escribir y cuándo guardar.
Funciona en computadora de escritorio, donde viven esos elementos del panel. Admin ve
los recorridos de edición (conectar un canal, asignar canales al agente, reglas de
escalamiento); Supervisor ve los de revisión (Centro de calidad, evidencia de
producción). Dos recorridos alcanzan también al rol **agente**: el del sistema de ayuda
(dónde vive la ayuda de cada pantalla) y el de la primera conversación del inbox. También puedes pedirlo en el chat: cuando le preguntas a Assist dónde o
cómo se hace algo que tiene recorrido, la respuesta trae ese botón.

## Cómo interpretar el estado

- **Aún no evaluado:** todavía no hay evidencia suficiente.
- **Configuración incompleta:** falta un requisito o hay una advertencia de preparación.
- **Agente en riesgo:** una prueba crítica o una señal real importante exige revisión.
- **Listo para piloto controlado:** preparación y pruebas permiten un piloto limitado,
  pero aún falta evidencia real suficiente.
- **Operando con evidencia:** hay configuración, pruebas vigentes y una muestra útil de
  producción.
- **Revisión requerida:** la evidencia quedó desactualizada o el desempeño reciente se
  deterioró.

Ningún estado significa que el agente sea perfecto, certifica su operación ni
garantiza resultados comerciales.

## Qué mejorar primero

Parallly conserva snapshots del estado y señales por agente, versión y causa. Cambios
de configuración, resultados de QA, evaluaciones y simulaciones actualizan la
evidencia; las recurrencias se agrupan para evitar avisos duplicados y una revisión
periódica acotada recupera eventos perdidos. Una señal puede estar abierta,
reconocida, pospuesta, resuelta o reemplazada. Reconocer o posponer administra la
atención; solo evidencia nueva la resuelve.

Abre las recomendaciones críticas y altas. Cada una indica el pilar y la dimensión
afectados y, cuando existe el dato, cuántos escenarios o interacciones la originaron.
Úsalas para distinguir entre:

- **Reforzar conocimiento:** faltan datos o la fuente no se recuperó.
- **Ajustar comportamiento:** la información existía, pero el agente preguntó,
  explicó, negó o escaló mal.
- **Reparar una capacidad:** falló una herramienta, conexión, política, aprobación o
  ruta humana.

El Centro de calidad no reescribe automáticamente prompts, políticas ni contenido.
Admin realiza el cambio, vuelve a ejecutar las pruebas y revisa si la evidencia nueva
confirma la mejora; Supervisor puede revisar resultados y coordinar el seguimiento.

## Preguntar a Parallly Assist

Desde Inicio o el aviso global, **Preguntar a Assist** abre el chat sobre el agente y
la señal seleccionados. El servidor valida tenant, rol, agente y señal, y Assist
explica una prioridad con el estado vigente. Admin puede recibir una ruta de
corrección; Supervisor recibe la ruta de revisión, sin permisos de edición.

El contexto incluye solo estado, versión, hito, códigos de bloqueo, vigencia de
pruebas, muestra, gravedad, pilar, dimensión y conteos. No incluye transcripciones,
texto de clientes, IDs de conversación, prompts, consultas de recuperación, texto
libre del evaluador ni secretos. Assist no aplica cambios ni inicia comunicaciones.

Además del estado del agente, Assist recibe la **lista de canales conectados del
negocio** (tipo de canal, cuántas cuentas y su estado de credencial) y la evidencia
acotada del control: conteos y tipos de canal, nunca nombres, números ni
identificadores. Por eso puede decirte qué canal sí está operando y cuál falta conectar,
en vez de afirmar que no tienes canales conectados.

## Preguntas frecuentes

**¿El checklist de configuración es lo mismo que el Centro de calidad?**
No. La tarjeta **Puesta en marcha** de Inicio muestra solo pasos esenciales disponibles
para tu plan, rol e industria y desaparece al completarlos. Reemplaza la antigua
pastilla flotante `8/9`. Salud de agentes añade pruebas y evidencia de producción.

**¿Un buen puntaje de simulación basta para publicar?**
No. Ayuda a reducir riesgo, pero debe revisarse junto con bloqueos críticos, vigencia
de la versión y evidencia real cuando esté disponible.

**¿El sistema aprende y cambia solo con cada conversación?**
No. Las interacciones generan diagnósticos y recomendaciones; una persona revisa y
aprueba cualquier cambio antes de volver a probarlo.
