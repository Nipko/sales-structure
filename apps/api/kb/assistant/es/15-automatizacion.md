---
id: automatizacion
title: "Automatizaciones y seguimiento"
routes: ["/admin/automation", "/admin/automation/drip-sequences", "/admin/automation/templates"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["automatizacion", "automatizaciones", "reglas", "regla automatica", "disparador", "trigger", "condiciones", "acciones", "secuencia", "drip", "nurturing", "seguimiento", "seguimiento automatico", "flujo", "constructor visual", "plantillas de automatizacion", "mensajes automaticos", "recordatorio", "reactivacion", "carrito abandonado", "bienvenida"]
---

# Automatizaciones y seguimiento

Las automatizaciones hacen que Parallly trabaje por ti: cuando ocurre algo en tu negocio (llega un lead, un cliente deja de responder, alguien cambia de etapa), la plataforma ejecuta acciones automáticas sin que nadie tenga que estar pendiente. En **IA y crecimiento** encontrarás **Automatización**, **Secuencias Drip** y **Plantillas**:

- **Reglas**: "cuando pase X, haz Y" (una sola vez por evento).
- **Secuencias Drip**: series de mensajes de seguimiento con esperas entre cada uno.
- **Plantillas**: automatizaciones listas para instalar, organizadas por industria.

> Pueden configurarlas los roles **administrador** y **supervisor**. Los agentes no gestionan automatizaciones, pero sí ven sus efectos (por ejemplo, tareas o conversaciones asignadas).

## Cómo crear una regla de automatización

1. Ve a **Automatización** en la barra lateral y haz clic en **Nueva regla**.
2. **Disparador** — elige qué evento activa la regla:
   - **Lead capturado**: cuando un nuevo lead ingresa al sistema.
   - **Mensaje nuevo**: cuando se recibe un mensaje del cliente.
   - **Conversación asignada**: cuando una conversación se asigna a un agente.
   - **SLA vencido**: cuando se excede el tiempo de respuesta.
   - **Inactividad**: cuando el cliente no responde.
   - **Cambio de etapa**: cuando un lead cambia de etapa en el embudo.
3. **Condiciones** — filtros opcionales con **Agregar condición**. Puedes filtrar por **Canal**, **Etapa**, **Score**, **Etiqueta**, **Fuente** o **ID de campaña**, con operadores como "es igual a", "contiene", "mayor que". Todas las condiciones deben cumplirse a la vez; si no agregas ninguna, la regla se ejecuta siempre que ocurra el disparador.
4. **Acciones** — con **Agregar acción** define qué hace la regla:
   - **Enviar plantilla WhatsApp**
   - **Crear tarea de seguimiento**
   - **Cambiar etapa del pipeline**
   - **Agregar etiqueta**
   - **Asignar a agente**
   Cada acción tiene un campo **Demora (segundos)** por si quieres que se ejecute con espera en lugar de inmediatamente.
5. En el paso **Resumen**, dale un nombre claro (ej. "Auto-asignar leads nuevos"), activa **Activar regla inmediatamente** si quieres que empiece a funcionar ya, y haz clic en **Guardar Regla**.

Puedes activar o desactivar cualquier regla desde la lista sin borrarla, y revisar el **Historial de ejecuciones** para ver cuándo corrió y si alguna acción falló (los envíos fallidos se reintentan automáticamente).

## Cómo usar el constructor visual

Si prefieres ver tu automatización como un diagrama en lugar del asistente paso a paso:

1. En **Automatización**, haz clic en **Constructor visual**.
2. Arma el flujo en el lienzo conectando bloques de **Disparador**, **Condición**, **Acción** y **Espera**. Las condiciones bifurcan el flujo en ramas **Sí** / **No**.
3. Guarda con **Guardar**. Una regla creada en el constructor visual se puede seguir editando con **Editar con asistente**, y viceversa: son la misma regla vista de dos formas.

> Si **HTTP Request** está habilitado para tu cuenta, una regla puede avisar a otro sistema de tu negocio. Trátalo como una integración técnica y pruébalo con datos no sensibles.

## Cómo crear una secuencia de seguimiento (Drip)

Las **Secuencias Drip** envían varios mensajes espaciados en el tiempo: ideales para dar seguimiento a leads que no respondieron, dar la bienvenida a clientes nuevos o hacer posventa.

1. Ve a **Automatización → Secuencias Drip** y haz clic en **Nueva secuencia**.
2. Escribe un **Nombre** (ej. "Bienvenida nuevos leads") y elige el **Disparador** que inscribe al contacto:
   - **Lead capturado**
   - **Cambio de etapa**
   - **Etiqueta agregada**
   - **Inscripción manual** (tú agregas contactos con **Inscribir contacto**)
3. Con **Agregar paso** crea cada mensaje. Cada paso tiene:
   - **Espera**: cuánto esperar antes de enviarlo (**Minutos**, **Horas** o **Días**).
   - **Tipo de mensaje**: **Plantilla WhatsApp**, **Mensaje personalizado** o **Generado por IA** (el agente redacta el mensaje según el contexto de ese lead).
4. En **Detener si**, usa **El contacto responde** para no insistirle a alguien que ya te está hablando. Si pide no recibir más mensajes (opt-out), la plataforma también detiene los envíos. La opción visual **El contacto convierte** aún no se ejecuta automáticamente en esta versión: desinscribe manualmente al contacto cuando convierta.
5. Activa la secuencia con el interruptor **Activa**.

En cada tarjeta verás el contador **Inscritos**: cuántos contactos están dentro de ese flujo en este momento.

**Ejemplo de secuencia corta (3-4 pasos funciona mejor que 8):**

- Día 0 — "Hola {{nombre}}, gracias por tu interés…"
- Día 2 — mensaje de valor (beneficio, financiación, novedad)
- Día 5 — invitación concreta ("¿Agendamos una llamada? Responde SÍ")

## Cómo instalar una plantilla lista para usar

1. Ve a **Automatización → Plantillas**.
2. Usa el buscador y los filtros de **Categoría** e **Industria** para encontrar la ideal. Hay plantillas de **Nutrición de leads**, **Recordatorios de citas**, **Carrito abandonado**, **Secuencia de bienvenida**, **Reactivación**, **Recolección de feedback**, **Tratamiento VIP** y **Fuera de horario**. Si tu negocio es de salud, inmobiliaria, restaurante, etc., verás primero las de tu industria.
3. Haz clic en **Instalar**: un modal te muestra el disparador, las acciones y las **Variables** que puedes ajustar (textos, tiempos) antes de confirmar con **Instalar plantilla**.
4. Al terminar, usa **Ver reglas** para ir directo a tus reglas. La regla instalada queda **inactiva** por defecto: revisa los textos y actívala cuando estés listo.

## Disponibilidad y capacidad

La pantalla muestra si reglas, secuencias y **HTTP Request** están habilitados, además del uso actual. Consulta los límites vigentes en **Plan y facturación**.

## Preguntas frecuentes

**¿Cuál es la diferencia entre una regla y una secuencia drip?**
Una regla reacciona una vez a un evento ("lead nuevo → asignar agente"). Una secuencia drip envía varios mensajes a lo largo de días, con esperas entre cada uno, y puede detenerse si el contacto responde o solicita no recibir más mensajes.

**Creé una regla y no pasa nada, ¿qué reviso?**
Primero verifica que esté **Activa** (las plantillas se instalan inactivas por defecto). Luego revisa las condiciones: todas deben cumplirse a la vez, y una condición mal puesta (por ejemplo, un canal que no usas) bloquea la regla. El **Historial de ejecuciones** te dice si la regla corrió y qué resultado tuvo.

**¿Puedo pausar una secuencia sin borrarla?**
El interruptor **Activa/Inactiva** impide nuevas inscripciones, pero los pasos ya programados para contactos inscritos pueden continuar en esta versión. Para detenerlos, desinscribe esos contactos antes de desactivar la secuencia.

**¿Las automatizaciones pueden escribirle a cualquier contacto a cualquier hora?**
Envían según las esperas que configures, respetando siempre los opt-outs. En WhatsApp, los mensajes fuera de la ventana de conversación requieren plantillas aprobadas, por eso el tipo de paso **Plantilla WhatsApp** es el más seguro para seguimientos de varios días.

**No veo estas opciones.**
Confirma tu rol y revisa en **Plan y facturación** si la función está habilitada para tu cuenta.

¿Dudas? Escríbenos en https://parallly-chat.cloud/support
