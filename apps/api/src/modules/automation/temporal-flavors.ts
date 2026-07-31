/**
 * Las fuentes temporales de cada vertical, declaradas como datos.
 *
 * El motor de automations sólo reaccionaba a eventos ENTRANTES: su único
 * `@OnEvent` era `lead.captured`. Todo lo que depende del *paso del tiempo* no
 * existía — incluidas las plantillas con `trigger_type='inactivity'` que el
 * seed ya sembraba y que no evaluaba nadie. Doce ítems de siete dossiers
 * colgaban de ese hueco: el recall de vacunas, el recall semestral dental, la
 * reactivación de socios, el rebooking de belleza, el vencimiento de pólizas,
 * la re-matrícula y el pre/post estadía de alojamiento.
 *
 * Se hace UNA vez y se declara N veces: la lógica de "buscar, deduplicar,
 * respetar opt-out y disparar las reglas" es la misma para los ocho; lo único
 * que cambia es la consulta. Por eso los sabores son una tabla y no ocho
 * servicios.
 *
 * Contrato de cada consulta:
 *   - devuelve `contact_id`, `entity_id`, `entity_type` y `label`
 *   - `label` es texto para el mensaje (nombre de la mascota, del curso…)
 *   - $1 = ventana en días (`windowDays`)
 *   - NO filtra opt-outs ni duplicados: eso lo hace el evaluador para todos
 *
 * `table` se usa para saltear el sabor cuando la tabla no existe: las tablas
 * verticales son lazy y su ausencia significa "no aplica", no "falló".
 */
export interface TemporalFlavor {
    /** trigger_type que las reglas de automation declaran para engancharse. */
    trigger: string;
    /** Tabla que debe existir para que el sabor aplique. */
    table: string;
    /** Días hacia adelante (o hacia atrás, según el sabor) que mira la consulta. */
    windowDays: number;
    /**
     * Días que deben pasar antes de volver a disparar la MISMA regla sobre la
     * MISMA entidad. Sin esto un cron diario le escribe todos los días al mismo
     * cliente hasta que la fecha pase.
     */
    cooldownDays: number;
    sql: string;
}

