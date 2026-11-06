---
id: configuracion-gobierno
title: "Configuración del negocio, políticas y gobierno"
routes: ["/admin/settings/business-info", "/admin/settings/localization", "/admin/settings/fiscal", "/admin/settings/business-hours", "/admin/settings/policies", "/admin/settings/alerts", "/admin/compliance", "/admin/settings/media", "/admin/settings/prechat", "/admin/settings/email-templates", "/admin/settings/macros", "/admin/settings/recall", "/admin/settings/public-booking"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["configuracion", "empresa", "informacion del negocio", "idioma", "zona horaria", "fiscal", "horarios", "politicas", "alertas", "cumplimiento", "medios", "prechat", "emails", "macros", "memoria", "reservas", "recall", "reactivacion"]
---

# Configuración del negocio, políticas y gobierno

**Configuración** reúne datos que afectan a varias áreas. El administrador controla identidad, localización, datos fiscales, políticas y funciones sensibles. El supervisor puede operar pantallas habilitadas para su rol, como alertas o medios, pero no debe asumir permisos de administrador.

- **Cuenta y empresa**: perfil, información del negocio, idioma, zona horaria, datos fiscales y horario.
- **CRM y conversaciones**: atributos, embudo, formularios pre-chat, macros, memoria y plantillas de email.
- **Gobierno y alertas**: políticas que el agente puede consultar, cumplimiento, notificaciones y reglas de alerta.
- **Experiencia pública**: biblioteca de medios y configuración de la página de reservas.

La pantalla es la autoridad: si una acción no aparece, tu rol o la configuración de la cuenta pueden no habilitarla. Antes de guardar, revisa qué canales, agentes o automatizaciones consumen el dato. Cambiar zona horaria, horarios, políticas o identidad puede modificar respuestas y programaciones; registra el motivo y prueba el agente antes de publicar cambios delicados.

## Reactivación automática (recall)

Solo un administrador la configura, en **Configuración → Recall automático** (la pantalla se titula **Reactivación automática**), y aparece si tu plan incluye la función. Sirve para volver a escribir a quien no regresa: limpiezas dentales semestrales, controles veterinarios o renovaciones.

- **Días sin actividad para reactivar**: cuánto tiempo debe pasar desde la última cita completada (por ejemplo 180 para una limpieza semestral).
- **Días de espera entre reactivaciones**: tiempo mínimo antes de volver a escribirle a la misma persona.
- **Canal de envío** y **Mensaje**: el canal debe estar conectado y activo; el mensaje admite las variables `{name}` y `{months}`.

La revisión corre todos los días a las 9 AM (hora del servidor) y solo escribe a contactos con teléfono, sin baja registrada, cuya última cita **marcada como completada** supera el umbral; por eso conviene completar las citas en **Citas**. **Enviar ahora (prueba)** ejecuta esa misma revisión al instante y envía mensajes reales a los contactos que califican. Si tienes varios números del mismo canal y Parallly no puede saber desde cuál salir, no envía: te deja una tarea para que elijas el número.
