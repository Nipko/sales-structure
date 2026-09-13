---
id: privacidad-medios
title: "Privacidad para imágenes, audios y consentimiento"
routes: ["/admin/settings/policies", "/admin/compliance", "/admin/settings/billing"]
roles: ["tenant_admin"]
keywords: ["privacidad", "consentimiento", "audio", "imagen", "transcripcion", "analisis", "retencion", "revocar"]
---

# Privacidad para imágenes, audios y consentimiento

El plan puede incluir análisis de imágenes o transcripción de audio, pero esa disponibilidad no autoriza a procesar contenido de una persona. Antes de usar la capacidad, el negocio debe publicar una política de privacidad activa en **Configuración → Políticas → Privacidad**. El texto debe explicar qué medios se procesan, con qué finalidad, cuánto se conserva el material y cómo retirar el consentimiento. La persona responsable del negocio debe revisar el texto; Parallly Assist no inventa ni publica condiciones legales.

Cuando llega una imagen o un audio sin autorización vigente, el agente no conserva ni analiza ese archivo. Responde con una solicitud clara, enlaza la política pública y espera una confirmación explícita. Si la persona acepta, Parallly registra el alcance, la versión de la política, la fecha y la conversación que originó la autorización. Después pide reenviar el archivo original, porque el primero no se retuvo. Una respuesta ambigua o condicionada no concede permiso.

El consentimiento para medios cubre la extracción automática solicitada; no convierte la política en permiso general para reutilizar datos. El archivo fuente y la extracción temporal se eliminan al completar el turno. El mensaje final que recibe el cliente sigue la retención normal de la conversación. La autorización puede revocarse desde **Cumplimiento**, y también deja de ser válida cuando cambia la versión activa de la política o se ejecuta el borrado del contacto.

La seguridad de la cuenta de Parallly y la relación de pago con Meta son ámbitos distintos. La tarjeta que el negocio registra para cobros de WhatsApp se administra en Meta; no concede a Parallly acceso a los datos de la tarjeta. La política de privacidad del negocio gobierna el tratamiento de sus clientes dentro del agente. Revisa ambos controles por separado y prueba el agente con un archivo sintético después de publicar la política.

Si Salud del agente muestra **Privacidad para imágenes y audios**, abre la recomendación o el recorrido **Mostrarme cómo**. El bloqueo desaparece únicamente cuando existe una política de privacidad activa que el runtime puede mostrar; una política de envío, términos generales o un borrador no lo resuelve.
