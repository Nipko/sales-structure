# Condiciones aceptadas de una cita

Validación local del 7 de septiembre de 2026. Sin despliegue, migración sobre tenants existentes ni llamadas a proveedores.

El ejecutor resuelve el servicio activo y sus condiciones antes de proponer una cita: precio, moneda, política de pago, anticipo, duración, modalidad y ubicación. Descarta los términos proporcionados por el modelo y liga un digest exacto al ledger y al consentimiento. Un nombre ambiguo no selecciona arbitrariamente un servicio. En borrador se hace esta lectura antes de registrar la propuesta; no se ejecuta el comando.

El motor de reservas compara la propuesta mostrada con los términos actuales. Cuando cambian, conserva fecha, hora y datos de contacto, emite un botón nuevo y presenta precio, pago requerido, duración y lugar para otra aceptación. La firma detecta también cambios en enlaces de reunión, pero esos enlaces sólo se exponen como hash en los términos de la propuesta. Un enlace privado no se publica por el hecho de listar servicios.

El comando canónico vuelve a comparar las condiciones dentro de la transacción, después de adquirir `FOR SHARE` sobre el servicio y antes de insertar la cita. Un cambio concurrente del propietario no puede alterar esa fila hasta que finalice la transacción. El origen de IA exige condiciones propuestas aunque un llamador omita el ejecutor; la creación manual conserva su contrato.

Todas las citas nuevas guardan `metadata.serviceTerms` desde la fila canónica bloqueada, sobrescribiendo cualquier snapshot enviado por el llamador. La resolución de referencia de pago, el reporte de ventas, la consulta de citas y la recuperación de una reserva existente usan el precio y la moneda guardados. Una edición posterior del catálogo no cambia la venta ya acordada. El anticipo persistido conserva su función actual.

## Evidencia

- 15 suites focalizadas, 176 pruebas aprobadas: cambios de precio/moneda/anticipo/duración/ubicación, confirmación nueva, no reutilización del mensaje origen, propuestas de borrador, privacidad de argumentos, límites de staff, locks, calendario, horarios ambiguos y estados de pago.
- 13 pruebas reales de PostgreSQL en `isolated-canonical-commands.spec.ts`, incluidas dos nuevas de condiciones aceptadas. Una observa `pg_blocking_pids` para comprobar que la edición concurrente espera al lock del comando; después del commit verifica que el catálogo vale 200 y la referencia de pago conserva 100.
- El recorrido de borrador de esa suite usa ahora también el ejecutor real para preparar la propuesta, después consentimiento, aprobación humana y reanudación: exactamente una cita.
- TypeScript de API sin errores durante la tanda. Los conteos anteriores se solapan con otras tandas; no sumarlos como casos independientes.

## Alcance pendiente

Las citas históricas sin snapshot mantienen el comportamiento anterior de consultar el catálogo. Eso no acredita su precio histórico; la reparación debe partir de evidencia de la propuesta o del pago, con revisión cuando falte. No se modifica su importe retrospectivamente en esta tanda.

Esta protección corresponde a la creación y al cobro posterior de citas. Matrículas, pedidos, otras familias de negocio y modificaciones de una operación existente requieren sus propios términos y pruebas de transición. El snapshot no acredita entrega del mensaje, pago ni disponibilidad de un proveedor externo.
