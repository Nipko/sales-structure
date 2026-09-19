> **Nota de verificación (16-sep-2026).** Las cifras del §2 no tienen fuente primaria: "72 %" (Tidio) es una estadística genérica de un roundup; "60 %" (Wati) y "85 %" (Calendly) no aparecen en ninguna fuente; "Duolingo 25 % → 89 %" está contradicho (el caso documentado es 8,9 % de conversión y +20 % por progreso dotado). Wati NO permite probar el bot antes de conectar Meta (su probador exige un número conectado). La premisa LEGO coincide con lo que sí dicen los referentes verificados (ver `docs/onboarding-diagnosis-2026-09.md` §5 y su workdir), pero el plan técnico del §7 asume que hay que construir un flujo que ya existe: el asistente de 3 pasos, la tarjeta de puesta en marcha y los recorridos guiados están desplegados desde el 4-sep; el problema vigente son las capas que se montaron encima entre el 6 y el 14 de septiembre (diagnóstico §3.2).

# Investigación Maestra de Benchmarks UX y Diagnóstico Definitivo de Onboarding

**Proyecto:** Parallly Conversational AI Platform  
**Fecha:** Septiembre 2026  
**Documento Complementario:** `docs/onboarding-video-transcript-analysis.md`

---

## 1. Introducción y Premisa Central

La premisa de Parallly es innegociable: **cualquier dueño de negocio o persona no técnica (un odontólogo, un dueño de restaurante, una academia de baile o un asesor inmobiliario) debe poder tener un agente de IA funcional, seguro y comercialmente decente configurado en un máximo de 20 minutos**.

La experiencia debe sentirse como **armar piezas de LEGO**:
* Encajar bloques prefabricados y coherentes entre sí.
* Tomar decisiones binarias o de opción múltiple (A o B, Sí o No).
* Cero redacción de prompts o instrucciones desde hojas en blanco.
* Cero exposición a jerga técnica o infraestructura interna (tokens, modelos LLM, revisiones operacionales, estados de borrador, webhooks, colas BullMQ).
* Gratificación instantánea y prueba en vivo antes de conectar canales oficiales.

---

## 2. Investigación Exhaustiva de Benchmarks Mundiales (Product Teardowns)

Para lograr que una plataforma hiper-compleja por debajo sea absurdamente simple por fuera, investigamos cómo los líderes globales del software B2B, automatización conversacional e IA resolvieron exactamente este desafío:

---

### CASO 1: Tidio (Lyro AI) — El campeón del Time-to-Value (< 10 minutos)
* **El problema histórico:** Configurar bots en Tidio requería diagramar árboles de decisión condicionales de 30 nodos. El 72% de los usuarios abandonaba antes de terminar.
* **Mecanismos clave de Lyro AI:**
  1. **Cero ingeniería de prompts:** Eliminaron el campo de "System Prompt". La entrada es una URL o un archivo de preguntas frecuentes.
  2. **Playground Sandbox Inmediato:** En el minuto 3, antes de conectar cualquier canal, se abre una ventana de chat en pantalla partida con 3 preguntas autogeneradas sugeridas: *"Pregúntame por costos de envío"*. El usuario ve a la IA responder con datos de su empresa casi de inmediato.
  3. **Handoff binario:** Solo preguntan: *"¿A qué correo o asesor transferimos cuando el bot no sepa la respuesta?"*.
* **Lección para Parallly:** Probar el agente en un simulador sandbox antes de conectar canales dispara la dopamina y valida el producto en menos de 5 minutos.

---

### CASO 2: ManyChat — Cómo incorporar a más de 1 millón de no-técnicos
* **El problema histórico:** El motor de flujos (*Flow Builder*) de ManyChat es potente pero intimidante. Mostrarlo el Día 1 causaba parálisis por análisis.
* **Mecanismos clave de ManyChat:**
  1. **El puente de "Quick Automations":** Un usuario nuevo jamás ve el Flow Builder en sus primeros días.
  2. **Plantillas por Intención de Negocio:** Ofrecen 3 tarjetas prediseñadas: *"Auto-responder comentarios con link de compra"*, *"Capturar WhatsApp de leads"*, *"Enviar cupón de bienvenida"*.
  3. **Personalización en 3 clics:** Al elegir una plantilla, el flujo ya está 100% armado; solo tiene 2 campos para cambiar el texto del mensaje y el enlace.
  4. **Graduación progresiva:** Solo tras comprobar que la automatización rápida funciona, el usuario es invitado a explorar el Flow Builder semanas después.
* **Lección para Parallly:** El usuario novato no debe enfrentarse al editor avanzado de 8 tarjetas y 4 pestañas; debe empezar con una "Automatización Rápida Vertical" prediseñada.

---

