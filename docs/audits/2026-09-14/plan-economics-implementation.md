# Catálogo rentable, control del superadmin y financiación de Meta

Implementación del 14-sep-2026. El usuario autorizó un catálogo único para los tenants existentes y nuevos, así como commit, push e integración en main. No se guardan precios antiguos de forma indefinida. El contrato custom sigue requiriendo cotización.

| Plan | COP mensual | COP anual (10 % descuento) | Respuestas mensuales | Techo del modelo USD/mes |
|---|---:|---:|---:|---:|
| Emprendedor | 129.900 | 1.402.920 | 1.000 | 3 |
| Starter | 299.900 | 3.238.920 | 5.000 | 8 |
| Pro | 799.900 | 8.638.920 | 15.000 | 25 |
| Enterprise | 2.199.900 | A cotizar; mensual disponible | 40.000 | 80 |

Los precios USD de referencia son 29/69/179/499; no habilitan por sí solos cobro fuera de Colombia. Las filas de billing_plans siguen siendo la autoridad editable. El seed normal no sobrescribe cambios del superadmin. La migración guarda el estado anterior, actualiza el catálogo, elimina excepciones históricas de cuota/gasto de estas cuatro familias e invalida los identificadores de precio sustituidos. Los demás overrides operativos permanecen.

Las renovaciones activas congelan precio y primer intento del nuevo periodo en una misma transacción. No se reescriben pagos ni intentos ya creados, incluidos resultados desconocidos; tampoco se cambia una moneda bajo un mandato existente. El primer cobro ya cotizado de una prueba conserva su acuerdo. Cambios futuros de catálogo se toman en la siguiente renovación sin intento previo. Los límites operativos se actualizan al vencer/invalidate la caché, como máximo cinco minutos.

El superadmin dispone de validación semántica de cuotas, protección frente a dos ediciones de la misma revisión, auditoría transaccional, advertencia explícita si falla la invalidación de caché y una tabla de consumo/reservas del modelo por negocio (hasta 200, ordenados por consumo). Una cifra no inicializada no se presenta como cero medido. Los importes se editan por moneda sin eliminar signos o letras silenciosamente ni perder los decimales.

La nueva autoridad de gasto reserva antes de cada llamada del router, incluyendo los reintentos con autoridad de fuentes y el streaming. PostgreSQL serializa la admisión por tenant/mes UTC; usa micro-USD. Deshabilita reintentos ocultos del SDK. La entrada textual se estima conservadoramente por bytes y margen de formato; multimodal reserva el contexto máximo. El streaming conserva el techo de salida porque no informa todos los tokens de razonamiento. Un timeout o un fallo al reconciliar no libera dinero. Un resultado con uso registra el costo estimado según los tokens; no es una factura del proveedor. El primer uso incorpora el contador Redis previo del mes. Las evaluaciones que ya tienen presupuesto propio permanecen fuera de la contabilidad operativa. Multimedia y embeddings conservan sus controles separados. Un techo de -1 es una excepción explícita sin límite monetario. El producto explica que el presupuesto puede agotarse antes que la cuota de respuestas.

WhatsApp muestra el recorrido para cuentas existentes: abrir WhatsApp Manager de Meta, escoger la WABA indicada, agregar allí el método de pago y volver a comprobar. No requiere reconectar el número ni trasladar la tarjeta de Wompi. La comprobación usa la identidad de la conexión, verifica la WABA que contesta, conserva solo estado/fecha y caduca a las 24 horas. Una respuesta incompleta o sin permisos es desconocida; una tarjeta asociada no prueba solvencia. Un rechazo de pago observado prevalece sobre la lectura de configuración. La interfaz y Assist están actualizados en es/en/pt/fr. No se hizo ninguna comprobación con credenciales reales.

Finanzas: MRR normalizado desde el precio congelado y el ciclo real de la suscripción; se informa cuántas suscripciones no pudieron convertirse. La pantalla usaba nombres diferentes a los campos del backend para MRR/ARR/ARPU/LTV y ahora consume los campos correctos. El contador de respuestas deja de usar llamadas de modelo como si fueran respuestas. El margen histórico sigue siendo parcial: globalmente IA+infraestructura, por tenant solo IA. La pantalla declara explícitamente que faltan PSP, soporte, multimedia, embeddings y otros costos; este cambio no inventa costos observados ni completa esa contabilidad histórica. La investigación adjunta modela esas partidas y los escenarios AWS, pero no constituye margen real ni aprovisiona AWS.

## Verificación y operación

- Migraciones canónicas completas sobre PostgreSQL 17 vacío: 96 aplicadas.
- Upgrade del catálogo ensayado con precios/cuotas antiguos, ids remotos obsoletos y auditoría; custom conserva cotización.
- Pruebas de concurrencia y router sobre Prisma real, repetidas por PgBouncer en modo transacción: reserva compartida, timeout, conciliación de uso, bloqueo directo/stream, edición de topes y conflicto de dos administradores.
- Bloque API: 1.068 pruebas aprobadas; siete pruebas de reservas Redis se ejecutan aparte con Valkey. No es un reporte de la suite API completa.
- Dashboard: 90 suites / 1.219 pruebas, más dos nuevas pruebas de accesibilidad de las pantallas de financiación y gasto.
- Typecheck en frío API/dashboard/landing/shared; bootstrap real Nest; lint de archivos modificados; claims y artefactos generados.

No hay llaves de producción nuevas. El método de pago sigue a cargo del administrador del negocio en Meta. La lectura de primary_funding_id puede ser desconocida si Meta no lo expone al token; se conserva el acceso directo a Meta. Verificar el contrato vigente de WOMPI_MAX_TRANSACTION_COP_CENTS y el techo diario, ya existentes: el anual calculado de Enterprise sería COP 23.758.920 y supera el Int32 del motor; no se publica ese ciclo. Habilitarlo requiere ampliar primero las columnas y contratos monetarios del motor. Los demás anuales también deben respetar el monto autorizado al comercio. No aumentar un límite contractual inventándolo.

El rollback de aplicación no deshace los precios ni modifica cobros: cualquier reversión comercial debe hacerse explícitamente desde superadmin con nueva auditoría. Las reservas desconocidas no se borran para fabricar saldo; puede ajustarse el techo de forma consciente mientras se revisa la evidencia.
