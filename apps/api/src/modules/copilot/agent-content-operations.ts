import type {
    AgentExecutableOperationKey,
    AgentOperationInputMap,
} from '@parallext/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { KnowledgeService } from '../knowledge/knowledge.service';
import type { ComplianceService } from '../compliance/compliance.service';
import type { CatalogService } from '../catalog/catalog.service';
import type { ServicesService } from '../appointments/services.service';

/**
 * The only place an Assist operation turns into a real write.
 *
 * `AGENT_CONTENT_OPERATION_HANDLERS` is a **total map** over
 * `AgentExecutableOperationKey`: a key added to the contract without a handler
 * here does not compile, and a handler here without a key in the contract does
 * not compile either. That is the whitelist, expressed so it cannot rot — there
 * is no service registry to look a name up in, no method resolved from a string,
 * and therefore nothing an unexpected operation name could reach.
 *
 * Each handler delegates to the same service the owning screen calls. Assist is
 * never a second way to write the row with different rules: the plan gate, the
 * validation and the cache invalidation all belong to the module that owns the
 * table, and stay there.
 */

export interface ContentOperationActor {
    id: string;
    role: string;
    /** Present only under impersonation; carries the real operator into audits. */
    delegation?: Record<string, unknown>;
}

export interface ContentOperationContext {
    tenantId: string;
    schemaName: string;
    actor: ContentOperationActor;
    prisma: PrismaService;
    knowledge: KnowledgeService;
    compliance: ComplianceService;
    catalog: CatalogService;
    services: ServicesService;
}

/** What was written, in the terms the reviewer will recognise on the screen. */
export interface CreatedContentObject {
    id: string;
    label: string;
}

export interface ContentOperationHandler<K extends AgentExecutableOperationKey> {
    /**
     * Rows that already exist, for a `plan_limit` gate. Counted the same way the
     * owning screen counts them, so Assist and the screen hit the ceiling at the
     * same row rather than one letting through what the other rejects.
     */
    count?: (context: ContentOperationContext) => Promise<number>;
    /**
     * The label the owning screen passes to `enforcePlanLimit`. Reused verbatim
     * so a plan rejection reads identically whichever path the person took.
     */
    planResourceLabel?: string;
    create: (context: ContentOperationContext, input: AgentOperationInputMap[K]) => Promise<CreatedContentObject>;
    /** Read-back after the write, so the receipt is evidence and not an assumption. */
    read: (context: ContentOperationContext, id: string) => Promise<CreatedContentObject | null>;
    /** The `after` side of the review diff, field by field. */
    preview: (input: AgentOperationInputMap[K]) => Array<{ field: string; value: string | number | boolean }>;
}

const countRows = async (context: ContentOperationContext, sql: string): Promise<number> => {
    // `COUNT(*)::int` rather than the BigInt polyfill: this number is compared
    // against a plan ceiling, and a BigInt would silently fail that comparison.
    const rows = await context.prisma.executeInTenantSchema<any[]>(context.schemaName, sql);
    return Number(rows?.[0]?.c ?? 0);
};

const optional = (field: string, value: string | number | boolean | undefined) =>
    value === undefined ? [] : [{ field, value }];