### CASO 3: Gorgias AI Agent — El estándar de oro en E-commerce
* **El problema histórico:** Integrar IA con inventarios, devoluciones y pedidos exigía mapear APIs y crear reglas lógicas contradictorias.
* **Mecanismos clave de Gorgias:**
  1. **Reemplazo de Prompts por "Guidance":** En lugar de pedirle al usuario que redacte instrucciones en lenguaje de sistema, crearon formularios declarativos con lenguaje natural:
     - *Política de Cambios:* [30 días sin costo con ticket de compra].
     - *Tiempos de Despacho:* [2 a 4 días hábiles].
  2. **El "20-Minute Ticket Audit":** Analizan las 5 dudas más comunes del sector e inyectan respuestas pre-redactadas.
  3. **Separación de Lógica:** La IA solo consulta el catálogo y las políticas aprobadas; tiene prohibido alucinar plazos o precios.
* **Lección para Parallly:** Las políticas y reglas comerciales no se redactan en un prompt libre; se completan en tarjetas declarativas guiadas.

---

### CASO 4: Chatbase — La secuencia lineal inquebrantable
* **Mecanismos clave:** Redujeron el embudo de activación a 4 pasos estrictos:
  1. Ingesta de datos (URL, PDF o texto).
  2. Generación automática del modelo (2 minutos de procesamiento con barra de progreso).
  3. **Playground interactivo inmediato** en el navegador.
  4. Un solo botón de despliegue: "Integrar / Conectar".
* **Lección para Parallly:** Linealidad absoluta. Nada de pestañas dispersas ni menús laterales durante el onboarding.

---

### CASO 5: Wati y Kommo — La realidad de WhatsApp en Latinoamérica
* **El dilema de la API oficial de WhatsApp:** El proceso de Meta Cloud API / Embedded Signup es el punto de mayor fricción del ecosistema (requiere Meta Business Manager, verificación por SMS/llamada, permisos de Facebook).
* **Mecanismos clave:**
  1. **Diferir la conexión:** Wati permite entrenar, probar y validar el bot en el navegador antes de exigir el registro de Meta. Si pides Meta en el minuto 2, el 60% de los usuarios abandona porque no tiene las contraseñas de Facebook a mano.
  2. **Mapeo visual de ventas (Kommo):** Cada interacción en WhatsApp alimenta automáticamente una columna en un pipeline comercial (*Lead entrante ➔ Calificado ➔ Cotizado ➔ Agendado*). El usuario percibe retorno de inversión comercial, no solo un juguete tecnológico.
* **Lección para Parallly:** WhatsApp se conecta al final o se deja para después sin bloquear el resto de la plataforma.

---

### CASO 6: Shopify, Canva, Calendly y Duolingo — Principios Psicológicos de Retención
* **Shopify (Lienzo precargado):** Nunca entrega una tienda vacía; entrega 3 productos de ejemplo con fotos y precios que el usuario solo edita.
* **Canva (Plantillas por intención):** Elimina el lienzo gris de Photoshop; eliges "Menú de restaurante" y solo editas los nombres de los platos.
* **Calendly (Defaults sabios):** Viene con Lunes a Viernes de 9:00 AM a 5:00 PM por defecto. El 85% de los usuarios nunca toca la configuración avanzada de buffers.
* **Duolingo (Endowed Progress Effect):** Si el usuario siente que empieza en 0%, abandona. Si le muestras que ya tiene el 25% completado gracias a su registro, la tasa de finalización sube al 89%.

---

## 3. Conclusiones y Diagnóstico del Caso Real en Video (`parallly_onboarding.mp4`)

El análisis forense de la grabación de 48 minutos con **Nataly** (Bogotá Dance Club), **Germán** y **Felipe** demostró empíricamente todas las patologías diagnosticadas en la arquitectura actual:

1. **La búsqueda ciega:** La usuaria escribió "Identidad" en el buscador y cayó en la pantalla de deduplicación de contactos CRM (`/admin/identity`), sintiéndose perdida a los 11 segundos de iniciar.
2. **Saturación y pánico visual:** Tres banners compitiendo a la vez (`<AgentReadinessBanner>`, `<AgentAssessmentPanel>`, `<HelpPanel>`). La usuaria exclamó textualmente: *"No... ya me perdí"*.
3. **La tortura de redactar prompts:** Nataly tuvo que redactar desde cero las instrucciones comerciales ("Eres nuestro asistente comercial...") mientras su socio le dictaba frases durante 4 minutos.
4. **La ilusión de las herramientas:** Al encender el toggle de "Catálogo de productos", Nataly preguntó con lógica aplastante: *"¿Y si le doy aquí, cómo lo configuro? ¿Es solo prender y apagar para luego en otro lado meter la información? Muy genérico..."*.
5. **Accidentes destructivos:** Al hacer clic en el chip de WhatsApp para "configurarlo", lo desasignó de inmediato, entrando en pánico (*"¡Ay! ¿Ahí la quité? ¡Ay no!"*).
6. **El bloqueo de guardado:** Pulsó "Guardar borrador" y el sistema arrojó un banner rojo punitivo: *"Faltan datos obligatorios para guardar"*, sin señalar dónde estaba el error.
7. **La trampa del Inicio (Checklist interminable):** Al ir a la página de Inicio, se encontró con 8 tareas pendientes en la tarjeta de "Puesta en marcha", suspirando: *"O sea, tendría que trabajar en todos estos..."*.
8. **El muro de Meta y el abandono forzado:** Tras 48 minutos de esfuerzo, llegaron a la conexión de Meta, se encontraron con requisitos de Facebook no disponibles en esa máquina, arrojó un error de autorización y se despidieron con la sesión frustrada y ningún agente en producción.

