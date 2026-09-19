---
id: canales-email-widget
title: "Chat web y estado de la integración de Email"
routes: ["/admin/channels", "/admin/channels/email", "/admin/settings/integrations/web-chat", "/admin/settings/integrations/web-chat/triggers"]
roles: ["tenant_admin"]
keywords: ["email", "correo", "estado del canal email", "widget", "chat web", "web chat", "chat en mi sitio", "chat en mi pagina", "burbuja de chat", "codigo de insercion", "instalar widget", "triggers", "mensaje de bienvenida", "formulario pre-chat", "enlace de tu agente", "codigo de dos lineas"]
---

# Chat web y estado de la integración de Email

El **widget de chat web** es una superficie conversacional operativa que instalas en tu sitio para que los visitantes hablen con tu asistente de IA sin salir de la página.

> Solo el rol **administrador** puede configurar el widget de chat web.

## Disponibilidad

La pantalla indica si el chat web y los disparadores proactivos están habilitados y cuánto cupo queda. Consulta los detalles vigentes en **Plan y facturación**.

### Estado de Email

Email existe como adaptador técnico y entrada interna para integraciones administradas, pero **todavía no es un canal conversacional certificado ni configurable en autoservicio**. La página **Canales → Email** no cuenta actualmente con el contrato de API necesario para guardar una configuración por tenant. No ingreses credenciales ni asumas que esa pantalla deja el canal operativo.

Si tu organización necesita integrar correo, solicita una evaluación técnica a soporte. Hasta que el flujo sea implementado y certificado de extremo a extremo, Parallly Assist no debe prometer conexión, envío, recepción en el inbox ni respuestas automáticas por Email.

### El enlace de tu agente y el chat web de tu página

**El enlace de tu agente** (la página pública que ves en el asistente de configuración, con dirección que empieza en `/w/` seguida de un identificador) existe desde el día 0, antes de conectar ningún canal. Lo que es depende de tu plan:

- **Si tu plan no incluye el chat web**, sirve para **probar a tu agente y mostrárselo a alguien**: la plataforma paga sus mensajes hasta un cupo por cuenta, cada página tiene un tope de mensajes por día y la conversación nunca pasa a una persona. La plataforma puede pausar este enlace de prueba: mientras está en pausa, o cuando se agota el cupo, tu agente no responde por él.
- **Si tu plan incluye el chat web**, ese mismo enlace es un **canal real**: atiende a tus clientes con la cuota de tu plan, sin el tope diario de la prueba, y puede pasarle la conversación a tu equipo cuando el cliente pide una persona. Entonces la tarjeta del enlace suma **Ponerlo en mi bio** y **Ponerlo en mi página web**.

En los dos casos las conversaciones que recibe aparecen en tu bandeja de entrada como cualquier conversación de chat web, y el enlace no cuenta como canal conectado: no se conecta ni se desconecta.

El **chat web que instalas en tu sitio** (el widget de esta pantalla) sí cuenta como canal conectado y usa la función de chat web de tu plan. Para ponerlo en tu sitio, copia sus dos líneas con **Copiar código** y envíaselas a quien administra tu página; **Ponerlo en mi página web**, en la tarjeta del enlace, te trae a esta misma pantalla.

---

## Cómo instalar el widget de chat en tu sitio web

1. Entra a **Configuración** → **Canales e integraciones** → **Chat web**.
2. Haz clic en **Crear widget**. Se crea tu widget con la configuración inicial.
3. En la tarjeta del widget verás el **Código de incrustación**. Haz clic en el botón **Copiar código**.
4. Pega ese código en tu sitio web, idealmente justo antes del cierre de la página (si otra persona administra tu sitio, envíale el código tal cual: sabrá dónde ponerlo). Funciona en cualquier sitio: WordPress, Shopify, Wix, páginas hechas a medida, etc.
5. Guarda los cambios en tu sitio y recarga la página: la burbuja de chat aparecerá en la esquina que hayas elegido.

Los visitantes que escriban por el widget aparecen como conversaciones en tu bandeja de entrada, y tu asistente de IA los atiende automáticamente.

### Cómo personalizar el widget

En la misma página, haz clic en el ícono de **Configurar** (engranaje) de tu widget y ajusta:

