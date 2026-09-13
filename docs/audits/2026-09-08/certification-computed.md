# La certificación deja de ser una constante

8 de septiembre de 2026. Cierra la parte implementable de la [condición 2 de la directiva](../../handoffs/2026-09-08/claude-complete-plan-directive.md) y del punto 2 de la [revisión adversarial](../../handoffs/2026-09-08/claude-final-completion-review.md). Sin push, sin despliegue, sin llamadas a proveedores.

## Qué estaba mal

Dos matrices informaban `certifiedProfiles: 0`, y cada perfil salía como `{ certified: false, evidence: 'not_loaded' }`. Además, cada tarea recibía el hueco `profile_execution_evidence_missing` **sin condición alguna**.

Eso no es una medición. Se lee como prudencia y es lo contrario: el número no podía decir otra cosa, así que habría seguido diciendo cero después de que las corridas existieran, y nadie se habría enterado. Un cero literal y un cero medido se ven igual en un informe y significan cosas opuestas.

## Qué se computa ahora

`certifyProfiles` (`apps/api/src/modules/simulation/agent-certification.ts`) deriva el estado de la evidencia almacenada, perfil por perfil, sobre el producto cruzado completo de **idioma × canal × modelo × escenario**.

Tres estados, no un booleano:

| Estado | Significa |
| --- | --- |
| `certified` | Todos los casos requeridos tienen evidencia válida y aprobada que nombra a **ese** perfil |
| `not_certified` | Hay evidencia, y no alcanza |
| `no_evidence` | Nadie lo ejecutó |

La distinción entre los dos últimos importa: "no miramos" y "miramos y falló" son respuestas distintas y sólo una es un defecto del agente. Un booleano las aplana, y aplanarlas es lo que permitió que el cero pareciera información.

### Nada se hereda

Una corrida prueba exactamente el caso que corrió. No certifica:

- **otro perfil**, por parecido que sea — el catálogo tiene 76 y ninguno responde por otro;
- **otro idioma** — el runtime cambia de idioma con el cliente;
- **otro canal** — lo que se entrega y cómo cambia por canal;
- **otro modelo** — cambiar de modelo cambia el agente;
- **el mismo escenario reescrito** — un caso cuya definición cambió después de pasar nunca se probó en su forma actual;
- **una corrida cuyo sello no verifica** — el hash cubre el cuerpo entero.

Cada una de esas seis está fijada por una prueba en `agent-certification.spec.ts`, y están escritas al revés a propósito: lo que hay que impedir no es que el número diga cero, es que empiece a decir que sí por el motivo equivocado.

### El modelo tuvo que volverse evidencia

La certificación es por modelo, así que hacía falta que una corrida pudiera nombrar el suyo. `eval.service.ts` ahora registra qué modelo respondió **cada turno** —el router puede caer a otro proveedor a mitad de un escenario, así que declararlo una vez sería mentir— y sella el conjunto en la evidencia. Una corrida que no puede decirlo no prueba nada sobre ningún modelo, en vez de probar sobre todos.

## Cuánto cuesta

Con un canal y un modelo, el catálogo completo pide **15.172 casos** (76 perfiles × 4 idiomas × sus escenarios, colapsando las cuatro formas de tratamiento del español en un caso). Cada canal y cada modelo adicional lo multiplica: cinco canales y dos modelos son 151.720 conversaciones completas con juez.

Ese número está fijado en la prueba junto a los 76/268/146 de la matriz declarativa. No es decoración: es lo que hay que presupuestar, y agregar o quitar un escenario lo cambia.

## Qué falta y de qué depende

**Ejecutar.** Esta máquina no tiene `.env` —sólo `.env.example`— así que no hay ninguna clave de proveedor. La ruta de ejecución necesita dos cosas distintas:

1. una clave de cualquier proveedor para el turno del agente (`LLMRouterService`, por tier);
2. una clave de **OpenAI** en particular para el juez: `QualityService.judgeTranscript` fija `model: 'gpt-4o-mini'`.

Sin ellas, `certifyProfiles` responde `no_evidence` para los 76, que es la lectura honesta de un catálogo que nadie ejercitó.

Lo que **sí** corre sin ninguna clave, y por eso está probado: la derivación de los packs, la matriz, el cálculo de certificación, el verificador de efectos contra la tabla real, y el camino completo de writers canónicos dentro del namespace aislado (`isolated-canonical-commands.spec.ts` ejercita los writers reales contra PostgreSQL sin modelo alguno).

**Ordenar la ejecución.** `runGateV2` toma un único lock Redis `eval-gate-run:${tenantId}` para toda la corrida y aprovisiona un namespace por escenario, así que 15.172 casos no se paralelizan por ese punto de entrada tal como está. Repartir por tenant, o levantar `withOwnedSandboxSession` y manejar las claves de lease propias, es trabajo pendiente y depende de cuánto presupuesto de modelo haya.

## Cómo se lee

`buildTaskCompetenceMatrix(profileId?, execution?)` sigue respondiendo cobertura declarada cuando se lo llama sin evidencia —"not_loaded" y cero, que es la verdad de un catálogo sin corridas— y computa el estado cuando se le pasan las corridas. El hueco `profile_execution_evidence_missing` ya no se empuja sin condición: desaparece cuando el perfil quedó demostrado.
