# Parallly Mobile — Manual de usuario

_Versión documental: agosto de 2026_

Parallly Mobile es la aplicación operativa para atender conversaciones, consultar y
actualizar CRM, gestionar tareas y ejecutar flujos del negocio desde el teléfono. Es
una compañera del dashboard web, no una réplica completa de su administración.

> Este manual describe el código disponible. No confirma que una versión concreta ya
> esté aprobada o visible en Google Play o App Store. Verifica el estado de la tienda
> y el `versionCode` instalado antes de una prueba o publicación.

## 1. Acceso

La creación inicial de empresa, la selección de plan y la configuración de canales se
hacen en la web. En móvil:

1. Abre Parallly e inicia sesión con email y contraseña o Google, según la opción
   disponible en tu instalación.
2. Completa el segundo factor si la cuenta tiene 2FA.
3. Si activas biometría, la sesión vuelve a bloquearse al regresar después de más de
   15 minutos en segundo plano.
4. Si el usuario no tiene un tenant operativo, la app muestra **Sin workspace** en vez
   de inventar datos o abrir un módulo ajeno.

## 2. Navegación principal

| Pestaña | Uso |
|---------|-----|
| **Inbox** | Conversaciones, filtros y atención en tiempo real |
| **CRM** | Leads, detalle de contacto y acceso al embudo |
| **Operación** | Nombre y contenido adaptados a las capacidades de la vertical |
| **Más** | Disponibilidad, tareas, indicadores, idioma, notificaciones y cuenta |

El nombre interno de la tercera pestaña es `Citas`, pero el usuario ve el término
resuelto para su negocio: Agenda, Estadías, Pedidos, Clases, Seguros, Solicitudes,
Sesiones u otro workspace publicado.

## 3. Inbox

- Busca conversaciones y combina filtros de asignación, estado y canal.
- Los badges distinguen handoff, atención por IA y no leídos.
- Para iniciar una conversación saliente de WhatsApp usa un template aprobado y una
  conexión permitida; la ventana y reglas de Meta siguen aplicando.
- Si un filtro deja la lista vacía, limpia filtros antes de asumir que no hay mensajes.

### Dentro de una conversación

Según rol y estado puedes:

- asignártela o tomar control;
- devolverla a IA;
- marcarla resuelta;
- agregar una nota interna;
- usar canned responses y macros;
- pedir una sugerencia, reescritura por tono o resumen a Copilot;
- ver imágenes y notas de voz entrantes;
- abrir el contacto 360°.

El indicador de presencia muestra si otra persona está viendo el mismo hilo. Evita
responder en paralelo cuando aparezca una colisión.

## 4. CRM y embudo

- Busca leads y abre su ficha 360°.
- Consulta o edita datos permitidos, etiquetas, oportunidades y acciones de contacto.
- Crea un lead desde móvil cuando tu rol lo permita.
- Abre el embudo y mueve deals entre etapas habilitadas.

Los cambios dependen de los permisos del backend. Un error de red no debe interpretarse
como una creación o transición exitosa; vuelve a intentar después de recuperar conexión.

## 5. Workspace operativo por vertical

La app usa `manifestVersion` y `effectiveCapabilities` publicados por la API. El
workspace puede ser:

| Workspace | Ejemplos de uso |
|-----------|-----------------|
| Agenda | citas de salud/belleza, visitas, asesorías, servicios o test drives |
| Estadías | hotel y alquiler vacacional |
| Tours y reservas | tours y agencias de viaje |
| Pedidos y reservas | restaurante |
| Pedidos | retail, catálogo, hardware, farmacia o boutique según capacidades |
| Clases | membresías, clases y reservas de gimnasio |
| Matrículas | cohortes e inscripciones educativas |
| Seguros | cotizaciones, pólizas y reclamos |
| Solicitudes | servicios del hogar y despacho |
| Sesiones | fotografía |
| Alquileres de vehículos | automotriz/alquiler |
| Hospedaje de mascotas | guardería u hotel para mascotas |
| Sin módulo | cuando la API no publica una capacidad móvil segura |

La misma industria puede abrir un workspace distinto por subtipo. Una lista explícita
de capacidades vacía muestra **Sin módulo operativo**; no es un fallo de navegación.

### Crear y avanzar operaciones

- Agent puede crear las operaciones de campo permitidas: citas, estadías, tours,
  pedidos/reservas, reservas de clase, intake de seguros, solicitudes, test drives,
  alquileres y hospedaje de mascotas.
- Admin/Supervisor también pueden crear matrículas y sesiones fotográficas.
- Los botones de estado son conservadores: solo aparecen para una transición conocida,
  hacia adelante y compatible con rol/estado.
- Acciones sensibles de seguros o cancelaciones pueden requerir manager o confirmación.
- Registros terminales y estados desconocidos permanecen en lectura.

Las 18 verticales están implementadas pero no certificadas E2E. Consulta
`product-capabilities-reference.md` antes de presentar una capacidad como completa.

## 6. Citas y reservas

En Agenda puedes consultar próximas citas y, según estado, confirmar, completar,
reprogramar o cancelar. Los workspaces especializados aplican su propio ciclo: por
ejemplo, pedido recibido → en preparación → listo → entregado, o solicitud pendiente
→ cotizada → agendada → despachada → en curso → completada.

Cuando una transición requiere fecha y hora, la app debe guardarlas junto con el nuevo
estado; si no hay disponibilidad, no fuerza la operación.

## 7. Más: disponibilidad, tareas e indicadores

- Cambia tu estado a online, ausente u offline.
- Consulta tareas asignadas y márcalas completadas.
- Visualiza indicadores operativos de los últimos 30 días cuando el endpoint y tu rol
  lo permiten. Esto no equivale a acceso a la página web de analítica del equipo.
- Cambia el idioma entre español, inglés, portugués y francés.
- Abre preferencias de notificaciones, política de privacidad y solicitud de
  eliminación de cuenta.
- Cerrar sesión requiere confirmación.

## 8. Push y enlaces profundos

Las notificaciones push pueden avisar de mensajes, handoffs, SLA y citas. Al tocar una
notificación compatible, la app abre la conversación indicada, incluso desde inicio
en frío. Puedes configurar categorías desde **Más → Preferencias de notificaciones**.

El push remoto requiere un build nativo compatible y permisos del sistema; no funciona
como push remoto en Expo Go para los SDK actuales.

## 9. Conectividad y errores

Si pierdes conexión:

1. Un mensaje saliente del chat puede quedar en la outbox local y enviarse al
   reconectar. La cola está aislada por usuario/tenant y se limpia al cerrar sesión.
2. No repitas otra acción destructiva hasta confirmar si el servidor la recibió.
3. Usa **Reintentar** cuando aparezca en la pantalla o sobre un mensaje fallido.
4. Algunas listas muestran la última copia conocida; el estado offline aparece de
   forma explícita y no convierte un error en una lista vacía válida.
5. Revisa filtros si una lista parece vacía.
6. Comprueba que tu sesión y tenant siguen activos.
7. Si el problema persiste, registra pantalla, hora, usuario, versión instalada y el
   flujo exacto; no compartas tokens ni códigos 2FA.

## 10. Funciones que se administran en web

Usa el dashboard web para conectar canales, crear o editar agentes IA, gestionar
usuarios, facturación, planes, datos de empresa, integraciones, API keys, catálogos,
configuración avanzada y analítica completa. La ausencia de estas opciones en móvil es
intencional.
