# Auditoría de herramientas, tipos de negocio y configuración del agente

Auditoría iniciada el 2026-09-11 y actualizada el 2026-09-13. La base histórica
inspeccionada fue `96ee640e40884742371889f19f916d1e80d9ed70`; el estado actual se
deriva del HEAD mediante el generador. Los hashes de sus fuentes están en
[tool-profile-audit.json](./tool-profile-audit.json).

## Conclusión

La arquitectura tiene contratos compartidos y una cobertura estructural amplia,
pero configuración, navegación, diagnósticos y ejecución no estaban completamente
alineados. Esta tanda corrige defectos reproducidos y agrega un plan de cierre
específico. **No certifica las 420 tareas ni los 76 perfiles.**

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
| Tareas / tareas que comprometen al negocio | 420 / 146 |

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
Assessment integra ese scope con la autoridad de snapshots y sólo reconoce
evidencia sellada de la revisión vigente. Esto permite distinguir una tarea
preparada de una probada sin reutilizar resultados de una configuración anterior.

### Ayuda de Assist

Se agregó el artículo 27 en es/en/pt/fr sobre tipo de negocio, misión, permisos,
datos, proveedor, diagnóstico y pruebas. Distingue activado, preparado y probado,
y separa la ayuda de plataforma de la base de conocimiento del negocio.

## Estado de las brechas confirmadas

T1–T4 y T6–T7 están aceptadas por contadores derivados. T5 tiene cero trabajo
local abierto y queda bloqueada únicamente por las cuentas y modelos necesarios
para certificar: 0 de 76 perfiles y 0 de 5 canales cuentan hoy como certificados.

Los controles de confirmación visibles tienen consumidor productivo; la selección
usa la autoridad del agente que atendió la operación; assessment liga la evidencia
a la revisión vigente; el diagnóstico agrega canales, writers, herramientas y
pruebas; los permisos de stock, recomendaciones y descuentos son gobernables; y
los 23 elementos de descubrimiento tienen recorrido. El censo vuelve a abrir la
fila correspondiente si cualquiera de esas propiedades deja de cumplirse.

Siguen pendientes por gate externo las ejecuciones con canales, modelos y
proveedores reales. Los cinco casos `file_claim` son negativos deliberados de
step-up y no deben convertirse en éxitos para hacer bajar un contador.

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
define el origen de T1–T7, las pruebas de aceptación y su relación con mensajería
económica, durabilidad, aprendizaje y release. El estado vigente está en el
[reporte de cierre](../2026-09-09/closure-report.md), derivado junto con este censo.
