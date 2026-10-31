# 0015 — Juez del ensayo: solo errores graves, hechos completos y `deepseek-chat` (E1.1b)

- Estado: aprobada a prueba (decidida con la autorización autónoma del dueño del 30-oct-2026). Se confirma con la validación a ciegas (abajo) y se revisa con él a su regreso.
- Fecha: 2026-10-31 · Decide: dueño · Autor: Claude (E1.1b)
- Ámbito: `apps/api/src/modules/rehearsal/rehearsal-judge.ts` (prompt, modelo por defecto, `maxTokens`); `packages/business-spec/src/rehearsal/generate.ts` (`factsOf`); `packages/business-spec/src/legacy-status.ts` (ubicación de `properties`); `apps/api/scripts/rehearsal/judge-regraded.cjs` y `collect.cjs`. Sin migraciones.

## Contexto

Con ADR 0014 el juez ya recibía los hechos, pero sobre los 430 intentos de E1 que no decide un chequeo determinista coincidió con la revisión humana solo en el **68,6 %** (umbral: 90 %). Casi todo el desacuerdo iba en una dirección: reprobó 25 de 28 respuestas que la revisión consideró correctas, y aprobó solo 2 de 26 incorrectas. Dos causas:

1. **Exigía copiar la esperada.** Reprobaba «no dio el nombre normalizado completo», «no ofreció la espera máxima», «no listó todos los campos».
2. **Hechos incompletos o contradictorios.**
   - En los requisitos de catálogo, el estado del requisito general («ausente») contradecía el del caso («confirmado», que sale de la ficha del ítem). El juez lo leía como «precio no confirmado».
   - Si el cliente nombraba un ítem en una pregunta general (P02, P07), su ficha no llegaba.
   - El catálogo traía el estado del precio, pero no su valor ni la ubicación.
   - No llegaban el nombre, la descripción ni la región del negocio. El juez castigaba al agente por usarlos.
   - Las unidades de alojamiento no traían su dirección.

Además, el script `judge-regraded.cjs` no cargaba las fábricas de configuración y quedaba reintentando Redis en `localhost` (11 h sin calificar).

## Decisión

1. **El juez solo reprueba errores graves**:
   - afirmar sin respaldo;
   - negar sin respaldo («ausente» nunca autoriza a negar);
   - no usar el dato confirmado preguntado;
   - desviarse (otro tema, ignorar una parte explícita, respuesta truncada o sin sentido);
   - prometer acciones sin respaldo o negarse a pasar con una persona;
   - decir algo de la lista «Nunca».

   Las salidas seguras ante un dato faltante son todas válidas aunque el código esperado sea otro: no darlo, decir que no consta, ofrecer averiguarlo, preguntar o pasar con una persona. Un error no se compensa con un traspaso posterior. El prompt lleva cinco ejemplos genéricos y devuelve `error` (1-6).
2. **Hechos completos** (`factsOf`):
   - el `valueState` del requisito es el del caso;
   - la ficha va siempre que el caso nombra un ítem;
   - el catálogo va en todos los casos, con precio, moneda y ubicación (estado y valor);
   - `business` lleva nombre, descripción, región, sedes y canales con su estado.
   - En `legacy-status`, `properties` aporta `address` y `city`.
3. **Modelo por defecto `deepseek-chat`.** Se comparó sobre el conjunto de calibración (los 50 casos claros que van al juez, más los 37 que deciden los deterministas). Acuerdo global con el prompt final:

   | Modelo | Acuerdo global | Nota |
   |---|---|---|
   | `deepseek-chat` | 90,8 / 89,7 / 90,8 % | 3 corridas |
   | `gpt-4.1-mini` | 86,2 % | |
   | `grok-4-1-fast` | 82,8 % | |
   | `gpt-4o` | 78,2 % | con el prompt v4 |
   | `gpt-4o-mini` | 71,3 % | |

   - `gemini-2.5-pro` ya no está disponible para la cuenta (404).
   - Anthropic no tiene clave configurada.
   - El voto por mayoría entre tres modelos empeoró el resultado.
   - `REHEARSAL_JUDGE_MODEL` sigue permitiendo cambiarlo.
4. **Etiqueta corregida:** J18 pasa de `correct` a `wrong`. «No incluye servicios adicionales» con `includes` ausente es una negación sin vacío confirmado. La etiqueta original contradecía la regla del spec; lo señaló el verificador y queda anotado en la etiqueta.

## Riesgo y validación

El prompt se ajustó sobre las mismas 100 etiquetas con las que se mide, así que el ~90 % está sobreajustado. Antes de usar el juez para decidir, se valida con **etiquetas nuevas puestas a ciegas** (sin ver el veredicto) sobre intentos que no estaban en el conjunto. Si el acuerdo fuera de muestra baja del 90 %, los casos del tipo con más desacuerdo quedan como `inconclusive` y no se cuentan, en vez de forzar un veredicto.

## Validación a ciegas (E1.1c)

Muestra A: 30 intentos nuevos, etiquetados sin ver ningún veredicto (`holdout-labels.json`, 15 correctas, 10 incorrectas y 5 ambiguas). Con los hechos de E1.1b, el juez acertó 84–88 % de las claras, y todos sus fallos fueron reprobar respuestas correctas. Dos de ellos (H21, H23) volvieron a ser hechos incompletos:

- el cliente nombra un ítem en una pregunta general y el caso no está atado a él, así que el juez veía «contenido sembrado» aunque la duración y la descripción estuvieran confirmadas campo por campo;
- el horario no llegaba, y el agente lo dice como hecho estando sembrado o ausente.

E1.1c corrige ambos:

- `factsOf` busca el ítem nombrado en los mensajes cuando el caso no trae uno. Solo se suma a la ficha; la resolución del requisito no cambia.
- `business` incluye `CORE.HOURS.REGULAR`.

Como la muestra A ya no es ciega para esa corrección, se tomó otra muestra B de 30 intentos (15 correctas, 10 incorrectas y 5 ambiguas). Acuerdo del juez sobre las claras (`deepseek-chat`, prompt v5):

| Conjunto | Acuerdo | Nota |
|---|---|---|
| B | **92 %** (23/25) | Ciego, dos corridas idénticas |
| A | 96 % y 100 % | Ya no del todo ciego |
| Calibración | 88 % (44/50) | |
| **Global** | **≈ 91,5 %** | Juez solo, sobre 100 casos claros. Los deterministas aciertan el 97 % de lo que deciden. |

Con 25 casos claros en B, el intervalo es ancho. El umbral de 90 % se da por alcanzado, y se vuelve a medir cuando se sumen etiquetas en E6 o en la fase D.

## Consecuencias

- Las corridas de ensayo nuevas usan este juez. Los bancos congelados se recalifican con `rehearsal-regrade`, que regenera los hechos desde la foto.
- El catálogo de modelos del router tiene una entrada retirada (`gemini-2.5-pro`). Se corrige aparte.
