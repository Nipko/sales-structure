# La experiencia de configuración guiada — diseño objetivo (septiembre 2026, v1.1)

> **Actualización del 18-sep-2026:** conservar este documento como diseño base e historia de decisiones. La [propuesta v2 investigada](onboarding-experience-plan-v2-2026-09.md) plantea cambios de recorrido, confirmación de hechos, activación y medición; todavía no se declara implementada ni validada con usuarios. Para lo construido y pendiente consultar la [auditoría técnica](onboarding-review-and-completion-plan-2026-09-18.md). Las reglas de seis pasos, diez minutos universales, cero avisos y rojo solo para regresiones se revisan explícitamente en v2.

> **Qué es este documento.** El diseño completo de la experiencia que queremos que viva cualquier persona sin conocimientos técnicos al configurar su agente en Parallly: el día 0 (onboarding), el después (mejorar y cambiar cosas) y el panel de salud. No es una lista de arreglos: es la experiencia nueva. La evidencia de por qué la actual no sirve está en `docs/onboarding-diagnosis-2026-09.md`; aquí se usa solo cuando explica una decisión.
> **Alcance.** Los cinco canales conversacionales (WhatsApp, Instagram, Messenger, Telegram y el chat web) en pie de igualdad; las 18 industrias y sus subtipos como fuente de ejemplos y sugerencias; escritorio y celular.
> **Estado histórico al redactar v1.1.** Diseño previo a su implementación. Posteriormente se construyeron partes de las olas 1–7 y comenzó la 8; el estado actual está en la auditoría enlazada arriba. **v1.1** incorporó la revisión adversarial de tres lentes (dueña sin conocimientos, factibilidad sobre el código real, contenido por rubro): 33 huecos, de los cuales 4 eran bloqueantes y quedaron resueltos en el diseño; el detalle está en `docs/onboarding-diagnosis-2026-09-workdir/design_review_*.md` y el resumen en §12.

---

## 0. La promesa

> **En diez minutos, una persona que nunca configuró nada ve a su agente responder a un cliente por el canal que su negocio usa, con ejemplos ya escritos para su rubro, y puede cambiar cualquier cosa tocándola.**

Tres cambios de enfoque respecto de lo que hay hoy:

1. **De "llenar formularios" a "confirmar ejemplos".** Conocemos el negocio desde que eligió su rubro. Cada pantalla llega con un ejemplo completo, usable tal cual, y la persona solo confirma o cambia. Nunca una hoja en blanco.
2. **De "una pantalla con todo" a "una decisión por pantalla".** Cada paso tiene un título en forma de pregunta, una línea que dice por qué importa, el ejemplo, dos botones (Usar así / Después) y una victoria visible al terminar.
3. **De "WhatsApp o nada" a "por donde te escriben tus clientes".** El canal es una elección múltiple guiada con la misma anatomía para los cinco, y el agente tiene desde el primer minuto **su propio enlace** para probarlo y mostrárselo a un socio antes de conectar cualquier canal.

---

## 1. Cómo se tiene que sentir

| Sensación | Cómo se logra | Cómo se comprueba |
|---|---|---|
| **"Ya está casi hecho."** | La receta del rubro prellena nombre, saludo, qué vende, preguntas frecuentes, reglas y horario; el progreso arranca en 2 de 6, no en 0 | Al entrar al paso 2 ya hay ≥4 tarjetas con contenido |
| **"Entiendo qué me piden y por qué, en una línea."** | Título en pregunta + una frase de por qué + un plegable "¿Por qué me preguntan esto?" de dos frases | ≤60 palabras visibles antes del ejemplo |
| **"Puedo usar el ejemplo tal cual."** | Los ejemplos son completos y del rubro; lo que no sabemos (precios, dirección) se ve como espacio por llenar, nunca como dato inventado | "Usar así" deja el paso listo sin escribir; lo pendiente se dice en una línea |
| **"Cambiar es tocar."** | Editar en el mismo lugar, con sugerencias en chips; nunca "ve a Ajustes → …" | Toda tarjeta tiene "Cambiar" que abre la edición inline |
| **"Veo que funciona."** | Cada paso termina con algo que se ve: una respuesta del agente, un "conectado", el primer mensaje respondido | Evento de victoria registrado por paso |
| **"Nadie me apura ni me grita."** | Ni banners, ni popups, ni avisos rojos, ni jerga mientras está en el recorrido; "Después" siempre disponible, con memoria y con su consecuencia dicha | Cero superficies fuera del paso |

---

## 2. La anatomía de un paso (la regla que aplica a todo)

Cada pantalla del día 0, y cada tarjeta de configuración del después, sigue esta plantilla. Es la unidad de la experiencia y el contrato para diseño, copy e ingeniería.

```
┌──────────────────────────────────────────────────────────────────┐
│ Paso 2 de 6 · tarjeta 1 de 4 · ~1 min                             │
│                                                                  │
│ ¿Qué ofreces y desde cuánto?                     ← título-pregunta│
│ Con esto tu agente responde "¿cuánto cuesta?" sin inventar.       │
│                                                     ← por qué (1) │
│ ┌──────────────── Ejemplo para una academia de baile ───────────┐ │
│ │ ✓ Clase de prueba (60 min) ........ gratis                    │ │
│ │ ✓ Mensualidad grupal .............. [ $180.000 ] ejemplo      │ │
│ │       [Poner mi precio]  [Por ahora no lo dice]               │ │
│ │ ✓ Clase personalizada (60 min) .... [ $60.000 ] ejemplo       │ │
│ │ ○ Alquiler de salón ............... a cotizar                 │ │
│ │                                     [+ agregar otro]          │ │
│ └───────────────────────────────────────────────────────────────┘ │
│ Sugerencias: [Clases para niños] [Paquete 8 clases] [Eventos]    │
│                                                                  │
│ ▸ ¿Por qué me preguntan esto?                                     │
│                                                                  │
│                        [ Después ]   [ Usar así → ]              │
│ Tus precios quedan como ejemplo: Valentina no los dirá hasta     │
│ que los confirmes. Tócalos cuando quieras.                       │
└──────────────────────────────────────────────────────────────────┘
```

Reglas:

- **Una decisión por pantalla.** Si hay dos, son dos pantallas. En celular, cada tarjeta del paso 2 es su propia pantalla (2a-2d) con la misma barra de progreso; en escritorio se ve la columna con una tarjeta expandida a la vez.
- **Título en pregunta, en segunda persona, con las palabras del rubro** ("clases", no "productos"; "pacientes", no "leads").
- **Una línea de por qué**, siempre en términos de lo que el cliente final va a preguntar.
- **El ejemplo es completo y del rubro.** Nunca "Ej.: …" en gris dentro de un campo vacío: el contenido está puesto y editable. **Lo que no sabemos se ve distinto:** un precio de ejemplo va en contorno punteado con la píldora "ejemplo" y dos chips [Poner mi precio] [Por ahora no lo dice]; una dirección que no dijo es un espacio `[dirección]`. "Usar así" confirma nombres y duraciones; **nunca confirma un precio ni un dato que la persona no puso**. Mientras un precio sea ejemplo, el agente no lo dice: "Sí tenemos [servicio]; el valor exacto te lo confirmo en un momento. ¿Te cuento horarios o te reservo?".
- **Sugerencias en chips** que agregan o reemplazan con un toque; vienen de la receta del rubro y de lo que la persona ya dijo.
- **Dos botones**: "Usar así" y "Después". "Cambiar" es tocar el contenido. **"Después" sobre algo esencial dice su consecuencia en el mismo lugar antes de salir** ("Sin esto, Valentina tomará los datos de quien pida clase y te avisará para que tú confirmes") y reaparece como el único siguiente paso en Inicio.
- **Victoria visible y honesta** al cerrar el paso: un check en la tarjeta y una frase que dice exactamente lo que ya puede hacer ("Ya sabe qué ofreces. Los precios los confirma con una persona hasta que los pongas").
- **Plegable "¿Por qué me preguntan esto?"**: dos frases, sin jerga, con un ejemplo de conversación de cliente.
- **Nada más en pantalla**: ni banner de prueba, ni aviso de instalar, ni mascota, ni ayuda lateral, ni estado de versiones. La ayuda es el paso.
- **Cabe en un celular** a 390 px sin overlays; los chips se apilan.

