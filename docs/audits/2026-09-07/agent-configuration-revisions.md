# Revisiones editables separadas — base de E3

El almacén nuevo guarda revisiones de configuración en tablas propias, con un puntero al borrador actual. No modifica `agent_personas`, sus canales, su versión operativa ni el alcance de una aprobación pendiente. Cada revisión conserva el hash de la configuración completa y la versión/hash operativos desde los que se preparó.

La escritura exige administrador, tenant propietario del esquema, versión operativa esperada, UUID del borrador esperado y clave de idempotencia. Dos editores concurrentes no sobrescriben el mismo borrador. Repetir una solicitud devuelve su revisión original; reutilizar su clave con otro contenido falla. El historial, el puntero y el comprobante de la solicitud comparten transacción. La lectura comprueba integridad y no crea tablas para ocultar un fallo.

Este es el contrato de persistencia para la separación; **todavía no cambia los endpoints del editor o Assist ni publica candidatos**. Los consumidores deben validar los requisitos de negocio y permisos actuales antes de guardar dentro de su transacción. La selección del candidato para evaluación, la revisión humana, el piloto, la promoción y el rollback siguen en ejecución. No hay migración ni escritura sobre tenants existentes.

La validación usó PrismaClient, transacciones de PrismaService y el DDL del proyecto en PostgreSQL temporal de loopback. Pasaron diez pruebas: aislamiento del agente operativo, seis reintentos concurrentes, conflicto de clave, dos editores, cambio de versión operativa, cambio de configuración sin incremento de versión, rollback ante fallo de auditoría, tenant incorrecto, rol/canal inválidos y alteración del contenido persistido. El esquema creado por las pruebas fue eliminado al terminar.
