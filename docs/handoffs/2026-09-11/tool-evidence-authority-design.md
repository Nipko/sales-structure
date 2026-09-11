# Autoridad vigente para evidencia de herramientas en el assessment

Estado: **pendiente de implementar**. Diseño preparado el 11 de septiembre de 2026 durante la auditoría de herramientas. No declara perfiles certificados ni sustituye los gates de proveedores, modelos o usuarios reales.

## Problema que queda abierto

El assessment ya evita mostrar una herramienta como operativa por un único caso negativo aprobado. `intentEvidence` exige la autoridad completa de la configuración evaluada y el conjunto canónico de casos por perfil, canal e idioma. `AgentAssessmentService`, sin embargo, sólo conoce la versión del agente y todavía no puede acreditar esa autoridad completa; mantiene `not_verified` explícitamente hasta conectar el lector descrito aquí.

No completar ese argumento copiando `configHash` o `dependencyRevision` desde el último run. Eso haría que la propia evidencia declarase su vigencia. Tampoco conservar `not_verified` como solución definitiva: el objetivo es reconocer pruebas vigentes y distinguir las que quedaron antiguas.

## Autoridades existentes que deben reutilizarse

| Fuente | Qué acredita | Restricción |
| --- | --- | --- |
| `conversations/agent-evaluation-snapshot.ts::evaluationSnapshot` | Hash canónico de `agent.config_json`, tenant, agente y versión | El hash debe calcularse desde la configuración operativa actual; un borrador evaluado no acredita otra configuración |
| `evaluation-revision/evaluation-revision.service.ts::capture` | Manifiesto actual de dependencias mediante lectura MVCC `RepeatableRead`, estructura, datos, artefacto del runtime y routing de modelos | No llama al modelo ni materializa réplicas; recorre las tablas, por lo que debe ejecutarse una vez por assessment con evidencia, no una vez por caso |
| `EvaluationRevisionService.assertCurrent` | Compara dependencias vivas actuales con la parte no congelada de un manifiesto anterior | Hoy vuelve a capturar las dependencias cada vez; extraer/reutilizar su comparación pura para un lote |
| `agent-evaluation-snapshot.ts::resolveEvaluationSnapshot` | Integridad y alcance tenant/agente del snapshot, configuración y huellas de entradas congeladas | Es validación del snapshot conservado, sin requerir que una réplica temporal siga alquilada |
| `simulation/agent-release-evidence.ts::readSealedRunEvidence` | Runs persistidos y no invalidados, con sello de evidencia válido | Hoy descarta casi todo `agent_snapshot`; ampliar su proyección privada, nunca el DTO público de Assist |
| `simulation/agent-release-policy.ts` | Sello, contexto, resultado, definición canónica de escenario y cobertura de release | Reutilizar estas reglas; no crear una definición alternativa de resultado aprobado |
| `conversations/agent-test.service.ts::assertSnapshotCurrent` | Orquestación existente de integridad del snapshot y vigencia de sus dependencias | Sirve como referencia semántica; evitar repetir su captura completa por cada run |

## Por qué no capturar otro snapshot de evaluación

`AgentTestService.captureSnapshot` crea o adquiere una réplica de conocimiento, congela contexto y consulta las definiciones MCP. No corresponde ejecutarlo al abrir Inicio, Salud o Assist.

Además, `sealEvaluationSnapshot` agrega dependencias `frozen.*`: `frozen.config` incluye `capturedAt` y la réplica incluye identificadores de alquiler. Dos capturas legítimas de la misma configuración pueden tener distintos `manifest.revision`. Exigir que el hash de una captura nueva sea igual al hash completo de una antigua impediría reconocer evidencia vigente.

La comparación correcta conserva el snapshot original y verifica que sus dependencias vivas continúan vigentes. La fórmula existente es:

```ts
sealRevision(
  snapshot.manifest.tenantId,
  snapshot.manifest.dependencies.filter(item => !item.key.startsWith('frozen.')),
  snapshot.manifest.exclusions,
).revision === currentManifest.revision
```

