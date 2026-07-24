---
id: crm-contactos
title: "Contactos y CRM"
routes: ["/admin/contacts", "/admin/contacts/segments", "/admin/identity", "/admin/settings/custom-attributes"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["contactos", "crm", "leads", "clientes", "score", "puntaje", "etapas", "segmentos", "filtros", "importar", "exportar", "csv", "excel", "duplicados", "fusionar", "merge", "archivar", "acciones masivas", "atributos personalizados", "campos personalizados", "vip"]
---

# Contactos y CRM

El CRM de Parallly es donde viven todos tus contactos: cada persona que te escribe por WhatsApp, Instagram, Messenger, Telegram, Email o el chat de tu sitio web se registra aquí automáticamente, con su historial completo. También puedes agregar contactos a mano o importarlos desde Excel.

Lo encuentras en la barra lateral: abre **CRM** y entra a la primera opción, **CRM**. Llegarás a la página **Contactos**, con una tabla que muestra nombre, canal, conversaciones, valor, última interacción, score, etapa y etiquetas. Arriba tienes chips rápidos para filtrar por grupo: **Todos**, **Nuevos**, **Leads**, **Calificados**, **Clientes** y **Perdidos**, además de un buscador.

Todos los roles pueden ver, crear y editar contactos. Archivar y las acciones masivas están reservadas para administradores y supervisores.

## Cómo crear un contacto manualmente

1. En **Contactos**, haz clic en **Agregar contacto**.
2. Completa el formulario **Nuevo contacto**: **Nombre**, **Apellido**, **Teléfono** (obligatorio), **Correo electrónico** y **Etapa** inicial.
3. Haz clic en **Crear contacto**.

> El teléfono se limpia y se normaliza automáticamente al formato internacional (funciona con números de Colombia, Argentina, México, Brasil, Chile, Perú, Ecuador y EE. UU./Canadá). Puedes escribir `3001234567` o `+573001234567`: ambos quedan bien guardados.

## El detalle del contacto (ficha 360°)

Haz clic en cualquier contacto para abrir su ficha completa:

- **Editar**: con el botón **Editar** cambias nombre, correo, teléfono, etapa, la marca **VIP** y las **Etiquetas** directamente en la ficha. Guarda con **Guardar**.
- **Desglose del score**: haz clic en el score para ver los 5 factores que lo componen — **Recencia**, **Engagement**, **Intención**, **Etapa** y **Perfil**.
- **AI Insights**: análisis automático del comportamiento del contacto (probabilidad de cierre, próxima mejor acción, señales detectadas).
- **Campos personalizados**: los atributos extra que hayas definido para tu negocio (ver más abajo).
- **Oportunidades**: los negocios abiertos de este contacto en el embudo.
- Pestañas **Historial** (línea de tiempo de actividad), **Notas** (anotaciones internas del equipo) y **Tareas** (seguimientos, llamadas, reuniones).

### ¿Qué es el score?

Es un puntaje que ordena tus contactos según qué tan "calientes" están: qué tan reciente es su última interacción, cuánto conversan, qué palabras de compra usan, en qué etapa están y qué tan completo es su perfil. Los administradores y supervisores pueden ajustar el peso de cada factor en **Configuración → Lead scoring**, incluyendo el decaimiento (el score baja solo si el contacto pasa muchos días sin actividad).

### Etapas

Cada contacto tiene una etapa de venta (nuevo, contactado, calificado, ganado, perdido…). Las etapas son las mismas de tu embudo y se personalizan en **Configuración → Etapas del pipeline**. Puedes cambiarla desde la ficha del contacto o dejar que el agente de IA la avance solo (ver el artículo del Embudo de ventas).

## Cómo usar los filtros avanzados

1. En **Contactos**, abre **Filtros avanzados**.
2. Combina criterios: **Rango de score** (mínimo y máximo), **Rango de fechas**, **Filtrar por etiquetas**.
3. Haz clic en **Aplicar filtros**. Con **Limpiar filtros** vuelves a la lista completa.

## Cómo importar contactos desde Excel o CSV

1. En **Contactos**, haz clic en **Importar**.
2. En la ventana **Importar contactos**, arrastra tu archivo de Excel (.xlsx, .xls) o CSV, haz clic para buscarlo en tu computador, o copia y pega las celdas directamente.
3. Si lo prefieres, usa **Descargar plantilla CSV** para partir de una plantilla con las columnas correctas y una hoja de instrucciones.
4. Haz clic en **Importar**. Al terminar verás el resumen: **Importados**, **Omitidos** y **Errores** (con el detalle de cada fila con problemas).

Detalles útiles del formato:

- La única columna obligatoria es el **teléfono** (es el identificador único del contacto).
- Las columnas aceptan sinónimos en español e inglés (ej. "telefono", "celular", "phone") y el separador puede ser coma o punto y coma.
- Columnas opcionales: nombre, apellido, correo, etapa, empresa, origen, es_vip, canal preferido y atributos de campañas (UTM).
- Si incluyes la columna de etapa, los valores válidos son: `nuevo`, `contactado`, `respondio`, `calificado`, `tibio`, `caliente`, `listo_cierre`, `ganado`, `perdido`, `no_interesado`.

## Cómo exportar tus contactos

En **Contactos**, haz clic en **Exportar**. Se descarga un archivo de Excel con todos tus contactos, listo para abrir o compartir.

## Acciones masivas

Para administradores y supervisores:

1. Marca las casillas de los contactos que quieras (verás cuántos llevas **seleccionados**).
2. En la barra que aparece abajo, elige la acción: **Cambiar etapa**, **Agregar etiqueta** o **Archivar**.
3. Completa el dato (la nueva etapa o el nombre de la etiqueta) y haz clic en **Aplicar**.

## Cómo archivar un contacto

Archivar saca al contacto de tus listas y del embudo (por ejemplo, contactos de prueba o que pidieron no ser contactados).

1. Abre la ficha del contacto y haz clic en **Archivar**.
2. Confirma en la ventana **Archivar contacto**.

También puedes archivar varios a la vez con las acciones masivas. Tómalo como una acción definitiva: revisa bien antes de confirmar.

## Segmentos guardados

Un segmento es un grupo de contactos definido por filtros que se actualiza solo: "leads calientes", "clientes VIP de Instagram", etc. Sirven, por ejemplo, para elegir el público de una campaña.

1. En **Contactos**, haz clic en **Segmentos** (o entra a la página Segmentos del CRM).
2. Haz clic en **Nuevo segmento**.
3. Ponle **Nombre** (ej. "Leads calientes") y una **Descripción** opcional.
4. Con **Agregar filtro** combina criterios: **Etapa**, **Puntuación**, **Teléfono**, **Email**, **Fuente**, **VIP** o **Fecha de creación**, con operadores como "igual a", "mayor que" o "contiene".
5. Usa **Previsualizar** para ver cuántos contactos coinciden y haz clic en **Crear segmento**.

## Atributos personalizados

Si necesitas guardar datos propios de tu negocio (cumpleaños, talla, número de póliza…), crea campos a tu medida. Disponible para administradores y supervisores:

1. Ve a **Configuración** y, en la sección **Operación**, entra a **Atributos personalizados**.
2. Haz clic en **Nuevo atributo**.
3. Elige el **Tipo de entidad** (Contacto, Lead, Empresa o Conversación), escribe la **Etiqueta** (ej. "Cumpleaños") y el **Tipo de dato**: Texto, Número, Fecha, Booleano, Lista (con opciones separadas por comas) o URL. Puedes marcarlo como **Campo requerido**.
4. Guarda. El campo aparecerá en la sección **Campos personalizados** de la ficha de cada contacto.

## Contactos duplicados: fusión automática y manual

Si la misma persona te escribe por dos canales con el mismo teléfono o correo, Parallly une los perfiles automáticamente. Para los casos que el sistema no puede resolver solo, los administradores y supervisores tienen la página **Identidad** (escribe `/admin/identity` al final de la dirección de tu panel):

- **Sugerencias automáticas**: pares de contactos muy parecidos detectados por el sistema, con su nivel de **Confianza**. Revisa cada par y elige **Aprobar** (se fusionan) o **Rechazar**.
- **Fusionar manualmente**: busca y selecciona el primer y el segundo contacto, y haz clic en **Fusionar contactos**. Quedan unidos en un solo perfil con todo su historial.

## Límites por plan

| Plan | Contactos | Segmentos guardados | Atributos personalizados |
|------|-----------|---------------------|--------------------------|
| Emprendedor | 100 | No incluye | No incluye |
| Starter | 500 | 3 | 5 |
| Pro | 5.000 | 15 | 20 |
| Enterprise | 50.000 | Sin límite | Sin límite |
| Custom | Sin límite | Sin límite | Sin límite |

Al acercarte al límite de contactos de tu plan verás un aviso para ampliarlo desde **Configuración → Facturación**.

## Preguntas frecuentes

**¿Los contactos se crean solos?**
Sí. Cada persona que te escribe por cualquier canal conectado queda registrada automáticamente con su conversación. Crear a mano o importar es solo para contactos que aún no te han escrito.

**¿Por qué un contacto tiene score bajo si me compró hace meses?**
El score premia la actividad reciente: si configuraste decaimiento, baja con los días sin interacción. Puedes ajustar los pesos en **Configuración → Lead scoring**.

**¿Qué pasa si importo un teléfono que ya existe?**
El teléfono es el identificador único: la fila se marca como omitida o actualiza el contacto existente, no se crean duplicados. El resumen de la importación te muestra el detalle.

**¿Puedo deshacer una fusión de contactos?**
No desde el panel. Antes de aprobar una sugerencia o fusionar manualmente, revisa bien ambos perfiles. Si fusionaste por error, escríbenos a soporte.

**¿Quién puede archivar o hacer cambios masivos?**
Solo administradores y supervisores. Los agentes pueden ver, crear y editar los contactos.

**¿Necesitas más ayuda?** Escríbenos en https://parallly-chat.cloud/support