export const TEMPORAL_FLAVORS: TemporalFlavor[] = [
    {
        // El sabor que el producto ya PROMETÍA. `seed-templates.ts` siembra tres
        // plantillas con este trigger_type ("Win-back 30 días", "Re-engagement
        // 14 días", "Control periódico" de salud) desde hace meses: el dueño las
        // activaba desde la galería, quedaban `active = true`, y no las evaluaba
        // absolutamente nadie. Con este sabor empiezan a correr sin tocarlas.
        trigger: 'inactivity',
        table: 'contacts',
        windowDays: 30,
        cooldownDays: 45,
        sql: `SELECT c.id AS contact_id, c.id AS entity_id, 'contact' AS entity_type,
                     c.name AS label, c.last_contact_at::date AS due_date, NULL AS detail
              FROM contacts c
              WHERE c.last_contact_at IS NOT NULL
                AND c.last_contact_at < NOW() - ($1 || ' days')::interval
              LIMIT 500`,
    },
    {
        // El sabor más barato y el más honesto: la fecha es un dato explícito
        // que cargó la propia clínica, no una inferencia.
        trigger: 'vaccination.due',
        table: 'pet_vaccinations',
        windowDays: 14,
        cooldownDays: 30,
        sql: `SELECT p.contact_id, v.id AS entity_id, 'vaccination' AS entity_type,
                     p.name AS label, v.next_due_at AS due_date, v.vaccine_name AS detail
              FROM pet_vaccinations v
              JOIN pets p ON p.id = v.pet_id
              WHERE v.next_due_at IS NOT NULL
                AND v.next_due_at BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1 || ' days')::interval
                AND p.is_active = true
                AND p.contact_id IS NOT NULL
              LIMIT 500`,
    },
    {
        trigger: 'policy.expiring',
        table: 'insurance_policies',
        windowDays: 30,
        cooldownDays: 30,
        sql: `SELECT contact_id, id AS entity_id, 'policy' AS entity_type,
                     policy_number AS label, ends_at AS due_date, NULL AS detail
              FROM insurance_policies
              WHERE status = 'active'
                AND ends_at IS NOT NULL
                AND ends_at BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1 || ' days')::interval
                AND contact_id IS NOT NULL
              LIMIT 500`,
    },
    {
        // Vencimiento de membresía: el momento en que el gimnasio o renueva o
        // pierde al socio.
        trigger: 'membership.expiring',
        table: 'members',
        windowDays: 10,
        cooldownDays: 20,
        sql: `SELECT contact_id, id AS entity_id, 'member' AS entity_type,
                     member_number AS label, current_period_end AS due_date, NULL AS detail
              FROM members
              WHERE status = 'active'
                AND current_period_end IS NOT NULL
                AND current_period_end BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1 || ' days')::interval
                AND contact_id IS NOT NULL
              LIMIT 500`,
    },
    {
        // Socio activo que dejó de venir. La ventana mira hacia ATRÁS.
        trigger: 'member.inactive',
        table: 'member_check_ins',
        windowDays: 21,
        cooldownDays: 30,
        sql: `SELECT m.contact_id, m.id AS entity_id, 'member' AS entity_type,
                     m.member_number AS label, NULL AS due_date, NULL AS detail
              FROM members m
              WHERE m.status = 'active'
                AND m.contact_id IS NOT NULL
                AND NOT EXISTS (
                    SELECT 1 FROM member_check_ins ci
                    WHERE ci.member_id = m.id
                      AND ci.checked_in_at >= NOW() - ($1 || ' days')::interval
                )
              LIMIT 500`,
    },
    {
        trigger: 'cohort.starting',
        table: 'course_cohorts',
        windowDays: 7,
        cooldownDays: 14,
        sql: `SELECT e.contact_id, c.id AS entity_id, 'cohort' AS entity_type,
                     co.name AS label, c.starts_at AS due_date, c.cohort_code AS detail
              FROM course_cohorts c
              JOIN enrollments e ON e.cohort_id = c.id AND e.status IN ('enrolled', 'active')
              JOIN courses co ON co.id = c.course_id
              WHERE c.starts_at BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1 || ' days')::interval
                AND e.contact_id IS NOT NULL
              LIMIT 500`,
    },
    {
        trigger: 'stay.arriving',
        table: 'property_bookings',
        windowDays: 3,
        cooldownDays: 5,
        sql: `SELECT b.contact_id, b.id AS entity_id, 'property_booking' AS entity_type,
                     p.name AS label, b.check_in AS due_date, NULL AS detail
              FROM property_bookings b
              JOIN properties p ON p.id = b.property_id
              WHERE b.status NOT IN ('cancelled', 'rejected')
                AND b.check_in BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1 || ' days')::interval
                AND b.contact_id IS NOT NULL
              LIMIT 500`,
    },
    {
        // Estadía terminada: la ventana para pedir la reseña. Mira hacia ATRÁS.
        trigger: 'stay.ended',
        table: 'property_bookings',
        windowDays: 2,
        cooldownDays: 90,
        sql: `SELECT b.contact_id, b.id AS entity_id, 'property_booking' AS entity_type,
                     p.name AS label, b.check_out AS due_date, NULL AS detail
              FROM property_bookings b
              JOIN properties p ON p.id = b.property_id
              WHERE b.status NOT IN ('cancelled', 'rejected')
                AND b.check_out BETWEEN CURRENT_DATE - ($1 || ' days')::interval AND CURRENT_DATE
                AND b.contact_id IS NOT NULL
              LIMIT 500`,
    },
    {
        // Rebooking / recall: atendido hace tiempo y sin próxima cita. Sirve al
        // salón y a la clínica dental con la MISMA consulta.
        //
        // La cadencia sale del SERVICIO (`services.rebook_after_days`), no de un
        // promedio: una keratina son ~90 días, unas raíces ~28, una limpieza
        // dental ~180. Un único número para todo el catálogo le escribe temprano
        // a la mitad de los clientes y tarde a la otra mitad, que es la forma
        // más rápida de que el dueño apague la automatización entera.
        //
        // `windowDays` queda como default para los servicios que no lo declaran.
        // Se eligió que NULL caiga al genérico y no que apague el servicio: la
        // regla ya es opt-in a nivel tenant (si no existe, nada de esto corre), y
        // exigir además configurar cada servicio uno por uno dejaría la función
        // encendida y sin efecto — el mismo "existe pero es inalcanzable" que
        // este plan viene desarmando.
        trigger: 'rebooking.due',
        table: 'appointments',
        windowDays: 45,
        cooldownDays: 45,
        sql: `SELECT a.contact_id, a.id AS entity_id, 'appointment' AS entity_type,
                     a.service_name AS label, a.start_at::date AS due_date,
                     s.rebook_after_days::text AS detail
              FROM appointments a
              LEFT JOIN services s ON s.id = a.service_id
              WHERE a.status = 'completed'
                AND a.contact_id IS NOT NULL
                AND a.start_at::date = (
                    CURRENT_DATE - (COALESCE(s.rebook_after_days, $1::int) || ' days')::interval
                )::date
                AND NOT EXISTS (
                    SELECT 1 FROM appointments f
                    WHERE f.contact_id = a.contact_id
                      AND f.start_at > NOW()
                      AND f.status <> 'cancelled'
                )
              LIMIT 500`,
    },
];
