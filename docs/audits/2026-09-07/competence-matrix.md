# Cobertura de competencia por perfil

Registro generado desde contratos de dominio, herramientas, dependencias y escenarios del código. No contiene datos de clientes.

Perfiles canónicos: **80**. Tareas declaradas: **444**. Tareas que comprometen al negocio: **158**.

Tareas sin caso positivo con efecto verificable: **5**. Tareas con alguna herramienta de escritura sin verificador de efecto: **5**.

Estos dos contadores **no** son los de «sin positivo propio / sin verificador» de [`task-matrix-derived.md`](../2026-09-08/task-matrix-derived.md), que están en cero. Aquel mide si la tarea tiene escenario propio y familia auditada; éste exige además que un caso positivo afirme un **efecto en base** (`db_effect`) del writer que la tarea compromete. Una tarea cuya familia de escritura todavía no corre en el adaptador aislado no puede afirmarlo, así que cuenta acá y no allá. Leer «cero sin positivo» como «toda tarea transaccional tiene un positivo verificable» es exactamente el error que esta línea existe para evitar.

La matriz describe cobertura declarada. Los estados por canal e idioma permanecen en «no ejecutado» hasta asociar evidencia de una revisión concreta. No hereda certificación de otro perfil ni convierte un escenario genérico llamado «camino feliz» en prueba de una operación terminada.

La disponibilidad comercial, el permiso de ejecutar una herramienta y la existencia de un verificador de lectura son dimensiones distintas. La prueba de carga de módulos o de componentes tampoco certifica un proveedor externo.

Revisión base del repositorio: `e95b789947a6b1a89caf9abc9b75857917c2751e`; incluye los cambios del árbol de trabajo al generar.

[Detalle de tareas en CSV](competence-matrix.csv). El contrato completo está disponible en `GET /eval/:tenantId/competence-matrix`; el generador también lo exporta con `--json`.

| Perfil | Tareas | Comprometen al negocio | Sin caso positivo | Herramientas no registradas |
|---|---:|---:|---:|---|
| automotriz/alquiler | 5 | 2 | 0 | — |
| automotriz/concesionario | 6 | 3 | 0 | — |
| automotriz/repuestos | 7 | 2 | 0 | — |
| automotriz/taller | 9 | 5 | 0 | — |
| construccion/contratista_general | 3 | 0 | 0 | — |
| education/academia_baile | 6 | 3 | 0 | — |
| education/academia_musica | 6 | 3 | 0 | — |
| education/autoescuela | 6 | 3 | 0 | — |
| education/capacitacion | 6 | 3 | 0 | — |
| education/clases_particulares | 6 | 3 | 0 | — |
| education/idiomas | 6 | 3 | 0 | — |
| education/online | 6 | 3 | 0 | — |
| education/universitaria | 6 | 3 | 0 | — |
| event_planning/weddings | 3 | 0 | 0 | — |
| finanzas/asesoria | 5 | 2 | 0 | — |
| finanzas/creditos | 5 | 2 | 0 | — |
| finanzas/pagos_recaudos | 3 | 0 | 0 | — |
| fotografia/bodas | 4 | 1 | 0 | — |
| fotografia/estudio | 4 | 1 | 0 | — |
| fotografia/eventos | 4 | 1 | 0 | — |
| fotografia/producto | 4 | 1 | 0 | — |
| gimnasios/crossfit | 6 | 3 | 0 | — |
| gimnasios/cycling | 6 | 3 | 0 | — |
| gimnasios/gimnasio_general | 6 | 3 | 0 | — |
| gimnasios/martial_arts | 6 | 3 | 0 | — |
| gimnasios/yoga_pilates | 6 | 3 | 0 | — |
| inmobiliaria/arriendo | 6 | 2 | 0 | — |
| inmobiliaria/comercial | 6 | 2 | 0 | — |
| inmobiliaria/promotora | 3 | 0 | 0 | — |
| inmobiliaria/venta | 6 | 2 | 0 | — |
| moda_belleza/barberia | 5 | 2 | 0 | — |
| moda_belleza/estetica | 6 | 2 | 0 | — |
| moda_belleza/salon_belleza | 5 | 2 | 0 | — |
| moda_belleza/spa | 6 | 2 | 0 | — |
| otro/__none__ | 7 | 2 | 0 | — |
| pet_services/adiestramiento | 8 | 3 | 0 | — |
| pet_services/guarderia | 7 | 2 | 0 | — |
| pet_services/hotel | 7 | 2 | 0 | — |
| pet_services/paseos | 8 | 3 | 0 | — |
| pet_services/peluqueria | 8 | 3 | 0 | — |
| restaurantes/cafeteria | 7 | 3 | 0 | — |
| restaurantes/casual_dining | 7 | 3 | 0 | — |
| restaurantes/comida_rapida | 5 | 1 | 0 | — |
| restaurantes/dark_kitchen | 5 | 1 | 0 | — |
| retail/electronica | 7 | 2 | 0 | — |
| retail/hogar | 9 | 4 | 0 | — |
| retail/marketplace | 3 | 0 | 0 | — |
| retail/moda | 7 | 2 | 0 | — |
| salud/dental | 6 | 2 | 0 | — |
| salud/dermatologia | 6 | 2 | 0 | — |
| salud/farmacia | 7 | 2 | 0 | — |
| salud/medica_general | 5 | 2 | 0 | — |
| salud/psicologia | 6 | 2 | 0 | — |
| seguros/aseguradora | 5 | 2 | 1 | — |
| seguros/auto | 5 | 2 | 1 | — |
| seguros/broker | 5 | 2 | 1 | — |
| seguros/salud | 5 | 2 | 1 | — |
| seguros/vida | 5 | 2 | 1 | — |
| servicios_hogar/cerrajeria | 4 | 1 | 0 | — |
| servicios_hogar/electricidad | 4 | 1 | 0 | — |
| servicios_hogar/fumigacion | 4 | 1 | 0 | — |
| servicios_hogar/jardineria | 4 | 1 | 0 | — |
| servicios_hogar/limpieza | 4 | 1 | 0 | — |
| servicios_hogar/pintura | 4 | 1 | 0 | — |
| servicios_hogar/plomeria | 4 | 1 | 0 | — |
| servicios_profesionales/abogados | 6 | 2 | 0 | — |
| servicios_profesionales/arquitectos | 6 | 2 | 0 | — |
| servicios_profesionales/consultores | 6 | 2 | 0 | — |
| servicios_profesionales/contadores | 6 | 2 | 0 | — |
| technology/desarrollo | 5 | 2 | 0 | — |
| technology/hardware | 7 | 2 | 0 | — |
| technology/saas | 5 | 2 | 0 | — |
| technology/soporte_ti_msp | 3 | 0 | 0 | — |
| turismo/agencia_viajes | 4 | 1 | 0 | — |
| turismo/alquiler_vacacional | 5 | 1 | 0 | — |
| turismo/hotel | 5 | 1 | 0 | — |
| turismo/tours | 4 | 1 | 0 | — |
| veterinaria/clinica_general | 7 | 3 | 0 | — |
| veterinaria/exoticos | 7 | 3 | 0 | — |
| veterinaria/hospital_24h | 7 | 3 | 0 | — |

Para actualizar: ejecutar `node docs/audits/2026-09-07/generate-competence-matrix.cjs` desde la raíz. Cada cierre requiere escenario, datos de prueba, comando canónico, verificador, revisión del agente y evidencia por canal e idioma.
