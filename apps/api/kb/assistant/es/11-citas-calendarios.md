---
id: citas-calendarios
title: "Citas y calendarios"
routes: ["/admin/appointments", "/admin/settings/public-booking"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["citas", "agenda", "calendario", "agendar", "reservas", "reservar", "servicios", "disponibilidad", "horarios", "google calendar", "outlook", "recordatorios", "confirmacion de asistencia", "reprogramar", "cancelar cita", "fechas bloqueadas", "link de reunion", "meet", "teams", "booking publico", "pagina de reservas", "cita recurrente"]
---

# Citas y calendarios

Parallly incluye una agenda completa: defines tus servicios y horarios una sola vez, y a partir de ahí tu agente de IA agenda citas solo dentro de la conversación, tu equipo las ve en un calendario compartido y todo puede sincronizarse con Google Calendar u Outlook.

Todo vive en la barra lateral, en **Citas**. Al entrar verás la página **Citas y Agendamiento** con cinco pestañas: **Calendario** (vista por semana o por día), **Agenda** (lista de citas), **Servicios disponibles**, **Configuración** y **Analíticas**. La configuración es para administradores y supervisores; los agentes pueden ver el calendario, crear citas y atenderlas.

## Cómo crear tus servicios

Los servicios son lo que tus clientes pueden reservar (una consulta, un corte, una asesoría…).

1. Ve a **Citas** → pestaña **Servicios disponibles**.
2. Pulsa **Nuevo servicio**.
3. Completa el **Nombre del servicio**, la **Duración** en minutos y, si quieres, el **Precio**.
4. En **Tiempo entre citas (min)** puedes dejar un respiro entre una cita y la siguiente (por ejemplo, 10 minutos para preparar el espacio).
5. Elige la **Modalidad**: **Presencial**, **Online** o **Híbrido**.
   - Si es presencial, indica la **Dirección**.
   - Si es online o híbrido, puedes dejar vacío el **Enlace de reunión**: se genera automáticamente un link de Meet o Teams para cada cita.
6. Guarda con **Crear servicio**. Puedes activar o desactivar servicios cuando quieras.

Cuántos servicios puedes crear depende de tu plan: Emprendedor 1, Starter 2, y desde Pro en adelante sin límite.

## Cómo definir tu disponibilidad

1. Ve a **Citas** → pestaña **Configuración** → sección **Horario de atención**.
2. Elige **Disponible 24/7** o **Horario personalizado** y marca, día por día, las horas en que atiendes.
3. Guarda los cambios. Importante: si no guardas tus horarios, el agente de IA no tendrá disponibilidad real que ofrecer en las conversaciones.

### Fechas bloqueadas (vacaciones, feriados)

En la misma pestaña **Configuración**, sección **Fechas bloqueadas**:

1. Pulsa **Bloquear fecha**.
2. Elige el día y escribe la razón (por ejemplo, "Feriado").

El agente de IA nunca ofrecerá horarios en un día bloqueado, y tampoco estarán disponibles en la página pública de reservas.

## Cómo conectar Google Calendar u Outlook

Conectar tu calendario evita choques de horario: las citas de Parallly aparecen en tu calendario personal, y así todo tu equipo ve la agenda al día.

1. Ve a **Citas** → pestaña **Configuración** → sección **Calendarios conectados**.
2. Pulsa **Conectar Google Calendar** o **Conectar Outlook**.
3. Autoriza el acceso con tu cuenta de Google o Microsoft.
4. Listo: las citas nuevas se crean también en tu calendario externo automáticamente.

Cuántos calendarios puedes conectar depende de tu plan:

| Plan | Calendarios conectados |
|------|------------------------|
| Emprendedor | 1 |
| Starter | 1 |
| Pro | 3 |
| Enterprise | 10 |
| Custom | Sin límite |

### Con varios calendarios, ¿a cuál va cada cita?

A cada calendario conectado le pones una etiqueta: **General**, **Miembro del equipo** o **Servicio**. Cuando se crea una cita, se envía siguiendo este orden:

1. El calendario asignado al **servicio** de la cita.
2. Si no hay, el calendario del **miembro del equipo** asignado.
3. Si tampoco, el calendario **general** del negocio.

### Desconectar un calendario que tiene citas futuras

Si intentas desconectar un calendario con citas pendientes, el panel te ofrece dos opciones: **Reasignar citas a otro calendario** (eliges el destino, las citas se mueven y recién entonces se desconecta) o **Cancelar todas las citas y desconectar**. Así ninguna reserva queda en el aire sin que lo decidas tú.

## Links de reunión automáticos

Para servicios con modalidad **Online** o **Híbrido**, cada cita genera automáticamente su link de videollamada (Meet con Google Calendar, Teams con Outlook). El cliente lo recibe en su confirmación, sin que tengas que crear la reunión a mano. Si prefieres usar un link propio fijo, pégalo en el campo **Enlace de reunión** del servicio.

## Recordatorios y confirmación de asistencia

En **Citas** → **Configuración** → sección **Recordatorios y seguimiento** puedes activar:

- **Recordatorio 24 horas antes** — se envía un día antes de la cita.
- **Recordatorio 2 horas antes** — un último aviso el mismo día.
- **Confirmación de asistencia** — después de la cita, se le pregunta al cliente si asistió.
- **Completar automáticamente** — las citas se marcan como completadas 2 horas después de su hora de fin, sin trabajo manual.

Los recordatorios por WhatsApp usan plantillas de notificación aprobadas por Meta, así que llegan siempre, incluso si el cliente lleva más de 24 horas sin escribir.

## La IA agenda sola en la conversación

Cuando un cliente pide una cita por WhatsApp, Instagram o cualquier canal conectado, el agente de IA lo guía paso a paso: primero el servicio, luego una fecha con disponibilidad real, luego la hora, y al final una confirmación. En ese último paso el sistema vuelve a verificar el horario, así que dos personas no pueden quedarse con el mismo cupo.

Al confirmar, todo ocurre solo: la cita queda en tu **Calendario**, se sincroniza con tu Google Calendar u Outlook, el cliente recibe un email de confirmación, el miembro del equipo asignado recibe aviso y, si el servicio es online, se incluye el link de reunión.

En WhatsApp también puedes activar **WhatsApp Flows (Beta)** desde la pestaña **Configuración**: en lugar de ir pregunta por pregunta, el cliente agenda en un solo paso con un formulario interactivo. Si algo falla, el agente vuelve al flujo por texto automáticamente.

## Página pública de reservas

Además del chat, puedes tener una página web donde tus clientes agendan solos:

1. Ve a **Configuración** (barra lateral) → **Booking público**.
2. Activa el interruptor **Activar booking público**.
3. Copia tu enlace con el botón **Copiar** (tiene la forma `parallly-chat.cloud/book/tu-negocio`) o pulsa **Mostrar código QR** para imprimirlo o compartirlo.
4. En **Personalización** puedes definir el **Mensaje de bienvenida** y el **Color de marca** de la página.

Comparte el enlace en tu bio de Instagram, tu perfil de WhatsApp Business, tu firma de email o tu sitio web. Las citas que entren por ahí aparecen en tu calendario con origen "Reserva pública", junto a las creadas por el Agente IA o por tu equipo desde el panel.

## Preguntas frecuentes

**¿Qué pasa si dos personas quieren el mismo horario?**
El sistema verifica la disponibilidad en el momento exacto de confirmar y rechaza el segundo intento, ofreciendo otro horario. No hay dobles reservas.

**¿Puedo reprogramar o cancelar una cita?**
Sí. En la pestaña **Calendario** puedes reprogramar arrastrando la cita a otro horario, o abrirla para editarla o cancelarla indicando el motivo.

**¿Puedo crear citas que se repiten?**
Sí. Al crear una cita desde el panel, marca **Repetir esta cita** y elige la frecuencia (cada día, cada semana, cada 2 semanas o cada mes) y cuántas veces. Se crea la serie completa de una vez.

**¿Necesito conectar un calendario para usar la agenda?**
No, la agenda funciona sola dentro de Parallly. Conectar Google Calendar u Outlook es opcional, pero muy recomendable si tu equipo también agenda cosas fuera de la plataforma.

**¿Quién puede cambiar la configuración de la agenda?**
Los administradores y supervisores. Los agentes pueden ver el calendario, crear citas y atender a los clientes, pero no modificar servicios, horarios ni calendarios conectados.

¿Necesitas más ayuda? Escríbenos en https://parallly-chat.cloud/support