---

## 3. El motor de sugerencias: la receta del negocio

Todo lo que se prellena sale de una **receta**. Una receta tiene dos niveles: la de la **industria** (esquema completo) y una **capa por subtipo** con solo lo que cambia (servicios, las 5 preguntas, saludo, motivos de pase a persona, canales, preguntas de prueba). Hoy el registro tiene una parte de esto y solo cuatro industrias varían algo por subtipo; el resto de los 79 subtipos es una etiqueta (los cuatro de academias entraron el 17-sep con receta propia).

### 3.1 Qué contiene una receta (esquema) y qué existe hoy

Verificado en el registro de verticales (`vertical-definitions.ts`) por la revisión de contenido:

| Campo | Existe hoy | Para qué paso | Ejemplo (academia de baile) |
|---|---|---|---|
| Nombre y rol del agente | 15 de 18 tienen nombre humano; faltan `otro`, `event_planning`, `construccion`; el rol es genérico en todas | Conoce a {Nombre} | "Valentina · Asesora de clases" |
| Saludo | Existe en 15; genérico | Conoce a {Nombre} | "¡Hola! Soy Valentina, de {negocio}. ¿Buscas clases para ti, para tu pareja o para un niño?" |
| Vocabulario del rubro | Existe (terminology) | Todos | clase, alumno, sede, horario de clases, clase de prueba |
| Qué ofrece (3-5 ítems con precio de ejemplo, duración y **estado del precio**) | Servicios existen (3-9 por industria), marcados `example`/`quote` desde D10 y **sembrados en la moneda del país** desde la Ola 4: el precio del registro es una referencia en COP, no un precio | ¿Qué ofreces? | Clase de prueba (gratis, 60 min) · Mensualidad grupal 2/semana ($180.000 ejemplo) · Clase personalizada 60 min ($60.000 ejemplo) · Paquete 8 clases ($ ejemplo) · Alquiler de salón (a cotizar) |
| Modo de compra (`appointment` · `class` · `table` · `order` · `quote` · `inform`, con default por industria y varios a la vez) | **Existe desde la Ola 4 (17-sep)** en 6 industrias (belleza, salud, restaurantes, retail, educación, servicios del hogar) y sus subtipos, 38 de 104 ámbitos; el lint reporta el resto (`purchaseModes`) | ¿Cómo te compran? | `class`: clase de prueba con fecha y hora |
| Las 5 preguntas que siempre hacen, con respuesta y espacios `[ ]` | Las FAQ sembradas siguen esquivando; las 5 preguntas **con espacios** existen desde la Ola 4 (`canonicalQuestions`) en 6 industrias, y el lint rechaza una que contenga una palabra de escalado | Lo que ya sabe | "¿Dónde quedan?" → "Estamos en [dirección], [cómo llegar]." |
| Instrucciones principales (2-3 frases) | **Existe desde la Ola 4 (17-sep)** en 6 industrias (belleza, salud, restaurantes, retail, educación, servicios del hogar) y sus subtipos, 38 de 104 ámbitos; el lint reporta el resto (`mainInstructions`) | Editor (oculto en el día 0) | "Ayudas a quien escribe a encontrar la clase que le sirve…" |
| Cuando no sabe (3 opciones) | **Existe desde la Ola 4 (17-sep)** en 6 industrias (belleza, salud, restaurantes, retail, educación, servicios del hogar) y sus subtipos, 38 de 104 ámbitos; el lint reporta el resto (`whenUnsure`, tres salidas redactadas) | Conoce a {Nombre} | ver §3.3 |
| Cuándo pasa a una persona: **motivos** (texto visible, 3-5, con tilde) + **disparadores** (ocultos, bajo Avanzado) | Los disparadores siguen sin tilde (el motor compara el texto crudo); los **motivos visibles** existen desde la Ola 4 (`handoffReasons`) y el lint exige que cada uno tenga un disparador que lo haga cierto | Conoce a {Nombre} | motivos: "quiere inscribirse y pagar ya", "pide descuento o beca", "evento privado", "lesión o condición médica", "queja" |
| Reglas (3-5) | Existen, en voseo rioplatense en varias industrias | Editor | "Nunca confirmes un cupo sin verificar disponibilidad" |
| Horario típico | Existe | Dónde y cuándo | Lun-Vie 7:00-21:00, Sáb 8:00-14:00 |
| Canales recomendados y por qué | **Existe desde la Ola 4 (17-sep)** en 6 industrias (belleza, salud, restaurantes, retail, educación, servicios del hogar) y sus subtipos, 38 de 104 ámbitos; el lint reporta el resto (`recommendedChannels`, con el porqué) | ¿Por dónde te escriben? | Instagram y WhatsApp: "las academias reciben la mayoría de consultas por Instagram" |
| Tres preguntas de prueba | **Existe desde la Ola 4 (17-sep)** en 6 industrias (belleza, salud, restaurantes, retail, educación, servicios del hogar) y sus subtipos, 38 de 104 ámbitos; el lint reporta el resto (`testQuestions`) | Conoce a {Nombre} | "¿Cuánto cuestan las clases?" · "¿Tienen bachata los sábados?" · "Quiero una clase de prueba" |
| Tres ejemplos de conversación | **Existe desde la Ola 4 (17-sep)** en 6 industrias (belleza, salud, restaurantes, retail, educación, servicios del hogar) y sus subtipos, 38 de 104 ámbitos; el lint reporta el resto (`conversationExamples`) | ¿Por qué me preguntan esto? | Cliente: "hola, info de salsa" → Valentina: "…" |
| Variantes por país (moneda, montos de ejemplo, asegurador, medios de pago, vocabulario) | La **moneda y el monto** existen desde la Ola 4: seis países con ejemplo (CO, MX, AR, CL, PE, BR) y `[precio]` en el resto. El asegurador y los medios de pago siguen sin variante | Todos | CO/MX/AR/PE/CL/BR; fuera de esos, `[precio]` sin moneda |
| Recetas de mejora (después) | Parcial (procedimientos, automatizaciones) | Mejorar a {Nombre} | "Recordar la clase 24 h antes" · "Reenganchar alumnos inactivos 30 días" |
| Tono por defecto | No | Conoce a {Nombre} | Cálido y cercano, emojis moderados |
| Variación por subtipo | Solo turismo, salud/dental, automotriz (taller/repuestos) y servicios del hogar | Todos | capa `academia_baile` sobre `education` |

**Estado del precio (nuevo, obligatorio para que el diseño no mienta):** cada servicio nace `ejemplo` (los sembrados), `confirmado` (los que la persona puso o confirmó) o `a cotizar` (precio 0). Las herramientas de catálogo y reservas solo dicen precios confirmados; para `ejemplo` el agente ofrece confirmarlo; para `a cotizar` pasa a una persona. En la tarjeta: "Precios sin confirmar: 2 de 3" y un botón "Estos precios ya son los míos". El panel de salud lo muestra en naranja: "No sabe precios (2 de 3)". Requiere una columna nueva (`services.price_status`, migración solo aditiva). La moneda sale del país del alta, nunca del `COP` de la semilla.

