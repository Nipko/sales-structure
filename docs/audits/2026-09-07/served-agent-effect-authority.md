# Versión operativa dentro de las transacciones de efecto

El runtime conserva una autoridad privada obtenida de la misma fila que seleccionó las instrucciones del agente: tenant, schema, agente, versión y hash completo de configuración operativa. El objeto viaja fuera de los argumentos del modelo y se conserva en el ledger para aprobaciones diferidas.

## Frontera inicial registrada en `4ecbb4b8`

Doce comandos canónicos de citas, gimnasio, educación, taller y catálogo comprueban esa autoridad en la misma transacción que modifica el objeto del negocio. El orden es fence de privacidad, tenant `FOR SHARE`, agente `FOR SHARE`, comparación de versión/hash/activo y escrituras de dominio. Publicación usa tenant antes de agente, por lo que ambos órdenes serializan sin un lock externo que espere una conexión interna.

El executor exige el objeto privado en esos doce writers operativos. Una copia suministrada en argumentos del modelo no lo reemplaza. Las operaciones humanas mantienen sus controles existentes; el namespace de evaluación autorizado conserva su ruta separada. No se acepta autoridad legacy cuando existen agentes durables. Para un tenant todavía legacy, el lock de tabla sobre `agent_personas` impide que la primera inserción cruce la comprobación de ausencia y el efecto.

Las propuestas pendientes rechazan un origen distinto aunque se aprueben después de publicar otra versión. Los resultados ya registrados siguen siendo recibos de aquella operación: devolver un replay no admite otra escritura, ni convierte un resultado incierto en éxito. El retiro de configuración tampoco revierte por sí solo una reserva, un cobro ni un aviso ya aceptado.

## Evidencia local

- `served-agent-authority.postgres.spec.ts`: 17 casos pasan con Prisma y PostgreSQL reales. Cada una de las cinco familias mantiene el efecto anterior al cambio de versión; el cambio ganador, la desactivación y una modificación del hash sin incremento de versión rechazan el writer. Comprueba las cancelaciones/decisiones restantes, tenant ajeno, compatibilidad humana, primera inserción legacy y rollback del efecto.
- Batería integrada inicial: 12 suites / 150 casos pasan; siete casos de routing PostgreSQL se omitieron por no establecer su variable de conexión en esa llamada. Luego se ejecutó `serving-persona.postgres.spec.ts` con su conexión desechable y pasaron los siete.
- Procedencia de aprobación y argumentos: cuatro suites / 42 casos pasan después de agregar el origen privado, rechazo de argumentos falsificados y reanudación con versión/hash exactos.
- Después de preservar recibos anteriores al cambio: tres suites / 54 casos pasan, incluidos rechazar una propuesta pendiente sin aceptar su confirmación y devolver recibos de éxito o incertidumbre sin crear otro ledger.
- TypeScript de API pasó después de los ajustes de integración y recibos; las cifras anteriores se solapan.

## Límite de publicación

El bloque inicial cubre los doce comandos indicados, no todos los writers, proveedores, Flow, handoff, media ni jobs de la plataforma. La publicación HTTP del agente permanece sin habilitar. Aún deben cerrarse esos caminos y las demás fuentes de autoridad antes de conectar la primitiva de publicación/rollback al producto.

## Ampliaciones registradas después

La verificación exacta del índice del bloque inicial pasó **12 suites / 156 casos** y TypeScript API; las cifras de desarrollo anteriores se solapan con ella. La secuencia queda en la [bitácora incremental](incremental-commits-resumed.md).

La consolidación de pruebas de manejo añadió `schedule_test_drive` sobre el mismo comando protegido de citas. Su directorio aislado, assessment, escenarios, verificador y admisión del decimotercer writer quedaron incluidos en `1e93a2df`; la batería exacta pasó **19 suites / 274 casos API y 2 / 29 dashboard**, con TypeScript API/dashboard. La identidad de sus lectores de evaluación es una precondición sintética, no un OTP real. Evidencia y pendientes en [Pruebas de manejo](vehicle-appointment-consolidation.md).

`register_pet` y `update_pet` amplían a **quince** el conjunto protegido y admitido por el namespace desde `cdcb84c5`. Mantienen autoridad servida bajo la misma transacción del comando, propietario/versiones y recibos; no habilitan otros ciclos clínicos, hospedaje ni proveedores. Su batería integrada exacta pasó **26 suites / 389 casos API** y TypeScript API/shared. Los 17 casos de autoridad originales no se presentan como prueba nueva de todas esas ampliaciones: los comandos y escenarios de mascotas tienen su propia evidencia en [Ciclo de mascotas](pet-command-lifecycle.md).

Estos bloques no demuestran autoridad de versión en todos los efectos de la plataforma ni completan E3. Publicación HTTP, piloto/promoción/rollback integral, otras salidas diferidas y pilotos de proveedores permanecen pendientes. No hubo despliegue ni migración de tenants existentes.

`ea868d15` añadió `create_payment_link` como decimosexta herramienta operativa protegida. El COMMIT de admisión autoriza una tentativa del proveedor; el POST ocurre fuera de la transacción. Una configuración retirada antes de admitir impide el envío; una admisión ya confirmada conserva su operación y conciliación posterior. Un ACK incierto no habilita recrear el enlace. La batería exacta pasó 18 suites / 183 casos, incluidos 20 PostgreSQL. El sandbox conserva quince writers: pagos sigue bloqueado en evaluación.

`e8cea802` protege además la entrega aprobada de imágenes/enlaces de Web Chat en la transacción que guarda mensaje y recibo. Comprueba origen y versión actual, conserva recibos confirmados y registra fallos de recuperación sin duplicar la entrega. La batería exacta pasó 10 suites / 90 casos, incluidos 65 PostgreSQL. Esta frontera de entrega no aumenta el inventario de writers; sus límites, incluida la selección pendiente del agente en la reanudación, están en [Autoridad de entregas aprobadas](approved-webchat-agent-authority.md).