---

## 4. La Arquitectura Definitiva: El Sistema LEGO de 20 Minutos

Para erradicar estas fallas, la experiencia de Parallly se dividirá en dos fases estrictamente desacopladas:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      DÍA 0: ONBOARDING LEGO (20 MIN)                    │
│   (Flujo cerrado, lineal, sin banners técnicos, sin menús laterales)    │
├─────────────────────────────────────────────────────────────────────────┤
│ 🧩 Pieza 1: Identidad y Voz        ➔ 3 arquetipos visuales. Cero prompts│
│ 🧩 Pieza 2: Oferta y Catálogo      ➔ 4-5 servicios precargados con $   │
│ 🧩 Pieza 3: 5 Dudas Clave          ➔ Preguntas frecuentes con 1 dato   │
│ 🧩 Pieza 4: Horario y Traspaso     ➔ Horario default + WhatsApp asesor │
│ 🧩 Pieza 5: Simulador Sandbox      ➔ Chat WhatsApp en vivo (Aha! Moment)│
│ 🏁 Final: Conexión WhatsApp / Meta  ➔ Opcional; diferible en 1 clic      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
       Si abandona a mitad de camino ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                ESTACIÓN DE CONTINUACIÓN EN EL DASHBOARD                 │
│   "Tu agente está al 60% (Faltan 5 min) 👉 [Continuar donde quedé ➔]"  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
          Una vez completado el setup ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   DÍA 1+: MODO TRADICIONAL + SUPERPODERES               │
│   (Editor completo + Galería de Recetas de Crecimiento en 1 Clic)       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Especificación de los 5 Bloques LEGO

### Bloque 1: Identidad y Voz (Tiempo estimado: 3 min)
- **Datos previos:** La vertical ya se conoce desde `/onboarding` (ej. *Academia de Baile*).
- **Nombre sugerido:** Pre-llenado (ej. *Geraldine*).
- **Arquetipos de Personalidad (3 tarjetas grandes con avatar):**
  1. *Cálido y Comercial:* Cercano, usa emojis, enfocado en resolver dudas y entusiasmar al cliente.
  2. *Profesional y Formal:* Respetuoso, directo, ideal para servicios clínicos o corporativos.
  3. *Ágil y Rápido:* Respuestas breves, ideal para delivery y soporte inmediato.
- **Saludo de bienvenida:** Generado automáticamente con variables de la empresa.
- **Mensaje de contingencia (Fallback):** 3 opciones profesionales listas con radio button (ej. *"Con gusto te comunico con uno de nuestros asesores para brindarte información detallada"*). Cero redacción de "mi humano".

### Bloque 2: Oferta y Catálogo (Tiempo estimado: 5 min)
- Cero tablas de base de datos vacías.
- Se presentan 4 a 5 servicios típicos de su rubro ya leídos del manifiesto vertical:
  - `[✓]` Clase Personalizada de Baile — Precio: `[ $ 60.000 ]`
  - `[✓]` Mensualidad Clases Grupales — Precio: `[ $ 180.000 ]`
  - `[✓]` Clase de Prueba Individual — Precio: `[ $ 25.000 ]`
  - `[ ]` Alquiler de Salones para Eventos — *(Desmarcado por defecto)*
- La usuaria solo ajusta precios o desmarca los que no ofrece.

### Bloque 3: Las 5 Dudas Clave (Tiempo estimado: 4 min)
- 5 tarjetas con las preguntas obligatorias del sector pre-redactadas con campos entre corchetes:
  1. 📍 **Ubicación:** *"Nuestra sede principal queda en [ Calle 100 #15-20, Bogotá ]."*
  2. 💳 **Medios de Pago:** *"Aceptamos [ Tarjetas, Nequi, Daviplata y Efectivo ]."*
  3. ⏰ **Horarios de Atención:** *"Atendemos de [ Lunes a Sábado de 8:00 AM a 8:00 PM ]."*
  4. 📅 **¿Cómo reservar?:** *"¿El agente puede registrar citas en el calendario?"* `[ SÍ / NO ]`.
  5. 🛡️ **Cancelaciones:** *"Puedes reprogramar tu clase con [ 2 horas ] de anticipación."*