### 3.2 De dónde sale la receta

- **Rubro elegido con búsqueda, no con chips.** En el paso 1 la persona escribe una palabra ("baile", "dentista", "domicilios") y elige entre los 79 subtipos con sinónimos. "Otro" aparece solo cuando no hay coincidencia.
- **Subtipos nuevos con receta propia**, hoy caen en "Otro" o en una etiqueta vacía: `education` → academia de baile, academia de música o arte, clases particulares y tutorías, autoescuela; `gimnasios` → escuela deportiva / natación; `salud` → nutrición, fisioterapia, óptica; `moda_belleza` → uñas, pestañas y cejas; tatuajes y piercing; `restaurantes` → pastelería y comida por encargo; `retail` → ferretería, papelería y venta de mostrador; floristería y regalos; `servicios_hogar` → lavandería y tintorería; `servicios_profesionales` → coaching y asesoría personal; agencia de marketing o diseño. **Toda receta de academia o clase nace con agenda encendida, una "Clase de prueba" de 60 min y disponibilidad sembrada** (el hueco exacto del video). Además, la primera ola cubre 20 capas de subtipo sobre las industrias con más demanda (belleza: barbería, spa, estética · salud: dental, psicología, farmacia · restaurantes: comida rápida, cafetería, cocina oculta · gimnasios: yoga/pilates, crossfit · education: idiomas, online · inmobiliaria: arriendo, venta · profesionales: abogados, contadores · mascotas: peluquería, hotel · retail: moda). Regla para la colisión estética: lo no médico va a belleza.
- **"Otro" o subtipo que no encaja** → "Cuéntanos tu negocio en una frase". La receta se genera **en segundo plano al terminar el paso 1** (nunca dentro del alta), con salida estructurada cuyo esquema **no tiene campos de precio, dirección ni teléfono**; las respuestas pueden llevar el espacio `[ ]`; un validador determinista rechaza cifras con moneda, direcciones o URLs que la persona no dio y cae a la receta genérica. Máximo dos generaciones por tenant con presupuesto de plataforma. Se guarda como receta del tenant, versionada. Mientras se genera, el paso 2 muestra el esqueleto con la etiqueta "preparando…".
- **Sitio web** → se rastrea la primera URL sin gate de plan (el rastreador existe) y una extracción aparte propone "sobre nosotros", dirección, horario y servicios como chips **"detectado"** que solo entran al confirmarlos, con el mismo validador. **Instagram no se rastrea**: se pide el usuario solo para el saludo y para el enlace de la bio.
- **Lo que la persona ya escribió** (sobre tu negocio, objetivos, público) alimenta saludo, instrucciones y sugerencias.

### 3.3 Cuatro recetas de ejemplo (para calibrar el nivel de detalle)

Cada una debe poder confirmarse con "Usar así" sin escribir. Las tres primeras son de reserva; la cuarta prueba el esquema fuera de la agenda.

**Academia de baile** (`education` → `academia_baile`). Nombre y rol: "Valentina · Asesora de clases". Saludo: "¡Hola! Soy Valentina, de {negocio}. ¿Buscas clases para ti, para tu pareja o para un niño?". Instrucciones: "Ayudas a quien escribe a encontrar la clase que le sirve: preguntas qué ritmo le interesa y qué nivel tiene, das horarios y precios confirmados, y lo llevas a reservar su clase de prueba. Si te preguntan algo que no sabes, lo confirmas con el equipo en vez de suponer." Ofrece: Clase de prueba (gratis, 60 min) · Mensualidad grupal 2 clases/semana ($180.000 ejemplo) · Clase personalizada 60 min ($60.000 ejemplo) · Paquete de 8 clases ($ ejemplo) · Alquiler de salón (a cotizar). Modo de compra: `class`. Las 5 preguntas: "¿Cuánto cuestan las clases?" → "La mensualidad grupal es de [precio] y la clase personalizada [precio]. La primera clase de prueba es gratis, ¿te la reservo?" · "¿Dónde quedan?" → "Estamos en [dirección], [referencia para llegar]." · "¿Qué horarios tienen de [salsa/bachata]?" → "Tenemos [ritmo] los [días] a las [horas]. ¿Cuál te sirve?" · "¿Hay clases para niños?" → "[Sí, desde los [edad] años, los [días] a las [hora] / Por ahora solo adultos]." · "¿Qué necesito llevar?" → "Ropa cómoda, [zapatos de suela lisa] y agua. Nada más." Cuando no sabe: "Eso lo confirmo con el equipo y te escribo enseguida." / "Te paso con alguien de la academia para que te ayude mejor." / "No tengo ese dato a la mano, ¿te lo confirmo por acá en un momento?". Pasa a persona: quiere inscribirse y pagar ya · pide descuento o beca · evento privado o show · lesión o condición médica · queja. Canales: Instagram primero ("las academias reciben la mayoría de consultas por Instagram"), WhatsApp segundo. Prueba: "¿Cuánto cuestan las clases?" · "¿Tienen bachata los sábados?" · "Quiero una clase de prueba".

**Clínica dental** (`salud` → `odontologia`). Nombre y rol: "Sofía · Recepción de la clínica". Saludo: "Hola, soy Sofía, de {negocio}. ¿Quieres agendar una cita o tienes alguna duda sobre un tratamiento?". Instrucciones: "Agendas valoraciones y controles, respondes precios confirmados y ubicación, y nunca das diagnósticos ni recomiendas medicamentos. Ante dolor fuerte o urgencia pasas de inmediato a una persona." Ofrece: Valoración inicial 30 min ($60.000 ejemplo) · Limpieza dental 45 min ($120.000 ejemplo) · Blanqueamiento 60 min ($ ejemplo) · Ortodoncia (se cotiza en la valoración) · Control 20 min ($ ejemplo). Modo de compra: `appointment` (fecha, hora y [odontólogo]). Las 5 preguntas: "¿Cuánto cuesta la valoración?" → "La valoración inicial cuesta [precio] e incluye [diagnóstico y plan de tratamiento]." · "¿Aceptan [EPS / seguro / prepagada]?" → "[Sí, trabajamos con [nombres] / Atendemos solo de forma particular]." · "¿Dónde quedan?" → "Estamos en [dirección], [referencia]." · "¿Atienden urgencias?" → "[Sí, en horario de [horas] / Para urgencias llama al [teléfono]]." · "¿Cómo cancelo o cambio una cita?" → "Escríbeme «cancelar» o «cambiar cita» y lo hago; te pedimos avisar con [24] horas." Cuando no sabe: las mismas tres opciones. Pasa a persona: dolor fuerte o urgencia · pregunta clínica sobre su caso · resultado de un examen · reclamo · pago o factura. Canales: WhatsApp primero, luego Instagram. Prueba: "¿Cuánto vale la limpieza?" · "¿Atienden sábados?" · "Necesito una cita".

