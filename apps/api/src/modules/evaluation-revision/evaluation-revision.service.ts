import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import type { ProcedureDefinition } from '@parallext/shared';
import { evaluationArtifactHash } from './evaluation-artifact';
import { assertRevisionIntegrity, EVALUATION_OUTPUT_TABLES, revisionHash, revisionIgnoredColumns,
    sealRevision, type EvaluationDependency, type EvaluationRevisionManifest } from './evaluation-revision';

const PUBLIC_DEPENDENCIES = [
    ['tenants', 'id'], ['users', 'tenant_id'], ['channel_accounts', 'tenant_id'],
    ['widget_configs', 'tenant_id'], ['tenant_payment_provider_configs', 'tenant_id'],
    ['billing_plans', null], ['platform_settings', null],
] as const;
const safeIdentifier = (name: string): string => {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('evaluation_dependency_identifier_unknown');
    return `"${name}"`;
};

@Injectable()
export class EvaluationRevisionService {
    constructor(private readonly prisma: PrismaService, private readonly router: LLMRouterService) {}

    async capture(tenantId: string): Promise<EvaluationRevisionManifest> {
        try {
            const routing = await this.router.evaluationRoutingSignature();
            const manifest = await this.prisma.$transaction(async (tx: any) => {
                // A coherent MVCC read, never a sequence of independently committed signatures.
                const tenants = await tx.$queryRawUnsafe('SELECT schema_name FROM public.tenants WHERE id = $1::uuid', tenantId);
                const schema = tenants[0]?.schema_name;
                if (!schema || !/^tenant_[a-z0-9_]+$/.test(schema)) throw new Error('evaluation_tenant_scope_unavailable');
                const relations: Array<{ name: string; kind: string }> = await tx.$queryRawUnsafe(
                    `SELECT c.relname AS name, c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                     WHERE n.nspname=$1 AND c.relkind IN ('r','p','v','m','f') ORDER BY c.relname`, schema);
                const dependencies: EvaluationDependency[] = [];
                const exclusions: string[] = [];
                const structure = await tx.$queryRawUnsafe(`SELECT encode(sha256(convert_to(COALESCE(string_agg(definition, ',' ORDER BY definition),''),'UTF8')),'hex') AS hash FROM (
                    SELECT c.relname || ':' || a.attname || ':' || format_type(a.atttypid,a.atttypmod) || ':' || a.attnotnull::text
                        || ':' || COALESCE(pg_get_expr(d.adbin,d.adrelid),'') AS definition
                    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
                    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
                    WHERE n.nspname=$1 AND a.attnum>0 AND NOT a.attisdropped AND NOT(c.relname=ANY($2::text[]))
                    UNION ALL SELECT c.relname || ':' || pg_get_constraintdef(k.oid) FROM pg_constraint k
                    JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname=$1 AND NOT(c.relname=ANY($2::text[]))
                    UNION ALL SELECT c.relname || ':' || pg_get_triggerdef(t.oid) FROM pg_trigger t
                    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname=$1 AND NOT t.tgisinternal AND NOT(c.relname=ANY($2::text[]))
                    UNION ALL SELECT p.proname || ':' || p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                    WHERE n.nspname=$1) definitions`,schema,[...EVALUATION_OUTPUT_TABLES]);
                if (!structure[0]?.hash) throw new Error('evaluation_dependency_signature_unavailable');
                dependencies.push({key:'database.structure',state:'present',hash:revisionHash(structure[0].hash)});
                for (const table of relations) {
                    if (EVALUATION_OUTPUT_TABLES.has(table.name)) { exclusions.push(`tenant.${table.name}`); continue; }
                    if (!['r','p'].includes(table.kind)) throw new Error(`evaluation_dependency_unversioned:tenant.${table.name}`);
                    dependencies.push(await this.tableSignature(tx, schema, table.name, `tenant.${table.name}`, revisionIgnoredColumns(table.name)));
                }
                // A missing relation is distinguishable from an unreadable relation; errors never mean absence.
                for (const name of ['agent_personas','persona_config','companies','procedures','faqs','policies',
                    'knowledge_documents','knowledge_embeddings','knowledge_document_versions','knowledge_resources','knowledge_chunks','knowledge_approvals']) {
                    if (!relations.some(row => row.name === name)) dependencies.push({key:`tenant.${name}`,state:'absent',hash:revisionHash(null),rows:0});
                }
                for (const [table, scope] of PUBLIC_DEPENDENCIES) {
                    const rows = await tx.$queryRawUnsafe('SELECT to_regclass($1)::text AS relation', `public.${table}`);
                    if (!rows[0]?.relation) { dependencies.push({key:`public.${table}`,state:'absent',hash:revisionHash(null),rows:0}); continue; }
                    const omit = table === 'users' ? ['password','last_login_at','last_active_at','updated_at','two_factor_secret','email_verified_at'] : [];
                    dependencies.push(await this.tableSignature(tx,'public',table,`public.${table}`,omit,scope ? `${safeIdentifier(scope)}::text = $2::uuid::text` : undefined, tenantId));
                }
                dependencies.push({key:'runtime.artifact_templates_tools_rubrics',state:'present',hash:evaluationArtifactHash()},
                    {key:'runtime.model_routing',state:'present',hash:routing});
                return sealRevision(tenantId,dependencies,exclusions);
            }, { isolationLevel: 'RepeatableRead', timeout: 60_000 });
            if (routing !== await this.router.evaluationRoutingSignature()) throw new Error('evaluation_dependencies_changed:runtime.model_routing');
            return manifest;
        } catch (error: any) {
            // Do not serialize SQL, customer values or credential-bearing error messages into a run.
            if (/^evaluation_[a-z_]+(?::[a-z_.]+)?$/.test(String(error?.message))) throw error;
            throw new Error('evaluation_dependencies_unavailable');
        }
    }

