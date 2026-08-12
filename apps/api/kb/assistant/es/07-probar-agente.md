---
id: probar-agente
title: "Probar tu agente antes de publicar"
routes: ["/admin/agent", "/admin/agent/simulation", "/admin/procedures"]
roles: ["tenant_admin"]
keywords: ["probar agente", "simulacion", "simular conversacion", "chat de prueba", "escenarios", "sinteticos", "historicos", "linea base", "regresion", "puntaje", "calidad del agente", "evaluar agente", "procedimientos", "sop", "procedimiento operativo", "compilar pasos", "palabras clave activacion", "flujo paso a paso", "testear bot", "antes de publicar"]
---

# Probar tu agente antes de publicar

Antes de dejar que tu agente de IA hable con clientes reales, conviene verificar cómo responde. Parallly te da tres herramientas para eso:

- **Chat de prueba** — conversa tú mismo con el agente, como si fueras un cliente.
- **Simulaciones** — decenas de "clientes simulados" conversan con tu agente y una IA evaluadora califica cada conversación.
- **Procedimientos (SOP)** — escribe tus procesos en lenguaje natural para que el agente los siga paso a paso, sin improvisar.

> Estas herramientas están disponibles para el rol **administrador**. **Agente IA** y **Procedimientos** están en **IA y crecimiento**.

## Cómo chatear con tu agente (chat de prueba)

Es la forma más rápida de ver a tu agente en acción:

1. En la barra lateral, ve a **IA y crecimiento** → **Agente IA**.
2. Abre el agente que quieres revisar.
3. Haz clic en el botón **Probar agente**.
4. Escribe como si fueras un cliente ("¿Qué precios manejan?", "¿Tienen disponibilidad el sábado?") y pulsa **Enviar**.
5. Con **Reiniciar** borras la conversación y empiezas de cero.

El chat de prueba es un espacio seguro: no crea contactos, no aparece en tu bandeja de entrada y no toca ninguna conversación real. Úsalo cada vez que cambies la personalidad, las reglas o la información del negocio, para confirmar que el agente responde como esperas.

## Cómo ejecutar una simulación

Cuando quieres una evaluación más completa que un par de mensajes manuales, usa las simulaciones. Piensa en ellas como un "control de calidad" automático de tu agente.

1. Entra a **Agente IA**, abre el agente y selecciona **Probar agente**.
2. En el panel **Nueva simulación**, elige el **Agente** que quieres evaluar.
3. En **Origen de escenarios**, elige cómo se generan los clientes de prueba:
   - **Sintéticos** — la IA genera clientes variados y realistas de tu industria: fáciles, escépticos, molestos, comparadores de precio, etc.
   - **Históricos** — reproduce conversaciones reales que tus clientes ya tuvieron, para ver cómo las manejaría el agente con su configuración actual.
4. Define el **Número de escenarios** a correr (50 por defecto; puedes ajustarlo).
5. (Opcional) En **Comparar con (línea base)** elige una simulación anterior: se reutilizan sus mismos escenarios para detectar si algo empeoró tras tus cambios.
6. Pulsa **Ejecutar simulación**.

La simulación corre en segundo plano: puedes seguir trabajando y volver después. En el panel **Historial** verás cada corrida con su estado — **En cola**, **Ejecutando**, **Completada** o **Fallida** — y el avance de escenarios evaluados.

> **Es 100% seguro:** la simulación nunca crea citas, pedidos ni descuentos reales. Las acciones del agente se desactivan durante la prueba; nada llega a tus clientes.

## Cómo leer los resultados

Al abrir una simulación completada verás:

- **Puntaje promedio** (0 a 10) — la calidad general de las respuestas del agente.
- **Tasa de resolución** — qué porcentaje de conversaciones el agente logró resolver.
- **Sub-puntajes por dimensión** — **Resolución**, **Tono**, **Precisión** y **Empatía**, para saber exactamente dónde está fuerte y dónde flojea.
- **Regresiones** — si elegiste una línea base, verás **Regresión detectada** cuando alguna respuesta empeoró respecto a la corrida anterior, o **Sin regresiones** si todo se mantuvo o mejoró.
- **Tabla de escenarios** — haz clic en cualquier escenario para ver la **transcripción** completa (cliente vs. agente) y los **problemas** que el evaluador detectó en esa conversación.