**Restaurante** (`restaurantes`). Nombre y rol: "Luca · Pedidos y reservas". Saludo: "¡Hola! Soy Luca, de {negocio}. ¿Quieres ver el menú, hacer un pedido o reservar mesa?". Instrucciones: "Muestras el menú con precios confirmados, tomas pedidos a domicilio o para recoger confirmando dirección y total, y reservas mesas con fecha, hora y personas. Confirmas alergias antes de cerrar un pedido y nunca garantizas que un plato esté libre de alérgenos." Ofrece (platos, no servicios): [Plato estrella] ($ ejemplo) · Menú del día ($ ejemplo) · [Bebida] ($ ejemplo) · Domicilio a [zonas] ($ ejemplo por zona) · Mesa para grupos (a coordinar). Modo de compra: `order` + `table`, ambos encendidos. Las 5 preguntas: "¿Hacen domicilio a [barrio]?" → "Sí, llegamos a [zonas]; el envío cuesta [precio] y tarda unos [minutos] minutos." · "¿Cuál es el menú de hoy?" → "Hoy tenemos [menú del día] por [precio]. ¿Te lo pido?" · "¿Dónde quedan y hasta qué hora abren?" → "Estamos en [dirección]; atendemos [días y horas]." · "¿Reciben grupos grandes?" → "Hasta [8] personas reservo aquí; para más te paso con el equipo." · "¿Tienen opciones vegetarianas o sin gluten?" → "Sí: [platos]. Dime si tienes alguna alergia y lo aviso a cocina." Pasa a persona: grupo de más de [8] o evento · alergia grave · queja de un pedido · factura especial · pedido fuera de zona. Canales: WhatsApp primero, Instagram segundo, el enlace propio siempre. Prueba: "¿Tienen menú del día?" · "¿Hacen domicilio a [barrio]?" · "Mesa para 4 el sábado a las 8". *Honestidad del motor:* mientras el motor de reservas sea de un solo recurso, la tarjeta dice "toma la reserva con fecha, hora y personas y te avisa para que confirmes".

**Ferretería y venta de mostrador** (`retail` → `mostrador`). Nombre y rol: "Alex · Ventas". Saludo: "¡Hola! Soy Alex, de {negocio}. Dime qué buscas y te digo si lo tenemos y cuánto cuesta." Instrucciones: "Respondes si hay un producto, su precio confirmado y cómo pagarlo o recibirlo; tomas el pedido con nombre, dirección y forma de pago y lo pasas al equipo para confirmar. No prometes existencias que no puedes verificar." Ofrece: [Producto más vendido] ($ ejemplo) · [Segundo producto] ($ ejemplo) · Envío a [zonas] ($ ejemplo) · Recoger en tienda (gratis). Modo de compra: `order` (v1: toma el pedido y lo pasa a una persona). Las 5 preguntas: "¿Tienen [producto]?" → "Sí, [producto] cuesta [precio]. ¿Cuántos quieres?" · "¿Hacen envíos?" → "Llegamos a [zonas]; el envío cuesta [precio] y tarda [tiempo]." · "¿Cómo pago?" → "Aceptamos [efectivo / transferencia / tarjeta / enlace de pago]." · "¿Dónde están y a qué hora abren?" → "Estamos en [dirección]; abrimos [días y horas]." · "¿Puedo cambiar o devolver?" → "Sí, dentro de [días] días con [condición]." Pasa a persona: pedido grande o al por mayor · garantía o devolución · producto que no está en la lista · reclamo. Canales: WhatsApp primero. Prueba: "¿Tienen [producto]?" · "¿Hacen envío a [barrio]?" · "Quiero pedir 3".

Las listas canónicas de "5 preguntas" por familia (servicios con reserva · pedidos y retail · inmobiliaria · restaurantes · servicios profesionales) están en el Apéndice B.

---

## 4. El día 0: "Conoce a {Nombre}" en seis pasos

Diez minutos propios, una decisión por pantalla, el agente responde en el paso 3, alguien le escribe en el paso 5. Todo lo que la persona hace en estos pasos **se confirma de inmediato en el agente que atiende**: mientras la etapa sea anterior a "en vivo" y el agente no tenga conversaciones, cada guardado escribe en el agente operativo con una revisión de origen "onboarding" (regla del servidor; decisión D1). Borradores y publicación no aparecen.

### Paso 1 — "¿Cuál es tu negocio?" (1 min)

- **Ve:** un campo "¿Qué tipo de negocio tienes? Escribe una palabra: baile, dentista, restaurante…" con búsqueda sobre los 79 subtipos y sinónimos; el rubro detectado desde el alta viene preseleccionado. Debajo, "Cuéntanos tu negocio en una frase" con un ejemplo del rubro ya escrito y editable; opcional "¿Tienes página web?" con su por qué ("la leemos para no preguntarte lo que ya publicaste") y "¿Cuál es tu Instagram?" (solo para el saludo y el enlace).
- **Por qué:** "Con esto preparamos a tu agente con ejemplos de tu rubro."
- **Si no hay coincidencia:** aparece "Otro", la frase es obligatoria y la receta se genera en segundo plano (§3.2).
- **Victoria:** "Listo. Preparamos a Valentina para una academia de baile." y aparece el avatar con nombre.

### Paso 2 — "Esto es lo que {Nombre} ya sabe" (3 min; en celular, cuatro pantallas 2a-2d)

Cuatro tarjetas con la anatomía del §2; el contador dice "Paso 2 · tarjeta 1 de 4".

1. **¿Qué ofreces y desde cuánto?** Servicios o productos de la receta con duración y precio en estado `ejemplo`; chips [Poner mi precio] [Por ahora no lo dice]; "+ agregar"; para restaurantes y retail, un chip "Zonas de entrega y costo" ("Chapinero · $5.000 ejemplo"). Por qué: "así responde cuánto cuesta sin inventar". Victoria condicional: con precios → "Ya sabe qué ofreces y cuánto cuesta"; sin precios → "Ya sabe qué ofreces. Los precios los confirma con una persona hasta que los pongas".
2. **¿Dónde estás y cuándo atiendes?** Dirección como espacio `[dirección]` (o chip "detectado" si vino de la web), horario típico del rubro precargado, "también responde fuera de horario con un mensaje" activado. Por qué: "para 'dónde quedan' y 'a qué hora abren'".
3. **¿Cómo te compran o reservan?** Selección múltiple con verbos honestos y una línea de consecuencia cada uno: [Reservar cita / clase / mesa] "toma fecha, hora y [personas] y te avisa para confirmar" · [Tomar pedidos a domicilio o para recoger] "toma el pedido y te lo pasa por el canal" · [Pedir cotización] "recoge los datos y te los pasa" · [Solo informar y pasar a una persona]. Los defaults vienen de la receta. Si elige reservar, aquí mismo se crean el servicio y el bloque de disponibilidad, con la persona administradora como responsable por defecto (la agenda exige uno). Lo que el producto aún no opera se muestra apagado con "pronto", nunca como interruptor muerto. Por qué: "para que pueda cerrar, no solo informar".
4. **Las 5 preguntas que siempre te hacen.** Preguntas reales del rubro con respuestas con espacios `[ ]`; un toque en el espacio lo rellena; chips con variantes. **Una respuesta con un espacio sin llenar no cuenta.** Por qué: "son el 80 % de lo que preguntan; con esto ya atiende".

- **Victoria:** contador vivo "Ya sabe responder 3 de 5 preguntas" y, al terminar, "Listo: Valentina ya sabe qué ofreces, dónde estás y cómo se reserva."

### Paso 3 — "Conoce a {Nombre}" (2 min, el momento aha)

- **Ve, a la izquierda:** nombre (humano, del rubro, editable), saludo (con el nombre del negocio ya puesto), estilo en tres tarjetas (cálido y cercano · profesional · ágil y breve), y tres decisiones ya tomadas con opción de cambiar: "Cuando no sabe, dice: …" (tres opciones), "Pasa a una persona cuando: …" (motivos del rubro, quitables), y **"¿Y a quién le avisa? → A ti, por correo a {email del alta} [Cambiar] · Invitar a alguien más (después)"**. La persona es la receptora por defecto con lo que ya sabemos; sin persona receptora, las opciones de "cuando no sabe" que prometen una persona no se ofrecen.
- **Ve, a la derecha:** el chat de prueba con **tres chips** de la receta. Un toque y {Nombre} responde con lo del paso 2. Si una respuesta difiere un precio, debajo del chat: "Respondió así porque no pusiste el precio de la mensualidad. Tócalo y ponlo."
- **Por qué:** "Así tus clientes sienten que los atiende alguien que conoce tu negocio." (El agente nunca dice ser humano.)
- **Victoria:** la primera respuesta real. "Esto lo respondió con lo que confirmaste. Si algo no te gusta, tócalo y cámbialo."
- **Qué no está aquí:** reglas, temas prohibidos, herramientas, versiones, misión, evaluación. Vienen de la receta y se ajustan después.