### Bloque 4: Horario y Traspaso Humano (Tiempo estimado: 3 min)
- **Horario de atención:** Default sabio seleccionado (Lunes a Viernes 8am-6pm, Sábados 9am-1pm).
- **Traspaso:** Una sola pregunta humana: *"¿A qué número de WhatsApp o correo enviamos la alerta cuando un cliente quiera cerrar la compra o pida un asesor?"* `[ +57 300 123 4567 ]`.

### Bloque 5: El Simulador Sandbox en Vivo (Tiempo estimado: 5 min)
- Pantalla dividida interactiva.
- A la izquierda: Resumen visual de las 4 piezas LEGO ensambladas con checks verdes.
- A la derecha: Chat idéntico a WhatsApp Web conectado en tiempo real con el motor del agente.
- **Chips de prueba con 1 solo clic:**
  - `[ 💰 Preguntar precio de clases personalizadas ]` ➔ El agente responde cotizando.
  - `[ 📍 Preguntar ubicación de la sede ]` ➔ El agente responde con la dirección cargada en la Pieza 3.
  - `[ 👤 Pedir hablar con un asesor ]` ➔ El agente responde transfiriendo al WhatsApp del Bloque 4.
- **Aha! Moment:** El usuario comprueba con sus propios ojos que su agente funciona, es coherente y está listo.

### Cierre: Conexión Oficial o Guardado para Después
- Botón Primario: **`[ Conectar WhatsApp Oficial Ahora ➔ ]`** (Embedded Signup).
- Botón Secundario: **`[ Terminar por hoy y conectar después ]`** (El agente queda publicado internamente; un banner limpio en el Dashboard permitirá conectar WhatsApp cuando tengan la SIM card a mano).

---

## 6. La Estación de Reanudación y el Día 2 (Superpoderes)

### Manejo del Abandono (The Resume Station)
Si la persona cierra el navegador en el Bloque 2 o 3:
* **Persistencia total:** Guardado automático reactivo en base de datos (`tenant_id`, `step`, `state_json`).
* **En el Dashboard (`/admin`):**
  - Se silencian todos los gráficos en cero y alertas de salud técnica.
  - Se despliega una tarjeta prominente de continuación:
    ```
    ┌──────────────────────────────────────────────────────────────┐
    │ 🧩 ¡Tu agente Geraldine está casi lista!                     │
    │ Progreso: [████████████░░░░░░░░] 60% (Faltan aprox. 5 min)  │
    │ ✓ Voz  ✓ Servicios  ⏳ 5 Dudas clave  ⚪ Traspaso            │
    │                                                              │
    │   👉 [ Continuar armando tu agente (Paso 3) ➔ ]              │
    └──────────────────────────────────────────────────────────────┘
    ```
  - Un solo clic regresa a la pantalla y campo exactos.

### El Día 2: Banco de Superpoderes con 1 Clic (Modelo Zapier/ManyChat)
Una vez completado el agente, la plataforma tradicional no se muestra como un conjunto de formularios vacíos, sino que ofrece una pestaña de **"Superpoderes"**:
* ⚡ *Receta 1: Recordar clases 24h antes por WhatsApp* `[Activar con 1 clic]`.
* ⚡ *Receta 2: Manejo de objeción de precio ("Está costoso")* `[Activar con 1 clic]`.
* ⚡ *Receta 3: Re-enganche a alumnos inactivos hace 30 días* `[Activar con 1 clic]`.
* Cada receta viene con el prompt, la regla y el mensaje redactados; el usuario solo modifica variables si lo desea.

---

## 7. Próximos Pasos Técnicos para la Ejecución

Con este marco de referencia y la validación de la sesión grabada, los componentes a intervenir en el código son:
1. **Creación del endpoint unificado:** `POST /api/v1/persona/:tenantId/quick-setup` para guardar los 5 bloques en una sola transacción segura.
2. **Rediseño completo de `/admin/setup-wizard`:** Reemplazo de la vista actual por el contenedor visual de los 5 Bloques LEGO, eliminando `<AgentAssessmentPanel>`, `<AgentDraftStatus>` y el `<HelpPanel>` abrumador.
3. **Módulo de Reanudación en `/admin`:** Crear `<LegoResumeHero />` para que sustituya la tarjeta de tareas pendientes cuando el onboarding no se haya completado.
4. **Catálogo vertical pre-ensamblado:** Integrar los diccionarios de servicios y FAQs por vertical en el frontend para evitar llamadas vacías.