Esta igualdad sólo se usa después de validar la integridad del manifiesto y del snapshot. Las dependencias congeladas no se ignoran: `resolveEvaluationSnapshot` debe seguir verificando sus huellas contra los datos privados conservados.

## Implementación mínima segura

1. **Leer evidencia privada con identidad durable.** Ampliar `readSealedRunEvidence` para conservar internamente `id`, orden/fecha durable, `agent_snapshot`, `release_evidence` y su estado de invalidación. Mantener el aislamiento por tenant y agente. No devolver a Assist configuración arbitraria, conocimiento, tokens, credenciales ni contenido de clientes de esos snapshots.
2. **Capturar una sola autoridad actual.** Sólo si existen candidatos de evidencia, obtener `EvaluationRevisionService.capture(tenantId)`. El módulo Copilot puede importar `EvaluationRevisionModule`, que exporta este servicio; no importar `EvalService` ni crear un ciclo nuevo con Simulation. Calcular el hash de configuración mediante `evaluationSnapshot` a partir del agente operativo ya leído.
3. **Evitar una lectura mezclada.** La configuración, perfil, rutas y manifiesto deben representar el mismo estado. Revalidar versión del agente y revisión de los settings del tenant después de la captura, con el reintento acotado que ya usa el assessment, o ampliar la captura para devolver esa autoridad dentro de su transacción coherente. Una discrepancia nunca se convierte en evidencia actual.
4. **Validar cada snapshot original.** Tenant/agente, integridad completa, versión, `configHash` actual y parte viva del manifiesto deben coincidir. También comprobar que `release_evidence.configHash` y `dependencyRevision` corresponden exactamente a ese snapshot conservado. Un run de borrador distinto del agente operativo no sirve para certificarlo.
5. **Acreditar revisiones, sin reescribir el run.** Distintas capturas vigentes pueden tener distintas revisiones completas por sus entradas congeladas. Extender `IntentEvidenceScope` para recibir, desde este lector de autoridad, un conjunto privado de revisiones completas validadas o descriptores de validez por run. No re-sellar, sustituir el hash ni normalizar el cuerpo original para hacer que coincida con una única revisión artificial.
6. **Aplicar la cobertura al alcance actual.** Exigir los escenarios canónicos vigentes del intent para cada canal, idioma y modelo exigidos por el alcance. Usar `releaseScenarioDefinition` y `releaseScenarioPassed`. Caso negativo solo, caso personalizado renombrado y caso positivo sin verificación de la acción no acreditan una operación completa.
7. **Proyectar a producto.** Assessment por canal y resumen conservador de herramientas; `verified` significa tarea probada bajo ese alcance. No elevarlo a certificación comercial de los 76 perfiles ni afirmar ejecución productiva real sólo por pruebas sintéticas.

Si falla la lectura actual, distinguir falta de autoridad de evidencia demostrablemente antigua. Un sello inválido no es una prueba fallida del negocio; es evidencia inutilizable. Conservar la explicación tipada para que Assist pueda decir si falta ejecutar, repetir o revisar la evaluación.

## Perfil, canal, idioma y modelo