### Paso 4 — "¿Por dónde te escriben tus clientes?" (1 min + conexión)

Elección múltiple con los cinco canales en pie de igualdad, ordenados por la receta del rubro. **El tiempo se muestra después del triage, nunca en la tarjeta.**

| Canal | Para qué (una línea) | Qué necesitas (en palabras de la persona) | Cómo se prueba |
|---|---|---|---|
| **WhatsApp** | Donde más te escriben | Tu número y tu cuenta de Facebook; te preguntamos dónde vive hoy tu número y te decimos qué hace falta | Alguien le escribe al número |
| **Instagram** | Los mensajes directos de tu cuenta | Que tu cuenta sea profesional (gratis, 1 minuto: Configuración → Tipo de cuenta → Cambiar a cuenta profesional; te mostramos las 3 pantallas). Entras con tu usuario de Instagram y aceptas | Alguien te escribe por Instagram |
| **Messenger** | Los mensajes a tu página de Facebook | Poder publicar en la página de tu negocio desde tu cuenta (si la creaste tú, ya puedes). Entras con Facebook y eliges la página | El botón "Enviar mensaje" de tu página |
| **Telegram** | Un contacto de tu negocio en Telegram | Telegram te deja crearlo en 2 minutos dentro de la app (te mostramos los 4 mensajes que hay que enviar); al final te da una clave larga: pégala aquí | Abres tu contacto y escribes |
| **El enlace de {Nombre}** | Un enlace donde cualquiera puede escribirle: sirve para probar hoy y para tu bio de Instagram | Nada. Si tienes página web, te damos dos líneas para quien la maneja | Abres el enlace |

- **Por qué:** "Tu agente responde por todos los que conectes; puedes empezar por uno."
- **El enlace de {Nombre} existe desde el paso 3** (página pública `/w/{id}` sobre el widget que ya existe, con tope diario por página y marcado como demo para que no cuente como activación). Es lo que permite mostrarle el agente a un socio y seguir probando mientras Meta tarda.
- **Cada canal elegido abre su mini-flujo con la misma anatomía**, uno a la vez, y siempre con "Conectar después" por canal, con memoria, recordatorio y una línea de "mientras tanto {Nombre} ya atiende por su enlace":
  - **WhatsApp**: triage "¿Dónde vive hoy tu número?" con cinco respuestas: (a) *En la app WhatsApp Business de un celular* → coexistencia, ~10 min, "ten el celular a mano para escanear"; (b) *En el WhatsApp normal de mi celular* → mini-paso "Pásalo a WhatsApp Business (gratis, 5 min, conservas número y chats): instala WhatsApp Business, elige «usar este número» y vuelve aquí"; (c) *Es un número nuevo o sin WhatsApp* → número nuevo, ~5 min; (d) *Ya lo usa otro proveedor* → "Tu número solo puede estar con un proveedor a la vez: cuando lo pases a Parallly deja de responder con el otro. Pídele a tu proveedor apagar la verificación en dos pasos (suele tardar 1-3 días) y vuelve aquí. Mientras tanto, {Nombre} ya atiende por Instagram y por su enlace." → salta al siguiente canal; (e) *No lo tengo a mano* → número de prueba de Meta si D4 lo habilita, o "Después". Cada ruta muestra **tres líneas** de lo que hace falta (el detalle largo en "Ver más"). Mientras la ventana de Meta está abierta: texto vivo y enlace "Cancelar"; cada error termina en una acción ("este número ya tiene WhatsApp: usa la opción de la app", "permite las ventanas emergentes", "esa cuenta de Facebook no administra el negocio"). Si coexistencia no funciona de punta a punta desde un celular, la tarjeta lo dice y ofrece "te enviamos el enlace por correo para hacerlo desde un computador" (queda como Después con memoria).
  - **Instagram / Messenger**: el triage es autodeclarado (sí / no / no sé, con "cómo saberlo" en tres líneas), porque nada se puede saber antes de entrar; después de la ventana, el servidor devuelve un código (cuenta no profesional, sin página, sin rol de administrador, permisos faltantes, ventana bloqueada) y la pantalla muestra la acción; nunca el texto de Meta.
  - **Telegram**: el flujo actual de dos pasos ya está bien resuelto; se conserva y se le suma la victoria explícita.
  - **El enlace de {Nombre}**: "Copiar enlace", "Ponerlo en mi bio", "Enviarle las dos líneas a quien maneja mi página".
- **Asignación al agente**: se deja de sembrar las cinco asignaciones; el agente por defecto atiende sin asignación y se vincula al conectar cada canal.
- **Victoria por canal:** "WhatsApp conectado · {número}" con el botón del paso 5.

### Paso 5 — "Que alguien le escriba" (1 min)

- **Ve:** por cada canal conectado, "Pídele a alguien que le escriba a {número} o usa otro celular: [Copiar enlace] [Enviármelo por correo]. O pruébalo ahora mismo en su enlace: [Abrir]". Estado en vivo "Esperando el primer mensaje…". Cuando llega un mensaje de un contacto externo por **cualquier** canal conectado y {Nombre} responde, la pantalla lo celebra y muestra la conversación. (La persona no puede escribirse a su propio número desde el celular que lo tiene; por eso el enlace propio es el camino corto.)
- **Por qué:** "Así compruebas con tus ojos que ya atiende por donde te escriben."
- **Activación = primer mensaje entrante de un contacto externo con respuesta del agente entregada.** Es el fin del onboarding y la métrica de Parallly; la etapa pasa a "en vivo". Si en dos minutos no llega nada, la pantalla muestra **verificaciones del sistema**, no tareas: "Meta confirmó el número ✓ · {Nombre} está encendida ✓ · Aún no llega un mensaje".

### Paso 6 — "Listo" (30 s)

- **Ve:** "{Nombre} ya sabe responder N preguntas, atiende por [canales] y le avisa a [ti] cuando [motivos]." Debajo, lo que quedó para después con su tiempo ("Dejaste para después: cómo te reservan · 2 min") y tres mejoras sugeridas del rubro, y "Ir a Inicio".
- **Inicio desde ese momento:** la tarjeta de salud (§6) reemplaza a la de puesta en marcha. Si algo esencial quedó en "Después", la tarjeta lo muestra como el único siguiente paso, con "Continuar donde quedaste (paso 4 · 5 min)".

### Reglas del contenedor del día 0

Sin banner de prueba, sin "Instalar Parallly", sin aviso rojo, sin mascota, sin KPIs, sin ayuda lateral, sin panel de versiones ni de misión, mientras la etapa no sea "en vivo". Esc guarda y recuerda el paso. Autoguardado por tarjeta. Tuteo neutro con el vocabulario del rubro. Todo cabe a 390 px.

---

## 5. Después del día 0: "Mejorar a {Nombre}"

Cambiar algo tiene que ser tan fácil como configurarlo, y en el mismo lenguaje. El editor deja de ser una pila de pestañas técnicas y se organiza por las preguntas que la persona se hace, cada una como una tarjeta con la anatomía del §2:

