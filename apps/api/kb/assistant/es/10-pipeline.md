---
id: pipeline
title: "Embudo de ventas (pipeline)"
routes: ["/admin/pipeline", "/admin/settings/pipeline"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["embudo", "pipeline", "kanban", "etapas", "oportunidades", "negocios", "tratos", "deals", "auto-avance", "avance automatico", "aprobacion", "aprobar trato", "probabilidad", "color de etapa", "arrastrar tarjeta", "ganado", "perdido", "re-sincronizar", "condiciones de transicion"]
---

# Embudo de ventas (pipeline)

El embudo de ventas es tu tablero kanban de oportunidades: cada tarjeta es un negocio en curso con un contacto, y las columnas son las etapas de tu proceso de venta. Lo encuentras en la barra lateral, en **Embudo de ventas**.

Para no duplicar información, el tablero muestra **una tarjeta por contacto**, aunque esa persona tenga varias conversaciones contigo.

## Qué ves en el tablero

- **Indicadores arriba**: **Valor total** (suma de todas las oportunidades abiertas), **Ponderado** (valor ajustado por la probabilidad de cierre de cada etapa), **Oportunidades** y **Promedio**.
- **Columnas**: tus etapas, cada una con su color y sus tarjetas.
- **Tarjetas**: al hacer clic en una se abre su detalle, con valor, probabilidad, días en la etapa, historial de etapas, responsable asignado y accesos directos a **Ver conversación** y **Ver contacto**.

## Cómo mover una oportunidad de etapa

1. Entra a **Embudo de ventas**.
2. Arrastra la tarjeta a la columna de destino y suéltala.
3. Verás la confirmación "Oportunidad movida a…". Cualquier miembro del equipo puede mover tarjetas.

Si la etapa de destino tiene condiciones configuradas (por ejemplo, que el contacto tenga correo registrado), el sistema no dejará pasar la tarjeta hasta que se cumplan y te dirá exactamente qué falta.

## Cómo crear una oportunidad manualmente

La mayoría de las oportunidades se crean solas a partir de tus conversaciones, pero también puedes agregarlas a mano:

1. En **Embudo de ventas**, haz clic en **Nueva oportunidad**.
2. Completa el formulario: **Contacto**, **Título**, **Valor ($)**, **Etapa** y **Notas**.
3. Guarda. La tarjeta aparece en la etapa que elegiste.

## Cómo personalizar las etapas (orden, color y probabilidad)

Solo administradores y supervisores pueden hacerlo:

1. En **Embudo de ventas**, haz clic en **Personalizar etapas** (o ve a **Configuración → Etapas del pipeline**).
2. **Reordenar**: arrastra las etapas a la posición que quieras.
3. Para cada etapa puedes editar el **Nombre**, el **Color** y la **Probabilidad** de cierre (ese porcentaje alimenta el indicador **Ponderado** del tablero).
4. Marca las etapas de cierre como **Etapa final (cerrada)** — por ejemplo, Ganado o Perdido — y deja el resto como **Etapa activa**.
5. Usa **Agregar etapa** para crear nuevas (el máximo depende de tu plan) o el ícono de eliminar para quitarlas.
6. Guarda los cambios.

¿Prefieres empezar desde una base pensada para tu rubro? Haz clic en **Cargar preajustes de la industria**: reemplaza tus etapas por las estándar de tu vertical (recuerda guardar después). También tienes **Restaurar predeterminados** para volver a la configuración inicial.

### Condiciones de transición (opcional)

En **Configuración → Etapas del pipeline**, cada etapa tiene una sección de **Condiciones de Transición**: requisitos que el contacto debe cumplir para poder entrar a esa etapa. Puedes exigir, por ejemplo:

- Correo, teléfono o nombre completo registrados.
- Un puntaje (score) mínimo del lead.
- Un asesor humano asignado.
- Una cita agendada o una cotización comercial activa.
- Un dato personalizado con cierto valor (por ejemplo, "ciudad = Bogotá").

Estas condiciones aplican tanto a los movimientos manuales como al avance automático.

## Avance automático por señales de la conversación

Parallly puede mover las oportunidades por el embudo sin que nadie toque el tablero: analiza las señales de cada conversación (interés, preguntas por precio, intención de compra) y avanza la tarjeta a la etapa que corresponde.

- **Activar o desactivar**: en la parte superior de **Embudo de ventas** está el interruptor **Auto-avance** (visible para administradores y supervisores; también aparece en **Configuración → Etapas del pipeline** como **Avance automático de etapas**). Apágalo si prefieres gestionar las etapas 100% a mano; puedes volver a encenderlo cuando quieras.
- **Re-sincronizar**: el botón **Re-sincronizar** (junto al interruptor) re-alinea las oportunidades existentes con su etapa correcta. Úsalo después de cambiar tus etapas o de encender el auto-avance, y verás cuántas oportunidades se ajustaron.

El avance automático respeta tus condiciones de transición: si falta un requisito, la tarjeta no avanza.

## Estado de la aprobación de tratos

La interfaz contiene elementos de aprobación, pero **el circuito de solicitud, revisión y bloqueo de etapas finales no está certificado de extremo a extremo en la versión actual**. No lo uses como control financiero o de auditoría: un movimiento directo puede cambiar la etapa sin completar esa revisión. Hasta que el panel indique que el flujo está disponible, limita operativamente los cierres a administradores/supervisores y revisa el historial de cada oportunidad.

## Preguntas frecuentes

**¿Quién puede mover tarjetas y quién puede cambiar las etapas?**
Mover tarjetas: todo el equipo (administrador, supervisor y agentes). Personalizar etapas, condiciones y el interruptor de auto-avance: solo administradores y supervisores.

**Activé el auto-avance pero mis oportunidades siguen donde estaban. ¿Qué hago?**
Haz clic en **Re-sincronizar** en la cabecera del embudo: el auto-avance actúa sobre las conversaciones nuevas, y la re-sincronización acomoda las oportunidades que ya existían.

**¿Puedo eliminar una oportunidad?**
Desde su detalle puedes usar **Archivar**: la oportunidad se marca como perdida y deja de aparecer en el tablero.

**¿Por qué no puedo arrastrar una tarjeta a cierta etapa?**
Esa etapa tiene condiciones de transición sin cumplir (correo, teléfono, score mínimo, cita, etc.). El mensaje de error te dice exactamente qué falta; completa ese dato en la ficha del contacto e inténtalo de nuevo.

**¿El valor "Ponderado" qué significa?**
Es la suma de cada oportunidad multiplicada por la probabilidad de su etapa. Por eso conviene asignar probabilidades realistas al personalizar tus etapas.

**¿Dónde configuro el puntaje (score) de mis leads?**
En **Configuración → Lead Scoring** puedes ajustar los pesos, las palabras clave de compra y el decaimiento por inactividad.

¿Necesitas ayuda? Escríbenos en https://parallly-chat.cloud/support
