import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { runInNewContext } from 'vm';

export const FACTORY_PLAN_SOURCE = 'prisma/seed-billing-plans.js' as const;

export interface FactoryPlanContract {
    slug: string;
    sortOrder: number;
    maxAgents: number;
    pipelineStages: number;
    appointmentServices: number;
}

function seedCandidates(): string[] {
    return [...new Set([
        resolve(__dirname, '../../../prisma/seed-billing-plans.js'),
        resolve(process.cwd(), 'prisma/seed-billing-plans.js'),
        resolve(process.cwd(), 'apps/api/prisma/seed-billing-plans.js'),
    ])];
}

export function resolveFactoryPlanSeedPath(): string {
    const path = seedCandidates().find((candidate) => existsSync(candidate));
    if (!path) {
        throw new Error(
            `Factory billing-plan seed not found. Checked: ${seedCandidates().join(', ')}`,
        );
    }
    return path;
}

function readPlanLiteral(seedPath: string): unknown {
    const source = readFileSync(seedPath, 'utf8');
    const declaration = 'const PLANS = ';
    const endComment = '// The runtime source of truth';
    const start = source.indexOf(declaration);
    const end = source.indexOf(endComment, start + declaration.length);
    if (start < 0 || end < 0) {
        throw new Error(
            `Could not locate the PLANS literal in ${seedPath}; refusing to use fallback quotas.`,
        );
    }

    const block = source.slice(start + declaration.length, end).trim();
    const expression = block.endsWith(';') ? block.slice(0, -1) : block;
    try {
        // Evaluate only the isolated literal. The Prisma setup and main() from
        // the seed are never loaded, so this path is deterministic and DB-free.
        return runInNewContext(`(${expression})`, Object.create(null), { timeout: 1_000 });
    } catch (error: any) {
        throw new Error(`Could not parse factory plan contracts from ${seedPath}: ${error?.message}`);
    }
}

function quota(value: unknown, field: string, slug: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < -1) {
        throw new Error(`Plan ${slug} has invalid ${field}: ${String(value)}`);
    }
    return value;
}

/** Load factory plan floors from the real seed without importing Prisma. */
export function loadFactoryPlanContracts(seedPath = resolveFactoryPlanSeedPath()): FactoryPlanContract[] {
    const raw = readPlanLiteral(seedPath);
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error(`Factory plan seed ${seedPath} did not contain a non-empty PLANS array.`);
    }

    const plans = raw.map((plan: any, index): FactoryPlanContract => {
        const slug = typeof plan?.slug === 'string' ? plan.slug.trim() : '';
        if (!slug) throw new Error(`Factory plan at index ${index} has no slug.`);
        if (!plan.features || typeof plan.features !== 'object') {
            throw new Error(`Plan ${slug} has no features object.`);
        }
        return {
            slug,
            sortOrder: quota(plan.sortOrder, 'sortOrder', slug),
            maxAgents: quota(plan.maxAgents, 'maxAgents', slug),
            pipelineStages: quota(plan.features.pipelineStages, 'features.pipelineStages', slug),
            appointmentServices: quota(
                plan.features.appointmentsServices,
                'features.appointmentsServices',
                slug,
            ),
        };
    }).sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug));

    const slugs = new Set(plans.map((plan) => plan.slug));
    if (slugs.size !== plans.length) {
        throw new Error(`Factory plan seed ${seedPath} contains duplicate slugs.`);
    }
    return plans;
}