| Tarjeta | Qué contiene | Hoy vive en |
|---|---|---|
| **Qué vende** | Servicios/productos con su estado de precio, modo de compra, catálogo, zonas de entrega | Citas → Servicios, Catálogo, Herramientas |
| **Dónde y cuándo** | Dirección, horario, fuera de horario | Información del negocio, Horarios, pestaña Horario |
| **Cómo habla** | Nombre, saludo, estilo, extensión, idioma, cuando no sabe | Persona |
| **Cuándo llama a una persona y a quién** | Motivos visibles, quién recibe, qué pasa si nadie responde; disparadores bajo Avanzado | Instrucciones, Usuarios |
| **Qué sabe** | Las 5 preguntas y más, documentos, páginas, lo que aprendió de conversaciones | Conocimiento, FAQs |
| **Por dónde atiende** | Canales conectados con estado por canal, conectar otro, el enlace propio | Canales, chips del editor |
| **Reglas** | Reglas del rubro, temas que no toca, "lo que nunca hará" (plegado) | Instrucciones |
| **Avanzado** (plegado) | Instrucciones libres, modo prompt, ajustes de búsqueda, upsell, e-commerce, borradores y publicación, candidatos y pruebas, disparadores | Herramientas, Avanzado, workspaces |

Reglas de este modo:

- **Cambiar es tocar y guardar.** Cada tarjeta guarda sola al salir del campo. Mientras el agente no tenga conversaciones reales, el guardado se confirma de inmediato. Después, el dueño decide (D15): o el guardado sigue siendo inmediato y la revisión es un modo avanzado opcional, o hay un "publicar ahora" de un botón. En ningún caso una tubería que la persona tenga que descubrir.
- **Encendido/apagado**, no publicar/borrador. El interruptor enciende y apaga de verdad (hoy solo apaga).
- **Sugerencias siempre presentes**: chips de la receta debajo de cada campo y, con conversaciones reales, sugerencias sacadas de ellas ("12 personas preguntaron por clases para niños y Valentina no supo: ¿agregamos la respuesta?").
- **"Enséñale"**: desde cualquier conversación real, una respuesta que no supo se convierte en pregunta y respuesta con un toque.
- **Recetas de mejora en un clic** por rubro: recordar la cita o clase 24 h antes, reenganchar a quien no volvió en 30 días, responder objeción de precio, pedir reseña después de la visita. Cada una con su mensaje escrito y editable.
- **La búsqueda entiende las palabras de la persona**: "nombre del agente", "saludo", "precios", "horario" llevan a la tarjeta correcta.

---

## 6. El panel de salud: "Salud de {Nombre}"

Una sola pantalla, la misma tarjeta en Inicio, cuatro preguntas en lenguaje llano (detalle en `docs/onboarding-diagnosis-2026-09.md` §6.4):

1. **¿Puede atender hoy?** Semáforo de tres bandas, **por canal**: verde atiende; naranja atiende pero pierde ventas (no sabe precios: "2 de 3 sin confirmar", sin persona que reciba, agenda pedida y apagada); rojo no atiende (canal desconectado, apagada, sin ruta a persona). Solo sube con estado verificado; "crítico" en rojo solo cuando algo que funcionaba dejó de funcionar (requiere guardar el último estado bueno por canal, que hoy no existe).
2. **¿Qué sabe responder?** Las preguntas del rubro con ✔/✖ y "Enséñale"; qué puede hacer (reservar, tomar pedidos, cotizar).
3. **¿Cómo le fue con clientes reales?** Respondidas, pasadas a persona, reservas, preguntas sin respuesta agrupadas con acción.
4. **¿Qué hago ahora?** Máximo tres recomendaciones con impacto; las rojas no se pueden descartar; las naranjas se posponen.

Todo lo técnico (pilares, dimensiones, pesos, snapshots, pruebas automatizadas, candidatos) queda bajo "Detalle técnico".

---

## 7. Multicanal: la matriz completa

| | WhatsApp | Instagram | Messenger | Telegram | El enlace de {Nombre} |
|---|---|---|---|---|---|
| **Qué necesitas** | Número + cuenta de Facebook; depende de dónde vive el número | Cuenta profesional de Instagram (gratis, 1 min) y entrar con tu usuario de Instagram | Poder publicar en la página de tu negocio; entrar con Facebook | Crear el contacto en Telegram (4 mensajes) y pegar la clave | Nada; dos líneas para tu web si la tienes |
| **Tiempo propio (se muestra tras el triage)** | coexistencia ~10 min · nuevo ~5 min · otro proveedor: depende del proveedor (1-3 días) · WhatsApp normal: +5 min para pasarlo a Business | 2 min | 2 min | 2 min | 0 min / 5 min |
| **Triage previo** | "¿Dónde vive hoy tu número?" (5 opciones) | Autodeclarado: "¿Ves «Panel profesional» en tu perfil?" sí / no / no sé + cómo mirarlo | Autodeclarado: "¿Puedes publicar en la página?" | — | — |
| **Errores → acción (códigos del servidor, nunca texto de Meta)** | número ya en WhatsApp → app/coexistencia; ventana bloqueada → permitir; verificación en dos pasos en el proveedor → pedir apagarla; cuenta de Facebook sin permisos → cuenta correcta | cuenta no profesional → cómo cambiarla; permisos faltantes → volver a aceptar | sin rol en la página → pedirlo | clave inválida → volver a Telegram | script no cargado → enviarlo a quien maneja la web |
| **Cómo se prueba** | Alguien le escribe (o el enlace propio) | Alguien te escribe por Instagram | Botón de tu página | Abres tu contacto | Abres el enlace |
| **Conectar después** | Sí, con recordatorio; el enlace propio mientras tanto | Sí | Sí | Sí | Siempre disponible |
| **Qué no hace** (dicho en la tarjeta) | Grupos, llamadas, difusiones desde la app | Historias y comentarios | Comentarios de publicaciones | Grupos | — |
| **Asignación al agente** | Al conectar | Al conectar | Al conectar | Al conectar | Al crearse |

---

## 8. El sistema de ayuda en este modelo

- **La ayuda es el paso.** No hay panel lateral, ni tips numerados, ni tours en el día 0.
- **"¿Por qué me preguntan esto?"** en cada paso: dos frases y un ejemplo de conversación de cliente.
- **Recorridos "Mostrarme dónde"** solo en el después, de máximo cuatro pasos, lanzados por la persona, nunca solos.
- **Parallly Assist conoce la receta y el paso**: responde "¿qué me falta?" con los ítems reales y abre la tarjeta correcta; no explica versiones ni candidatos salvo en modo avanzado.
- **Una sola fuente de verdad para los textos**: los tips y las tarjetas citan etiquetas por su clave; una prueba automática falla si un texto nombra un botón que no existe o si aparece una palabra de la lista de jerga fuera de "Avanzado".
- **Trato**: tuteo neutro en toda la plataforma; se elimina el voseo de las semillas y de los pre-checks.

---

## 9. Qué existe, qué se completa y qué se construye (tamaños revisados por ingeniería)

