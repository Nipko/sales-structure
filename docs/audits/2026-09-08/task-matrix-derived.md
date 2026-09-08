# La matriz de tareas, calculada — y los dos huecos en cero

8 de septiembre de 2026. Cierre de los dos contadores nombrados en la [condición 2 de la directiva](../../handoffs/2026-09-08/claude-complete-plan-directive.md): las 32 tareas sin positivo propio y las 10 sin verificador. Sin push, sin despliegue, sin proveedores reales.

## Commits

| Commit | Qué cierra |
| --- | --- |
| `98e2c76b` | La matriz se deriva en vez de transcribirse, y los huecos se enumeran |
| `23f65b00` | El gate verifica las transiciones de cita que ya ejecutaba |
| `f4fbf2ab` | El gate verifica una cotización de póliza |

## El problema no era el número: era que nadie podía comprobarlo

«76 perfiles, 268 tareas, 146 transaccionales, 32 sin positivo propio, 10 sin verificador» vivía únicamente en la prosa de las auditorías. Se regeneraba a mano cada tanda y se copiaba. Un número así envejece en silencio —un perfil nuevo, un intent renombrado, un verificador que pasa de pendiente a auditado lo mueven— y el documento sigue afirmando lo de antes.

Peor: el hueco se podía **contar** pero no **enumerar**. Nadie sabía cuál de las 32 tareas era la que no tenía positivo, así que tampoco había forma de cerrarlo dirigidamente.

Ahora se deriva de las mismas fuentes que usa el runtime: los perfiles canónicos, el contrato de dominio de cada uno, su pack de evaluación y el registro de writers auditados. Reproduce el censo exacto —**76 / 268 / 146**—, que es lo que hace confiable la derivación, y nombra cada hueco.

## Lo que apareció al calcularlo

**Las tareas sin positivo ni negativo propio ya eran cero.** El 32 era correcto cuando se escribió y quedó obsoleto: trabajo posterior las cerró y nadie movió la cifra. La lista vacía —no el conteo— es lo que lo demuestra, porque un conteo que baja también puede ser un perfil que desapareció.

**El hueco de verificadores era mayor que 10 bajo una definición comprobable: 51.** Cuarenta y una de esas tareas eran un desfase del registro, no una carencia real. Cancelar una cita, reprogramarla y agendar una prueba de manejo **ya** corrían por el adaptador aislado —`CANONICAL_EVAL_TOOL_FAMILIES` las mapea a `appointments`, que está en el registro de limpieza— y el registro de writers simplemente no lo decía. El gate producía esos efectos y no tenía familia auditada con la que comprobarlos.

Entran como familia propia y no como más tools de `appointments`, porque **verificar una cancelación es comprobar que una fila concreta CAMBIÓ**, no que existe una fila. Son cosas distintas y merecen aserciones distintas.

Las cinco restantes eran `quote_policy`, que escribe `insurance_quotes`: una tabla que el namespace arrendado no copiaba. Ahora copia esa y `insurance_plans` —la segunda no es incidental: `calculate_quote` lee el plan antes de escribir, y sin ella la cotización fallaría por un plan ausente en vez de por lo que la evaluación mide—. El teardown suelta el schema arrendado entero, así que las dos se limpian con él.

## Una regresión latente que salió sola

Dos familias verificando la misma tabla destaparon un defecto: las proyecciones JSON de términos de vehículo y de servicio estaban indexadas por el **nombre de la familia**, así que la familia nueva no veía esas columnas. Y una aserción que no nombra familia se resuelve **por tabla**: cuál de las dos encontrara habría cambiado lo que era capaz de comprobar. Ahora están indexadas por la tabla, que es lo que siempre describieron.

## `canonicalOnly` no es una formalidad

Las tres familias nuevas son ejecutables **sólo** dentro de un namespace arrendado, nunca contra el schema real de un tenant, ni siquiera para el contacto sandbox:

- una cancelación mal dirigida ahí borraría la cita de un cliente de verdad;
- una cotización quedaría en la bandeja de un asesor como si un cliente la hubiera pedido.

## Estado

| Contador | Al inicio (transcrito) | Al calcularlo | Hoy |
| --- | --- | --- | --- |
| Perfiles | 76 | 76 | 76 |
| Tareas | 268 | 268 | 268 |
| Transaccionales | 146 | 146 | 146 |
| Sin positivo propio | 32 | **0** | **0** |
| Sin negativo propio | — | **0** | **0** |
| Sin verificador | 10 | 51 | **0** |
| Deliberadamente sin verificador | — | — | 5 (`file_claim`) |
| Perfiles certificados | 0 | 0 | **0** |

`file_claim` no es un hueco: en una evaluación existe únicamente para demostrar que el step-up de identidad lo rechaza, así que nunca llega a un writer y nunca manda un OTP desde una corrida. Pedirle un verificador de efecto sería pedir que se compruebe que no se escribió nada.

## Límites explícitos

- **Cero perfiles certificados, y la matriz no los certifica.** Dice qué tiene cada tarea y qué le falta. Ejecutar los escenarios contra un modelo por idioma y canal es otra cosa, y ningún perfil hereda certificación por parecerse a otro.
- Un verificador **no se hereda**: que `create_appointment` esté auditado no verifica `cancel_appointment` aunque escriban la misma tabla. La prueba lo fija.
- Que una tarea tenga positivo, negativo, comando y verificador declarados no dice nada sobre la calidad de la respuesta del agente en esa tarea.
