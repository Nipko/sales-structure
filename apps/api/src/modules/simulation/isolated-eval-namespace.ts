import { createHash, randomUUID } from 'crypto';
import type { PrismaService } from '../prisma/prisma.service';

export const CANONICAL_EVAL_TOOL_FAMILIES: Readonly<Record<string, string>> = Object.freeze({
    create_appointment: 'appointments', cancel_appointment: 'appointments', reschedule_appointment: 'appointments',
    schedule_test_drive: 'appointments',
    enroll_student: 'enrollments', cancel_enrollment: 'enrollments', book_class: 'class_bookings', cancel_class_booking: 'class_bookings',
    create_repair_order: 'repair_orders', approve_repair: 'repair_orders', cancel_repair_order: 'repair_orders',
    place_catalog_order:'catalog_orders',cancel_catalog_order:'catalog_orders',
    register_pet: 'pets', update_pet: 'pets',
    calculate_quote: 'insurance_quotes',
    // Las seis operaciones que un negocio de servicio, hospedaje o comida
    // cierra en el chat. Estaban en el registro de familias auditadas pero no
    // acá, y la superficie ejecutable bajo un namespace se decide **acá**: sin
    // esta entrada el escenario recibía `canonical_sandbox_not_available` y
    // ninguna afirmación positiva podía pasar, por lo que ninguna se escribió.
    //
    // Entran ahora porque cada uno corre su comando de producción real dentro
    // del namespace arrendado, con su único efecto externo apagado por el
    // arriendo (no por el schema ni por un flag suelto), con todas las tablas
    // que leen y escriben clonadas, y con el estado que afirman igual al que
    // escribe producción — `create_vehicle_rental` nace `pending_review`, no
    // `reserved`.
    //
    // `create_vehicle_rental` NO entra, aunque comparta familia y tabla con la
    // guardería. Es la única de estas operaciones declarada A2 con
    // `assuranceEnforcement: 'step_up'`, así que el guardián central le pide
    // identidad verificada antes de llegar al comando, y la identidad sintética
    // del namespace sólo cubre lectores (`EVAL_IDENTITY_READERS`) — igual que
    // rechaza `file_claim`. Admitirla exigiría darle identidad verificada a un
    // writer sensible desde una prueba, que es exactamente lo que ese control
    // existe para impedir.
    create_property_booking: 'property_bookings', create_tour_booking: 'tour_bookings',
    place_order: 'restaurant_orders', create_service_request: 'service_requests',
    request_photo_quote: 'photo_sessions', create_pet_boarding: 'resource_rentals',
});
/** Private readers keep their normal identity/ownership guards; this only admits
 * their schema-local implementation after a fixture lease has been verified. */
export const CANONICAL_EVAL_TOOLS = new Set(['check_availability', 'get_appointment_details', 'list_customer_appointments',
    ...Object.keys(CANONICAL_EVAL_TOOL_FAMILIES)]);

export function isolatedEvalNamespaceForPrisma(prisma: PrismaService): IsolatedEvalNamespace {
    return new IsolatedEvalNamespace({ transaction: work => prisma.$transaction(async tx => work(async (sql, params = []) => {
        if (/^\s*(?:CREATE|ALTER|DROP|SET)\b/i.test(sql)) { await tx.$executeRawUnsafe(sql, ...params); return []; }
        return await tx.$queryRawUnsafe(sql, ...params) as any[];
    }), { timeout: 30_000 }) });
}