| Pieza | Estado | Trabajo | Tamaño |
|---|---|---|---|
| Alta de 4 pasos | Existe y funciona | Ninguno | — |
| Registro de verticales | Existe (nombre, saludo, servicios, FAQs, horario, embudo, vocabulario) | Mover las recetas a JSON por (industria, subtipo, idioma) con esquema validado y **lint en CI** (jerga, voseo, `[ ]` en respuestas, colisión con palabras de escalado de plataforma, precio con estado, agenda en academias); agregar `subTypes[].recipe` que se fusiona sobre la industria; corregir la localización que fuera de `es` devuelve siempre la primera plantilla | M (esquema) + contenido (D13) |
| Estado del precio | No existe | Columna `services.price_status` (aditiva); siembra en `ejemplo`; herramientas y prompt no dicen precios de ejemplo; incluir la columna en las réplicas de prueba y en los scripts de bootstrap | S |
| Receta generada para "Otro" | No existe | Servicio + trabajo en segundo plano; salida estructurada sin precio/dirección/teléfono; validador determinista; presupuesto de plataforma; receta del tenant versionada | M |
| Rastreo de web | Existe el rastreador (con gate de plan) | Primera URL sin gate + extracción estructurada con validador; chips "detectado" | M |
| Paso 1 | No existe | Búsqueda con sinónimos sobre 79 subtipos | S |
| Paso 2 (cuatro tarjetas) | No existe | Componente de tarjeta + un endpoint idempotente que escribe servicios, dirección, horario, disponibilidad (administrador como responsable) y FAQs reutilizando las siembras del bootstrap | M-L |
| Paso 3 | Existe en parte (asistente de 3 pasos, chat de prueba, tarjetas de tono) | Quitar paneles; chips de prueba y sugerencias; receptor por defecto; **regla de confirmación inmediata en el servidor** (etapa < en vivo y sin conversaciones) con revisión de origen "onboarding" y prueba que demuestre que el agente servido cambia al instante; el interruptor enciende bajo la misma regla | M |
| Paso 4 multicanal | Existe por partes (rutas WA, OAuth IG/Messenger, Telegram, código del widget) | Elección múltiple con tarjetas; triage de WhatsApp con 5 respuestas; requisitos en tres líneas; "Cancelar" y errores → acción; códigos de error de IG/Messenger; dejar de sembrar asignaciones y vincular al conectar | L |
| El enlace de {Nombre} | Existe el widget (loader, config, sesiones con límite) | Ruta pública `/w/{id}` (nunca el slug); aprovisionar widget + conexión web_widget + vínculo al agente en el día 0; origen de plataforma siempre permitido; tope diario por página; marca "demo" | M |
| Paso 5 | Existe la tarjeta wa.me tras conectar | Evento "el agente respondió" (+ "entregado" donde exista) relevado por WebSocket a la cuenta; consulta idempotente para sobrevivir recargas; etapa "en vivo"; verificaciones del sistema en el fallback | M |
| Tarjeta de Inicio | Existe (8-10 ítems) | Reducir a lo diferido + salud | S |
| Editor por tarjetas | No existe | Reorganizar el editor en 8 tarjetas; modo avanzado; decisión D15 sobre el después | L-XL |
| "Enséñale" | Existe la detección de huecos | Acción de un toque que crea la FAQ | S |
| Recetas de mejora | Existen procedimientos y automatizaciones | Catálogo por rubro con mensaje escrito | M |
| Panel de salud | Existen los datos | Reencuadrar; "rojo solo por regresión" necesita último estado bueno por canal | M |
| Eventos y etapa | No existen | Tabla global `onboarding_events` (registrada en la purga y en los scripts de bootstrap) + etapa "en vivo" con regla de derivación para tenants antiguos | S |
| Contrato de textos | Existe un spec que exige "publicar" | Invertir y ampliar | S |

Orden sugerido: **(1)** quitar del día 0 lo que sobra y arreglar la plomería que pierde trabajo (Ola 0 del diagnóstico); **(2)** estado del precio, esquema de recetas con capa de subtipo y lint, pasos 1-3 con recetas completas para las 6 industrias de más demanda (belleza, salud, restaurantes, academias, inmobiliaria, servicios profesionales) y "Otro" generado; **(3)** paso 4 multicanal con el enlace propio y paso 5; **(4)** editor por tarjetas, "Enséñale", recetas de mejora y panel de salud; **(5)** las 12 industrias restantes y las 20 capas de subtipo.

---

## 10. Decisiones para el dueño

Las ocho del diagnóstico siguen vigentes (día 0 escribe directo al agente vivo; misión y pruebas fuera de "listo para atender"; rojo solo para regresiones; reabrir número de prueba de Meta; receta para academias y política de "Otro"; vocabulario encendido/apagado; presupuesto de interrupciones; tarjeta de 3-4 esenciales). Este diseño agrega:

| # | Decisión | Recomendación |
|---|---|---|
| D9 | La receta para negocios fuera de las 18 industrias se **genera con el modelo** en segundo plano, con esquema sin precio/dirección/teléfono y validador | Sí |
| D10 | **Precios de ejemplo**: columna de estado; el agente **no dice** un precio de ejemplo (más seguro que decirlo "como referencia") y ofrece confirmarlo; "Usar así" nunca confirma un precio | Sí, ocultar hasta confirmar |
| D11 | **El enlace de {Nombre}** (página pública del chat web) para cada agente desde el paso 3, con tope diario y marcado como demo | Sí — hecho el 17-sep: `/w/{widgetId}`, `widget_configs.is_demo`, no cuenta como canal ni como activación |
| D12 | Los **cinco canales en pie de igualdad**, ordenados por la receta, con "conectar después" por canal | Sí — hecho el 17-sep: triage de 5 respuestas en WhatsApp, resumen plegado, texto vivo + "Cancelar y volver", y códigos tipados de servidor para IG/Messenger |
| D13 | **Contenido de las recetas**: ≈38 recetas (18 industrias + 20 capas de subtipo) × 14 campos ≈ 1.000 textos en español, ≈4.000 con en/pt/fr; unas 25 jornadas para español y 60 en total. Secuencia: español para las 6 industrias de más demanda → validación con un dueño real por industria en una sesión de 15 minutos de "Usar así" (criterio: ≤2 tarjetas cambiadas de 7) → traducción → el resto | Empezar por 6 con el equipo; nombrar a quién valida |
| D14 | El **editor se reorganiza por tarjetas** y las pestañas técnicas pasan a "Avanzado" | Sí |
| D15 | **Después del día 0**, ¿"cambiar es tocar y guardar" sigue siendo inmediato (borradores como modo avanzado opcional) o hay un "publicar ahora" de un botón? | Inmediato por defecto; revisión opt-in para quien la quiera |
| D16 | **Receptor de avisos por defecto**: la persona del alta, por correo (y su WhatsApp si lo da) | Sí |
| D17 | **Países con montos de ejemplo reales** en la primera ola (CO, MX, AR, PE, CL, BR); el resto con `[precio]` | Sí |
| D18 | **Dónde viven las academias**: subtipos de `education` (reutilizan la reserva de clases) | `education` |
| D19 | **Cuota del enlace de prueba**: la plataforma paga los primeros N mensajes de demo por tenant antes de elegir plan | Sí, con tope — hecho el 17-sep: `onboarding.demoAllowance` (200 de por vida por cuenta, 60 por página y día); "antes de elegir plan" = durante el trial del plan del alta, `pending_auth` sigue bloqueado |
| D20 | **Instagram**: confirmar de una vez con el flujo vigente de Meta que no exige página de Facebook (el código usa Instagram Login) y retirar ese requisito de todos los textos | Hecho el 17-sep en la ayuda de canales y de Instagram (4 idiomas): el código usa `instagram.com/oauth/authorize` con permisos `instagram_business_*`, que no piden página |

---

## 11. Cómo sabremos que funciona

