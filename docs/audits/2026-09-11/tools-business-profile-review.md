# Auditoría de herramientas, tipos de negocio y configuración del agente

Fecha: 2026-09-11. Base inspeccionada:
`96ee640e40884742371889f19f916d1e80d9ed70`; la rama recibió trabajo concurrente de
mensajería. Los hashes de las fuentes usadas por el censo están en
[tool-profile-audit.json](./tool-profile-audit.json).

## Conclusión

La arquitectura tiene contratos compartidos y una cobertura estructural amplia,
pero configuración, navegación, diagnósticos y ejecución no estaban completamente
alineados. Esta tanda corrige defectos reproducidos y agrega un plan de cierre
específico. **No certifica las 268 tareas ni los 76 perfiles.**

El cambio de enfoque necesario es organizar la configuración por tareas del
negocio, mostrando sus herramientas y requisitos, con una autoridad común para
editor, runtime y Assist. Un listado de interruptores no acredita que un agente
pueda cumplir su misión.

## Universo y alcance

El [censo generado](./tool-profile-audit.md) cruza el manifiesto de capacidades,
los perfiles, familias del registro, definiciones de tools, ramas del ejecutor,
políticas, rutas de navegación y matriz de tareas.

| Dimensión | Resultado de código |
|---|---:|
| Verticales canónicas | 20 |
| Perfiles de tipo de negocio | 76 |
| Familias configurables | 27 |
| Familias del registro nativo | 26 |
| Herramientas estáticas | 123 |
| Origen core / vertical / provider | 38 / 81 / 4 |
| Tareas / tareas que comprometen al negocio | 268 / 146 |

Las familias configurables no equivalen a herramientas individuales: pagos y otras
herramientas se componen fuera del registro nativo. MCP se registra dinámicamente
y queda fuera del número 123. Los 76 perfiles se inspeccionan individualmente;
no se infieren desde una prueba por vertical.

Después de los fixes, el censo no encuentra herramientas estáticas sin definición,
rama ejecutora o política, controles obligatorios declarados ausentes, rutas de
perfil ocultas, páginas inexistentes ni rutas sin registro de navegación.
Esto acredita correspondencias; no demuestra que un writer termine correctamente,
que se pueda cobrar o que un usuario nuevo entienda su configuración.

La matriz sin evidencia cargada devuelve cero perfiles certificados. No se leyó
el historial de cuentas productivas; no afirmar que ninguna cuenta haya sido
probada a partir de este censo. Los cinco `file_claim` sin positivo/verificador son
excepciones negativas deliberadas del catálogo, no cinco éxitos pendientes de fabricar.

## Defectos corregidos

### Editor y navegación

`CapabilitiesSection` ofrecía las 17 familias especializadas sin considerar el
subtipo: el cruce de los 76 perfiles detectó 1.228 ofertas de familia fuera del
perfil. El editor ahora usa el contrato compartido. Una configuración histórica
incompatible encendida sigue visible para poder apagarla; no permite reactivarla.

Catálogo de servicios estaba declarado, pero oculto, para 14 perfiles: retail/hogar,
los siete de servicios del hogar, guardería/hotel de mascotas y los cuatro de
fotografía. Ahora se exige capacidad activa y ruta publicada del manifiesto.
La prueba de rutas ya no omite esa correspondencia.

Pagos no se habilita mientras se desconoce el plan. Se consulta al montar y cambiar
tenant; una respuesta tardía de otra cuenta no puede pintar sus permisos. Los
defaults de reserva/cancelación y creación de enlaces coinciden con el runtime.

### Autoridad del runtime

Las lecturas de proveedores podían publicarse aunque su familia estuviese apagada.
Toast, Mindbody y Cliniko ahora quedan limitados por su grupo, perfil y contrato.
Se mantiene el desplazamiento de writers locales cuando un proveedor administra
esa operación: desactivar la familia o fallar la salud de una integración
configurada no crea autoridad local de sustitución.

Si fallan tanto salud como lectura de bindings del proveedor, los writers locales
potencialmente desplazados no se publican; se conserva lo independiente. Se
agregaron pruebas sobre los 76 perfiles y controles de casos positivos.
El CTA de preparación de pagos llevaba a una integración distinta; se corrigió.

### Preparación y diagnóstico

