# Qué cambia, para quien lo va a usar

La tabla A1–H3 dice en qué estado está cada fila. Este documento dice otra cosa:
qué se ve distinto, y para quién. Está ordenado por persona y por pantalla, no
por módulo, porque un cambio que sólo se puede explicar nombrando un archivo es
un cambio que nadie fuera del código puede evaluar.

Nada de esto está en producción. El candidato está en el draft PR
[#21](https://github.com/Nipko/sales-structure/pull/21).

---

## Para quien se da de alta por primera vez

**Los cuatro campos del formulario ya se pueden leer con un lector de pantalla.**
Tenían etiqueta visible y ninguna asociación, así que un lector decía «edit text»
cuatro veces en la primera pantalla del producto, y hacer clic en la etiqueta no
enfocaba nada. Ahora cada campo tiene su `id`, su `autocomplete` y el botón de
ver/ocultar contraseña tiene nombre accesible.

**El asistente de alta sigue siendo el mismo, y ahora hay una prueba que lo
recorre entero.** Elegir «salud / medicina general» cambia lo que pregunta
después —audiencias y objetivos médicos— y elegir «restaurantes» pregunta otra
cosa. Eso ya funcionaba; lo que no existía era nada que lo comprobara, así que
una regresión ahí no se habría notado hasta que un dueño la encontrara.

**Lo que el dueño contesta es exactamente lo que se manda, una sola vez.** El
cuerpo del alta se captura tal como sale del navegador y se comprueba campo por
campo: rubro, subtipo, tamaño, audiencias, objetivos e idioma.

## Para quien usa Parallly Assist

**Assist ya no manda a pantallas que el panel esconde.** Esto es lo más visible
de la tanda. La lista de las ocho operaciones que Assist no hace —conectar un
canal, conceder un rol, publicar el agente, configurar el cobro, agendar,
reemplazar disponibilidad, crear una campaña, crear una oferta— se le entregaba
al modelo entera, sin filtrar ni por rol ni por rubro. Un agente de inbox recibía
«andá a `/admin/users` y concedé el rol»; un restaurante, «andá a
`/admin/appointments`». El panel devolvía a los dos al asistente de puesta en
marcha, y lo que el dueño vivía era que el asistente lo mandaba a un lugar que no
existe.

Ahora la lista se filtra por las dos cosas que deciden si la pantalla abre. Y lo
que queda afuera **se dice**, con el motivo: «esto lo decide un administrador» o
«no forma parte de las capacidades de este rubro». Callarlo sería peor — el
modelo no puede distinguir «no existe» de «no me lo contaron», así que inventa
una disculpa o manda a otra pantalla.

**Un agente de inbox vuelve a recibir la lista.** La mitad del prompt que explica
las derivaciones estaba detrás de «¿puede crear contenido?», y un `tenant_agent`
no puede crear nada — así que tampoco se le decía nada de las pantallas,
incluida `agenda.appointment.book`, la única derivación que el registro declara
para ese rol.

**Y no ofrece crear lo que no se puede crear.** Preparar un curso para un
restaurante escribía una fila en una tabla cuya pantalla ese tenant no puede
abrir: creado, auditado e inalcanzable. El servicio lo rechaza al proponer y otra
vez al aplicar, así que una propuesta revisada antes de que el negocio cambiara
de rubro no sirve de permiso después.

**El circuito completo está recorrido en un navegador**: proponer, ver los dos
lados del cambio, guardar un borrador —no la versión que atiende a los
clientes—, y leer el recibo de esa revisión. Con sus dos negativas: un supervisor
ve el cambio propuesto y no tiene botón para guardarlo, y una propuesta vencida
lo dice en vez de dejar escribir sobre una revisión que ya se movió.

## Para quien configura el agente

**El asistente de puesta en marcha ya no se queda girando.** Un espacio de
trabajo sin su parte operativa hacía saltar una excepción que se iba al límite de
error del recorrido guiado, y dejaba la única pantalla que una cuenta nueva no
puede saltear con un spinner y ningún mensaje. Ahora, si eso pasara, sale el
error que la pantalla ya sabía escribir.

**Los recorridos guiados están probados como los usa una persona**: se arrancan
desde la tarjeta de puesta en marcha con un clic, se completan hasta el último
paso, se cierran a la mitad y no reaparecen solos, cruzan a la pantalla del paso
y siguen ahí, y se pueden volver a hacer desde el principio. Y la promesa que los
hace seguros de ofrecer —que no cambian nada mientras explican— se comprueba
mirando cada escritura durante la corrida.

## Para quien opera el agente todos los días

**Nada cambia en el turno.** Esta tanda no tocó el pipeline de conversación.

Lo que cambió alrededor: una respuesta que estaba en cola deja de vivir sólo en
Redis y pasa a tener dirección en la base, así que un retiro de versión o un
borrado de contacto la alcanzan **antes** de que salga; y un trabajo reintentado
no manda una segunda copia porque encuentra la fila ya marcada.

## Para quien cobra

**Tres familias dejaron de cobrar lo que dice la fila hoy y pasaron a cobrar lo
que el cliente aceptó.** Citas, pedidos de catálogo y las familias con
compromiso leen el precio acordado y **se niegan** cuando no hay ninguno, en vez
de tomar el precio del catálogo del día — que puede ser más alto o más bajo que
el que la persona vio.

Negarse tiene una fecha: el momento en que el código nuevo corre, una fila
anterior al atado deja de ser cobrable. Por eso cada familia tiene su contador de
huérfanos y hay un endpoint que lo responde por tenant, para que eso sea un
número que alguien puede ver antes y no una sorpresa en la caja.

**Y un rechazo mudo dejó de ser mudo.** Una cita con seña anterior al atado
vuelve con un número y sin moneda: se rechaza bien, y hasta ahora se contaba como
nada — una persona con un enlace de pago que no funciona, sin que nadie se
enterara, idéntico a un error de tipeo en la referencia.

## Para quien conecta canales

**La ventana de Instagram deja de girar para siempre.** El canje del código no
tenía plazo en ninguna parte, así que un API o un Meta lentos dejaban el popup
con un spinner, sin mensaje ni salida, y con la pantalla que lo abrió esperando
un resultado que nunca llegaba. Ahora espera veinte segundos y dice lo honesto:
no que falló —eso sería una afirmación sobre una conexión que quizá sí se
hizo— sino que no se pudo confirmar, y dónde mirar.

**Y deja de acusar de un ataque a quien acaba de conectar.** El guardia de
reintento estaba después de consumir el par CSRF, así que la segunda corrida del
efecto no encontraba nada guardado y reportaba un ataque. En desarrollo eso era
cada conexión de Instagram.

**La matriz de certificación de canales tiene pantalla.** El API la calculaba
desde hace tiempo y nadie la pedía: la única forma de leerla era con curl.

## Para quien administra la plataforma

**El benchmark se puede operar.** Techo que frena la corrida, deadline por reloj,
pausa, reanudación y cancelación, con reserva del presupuesto **antes** de llamar
al modelo y reclamo de la tarea antes de ejecutarla — así un trabajo reintentado
no vuelve a pagar por la misma respuesta.

**El ejecutor de certificación existe y se ensaya sin gastar.** Los 76 perfiles
se planifican, se particionan y los procesa el worker real, con gasto cero, y
recupera los leases de un worker que murió.

**El informe A1–H3 dejó de poder mentir en dos filas más.** D2 y E2 estaban
escritas a mano y decían que faltaba algo que ya estaba; ahora leen la misma
autoridad que lee el producto. Diez de las 25 filas son contadores; las doce que
siguen siendo declaraciones humanas lo dicen en la propia tabla.

## Para cualquiera que use el panel

**Ocho textos por debajo del contraste legible, medidos y corregidos**: las cinco
secciones del menú (2,58:1 en claro), el pie del acceso (2,47:1), el distintivo
que dice si los números de la pantalla son reales (1,86:1) y el chip de canal del
asistente. Ninguno era «texto grande», que es la excepción que la regla permite.

**Y el panel se puede agrandar.** A 320 px de ancho —lo que queda de una pantalla
de 1280 al 400 % de zoom— la página no se va de lado, y al 200 % tampoco, con su
landmark principal y el asistente todavía alcanzables en vez de escondidos para
que el ancho entre.