- **Guion de la persona sin conocimientos** (en producción, tenant nuevo, celular primero) para tres rubros (academia de baile con número en otro proveedor e Instagram como canal principal; clínica dental con WhatsApp normal en su único celular y 20 minutos; restaurante sin página web que quiere domicilios y reservas): cada paso con resultado esperado y tiempo máximo; ninguno exige escribir un párrafo, ninguno muestra una palabra de la lista de jerga, ninguno pierde trabajo al salir, ninguno promete algo que el paso no cumple.
- **Métricas de activación** (nuevas): tiempo hasta la primera respuesta en el chat de prueba (meta < 3 min desde el alta), tiempo hasta el primer canal conectado (meta < 10 min propios), tiempo hasta el primer mensaje real respondido (la activación), abandono por paso y por canal, y **"Usar así" vs "Cambiar" por tarjeta** (si nadie cambia, el ejemplo es bueno; si todos cambian lo mismo, la receta está mal).
- **Salud**: porcentaje de agentes en verde por canal a los 7 días; precios confirmados a los 7 días; preguntas sin respuesta convertidas con "Enséñale".
- **Ayuda**: cero tips que nombren botones inexistentes; cero jerga fuera de "Avanzado" (pruebas automáticas).

---

## 12. Qué cambió con la revisión adversarial (v1.0 → v1.1)

Tres revisores independientes (dueña sin conocimientos; ingeniería contra el código; contenido por rubro) devolvieron 33 huecos. Los cuatro bloqueantes y sus correcciones:

1. **"Usar así" sobre un precio de ejemplo era una mentira o un precio falso.** Resuelto con el estado del precio (§2, §3.1, D10): "Usar así" confirma nombres y duraciones; el precio se llena tocando o se deja "por ahora no lo dice"; el agente no dice precios de ejemplo; la victoria es condicional.
2. **El día 0 no preguntaba quién recibe los chats que el agente pasa.** Resuelto en el paso 3 con la persona del alta como receptora por defecto (D16).
3. **"Escribir directo al agente vivo" no tenía camino en el código** (los borradores lo bloquean en tres lugares). Resuelto como regla del servidor con condición (etapa < en vivo y sin conversaciones) y revisión de origen "onboarding" (§4 intro, §9).
4. **El registro no tiene lo que el diseño decía** (cero instrucciones, cero opciones de "cuando no sabe", cero canales recomendados, cero preguntas de prueba; solo 4 industrias varían por subtipo; precios fijos en COP sin marca). Resuelto con la tabla real del §3.1, la capa por subtipo, los 12 subtipos nuevos, las variantes por país, la tubería de contenido con lint y la estimación honesta de D13.

Otras correcciones incorporadas: Instagram no exige página de Facebook (verificar, D20); WhatsApp con cinco respuestas de triage incluida "WhatsApp normal de mi celular", y la ruta "otro proveedor" dice que el número deja de responder con el otro y tarda días; el tiempo se muestra tras el triage; la prueba del paso 5 la hace otra persona o el enlace propio (uno no puede escribirse a su número); el fallback muestra verificaciones del sistema; "Después" sobre algo esencial dice su consecuencia; paso 1 con búsqueda en vez de chips; paso 2 en celular como cuatro pantallas; tarjeta 3 con selección múltiple y consecuencias honestas; motivos visibles separados de los disparadores; receta generada en segundo plano con validador; web rastreada con extracción y sin Instagram; página pública `/w/{id}` con aprovisionamiento y tope; evento "el agente respondió" y etapa "en vivo"; tabla de eventos registrada en la purga; tamaños del §9 corregidos (varios subían de S a M-L); el "por qué" del paso 3 ya no sugiere fingir ser humano.

Quedaron abiertas para el dueño: D15 (el después), D17 (países), D18 (academias), D19 (cuota del enlace), D20 (Instagram), y si coexistencia funciona de punta a punta desde un celular (se verifica en producción, no en código).

---

## Apéndice A — Lista de jerga prohibida fuera de "Avanzado"

borrador · versión operativa · candidato · publicar · revisión · evaluación · misión · dependencias · bloqueo crítico · acción crítica · pilar · dimensión · snapshot · señal · RAG · chunk · umbral · top-k · webhook · token · API · BSP · downtime · Cloud API · Graph API · Tier · router · AES · texto plano · lead scoring · upsell · cross-sell · stock (fuera de retail) · prospecto (fuera de B2B) · slug · web_widget · página de prueba (se llama "el enlace de {Nombre}")

## Apéndice B — Las 5 preguntas canónicas por familia (con respuesta y espacios)

**Servicios con reserva** (belleza, salud, gimnasios, mascotas, veterinaria, fotografía, academias): "¿Cuánto cuesta [servicio]?" → "[Servicio] cuesta [precio] y dura [minutos] minutos." · "¿Dónde quedan?" → "Estamos en [dirección], [referencia]." · "¿Qué horario tienen?" → "Atendemos [días] de [hora] a [hora]." · "¿Cómo reservo?" → "Dime el servicio y el día que prefieres y te muestro las horas libres." · "¿Puedo cancelar o cambiar la cita?" → "Sí, avisando con [horas] horas; escríbeme «cambiar cita» y lo hago."

**Pedidos y retail** (retail, restaurantes, pastelería, floristería, mostrador): "¿Tienen [producto]?" → "Sí, [producto] cuesta [precio]. ¿Cuántos quieres?" · "¿Hacen envíos / domicilio?" → "Llegamos a [zonas]; el envío cuesta [precio] y tarda [tiempo]." · "¿Cómo pago?" → "Aceptamos [efectivo / transferencia / tarjeta / enlace de pago]." · "¿Dónde están y a qué hora abren?" → "Estamos en [dirección]; abrimos [días y horas]." · "¿Puedo cambiar o devolver?" → "Sí, dentro de [días] días con [condición]."

**Inmobiliaria**: "¿Cuánto vale [tipo de inmueble] en [zona]?" → "Tenemos opciones desde [precio] en [zona]. ¿Buscas comprar o arrendar?" · "¿Puedo visitarlo?" → "Sí, dime qué día te sirve y coordino la visita con [asesor]." · "¿Qué incluye la administración?" → "La administración es [monto] e incluye [servicios]." · "¿Aceptan crédito / fiador / seguro de arrendamiento?" → "Trabajamos con [opciones]." · "¿Qué papeles necesito?" → "Para [arrendar / comprar] necesitas [documentos]."

**Restaurantes**: las cinco del ejemplo de Luca (§3.3).

**Servicios profesionales** (abogados, contadores, consultores, coaching, agencias): "¿Cuánto cobran la consulta?" → "La primera consulta cuesta [precio / es gratis] y dura [minutos]." · "¿Atienden mi caso / mi tipo de empresa?" → "Sí, trabajamos [áreas]. Cuéntame brevemente tu situación y te digo el siguiente paso." · "¿Cómo agendo?" → "Dime el día que prefieres y te reservo [presencial / por videollamada]." · "¿Qué documentos necesito?" → "Para la primera reunión trae [documentos]." · "¿Cuánto tardan?" → "Un [trámite] suele tomar [tiempo] desde que tenemos los papeles."

Reglas: una respuesta con un `[ ]` sin llenar no cuenta como "sabe responder"; el lint de recetas falla si una pregunta canónica contiene una palabra de escalado de plataforma (hoy "devolución", "descuento", "abogado", "emergencia" hacen escalar antes de responder); en el runtime, una FAQ que coincide gana sobre la palabra de escalado.

## Apéndice C — Subtipos nuevos con receta propia (primera ola)

| Industria | Subtipo nuevo | Nota |
|---|---|---|
| education | academia_baile · academia_musica · clases_particulares · autoescuela | agenda encendida, "Clase de prueba" 60 min, disponibilidad sembrada |
| gimnasios | escuela_deportiva | idem |
| salud | nutricion · fisioterapia · optica | cita |
| moda_belleza | unas_pestanas · tatuajes | cita; lo no médico va aquí (estética) |
| restaurantes | pasteleria_encargo | pedido por encargo |
| retail | mostrador · floristeria | pedido; "Alex · Ventas" |
| servicios_hogar | lavanderia | pedido / cotización |
| servicios_profesionales | coaching · agencia | cita / cotización |