export const AGENT_CONTENT_OPERATION_HANDLERS: {
    [K in AgentExecutableOperationKey]: ContentOperationHandler<K>;
} = {
    'knowledge.faq.create': {
        planResourceLabel: 'documentos de conocimiento',
        count: context => countRows(context, 'SELECT COUNT(*)::int AS c FROM knowledge_resources'),
        create: async (context, input) => {
            const row = await context.knowledge.createResource(context.schemaName, context.tenantId, {
                title: input.title,
                // Fixed, not taken from the caller: `type` also selects crawl and
                // import behaviour, and Assist writes exactly one kind of thing.
                type: 'faq',
                content: input.content,
            });
            return { id: row.id, label: row.title };
        },
        read: async (context, id) => {
            const rows = await context.prisma.executeInTenantSchema<any[]>(context.schemaName,
                'SELECT id, title FROM knowledge_resources WHERE id = $1::uuid', [id]);
            return rows?.[0] ? { id: rows[0].id, label: rows[0].title } : null;
        },
        preview: input => [
            { field: 'title', value: input.title },
            { field: 'content', value: input.content },
            { field: 'type', value: 'faq' },
        ],
    },

    'policies.legal_text.create': {
        create: async (context, input) => {
            const row = await context.compliance.createLegalText(context.schemaName, {
                tenant_id: context.tenantId,
                name: input.name,
                type: input.type,
                text: input.text,
                channels: ['web'],
                // The one place a handler departs from the owning service's
                // default, and deliberately. An active legal text is served to
                // the tenant's customers as their binding terms; publishing that
                // the instant Assist drafts it would be a customer-facing act,
                // which is exactly what this whole path is built not to do. A
                // person activates it on `/admin/compliance`.
                active: false,
            });
            // The compliance trail is the module's own, and the REST screen
            // writes it on every create. Skipping it here would leave a legal
            // text with no record of who asked for it.
            await context.compliance.logComplianceAction(context.tenantId, 'legal_text.created', 'legal_text_versions', {
                id: row?.id, name: input.name, type: input.type, channels: ['web'], version: row?.version,
                userId: context.actor.id, via: 'parallly_assist', ...context.actor.delegation,
            });
            return { id: row.id, label: row.name };
        },
        read: async (context, id) => {
            const rows = await context.prisma.executeInTenantSchema<any[]>(context.schemaName,
                'SELECT id, name FROM legal_text_versions WHERE id = $1::uuid', [id]);
            return rows?.[0] ? { id: rows[0].id, label: rows[0].name } : null;
        },
        preview: input => [
            { field: 'name', value: input.name },
            { field: 'type', value: input.type },
            { field: 'text', value: input.text },
            // Shown in the diff because it is the surprising part: what is
            // written is a draft, and it is not yet in front of anyone.
            { field: 'active', value: false },
        ],
    },

    'catalogue.course.create': {
        create: async (context, input) => {
            const row = await context.catalog.createCourse(context.schemaName, {
                name: input.name,
                description: input.description,
                ...(input.price === undefined ? {} : { price: input.price }),
                ...(input.currency === undefined ? {} : { currency: input.currency }),
                ...(input.durationHours === undefined ? {} : { duration_hours: input.durationHours }),
                ...(input.modality === undefined ? {} : { modality: input.modality }),
            });
            return { id: row.id, label: row.name };
        },
        read: async (context, id) => {
            const rows = await context.prisma.executeInTenantSchema<any[]>(context.schemaName,
                'SELECT id, name FROM courses WHERE id = $1::uuid', [id]);
            return rows?.[0] ? { id: rows[0].id, label: rows[0].name } : null;
        },
        preview: input => [
            { field: 'name', value: input.name },
            { field: 'description', value: input.description },
            ...optional('price', input.price),
            ...optional('currency', input.currency),
            ...optional('durationHours', input.durationHours),
            ...optional('modality', input.modality),
        ],
    },

    'agenda.service.create': {
        planResourceLabel: 'servicios de agenda',
        count: context => countRows(context, 'SELECT COUNT(*)::int AS c FROM services WHERE is_active = true'),
        create: async (context, input) => {
            const row = await context.services.create(context.schemaName, {
                name: input.name,
                ...(input.description === undefined ? {} : { description: input.description }),
                durationMinutes: input.durationMinutes,
                // A fixed slot is the only shape whose meaning is unambiguous from
                // a sentence. `flexible` and `open` change how the booking engine
                // sells capacity, and that is a decision for the agenda screen.
                durationType: 'fixed',
                ...(input.price === undefined ? {} : { price: input.price }),
                ...(input.currency === undefined ? {} : { currency: input.currency }),
                // `paymentPolicy` is left at the service's own `none` default on
                // purpose: a deposit is money, and Assist must not configure one
                // as a side effect of describing a service.
            }, context.tenantId);
            return { id: row.id, label: row.name };
        },
        read: async (context, id) => {
            const rows = await context.prisma.executeInTenantSchema<any[]>(context.schemaName,
                'SELECT id, name FROM services WHERE id = $1::uuid', [id]);
            return rows?.[0] ? { id: rows[0].id, label: rows[0].name } : null;
        },
        preview: input => [
            { field: 'name', value: input.name },
            ...optional('description', input.description),
            { field: 'durationMinutes', value: input.durationMinutes },
            ...optional('price', input.price),
            ...optional('currency', input.currency),
            { field: 'paymentPolicy', value: 'none' },
        ],
    },
};
