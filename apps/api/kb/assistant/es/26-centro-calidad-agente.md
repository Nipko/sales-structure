---
id: centro-calidad-agente
title: "Centro de calidad del agente"
routes: ["/admin/agent/quality"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["centro de calidad", "calidad del agente", "preparacion", "calidad probada", "evidencia de produccion", "agente en riesgo", "listo para piloto", "configuracion incompleta", "revision requerida", "recomendaciones", "debilidades del agente", "mejorar agente"]
---

# Centro de calidad del agente

El **Centro de calidad** muestra qué falta configurar, qué se ha probado y qué ocurre
en conversaciones reales para cada agente IA. Está en **Insights → Centro de
calidad**. Admin y Supervisor pueden consultarlo; solo Admin puede editar agentes,
conexiones o configuración desde **IA y crecimiento → Agente IA**.

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

## Preguntas frecuentes

**¿El checklist de configuración es lo mismo que el Centro de calidad?**
No. El checklist orienta la adopción inicial. El centro añade pruebas repetibles y
evidencia atribuida de producción.

**¿Un buen puntaje de simulación basta para publicar?**
No. Ayuda a reducir riesgo, pero debe revisarse junto con bloqueos críticos, vigencia
de la versión y evidencia real cuando esté disponible.

**¿El sistema aprende y cambia solo con cada conversación?**
No. Las interacciones generan diagnósticos y recomendaciones; una persona revisa y
aprueba cualquier cambio antes de volver a probarlo.