La invalidación de readiness borraba una clave distinta de las que se cacheaban.
El diagnóstico ahora fuerza relectura e introduce una generación por tenant. Las
pruebas cubren múltiples claves/esquemas, otro tenant, consulta antigua en vuelo y
fallo de Redis. La siguiente consulta viva usa la generación actual.

Assist perdía motivos de exclusión al buscar una familia como substring del nombre
de herramienta: `appointments` no aparece en `check_availability`. Se resuelve la
familia real desde el registro. El agregado de herramientas considera los canales
asignados; uno sano ya no oculta otro canal ilegible o con menos permisos.
Cada herramienta recibe sólo la preparación pertinente a su familia y dependencias;
los proveedores no heredan requisitos de tablas nativas. Los ejemplos con marcadores
de fixtures o evaluación se omiten y se conservan los ejemplos canónicos legibles.

### Evidencia

Un caso negativo aislado con prefijo de intención podía hacer parecer verificada
la tarea. El lector ahora requiere autoridad actual, perfil/canal/idioma,
definiciones canónicas y todos los casos pertinentes. Sin scope actual no certifica.
**Falta integrar ese scope en assessment** con la autoridad de snapshots; está
documentado como pendiente local, no como certificación terminada.

### Ayuda de Assist

Se agregó el artículo 27 en es/en/pt/fr sobre tipo de negocio, misión, permisos,
datos, proveedor, diagnóstico y pruebas. Distingue activado, preparado y probado,
y separa la ayuda de plataforma de la base de conocimiento del negocio.

## Brechas confirmadas que continúan abiertas

| Prioridad | Brecha | Consecuencia / criterio de cierre |
|---|---|---|
| Alta | 11 controles emailConfirmations visibles sin consumidor | Implementar el evento y envío de cada familia, o retirar la promesa; probar efecto real del control. |
| Alta | Consumidores de confirmaciones eligen el primer agente activo | Configuración incorrecta en cuentas con varios agentes; vincular autoridad de origen y política del scheduler. |
| Alta | Scope de evidencia actual no conectado | Assessment no puede pasar legítimamente de preparado a probado; integrar autoridad sin copiar hashes históricos. |
| Alta | Diagnóstico de canal/global incompleto | Incluir writersBlocked, herramientas y pruebas requeridas, con estados consistentes y recuperables. |
| Media | canCheckStock / canRecommend sin controles específicos | El permiso existe en backend pero el dueño no puede gobernarlo completamente desde el editor. |
| Media | Descuentos/refund no operables por el proveedor actual | No venderlos como capacidad completa; ligar flags, procedimiento y proveedor, o declarar indisponibilidad. |
| Media | Tours omiten cases, stays, tourBookings y serviceCatalog | Completar rutas, explicaciones, accesibilidad y vuelta a configuración por perfil. |
| Alta | Resoluciones de preparación sin prueba completa de reparación | Una FAQ/RAG o una ruta existente no acredita que se arregle la tabla consultada por la herramienta. |
| Alta | Competencia por tarea pendiente | Probar escenarios, persistencia, capacidad, confirmación y resultados en la matriz de 76 perfiles. |

Los flags tipados de notificaciones alcanzan 18 familias; cuatro no tienen control
en la UI. La decisión debe ser coherente por función, evitando agregar interruptores
inoperantes sólo para igualar un conteo.

El censo no constituye una auditoría de cada endpoint o pantalla móvil, de MCP instalado en
una cuenta ni de respuestas reales de proveedores. Esos recorridos se incluyen
como condiciones de cierre del addendum, con evidencia separada.

## Verificación y límites

La verificación automatizada de esta tanda se registra en
[tool-profile-validation.md](./tool-profile-validation.md). Se ejecutaron suites
focalizadas, incluyendo matrices de los 76 perfiles y regresiones que fallaban
antes de los fixes. No se ejecutaron proveedores reales ni se certificó la matriz
completa mediante modelos pagos. No se hizo push ni despliegue.

## Continuación

El [addendum de ejecución para Claude](../../handoffs/2026-09-11/claude-tools-business-profile-alignment.md)
define T1–T7, orden, paralelización por archivos, pruebas de aceptación y relación
con mensajería económica, durabilidad, aprendizaje y release. Cerrar esos puntos
antes de declarar completa la alineación de herramientas de la plataforma.
