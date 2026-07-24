---
id: base-conocimiento
title: "Base de conocimiento del agente"
routes: ["/admin/knowledge", "/admin/knowledge/faqs"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["base de conocimiento", "conocimiento", "knowledge base", "subir documentos", "pdf", "faq", "preguntas frecuentes", "importar url", "pagina web", "rastreo", "articulos", "categorias", "editar documento", "versiones", "calidad", "sugerencias", "brechas", "portal publico", "ayuda para clientes", "el agente no sabe responder"]
---

# Base de conocimiento del agente

La base de conocimiento es la "memoria" de tu agente de IA: los documentos, preguntas frecuentes y páginas que subes aquí son la información con la que responde a tus clientes. Mientras más completa y actualizada esté, más precisas son sus respuestas.

La encuentras en el menú lateral, sección **Crecimiento → Automatización → Base de Conocimiento**. Adentro verás las pestañas **Biblioteca**, **FAQs**, **Buscar en contexto**, **Calidad**, **Analíticas** y **Brechas**.

> Esta sección la administran los roles **administrador** y **supervisor**.

## Qué incluye tu plan

| Plan | Artículos / documentos | Importación de páginas web | Tamaño máx. por documento | Analíticas de conocimiento |
|------|:---:|:---:|:---:|:---:|
| Emprendedor | 5 | No incluida | 25.000 caracteres | No |
| Starter | 20 | 50 páginas | 100.000 caracteres | Sí |
| Pro | Ilimitados | 500 páginas | 250.000 caracteres | Sí |
| Enterprise | Ilimitados | Ilimitadas | 500.000 caracteres | Sí |
| Custom | Ilimitados | Ilimitadas | Sin límite | Sí |

Si llegas al límite verás el aviso **Límite de documentos alcanzado** con la opción de mejorar tu plan.

## Cómo subir documentos (PDF, Word y más)

1. En la pestaña **Biblioteca**, haz clic en **Importación masiva**.
2. Haz clic en **Seleccionar archivos**. Formatos soportados: **PDF, DOCX, TXT, MD, CSV** (máximo 20 archivos por tanda).
3. Si quieres, escribe una **categoría** para todos los archivos (por ejemplo, "Precios" o "Políticas").
4. Haz clic en **Subir todo**.

Al terminar verás un resumen de cuántos se importaron con éxito. Cada documento se procesa y queda **Listo** para que el agente lo use en sus respuestas.

## Cómo crear un artículo escribiendo el texto

1. En **Biblioteca**, haz clic en **Crear**.
2. En la ventana **Nuevo recurso**, escribe el **Título del recurso** y pega o redacta el **Contenido de texto** (políticas, promociones, manual interno, lo que necesites).
3. Guarda y listo: el agente ya puede usarlo.

## Cómo importar una página web (con actualización automática)

Disponible desde el plan **Starter**:

1. En **Biblioteca**, haz clic en **Importar URL**.
2. Escribe la **URL de la página** (por ejemplo, la página de preguntas frecuentes de tu sitio). El **Título** es opcional: se detecta automáticamente.
3. Haz clic en importar. Parallly lee la página y la convierte en un artículo de tu base de conocimiento.

Las páginas importadas se mantienen al día solas: **una vez por semana la plataforma las revisa automáticamente** y, si el contenido cambió, actualiza el artículo. También puedes forzarlo cuando quieras con el botón **Actualizar contenido** del documento — si no hubo cambios verás "Sin cambios detectados".

## Cómo crear preguntas frecuentes (FAQs)

Las FAQs son pares de pregunta y respuesta que el agente usa para dar respuestas exactas, palabra por palabra si hace falta.

1. Entra a la pestaña **FAQs**.
2. Haz clic en **Nueva FAQ**.
3. Completa **Pregunta** y **Respuesta** (obligatorias). Puedes agregar **Categoría**, **Tags** y el **Orden** en que se muestra.
4. Deja activada la opción **Publicada (visible al agente)** para que el agente la use.
5. Haz clic en **Guardar**.

> Tip: usa FAQs para lo que debe responderse siempre igual (precios, horarios, políticas de devolución) y documentos para información más extensa.

## Organizar con categorías e idiomas

- Al crear o editar cualquier documento puedes asignarle una **categoría**. En **Biblioteca** aparecen como filtros de un clic para encontrar todo más rápido.
- El idioma de cada documento se **detecta automáticamente**. Si tienes contenido en varios idiomas, aparece un filtro por idioma; el agente prioriza el contenido del idioma en que escribe el cliente.

## Editar un artículo y recuperar versiones anteriores

- Para editar: en **Biblioteca**, haz clic en el botón de **editar** (lápiz) del documento y cambia nombre, contenido o categoría. Guarda con **Guardar cambios**.
- Cada edición crea una versión nueva. Con el botón de **Historial de versiones** (ícono de reloj) puedes ver las versiones anteriores y hacer clic en **Restaurar** para volver a una de ellas.

## Calidad y sugerencias de la IA

- En la pestaña **Calidad**, cada documento recibe un puntaje de 0 a 100 según su contenido, si tiene categoría, cuánto se consulta y qué tan relevante resulta en las respuestas. Empieza mejorando los que estén en rojo.
- En la pestaña **Analíticas**, la sección **Sugerencias de artículos (IA)** analiza las preguntas que tus clientes hicieron y el agente no pudo responder, y te propone artículos nuevos con su esquema. Haz clic en **Generar sugerencias** y luego en **Crear** sobre la que quieras redactar.

## Analíticas: qué se consulta y qué falta

Desde el plan **Starter**, la pestaña **Analíticas** te muestra:

- **Consultas únicas**, **tasa de acierto** y volumen diario de búsquedas del agente en tu base de conocimiento.
- **Documentos más consultados** — tu contenido estrella.
- **Preguntas sin respuesta** — lo que los clientes preguntaron y el agente no encontró. Desde ahí puedes **crear un artículo** con un clic o marcarlas con **Resolver**.

## Brechas: encuentra los huecos de tu contenido

La pestaña **Brechas** organiza lo que necesita tu atención:

- **Consultas sin respuesta** — crea un artículo o FAQ que las cubra.
- **Docs baja satisfacción** — artículos que recibieron reacciones negativas de tu equipo en el inbox; revísalos y mejóralos.
- **Docs desactualizados** — contenido que lleva mucho tiempo sin cambios (precios y políticas suelen vencerse).

Además, la sección **Salud del KB — Contradicciones** detecta información que se contradice entre tus documentos (dos precios distintos para lo mismo, políticas en conflicto). Haz clic en **Escanear ahora** y resuelve lo que encuentre.

> Tip: revisa Brechas una vez por semana. Cada brecha cerrada es un cliente mejor atendido.

## Portal público: un centro de ayuda para tus clientes

Puedes publicar parte de tu base de conocimiento como un centro de ayuda en línea, sin contraseña, para que tus clientes consulten solos:

1. En **Biblioteca**, haz clic en el botón **Público/Privado** (ícono de globo con candado) del documento que quieras publicar. Los publicados muestran la etiqueta **Público**.
2. Comparte el enlace de tu portal: `https://admin.parallly-chat.cloud/kb/tu-identificador` (el identificador de tu negocio en Parallly). Ideal para enlazarlo desde tu sitio web o en tus redes.

Solo se muestran los documentos que marcaste como públicos; todo lo demás sigue siendo privado.

## Cómo usa el agente tu base de conocimiento

Cuando un cliente pregunta algo, el agente busca en tus documentos y FAQs los fragmentos más relevantes y construye su respuesta con esa información — no inventa datos que no le diste. Para que funcione:

- En **Agente IA**, abre tu agente y, en sus herramientas, verifica que la tarjeta **Base de conocimiento** esté activada. Ahí mismo puedes ajustar cuántos fragmentos usa por respuesta y qué tan exigente es con la relevancia.
- Prueba qué encontraría el agente con la pestaña **Buscar en contexto**: escribe una pregunta como la haría un cliente y verás los fragmentos que la IA usaría, con su porcentaje de relevancia. Si no aparece nada útil, ahí tienes tu próximo artículo.

## Preguntas frecuentes

**El agente responde "no tengo esa información", ¿qué hago?**
Es señal de que falta contenido. Escribe la misma pregunta en **Buscar en contexto**: si no hay resultados, crea un artículo o FAQ que la cubra. Revisa también **Analíticas → Preguntas sin respuesta**, donde esa consulta quedó registrada.

**¿Puedo importar mi sitio web completo?**
Puedes importar página por página con **Importar URL**, hasta el límite de tu plan (50 páginas en Starter, 500 en Pro, sin límite en Enterprise y Custom). Empieza por las páginas con más valor: preguntas frecuentes, precios, políticas.

**¿Los cambios en mi sitio web se reflejan solos?**
Sí. Las páginas importadas se revisan automáticamente cada semana y se actualizan si cambiaron. Si necesitas el cambio ya, usa **Actualizar contenido** en el documento.

**¿Mis clientes pueden ver mis documentos internos?**
No. Todo es privado salvo lo que marques como **Público** para el portal de ayuda. El agente sí usa todo el contenido (público y privado) para responder, pero nunca muestra los documentos en sí.

**Edité un documento y quedó peor, ¿puedo volver atrás?**
Sí. Abre el **Historial de versiones** del documento y haz clic en **Restaurar** sobre la versión anterior.

**¿Por qué no veo la pestaña Analíticas con datos?**
Las analíticas de conocimiento requieren plan **Starter o superior**, y se empiezan a llenar con las conversaciones reales de tus clientes. Si acabas de empezar, dale unos días.

¿Necesitas más ayuda? Escríbenos en https://parallly-chat.cloud/support