| Opción | Qué controla |
|--------|--------------|
| **Nombre del widget** | Nombre interno para identificarlo (no lo ven tus visitantes) |
| **Nombre del asistente** | El nombre que ve el visitante en la ventana de chat |
| **Color primario** | El color de la burbuja y la cabecera del chat, para que combine con tu marca |
| **Posición** | **Abajo derecha** o **Abajo izquierda** de la pantalla |
| **Mensaje de bienvenida** | El primer mensaje que ve el visitante al abrir el chat |
| **Formulario previo al chat** | Si está activo, el visitante deja sus datos (nombre, contacto) antes de chatear |

Al terminar, haz clic en **Guardar**. Los cambios se aplican en tu sitio sin tocar el código de nuevo.

> Los campos que se piden en el formulario previo al chat se definen en **Configuración** → **Formulario pre-chat**. Pedir el teléfono o correo te permite reconocer al visitante si luego te escribe por WhatsApp u otro canal.

---

## Cómo guardar definiciones de triggers (sin ejecución pública todavía)

La pantalla permite guardar definiciones de triggers según el comportamiento del visitante. **En la versión actual, el script público del widget todavía no evalúa ni ejecuta esas definiciones**, por lo que no debes contar con aperturas, burbujas o banners proactivos en producción. El chat abierto por el visitante sí funciona.

1. Entra a **Configuración** → **Chat web** y haz clic en el botón **Triggers proactivos**.
2. Haz clic en **Nuevo trigger** y ponle un **Nombre** (ej. "Oferta de ayuda en precios").
3. En **Condiciones**, haz clic en **Agregar condición** y elige cuándo se dispara:

| Condición | Se dispara cuando… |
|-----------|--------------------|
| **Tiempo en página** | El visitante lleva X segundos en la página |
| **Scroll (%)** | Bajó más de cierto porcentaje de la página |
| **Intención de salir** | Mueve el cursor para cerrar la pestaña |
| **URL de la página** | Está en una página específica (ej. `/precios`) |
| **Número de visitas** | Ha entrado N o más veces a tu sitio |

4. Si agregas varias condiciones, elige el **Operador**: **Todas deben cumplirse (AND)** o **Al menos una (OR)**.
5. Elige el **Tipo de acción**: **Abrir widget** (el chat se abre solo), **Mostrar burbuja** (aparece un mensajito junto al ícono) o **Mostrar banner** (franja con mensaje y botón).
6. Escribe el **Mensaje** que verá el visitante y, si quieres, ajusta la **Frecuencia (min)** (0 = se muestra una sola vez por visita).
7. Haz clic en **Guardar**. La definición queda almacenada, pero todavía no se ejecuta en el sitio público.

**Ejemplos de configuraciones que el editor permite preparar (aún no se ejecutan):**

- Página de precios + 15 segundos → burbuja: "¿Tienes dudas sobre nuestros planes? Te ayudo a elegir".
- Intención de salir en el checkout → abrir widget: "¡Espera! ¿Te ayudo a completar tu compra?".
- 3.ª visita → banner: "Bienvenido de vuelta — agenda una demo gratuita".

> No publiques una estrategia que dependa de estos triggers hasta que el cargador público los marque como disponibles. La pantalla puede mostrar capacidad del plan aunque el ejecutor del navegador siga pendiente.

---

## Preguntas frecuentes

**¿Puedo tener el widget en varios sitios web?**
Puedes crear más de un widget desde **Crear widget** y cada uno tiene su propio código de incrustación y su propia personalización.

**¿Cómo quito el chat de mi sitio?**
En la tarjeta del widget, haz clic en **Eliminar** y confirma: los visitantes ya no podrán chatear, aunque el código siga en tu página. Si prefieres conservar el widget y su configuración, pide a quien administra tu sitio que retire el código de la página.

**¿Qué pasa con los chats del widget cuando mi negocio está cerrado?**
Tu asistente de IA responde 24/7. Si el visitante pide hablar con una persona fuera de horario, aplican tus **Horarios de atención** y el mensaje fuera de horario que hayas configurado.

**¿Necesito saber programar para instalar el widget?**
No. Solo copias el código con **Copiar código** y lo pegas en tu sitio (o se lo envías a quien lo administre). Es un paso de una sola vez.

¿Sigues con dudas? Escríbenos en https://parallly-chat.cloud/support