export type EvalNamespaceQuery = (sql: string, params?: unknown[]) => Promise<any[]>;
export interface EvalNamespaceDatabase {
    transaction<T>(work: (query: EvalNamespaceQuery) => Promise<T>): Promise<T>;
}
export interface EvalNamespaceLease {
    schemaName: string;
    sourceSchema: string;
    tenantId: string;
    token: string;
    expiresAt: string;
    tables: readonly string[];
}

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const NAMESPACE = /^tenant_eval_[a-f0-9]{8}_[a-f0-9]{24}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TABLES = new Set([
    'customer_profiles', 'contact_identities', 'contacts', 'conversations', 'messages', 'tool_execution_ledger', 'customer_memory_erasure', 'tool_approval_tickets', 'tool_approval_events', 'persona_config', 'agent_personas',
    'pipelines', 'pipeline_stages', 'deals', 'opportunities', 'leads', 'companies', 'campaigns', 'calendar_integrations', 'staff_members', 'operational_locations',
    'customer_vehicles', 'repair_orders', 'repair_order_events',
    'blocked_dates', 'availability_slots', 'service_staff', 'services', 'appointments', 'appointment_blocked_dates', 'appointment_settings', 'appointment_holds',
    'members', 'membership_plans', 'fitness_classes', 'class_bookings', 'class_waitlist',
    'courses', 'course_cohorts', 'enrollments', 'products', 'orders', 'order_items','stock_movements',
    'properties', 'property_bookings', 'tour_packages', 'tour_inventory', 'tour_bookings',
    'menu_items', 'food_orders', 'food_order_items', 'service_requests', 'photo_sessions',
    // `ical_blocks` no lo escribe nadie desde el chat: es la mitad del chequeo
    // de conflicto que `createBooking` hace antes de aceptar una estadía. Sin
    // la tabla la reserva falla por una relación ausente, que es un fallo de
    // infraestructura disfrazado de "no había disponibilidad".
    'ical_blocks',
    // La bitácora de la reserva de recurso se escribe en la MISMA transacción
    // que la reserva: sin clonarla, el INSERT de `resource_rentals` se revierte
    // entero y el alquiler nunca existe.
    'resource_rentals', 'resource_rental_events',
    'vehicles', 'pets', 'pet_vaccinations', 'pet_command_receipts', 'insurance_policies', 'insurance_claims',
    // `insurance_plans` is the read `calculate_quote` needs before it can write:
    // without it the quote fails on a missing plan rather than on anything the
    // evaluation is measuring.
    'insurance_plans', 'insurance_quotes',
]);
const quote = (name: string): string => {
    if (!IDENTIFIER.test(name)) throw new Error('eval_invalid_identifier');
    return `"${name}"`;
};

/** Defaults are code. Never copy an arbitrary function or a live nextval. */
export function isolatedDefault(expression: string, sequence?: string): string {
    const value = expression.trim();
    if (/^nextval\('[^']+'::regclass\)$/.test(value)) {
        if (!sequence) throw new Error('eval_sequence_metadata_missing');
        return `nextval('${sequence}'::regclass)`;
    }
    if (/^(?:public\.)?(?:gen_random_uuid|uuid_generate_v4)\(\)$/.test(value)) return 'pg_catalog.gen_random_uuid()';
    if (/^(?:now\(\)|CURRENT_TIMESTAMP|CURRENT_DATE|true|false|NULL|-?\d+(?:\.\d+)?)$/i.test(value)) return value;
    if (/^NULL::(?:text|character varying|jsonb|json|uuid|date|time without time zone|time with time zone|timestamp without time zone|timestamp with time zone|integer|bigint|numeric|boolean)$/.test(value)) return 'NULL';
    if (/^'(?:[^']|'')*'::(?:text|character varying|jsonb|json|uuid|date|time without time zone|time with time zone|timestamp without time zone|timestamp with time zone|interval|integer|bigint|numeric|boolean)(?:\[\])?$/.test(value)) return value;
    throw new Error('eval_unsafe_default');
}

/**
 * Empty relational clone only. It copies no customer rows, credentials, triggers,
 * policies or provider bindings. A caller must seed explicit fixtures separately.
 * This is infrastructure, not permission to enable domain writers in Agent Test.
 */
export class IsolatedEvalNamespace {
    constructor(private readonly database: EvalNamespaceDatabase) {}