**Recomendación:** ejecuta una simulación cada vez que cambies la personalidad, las reglas, la base de conocimiento o los procedimientos de tu agente, y compárala con la línea base anterior. Así publicas cambios con evidencia, no con intuición.

## Cómo crear un procedimiento (SOP)

Los procedimientos le enseñan a tu agente a ejecutar procesos de tu negocio **paso a paso**: reembolsos, garantías, reclamos, calificación de leads… El agente decide cómo redactar cada mensaje con naturalidad, pero el flujo lo controla el procedimiento — por eso nunca se salta ni inventa pasos.

1. En la barra lateral, ve a **IA y crecimiento** → **Procedimientos**.
2. Elige cómo crearlo:
   - **Escribir SOP** (recomendado) — describe el procedimiento en lenguaje natural, por ejemplo: *"Cuando un cliente pida un reembolso, pídele el número de orden y verifica su estado; si está entregada ofrece un cupón, si no escala a un agente."* Luego pulsa **Compilar a pasos**: la IA lo convierte en una secuencia de pasos concretos que queda como **Borrador** para tu revisión.
   - **En blanco** — construye los pasos manualmente, uno por uno, con **Añadir paso**.
3. Revisa y ajusta los pasos. Cada paso es de uno de estos tipos:

| Tipo | Qué hace |
|------|----------|
| **Mensaje** | Comunica algo al cliente |
| **Preguntar** | Pide un dato al cliente y lo guarda (ej.: número de orden) |
| **Herramienta** | Ejecuta una acción (consultar un pedido, buscar un producto…) |
| **Condición** | Evalúa un dato y bifurca el flujo según el resultado |
| **Escalar** | Transfiere la conversación a una persona de tu equipo |

4. Pulsa **Guardar**.

### Activar el procedimiento

- Define las **Palabras que lo activan** (ej.: "reembolso, devolución, garantía"). Cuando un cliente menciona alguna, el procedimiento arranca automáticamente.
- Usa **Activar** para ponerlo en marcha o **Desactivar** para pausarlo sin borrarlo.
- Cada cambio incrementa la **versión** del procedimiento, así sabes siempre qué versión está en uso.

**Tip:** después de activar o modificar un procedimiento, pruébalo en el chat de prueba mencionando una de sus palabras de activación, y luego corre una simulación para verificar que el resto de conversaciones no se vio afectado.

## Preguntas frecuentes

**¿La simulación puede enviar mensajes a mis clientes reales?**
No. Todo ocurre en un entorno aislado: no se crean citas, pedidos, descuentos ni conversaciones reales, y ningún mensaje sale hacia tus canales conectados.

**¿Cuál es la diferencia entre el chat de prueba y la simulación?**
El chat de prueba eres tú conversando con el agente: ideal para revisiones rápidas y puntuales. La simulación corre decenas de conversaciones variadas con calificación automática: ideal antes de publicar cambios importantes.

**¿Qué es la "línea base" y para qué sirve?**
Es una simulación anterior que usas como punto de comparación. Al reutilizar sus mismos escenarios, Parallly puede decirte si un cambio que hiciste **empeoró** alguna respuesta que antes salía bien (una "regresión").

**¿Qué hago si aparece "Regresión detectada"?**
Abre los escenarios marcados, lee la transcripción y los problemas detectados, ajusta la configuración del agente (personalidad, reglas, conocimiento o procedimientos) y vuelve a ejecutar la simulación comparando con la misma línea base.

**¿Un buen puntaje garantiza que el agente es perfecto?**
No, pero reduce mucho el riesgo. Como referencia: 8 o más es un buen resultado; entre 5 y 8 conviene revisar los escenarios con menor puntaje; por debajo de 5, revisa la configuración antes de publicar.

**¿Quién puede usar estas herramientas?**
Solo el rol **administrador**. Si no ves estas opciones en el menú y las necesitas, pídele acceso al administrador de tu cuenta. ¿Dudas? Escríbenos en https://parallly-chat.cloud/support
