# Evaluación con comandos canónicos y aislamiento relacional

Validación local: 7 de septiembre de 2026. No hubo despliegue ni acceso a datos de clientes.

La prueba habitual del agente conserva su contrato de lectura. Eval y Simulation pueden ejecutar `create_appointment`, `cancel_appointment`, `reschedule_appointment`, `enroll_student`, `cancel_enrollment`, `book_class` y `cancel_class_booking` mediante el mismo ejecutor, confirmación, ledger y comandos de dominio que producción. `check_availability` usa el mismo cálculo con un directorio de profesionales local y sin proveedores conectados.

Cada escenario recibe un esquema `tenant_eval_<tenant>_<nonce>` vacío y una credencial interna de propiedad con vigencia de una hora. Se valida antes del turno, cada herramienta y cada llamada al modelo. El esquema de origen sigue siendo el registrado para el tenant; ningún consumidor general cambia su resolución de tenant.

El provisionador copia únicamente tablas revisadas sin filas, disparadores ni credenciales. Conserva restricciones, índices y claves foráneas dentro del esquema nuevo; crea secuencias independientes y admite únicamente expresiones de valor predeterminado revisadas. Rechaza columnas generadas, tipos externos y funciones, operadores, clases de operador o colaciones no revisados. Las referencias a usuarios públicos se enlazan a un directorio sintético local. Las integraciones de calendario permanecen vacías; una fixture con un proveedor activo bloquea disponibilidad en vez de fingir una respuesta del proveedor.

Las fixtures congelan configuración y fechas permitidas por el horario del snapshot. Los escenarios enlazan sus variables explícitas de fecha, servicio, clase, cohorte e identidad. Cada reinicio crea otro esquema. La limpieza usa comprobación de propietario y `RESTRICT`, incluso tras perder el lock de cola. Los esquemas vencidos de un worker interrumpido se recuperan al iniciar una evaluación posterior del mismo tenant. Una dependencia externa inesperada impide la limpieza y hace visible el fallo.

## Evidencia

- 13 suites, 129 pruebas aprobadas; compilación TypeScript de API sin errores.
- 22 pruebas de las suites de aislamiento y comandos, ejecutadas contra PostgreSQL 17.11 efímero en loopback y almacenamiento `tmpfs`. Incluyen el adaptador real de Prisma.
- DDL de dominio extraído de `apps/api/prisma/tenant-schema.sql`, incluidas migraciones posteriores. Concurrencia de citas, anticipo y retención de cupo, cancelación e idempotencia, lista de espera y créditos de gimnasio, matrícula y restitución única de cupos.
- Confirmación real y ledger antes de los siete escritores. El flujo de borrador crea una propuesta y un ticket sin cita; la aprobación y reanudación producen exactamente una cita y el reintento no la duplica.
- No se emitieron eventos de citas, trabajos de calendario ni mensajes a proveedores durante estas pruebas.
- PostgreSQL reveló dos errores que los dobles SQL no detectaban: parámetro sin tipo en `cancelEnrollment` y deducción incompatible de `$2` en `decideApprovalTicket`. Ambos tienen conversión explícita a `text` y regresión real.

Para repetir las suites de integración, proporcionar `PARALLLY_ISOLATION_TEST_URL` con una base **desechable** en `127.0.0.1` o `localhost`, cuyo nombre comience por `parallly_eval_isolation`. Sin esa variable, las pruebas que requieren PostgreSQL se omiten. Las suites son `isolated-eval-namespace.spec.ts` e `isolated-canonical-commands.spec.ts`.

## Límites comprobables

Esta evidencia acredita tres familias de comandos y el aislamiento, no todos los dominios ni la calidad de un modelo contra conversaciones reales. Los escritores de otras familias, pagos externos, OTP y herramientas MCP siguen sin habilitación en este entorno. La presencia de un verificador de efectos no concede permiso para ejecutar su escritor. Entrega de medios, traspaso humano y notificaciones posteriores a una aprobación son un frente separado; un comando registrado como exitoso no acredita entrega al cliente.