    async provision(tenantId: string, sourceSchema: string, requestedTables: readonly string[], ttlMs = 3600_000): Promise<EvalNamespaceLease> {
        if (!UUID.test(tenantId) || !/^tenant_[a-z0-9_]+$/.test(sourceSchema) || sourceSchema.length > 63
            || NAMESPACE.test(sourceSchema)) throw new Error('eval_invalid_source');
        const tables = [...new Set(requestedTables)];
        if (!tables.length || tables.some(table => !TABLES.has(table))) throw new Error('eval_table_not_reviewed');
        if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 3600_000) throw new Error('eval_invalid_ttl');
        const schemaName = `tenant_eval_${tenantId.replace(/-/g, '').slice(0, 8)}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
        const token = randomUUID();
        return this.database.transaction(async query => {
            await query('SET LOCAL search_path TO pg_catalog');
            const owner = await query('SELECT schema_name FROM public.tenants WHERE id = $1::uuid', [tenantId]);
            if (owner[0]?.schema_name !== sourceSchema) throw new Error('eval_source_tenant_mismatch');
            const columns = await query(`SELECT c.relname::text AS table_name,c.relkind::text AS relkind,a.attname::text AS column_name,
                a.attidentity::text AS attidentity,a.attgenerated::text AS attgenerated,tn.nspname::text AS type_schema,pg_get_expr(d.adbin,d.adrelid) AS default_expression,
                s.seqstart::text,s.seqincrement::text,s.seqmin::text,s.seqmax::text,s.seqcycle,s.seqcache::text
                FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
                JOIN pg_type t ON t.oid=a.atttypid JOIN pg_namespace tn ON tn.oid=t.typnamespace
                LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
                LEFT JOIN pg_sequence s ON s.seqrelid=pg_get_serial_sequence(format('%I.%I',n.nspname,c.relname),a.attname)::regclass
                WHERE n.nspname=$1 AND c.relname=ANY($2::text[]) ORDER BY c.relname,a.attnum`, [sourceSchema, tables]);
            for (const table of tables) if (!columns.some(row => row.table_name === table)) throw new Error(`eval_table_missing:${table}`);
            if (columns.some(row => row.relkind !== 'r' || row.type_schema !== 'pg_catalog' || row.attgenerated)) throw new Error('eval_unsupported_column_definition');
            // Index/check expressions may call functions. Only built-ins are reviewed.
            const customFunctions = await query(`SELECT 1 FROM pg_depend d CROSS JOIN LATERAL pg_identify_object(d.refclassid,d.refobjid,d.refobjsubid) referenced
                WHERE d.refclassid IN ('pg_proc'::regclass,'pg_operator'::regclass,'pg_opclass'::regclass,'pg_opfamily'::regclass,'pg_collation'::regclass) AND referenced.schema<>'pg_catalog' AND (
                (d.classid='pg_constraint'::regclass AND d.objid IN (SELECT x.oid FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=ANY($2::text[])))
                OR (d.classid='pg_class'::regclass AND d.objid IN (SELECT i.indexrelid FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=ANY($2::text[])))) LIMIT 1`, [sourceSchema, tables]);
            if (customFunctions.length) throw new Error('eval_unreviewed_database_function');
            const foreignKeys = await query(`SELECT c.conname::text AS conname,c.condeferrable,c.condeferred,c.confupdtype::text AS confupdtype,c.confdeltype::text AS confdeltype,c.confmatchtype::text AS confmatchtype,
                src.relname::text AS table_name,rn.nspname::text AS reference_schema,ref.relname::text AS reference_table,
                ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=src.oid AND a.attnum=k.num ORDER BY k.ord) AS columns,
                ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=ref.oid AND a.attnum=k.num ORDER BY k.ord) AS reference_columns
                FROM pg_constraint c JOIN pg_class src ON src.oid=c.conrelid JOIN pg_namespace sn ON sn.oid=src.relnamespace
                JOIN pg_class ref ON ref.oid=c.confrelid JOIN pg_namespace rn ON rn.oid=ref.relnamespace
                WHERE c.contype='f' AND sn.nspname=$1 AND src.relname=ANY($2::text[])`, [sourceSchema, tables]);
            const shadowUser = (fk: any) => fk.reference_schema === 'public' && fk.reference_table === 'users' && JSON.stringify(fk.reference_columns) === '["id"]';
            for (const fk of foreignKeys) if (!shadowUser(fk) && (fk.reference_schema !== sourceSchema || !tables.includes(fk.reference_table))) throw new Error(`eval_dependency_not_cloned:${fk.reference_schema}.${fk.reference_table}`);
            // Validate all default expressions before creating any object.
            for (const column of columns) if (column.default_expression && !column.attidentity) isolatedDefault(column.default_expression, 'validated_sequence');
            await query(`CREATE SCHEMA ${quote(schemaName)}`);
            await query(`CREATE TABLE ${quote(schemaName)}.__eval_namespace (tenant_id uuid NOT NULL,owner_token uuid NOT NULL,source_schema text NOT NULL,expires_at timestamptz NOT NULL)`);
            const rows = await query(`INSERT INTO ${quote(schemaName)}.__eval_namespace VALUES ($1::uuid,$2::uuid,$4::text,clock_timestamp()+$3::integer*interval '1 millisecond') RETURNING expires_at`, [tenantId, token, ttlMs, sourceSchema]);
            await query(`CREATE TABLE ${quote(schemaName)}.__eval_ref_users (id uuid PRIMARY KEY,tenant_id uuid NOT NULL,is_active boolean NOT NULL DEFAULT true,first_name text,last_name text)`);
            await query(`CREATE TABLE ${quote(schemaName)}.__eval_ref_tenants (id uuid PRIMARY KEY,schema_name text NOT NULL,is_active boolean NOT NULL DEFAULT true)`);
            await query(`CREATE TABLE ${quote(schemaName)}.__eval_identity_assurance (conversation_id uuid PRIMARY KEY,contact_id uuid NOT NULL,assurance text NOT NULL CHECK (assurance='synthetic_A2'),expires_at timestamptz NOT NULL)`);
            await query(`INSERT INTO ${quote(schemaName)}.__eval_ref_tenants(id,schema_name) VALUES($1::uuid,$2)`,[tenantId,schemaName]);
            for (const table of tables) {
                // INCLUDING IDENTITY creates separate sequences; DEFAULTS would not.
                await query(`CREATE TABLE ${quote(schemaName)}.${quote(table)} (LIKE ${quote(sourceSchema)}.${quote(table)} INCLUDING CONSTRAINTS INCLUDING INDEXES INCLUDING IDENTITY)`);
            }
            for (const column of columns) {
                if (!column.default_expression || column.attidentity) continue;
                let sequence: string | undefined;
                if (/^nextval\(/.test(column.default_expression)) {
                    if (!column.seqstart) throw new Error('eval_sequence_metadata_missing');
                    const name = 'seq_' + createHash('sha256').update(`${column.table_name}:${column.column_name}`).digest('hex').slice(0, 24);
                    sequence = `${quote(schemaName)}.${quote(name)}`;
                    const numbers = ['seqstart', 'seqincrement', 'seqmin', 'seqmax', 'seqcache'].map(key => String(column[key]));
                    if (numbers.some(value => !/^-?\d+$/.test(value))) throw new Error('eval_invalid_sequence_definition');
                    await query(`CREATE SEQUENCE ${sequence} START ${numbers[0]} INCREMENT ${numbers[1]} MINVALUE ${numbers[2]} MAXVALUE ${numbers[3]} CACHE ${numbers[4]} ${column.seqcycle ? 'CYCLE' : 'NO CYCLE'} OWNED BY ${quote(schemaName)}.${quote(column.table_name)}.${quote(column.column_name)}`);
                }
                const expression = isolatedDefault(column.default_expression, sequence);
                await query(`ALTER TABLE ${quote(schemaName)}.${quote(column.table_name)} ALTER COLUMN ${quote(column.column_name)} SET DEFAULT ${expression}`);
            }
            const actions: Record<string, string> = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };
            for (const fk of foreignKeys) {
                const update = actions[fk.confupdtype], deletion = actions[fk.confdeltype];
                if (!update || !deletion || !['s', 'f'].includes(fk.confmatchtype)) throw new Error('eval_unsupported_fk');
                await query(`ALTER TABLE ${quote(schemaName)}.${quote(fk.table_name)} ADD CONSTRAINT ${quote(fk.conname)} FOREIGN KEY (${fk.columns.map(quote).join(',')}) REFERENCES ${quote(schemaName)}.${quote(shadowUser(fk) ? '__eval_ref_users' : fk.reference_table)} (${fk.reference_columns.map(quote).join(',')}) MATCH ${fk.confmatchtype === 'f' ? 'FULL' : 'SIMPLE'} ON UPDATE ${update} ON DELETE ${deletion} ${fk.condeferrable ? `DEFERRABLE INITIALLY ${fk.condeferred ? 'DEFERRED' : 'IMMEDIATE'}` : 'NOT DEFERRABLE'}`);
            }
            return { schemaName, sourceSchema, tenantId, token, expiresAt: new Date(rows[0].expires_at).toISOString(), tables };
        });
    }

    async provisionRuntime(tenantId: string, sourceSchema: string): Promise<EvalNamespaceLease> {
        const available = await this.database.transaction(query => query("SELECT c.relname::text AS relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='r'", [sourceSchema]));
        const tables = available.map(row => row.relname).filter(table => TABLES.has(table));
        for (const required of ['contacts','conversations','messages','services','appointments','members','fitness_classes','class_bookings','courses','course_cohorts','enrollments','persona_config']) {
            if (!tables.includes(required)) throw new Error('eval_table_missing:' + required);
        }
        await this.reapExpired(tenantId,sourceSchema);
        return this.provision(tenantId, sourceSchema, tables);
    }

    /** Recover abandoned namespaces after a worker crash, scoped to the owning tenant. */
    async reapExpired(tenantId: string,sourceSchema: string): Promise<number> {
        if (!UUID.test(tenantId)) throw new Error('eval_invalid_source');
        const candidates = await this.database.transaction(async query => {
            const owner=await query('SELECT schema_name FROM public.tenants WHERE id=$1::uuid',[tenantId]);
            if(owner[0]?.schema_name!==sourceSchema) throw new Error('eval_source_tenant_mismatch');
            return query('SELECT nspname::text AS nspname FROM pg_namespace WHERE starts_with(nspname,$1) ORDER BY nspname LIMIT 100',[`tenant_eval_${tenantId.replace(/-/g,'').slice(0,8)}_`]);
        });
        let count=0;
        for(const {nspname} of candidates) {
            if(!NAMESPACE.test(nspname)) continue;
            const rows=await this.database.transaction(async query=>{
                const marker=await query('SELECT to_regclass($1)::text AS name',[`"${nspname}".__eval_namespace`]);
                if(!marker[0]?.name) return [];
                return query(`SELECT owner_token,expires_at FROM ${quote(nspname)}.__eval_namespace WHERE tenant_id=$1::uuid AND source_schema=$2 AND expires_at<clock_timestamp()`,[tenantId,sourceSchema]);
            });
            if(rows.length!==1) continue;
            await this.dispose({schemaName:nspname,sourceSchema,tenantId,token:rows[0].owner_token,expiresAt:new Date(rows[0].expires_at).toISOString(),tables:[]});
            count++;
        }
        return count;
    }

    private validate(lease: EvalNamespaceLease): void {
        if (!NAMESPACE.test(lease.schemaName) || !UUID.test(lease.tenantId) || !UUID.test(lease.token)) throw new Error('eval_invalid_lease');
    }

    async assertOwned(lease: EvalNamespaceLease): Promise<void> {
        this.validate(lease);
        await this.database.transaction(async query => {
            const rows = await query(`SELECT 1 FROM ${quote(lease.schemaName)}.__eval_namespace WHERE tenant_id=$1::uuid AND owner_token=$2::uuid AND source_schema=$3::text AND expires_at>clock_timestamp()`, [lease.tenantId, lease.token, lease.sourceSchema]);
            if (rows.length !== 1) throw new Error('eval_namespace_lease_lost');
        });
    }

    async dispose(lease: EvalNamespaceLease): Promise<void> {
        this.validate(lease);
        await this.database.transaction(async query => {
            await disposeOwnedEvalNamespace(query,lease);
        });
    }
}

/** Shared teardown for normal completion and source erasure, within the caller's transaction. */
export async function disposeOwnedEvalNamespace(query:EvalNamespaceQuery,lease:EvalNamespaceLease):Promise<void> {
    if (!NAMESPACE.test(lease.schemaName) || !UUID.test(lease.tenantId) || !UUID.test(lease.token)) throw new Error('eval_invalid_lease');
            await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text AS locked', [`eval-namespace:${lease.schemaName}`]);
            const exists = await query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [lease.schemaName]);
            if (!exists.length) return; // Idempotent teardown after a successful drop.
            const owner = await query(`SELECT 1 FROM ${quote(lease.schemaName)}.__eval_namespace WHERE tenant_id=$1::uuid AND owner_token=$2::uuid AND source_schema=$3::text`, [lease.tenantId, lease.token, lease.sourceSchema]);
            if (owner.length !== 1) throw new Error('eval_namespace_owner_mismatch');
            // RESTRICT protects every external dependency (views/functions as
            // well as FKs). Drop the complete internal graph in one statement.
            const tables = await query(`SELECT c.relname::text AS relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p')`, [lease.schemaName]);
            if (tables.length) await query(`DROP TABLE ${tables.map(table => `${quote(lease.schemaName)}.${quote(table.relname)}`).join(',')} RESTRICT`);
            await query(`DROP SCHEMA ${quote(lease.schemaName)} RESTRICT`);
}