- **Perfil:** derivarlo con el resolver canónico, no concatenando strings opcionales. El catálogo actual tiene `otro/__none__`; `captureAgentReleaseScope` hoy concatena industria y subtipo y puede devolver `null` para `otro` sin subtipo. Este caso debe cubrirse al conectar el alcance.
- **Canal canónico:** `CONVERSATIONAL_CHANNELS` utiliza `web_widget`. `web_chat` es un alias presente en superficies de configuración. Introducir/reutilizar una sola normalización explícita `web_chat -> web_widget` para construir el alcance actual y al admitir nuevas evaluaciones. No convertir canales desconocidos en widget ni reescribir evidencia sellada. Para evidencia histórica con alias, validar primero el sello y comparar mediante la misma equivalencia explícita, sin modificar su `channelType` original ni su `contextHash`.
- **Asignación:** preferir las conexiones operativas reales del agente. No acreditar WhatsApp por un ensayo del widget; cambiar de conexión debe invalidar la autoridad correspondiente aunque el tipo de canal sea igual. El esquema de evidencia actual distingue tipos de canal; la certificación por conexión concreta requiere registrar esa identidad o mantener pendiente ese nivel de garantía.
- **Idiomas:** la configuración base no limita la detección automática del runtime. El alcance de competencia completa utiliza `EVAL_LANGUAGES` (es/en/pt/fr). Una vista parcial puede mostrar evidencia de un idioma identificado, pero no elevarla al conjunto. Para español, respetar las variantes de trato admitidas por el catálogo, como hace la política de release.
- **Modelos:** la firma de routing vigente forma parte del manifiesto. Además, comprobar modelos registrados en runs/intent y compararlos con el alcance que realmente puede usar el agente; no transferir evidencia de un modelo a otro por compartir proveedor o tier. Si el router no expone esa lista con una autoridad verificable, declarar esa dimensión pendiente en vez de deducirla del último resultado. Los proveedores no versionan necesariamente sus pesos: mantener la limitación ya declarada en el manifiesto.

## Reintentos y resultados vigentes

Una evaluación fallida no debe condenar una herramienta para siempre después de un reintento aprobado. Una aprobación antigua tampoco debe tapar una falla más reciente que fue aceptada como resultado válido.

Seleccionar por identidad de caso y alcance la **última tentativa aceptada durablemente**. El orden debe provenir del registro del ejecutor o de los registros persistidos de evaluación, nunca de una fecha enviada por el navegador. Una tentativa en curso, cancelada, con resultado rechazado, con sello inválido o de otra autoridad no reemplaza un resultado aceptado.

Cuando el ejecutor de certificación aporta `attempt` y aceptación del resultado, usar esa autoridad. Para runs históricos de `eval_runs`, definir explícitamente la precedencia de runs completos persistidos (fecha durable e id para desempate) y la migración semántica; no asumir que el array recibido está correctamente ordenado. El lector actual sólo devuelve los últimos 50 runs: garantizar que ese límite no oculta el último resultado aceptado de un caso requerido. Preferir seleccionar los resultados efectivos por alcance en la consulta o declarar cobertura incompleta.

## Pruebas de integración requeridas para cerrar

1. Snapshot persistido íntegro, configuración actual, dependencias vivas iguales y todos los casos exigidos: assessment recupera `verified` sin llamada a modelo, MCP remoto ni creación de réplica.
2. Dos snapshots con diferentes `capturedAt` y alquileres, pero misma autoridad viva: ambos pueden aportar evidencia de sus canales sin cambiar sus sellos.
3. Cambio de configuración, perfil, contenido, reglas de tools, routing de modelo o dependencia viva: evidencia anterior deja de acreditar competencia.
4. Run de borrador no publicado, snapshot de otro tenant/agente, hash de run que no corresponde a su snapshot, sello manipulado y release retirado: rechazados.
5. Sólo escenario negativo, sólo un idioma/canal/modelo, definición canónica antigua o escenario personalizado renombrado: nunca cobertura completa.
6. Falla antigua seguida de reintento aceptado que pasa: se recupera. Invertir el orden: queda fallido. Un resultado rechazado por CAS, cancelado o inconcluso no cambia el resultado efectivo.
7. El resultado más reciente relevante no está entre los 50 últimos runs generales: selección correcta o insuficiencia explícita; nunca éxito inventado.
8. `web_chat` y `web_widget` comparten únicamente la equivalencia documentada, con sello original intacto; WhatsApp no hereda su evidencia. `otro` sin subtipo resuelve al perfil canónico.
9. Carrera entre lectura del agente y captura de dependencias: reintenta o informa autoridad cambiada. No publica una mezcla.
10. Bootstrap DI real de Nest, proyección pública sin datos privados y consulta acotada: una captura de dependencias por assessment con evidencia, cero si no existen runs candidatos.

La prueba de infraestructura de esta integración puede usar PostgreSQL local y evidencia sintética controlada. La certificación real por perfil/modelo/idioma/canal permanece separada y requiere ejecutar sus gates autorizados.
