---
id: agentes-ia
title: "Agentes de IA: crear y configurar"
routes: ["/admin/agent", "/admin/agent/simulation"]
roles: ["tenant_admin"]
keywords: ["agente", "agentes de ia", "bot", "chatbot", "asistente virtual", "crear agente", "plantilla", "personalidad", "instrucciones", "tono", "horario del agente", "asignar canal", "conexion", "duplicar agente", "agente predeterminado", "limite de agentes", "canales sin agente", "probar agente", "reglas", "temas prohibidos"]
---

# Agentes de IA: crear y configurar

Tu agente de IA es el "vendedor virtual" que responde a tus clientes en WhatsApp, Instagram, Messenger, Telegram y el chat de tu sitio web, las 24 horas. Aquí aprendes a crearlo, darle personalidad, definir su horario y asignarlo a tus conexiones.

> Esta sección la administra el rol **administrador**. Los supervisores y agentes humanos ven el resultado en el inbox, pero no configuran los agentes de IA.

## Capacidad de agentes

**Agente IA** muestra cuántos agentes puedes crear y si puedes guardar plantillas propias. Si alcanzas el cupo verás **Límite de agentes alcanzado**; consulta la capacidad vigente en **Plan y facturación**.

## Cómo crear un agente

1. En el menú lateral, entra a **Agente IA**.
2. Haz clic en **Nuevo agente**.
3. Elige una plantilla. Verás tres grupos:
   - **Recomendados para tu negocio** — plantillas ajustadas a tu industria (por ejemplo, recepcionista para clínicas, asesor inmobiliario, toma de pedidos para restaurantes).
   - **Plantillas generales** — **Asesor de Ventas**, **Agente de Soporte**, **Bot de Preguntas Frecuentes**, **Agendador de Citas**, **Calificador de Leads** y **Agente en Blanco** (para configurar todo desde cero).
   - **Mis plantillas** — las que guardaste tú, cuando la función esté habilitada para tu cuenta.
4. Haz clic en **Usar esta** sobre la plantilla elegida.
5. Escribe el **Nombre del agente** si quieres uno propio (por ejemplo, Sofía o Max); si lo dejas vacío, se usa el de la plantilla.

El agente queda creado y se abre su editor para que lo personalices.

## Cómo configurar la personalidad y las instrucciones

Dentro de **Agente IA**, haz clic en **Editar** sobre el agente. El editor está organizado en tarjetas:

- **Identidad** — nombre, rol o título (por ejemplo, "Asesora de ventas") e idioma.
- **Personalidad** — el **Estilo de comunicación** (Amigable, Profesional, Formal, Casual o Empático), la **Extensión de respuestas** (Conciso, Estándar o Detallado) y el saludo inicial.
- **Comportamiento** — tus reglas propias en texto libre (por ejemplo, "siempre ofrece el combo familiar antes de cerrar"), los temas prohibidos que el agente nunca debe tocar y el modo de respuesta (siempre IA, siempre humano o híbrido).
- **Modelo IA** — qué motor usa el agente. El editor muestra los modelos habilitados para tu cuenta.
- **Horario** — cuándo está activo (ver más abajo).
- **Capacidades** — qué puede hacer el agente, con interruptores para activar o desactivar cada una:
  - Buscar respuestas en tu base de conocimiento
  - Verificar disponibilidad y agendar citas
  - Mostrar productos, servicios o propiedades de tu catálogo
  - Crear pedidos o reservas
  - Pasar la conversación a una persona de tu equipo cuando haga falta

Cuando termines, haz clic en **Guardar cambios** — el botón siempre está visible en la barra inferior, así no pierdes ediciones al desplazarte.

## Cómo definir el horario del agente

1. En el editor del agente, abre la tarjeta **Horario**.
2. Marca los días y las franjas en que el agente responde (por ejemplo, "Diario 9:00–18:00" o solo 5 días a la semana).
3. Guarda con **Guardar cambios**.

Fuera de ese horario el agente no atiende de forma automática; combina esto con el modo de respuesta si prefieres que tu equipo tome el control en ciertos momentos.

## Cómo asignar el agente a cada conexión

La regla es simple: **un agente de IA por conexión**. Una conexión es cada cuenta o número que conectaste — por ejemplo, "WhatsApp Ventas" y "WhatsApp Soporte" son dos conexiones distintas, y cada una puede tener su propio agente.

1. En el editor del agente, ve a **Asignación de canales**.
2. Marca las conexiones que este agente va a atender. Verás cada cuenta con su nombre y número, no el canal genérico.
3. Si la conexión ya estaba asignada a otro agente, el editor te avisa que **se reasignará** desde el agente anterior.
4. Haz clic en **Guardar cambios**.

La cantidad y el tipo de conexiones disponibles se muestran en **Canales** y **Plan y facturación**.

## Qué significa el aviso "canales sin agente asignado"

Si en **Agente IA** ves el aviso **Canales sin agente asignado**, tienes conexiones activas que ningún agente atiende de forma específica. Mientras tanto, esos mensajes los responde tu **agente predeterminado**, con una configuración genérica.

Haz clic en **Asignar agente ahora** para elegir qué agente atiende cada conexión y dar una experiencia personalizada.

## Duplicar, guardar como plantilla y otras acciones

En la lista de **Agente IA**, cada agente tiene un menú de acciones:

- **Duplicar** — crea una copia exacta, ideal para experimentar sin tocar el agente que ya funciona.
- **Guardar como plantilla** — convierte la configuración en una plantilla reutilizable cuando la función está habilitada (aparece en **Mis plantillas**).
- **Establecer como predeterminado** — define qué agente responde en las conexiones que no tienen uno asignado.
- **Eliminar** — borra el agente (te pide confirmación). El agente predeterminado no se puede eliminar.

## Prueba tu agente antes de activarlo

Desde el menú **Agente IA → Probar agente** puedes chatear con tu agente en modo simulación, sin afectar clientes reales. Úsalo cada vez que cambies la personalidad o las reglas, antes de que hable con tus clientes.

## Preguntas frecuentes

**¿Puedo tener un agente distinto para ventas y otro para soporte?**
Sí, cuando tu cuenta tenga cupo. Crea uno con la plantilla **Asesor de Ventas** y otro con **Agente de Soporte**, y asigna cada uno a la conexión correspondiente.

**¿Qué pasa si conecto un canal y no le asigno agente?**
Responde tu agente predeterminado. Verás el aviso de canales sin asignar en **Agente IA** para corregirlo con un clic.

**¿El agente puede responder por SMS?**
No. El SMS en Parallly no es un canal de conversación: se usa solo para notificaciones salientes con créditos (1 crédito = 1 segmento). Las superficies conversacionales autoservicio son WhatsApp, Instagram, Messenger, Telegram y el chat web. Email conserva un adaptador inbound interno, pero no una configuración autoservicio certificada.

**Cambié las instrucciones y el agente sigue igual, ¿qué reviso?**
Confirma que hiciste clic en **Guardar cambios** en la barra inferior del editor y que editaste el agente asignado a esa conexión (no otro). Luego verifícalo en **Probar agente**.

**¿Cómo agrego más agentes o más números?**
La pantalla muestra la capacidad disponible para agentes y conexiones. Consulta las opciones vigentes en **Administración → Plan y facturación**, o escríbenos en https://parallly-chat.cloud/support si necesitas otra capacidad.
