# E3 — revisión independiente de publicación y evaluación

La revisión cubrió `agent-release-{contract,store,policy,service,processor,controller}`, el gate de evaluación y la invalidación de derivados por retiro/borrado de regresiones. La aprobación técnica y humana se mantiene separada de la activación: `activationAllowed:false` y `certified:false` son límites deliberados, no una promoción pendiente de ejecutar por esta revisión.

## Defectos corregidos

1. **Identidad del inbound en evaluación.** El recorder insertaba un mensaje PostgreSQL y Agent Test inventaba otro ID para el mismo turno. El consentimiento ligado a misión no podía aceptar ese mensaje. `recordInbound` ahora devuelve `RETURNING id`; Eval, Simulation y Learning lo pasan como `sandboxInboundMessageId` exclusivamente en opciones del servidor. Una ejecución con namespace sin ese ID válido se rechaza antes de llegar al modelo. La prueba PostgreSQL recorre recorder → Agent Test → core → control → matrícula canónica; el ledger conserva el ID real de la propuesta y la respuesta posterior crea una sola matrícula.
2. **Recuperación de cola que podía ocultar candidatos.** La selección de los primeros 50 candidatos incluía trabajos con lease todavía vigente o presupuesto diferido. La recuperación ahora selecciona sólo candidatos que tienen al menos una evaluación lista o un lease vencido. Pruebas PostgreSQL muestran que 50 trabajos antiguos diferidos no ocultan el siguiente trabajo ejecutable y que un lease vencido sí se recupera.
3. **Escenarios recortados sin advertencia.** El gate y el alta de escenarios cortaban a ocho mensajes, mientras el hash de una definición histórica podía incluir más. Se rechaza una definición vacía, inválida o mayor de ocho mensajes antes de crear sandbox o llamar al modelo. No se certifica una secuencia cuyo desenlace se omitió.
4. **Presupuesto perdido al envolver errores del runtime.** `agent_runtime_failed:eval_autorun_budget_exhausted` se clasificaba como fallo genérico, con reintento a cinco minutos. El clasificador reconoce el envoltorio conocido y conserva presupuesto diferido o pérdida de lease. Los mensajes arbitrarios siguen convirtiéndose en un código genérico.

Se remitió al propietario de Learning el hallazgo adicional de que la verificación de efectos leía el tenant origen en vez del namespace donde se ejecutaban los comandos. Esa corrección y sus pruebas pertenecen a la tanda de Learning.

## Controles verificados

- La solicitud pública contiene sólo revisión de configuración y clave idempotente; el servidor congela configuración, escenarios y canales.
- La política exige escenarios canónicos íntegros de la misión, seguridad universal, cuatro idiomas y cada canal asignado. Una regresión adicional fallida impide la aprobación.
- Resultados y escenarios se vinculan a configuración, dependencias, canal, política de repetición y hash. El checkpoint de release exige tres ejecuciones, umbral ocho y aprobación de todas.
- Los leases tienen token, expiración y renovación; los checkpoints tardíos no reemplazan al nuevo trabajador. La cola transporta identificadores.
- La revisión humana exige versión, hash de evidencia, seis declaraciones y los hashes de muestras reales completas. CAS e idempotencia impiden decisiones dobles o contradictorias.
- Retirar o borrar una regresión invalida candidatos y elimina escenarios, resultados y transcripciones derivados; un worker atrasado no puede restaurarlos. La lectura se hace bajo fence y no ofrece evidencia revisable cuando la revisión dejó de ser actual.

## Validación

- Suite completa E3: **5 suites, 59 pruebas aprobadas**, incluidas **18 pruebas PostgreSQL con Prisma real** del store/revisión y **3 PostgreSQL** nuevas de recuperación de cola.
- Batch de release y adaptadores: **8 suites, 90 pruebas aprobadas**; la suite PostgreSQL de store se ejecutó después, con su variable de conexión específica.
- El archivo de comandos canónicos suma **29 pruebas PostgreSQL aprobadas**, incluida la nueva integración recorder/AgentTest/ledger.
- TypeScript API aprobado.

## Límite operativo vigente

El manifiesto firma todas las relaciones del tenant salvo exclusiones explícitas de salida/telemetría. Incluye contactos, mensajes y estados de negocio. En un tenant con tráfico, una nueva conversación u operación puede invalidar la revisión entre canales o antes de la revisión humana. El sistema falla de forma cerrada, pero **no está demostrado que esta publicación resulte fluida durante tráfico continuo**.

No se han eliminado tablas del manifiesto para ocultar ese comportamiento. Primero hace falta inventariar cada lectura efectiva del runtime de evaluación y demostrar su origen: fixture aislada, snapshot, definición revisada o fuente viva. Después se puede versionar sólo la dependencia realmente consultada, o servir todas esas lecturas desde una réplica congelada. La condición para reducir el manifiesto es una prueba de que modificar datos excluidos no cambia ninguna respuesta, autoridad o resultado del run; una mutación de una dependencia usada debe seguir invalidándolo.