    async assertCurrent(manifest?: EvaluationRevisionManifest): Promise<void> {
        assertRevisionIntegrity(manifest);
        const current = await this.capture(manifest.tenantId);
        // Frozen inputs have their own content hashes, checked against the private snapshot at every turn.
        const liveRevision = sealRevision(manifest.tenantId,manifest.dependencies.filter(item=>!item.key.startsWith('frozen.')),manifest.exclusions);
        if (current.revision !== liveRevision.revision) {
            const changed = current.dependencies.filter(item => !manifest.dependencies.some(old => old.key === item.key && old.hash === item.hash && old.state === item.state))
                .map(item => item.key);
            throw new Error(`evaluation_dependencies_changed:${changed.slice(0,8).join(',') || 'inventory'}`);
        }
    }

    /** Private snapshot data. A missing table is verified; a failed read is never converted to an empty workflow set. */
    async captureProcedures(tenantId: string): Promise<ProcedureDefinition[]> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        const exists = await this.prisma.executeInTenantSchema<any[]>(schema,
            'SELECT to_regclass($1)::text AS relation', [`${schema}.procedures`]);
        if (!exists[0]?.relation) return [];
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            'SELECT id, name, trigger, steps, status, version, vertical FROM procedures ORDER BY id');
        return rows.map(row => ({ id:row.id, name:row.name, trigger:row.trigger || {keywords:[]},
            steps:Array.isArray(row.steps) ? row.steps : [], status:row.status, version:Number(row.version) || 1,
            vertical:row.vertical || undefined }));
    }

    private async tableSignature(tx: any, schema: string, table: string, key: string, ignored: readonly string[], where?: string, tenantId?: string): Promise<EvaluationDependency> {
        const params: unknown[] = [ignored];
        if (where) params.push(tenantId);
        // PostgreSQL hashes each complete row, including vectors, before aggregation. Neither rows nor secrets leave the DB.
        const rows = await tx.$queryRawUnsafe(`SELECT COUNT(*)::text AS rows,
            encode(sha256(convert_to(COALESCE(string_agg(row_hash, ',' ORDER BY row_hash), ''),'UTF8')),'hex') AS hash
            FROM (SELECT encode(sha256(convert_to((to_jsonb(t) - $1::text[])::text
                || CASE WHEN to_jsonb(t) ?| $1::text[] THEN '' ELSE ':' || t.xmin::text END,'UTF8')),'hex') AS row_hash
                FROM ${safeIdentifier(schema)}.${safeIdentifier(table)} t ${where ? `WHERE ${where}` : ''}) signatures`, ...params);
        if (!rows[0]?.hash || !Number.isFinite(Number(rows[0]?.rows))) throw new Error('evaluation_dependency_signature_unavailable');
        return {key,state:'present',hash:revisionHash({hash:rows[0].hash,rows:String(rows[0].rows)}),rows:Number(rows[0].rows)};
    }
}
