import * as fs from 'fs';
import * as path from 'path';
import {
    AGENT_HANDOFF_RETURN_PARAM, AGENT_OPERATION_REGISTRY, buildAgentHandoff,
    resolutionForIssueCode, routedAgentOperations,
} from '@parallext/shared';

/**
 * The other half of F2: the eight operations Assist does not perform have to be
 * a handoff, not a shrug.
 *
 * The directive asks, for the external and sensitive ones, to "recopilar
 * requisitos no secretos, validar preparación, conservar el contexto, abrir la
 * pantalla exacta preconfigurada y volver a Assist con el resultado
 * actualizado". Each of those is a field on the routed operation now, and this
 * is what stops them being decoration.
 *
 * The first `describe` is the one that found real damage. The registry's own
 * header says the targets are "named so the whitelist can be audited line by
 * line against the code it calls" — but nothing calls a routed operation, so
 * four of them had drifted to services and tables that do not exist:
 * `ChannelManagementService`, `AuthService.updateUser`, `agent_publications`
 * and `TenantPaymentsService.saveConfig`. A handoff that names the wrong owner
 * is a handoff nobody can audit.
 */

const MODULES = path.resolve(__dirname, '..');

function moduleSource(moduleName: string): string {
    const directory = path.join(MODULES, moduleName);
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, item.name);
            if (item.isDirectory()) walk(full);
            else if (item.name.endsWith('.ts') && !item.name.endsWith('.spec.ts')) files.push(full);
        }
    };
    walk(directory);
    return files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
}

describe('every declared operation names code that exists', () => {
    it('finds the class and the method in the module it claims', () => {
        const wrong: string[] = [];
        for (const definition of AGENT_OPERATION_REGISTRY) {
            const { module, service, method } = definition.target;
            let source: string;
            try {
                source = moduleSource(module);
            } catch {
                wrong.push(`${definition.key}: module ${module} does not exist`);
                continue;
            }
            if (!new RegExp(`export class ${service}\\b`).test(source)) {
                wrong.push(`${definition.key}: ${module} has no class ${service}`);
                continue;
            }
            // Overloads, decorators and `private` all read the same way here:
            // the method has to appear as a declaration in that module.
            if (!new RegExp(`(^|\\s)(async\\s+)?${method}\\s*[(<]`, 'm').test(source)) {
                wrong.push(`${definition.key}: ${module} has no method ${method}`);
            }
        }
        expect({ wrong }).toEqual({ wrong: [] });
    });

    it('names a table the tenant schema or the global schema really has', () => {
        // `public.` marks a global table, which lives in schema.prisma;
        // everything else is a tenant table and has to be in the template the
        // tenant schemas are built from. Getting the half wrong is not
        // cosmetic — it is the difference between a row every tenant shares and
        // a row that belongs to one. `channel_accounts` is global and the
        // registry called it a tenant table, which is what this caught.
        const template = fs.readFileSync(path.resolve(MODULES, '../../prisma/tenant-schema.sql'), 'utf8');
        const globalSchema = fs.readFileSync(path.resolve(MODULES, '../../prisma/schema.prisma'), 'utf8');
        const missing: string[] = [];
        for (const definition of AGENT_OPERATION_REGISTRY) {
            const table = definition.target.table;
            if (table.startsWith('public.')) {
                const bare = table.slice('public.'.length);
                if (!globalSchema.includes(`@@map("${bare}")`)) missing.push(`${definition.key}: ${table}`);
                continue;
            }
            if (new RegExp(`"${table}"|CREATE TABLE IF NOT EXISTS ${table}\\b`).test(template)) continue;
            // A table created lazily by its own module is legitimate.
            if (new RegExp(`(CREATE TABLE IF NOT EXISTS|INSERT INTO)\\s+${table}\\b`)
                .test(moduleSource(definition.target.module))) continue;
            missing.push(`${definition.key}: ${table}`);
        }
        expect({ missing }).toEqual({ missing: [] });
    });
});

describe('the handoff to the screen that owns the decision', () => {
    it('declares requirements, readiness and a result for all eight', () => {
        const routed = routedAgentOperations();
        expect(routed).toHaveLength(8);
        for (const definition of routed) {
            expect(Array.isArray(definition.requirements)).toBe(true);
            expect(Array.isArray(definition.readiness)).toBe(true);
            expect(typeof definition.resultCheck).toBe('string');
            // A readiness code or a result the resolution table does not know
            // is a code the person can be shown with nothing to do about it.
            for (const code of definition.readiness) expect(resolutionForIssueCode(code)).not.toBeNull();
            if (definition.resultCheck !== 'assessment') {
                expect(resolutionForIssueCode(definition.resultCheck)).not.toBeNull();
            }
        }
    });

    it('never declares a requirement that would be a secret', () => {
        // The structural half of the boundary. `setConfig` takes an access
        // token, a private key and two webhook secrets; if any of them could be
        // declared as something Assist gathers, the whole reason this operation
        // is routed rather than executable would be gone.
        const forbidden = /token|secret|password|key|credential|pin/i;
        for (const definition of routedAgentOperations()) {
            for (const requirement of definition.requirements) {
                expect(`${definition.key}.${requirement.key}`).not.toMatch(forbidden);
            }
        }
    });

    it('opens the exact screen, preconfigured with what it was told', () => {
        const result = buildAgentHandoff('channels.account.connect', { channelType: 'whatsapp' });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.plan.href).toBe(`/admin/channels?type=whatsapp&${AGENT_HANDOFF_RETURN_PARAM}=channels.account.connect`);
        expect(result.plan.collected).toEqual({ channelType: 'whatsapp' });
        expect(result.plan.resultCheck).toBe('channel_connection');
        expect(result.plan.reason).toBe('oauth_round_trip_required');
    });

    it('keeps the context even when the screen honours no parameter of its own', () => {
        // `roles.member.grant` gathers a role and the users screen reads no
        // parameter for it. The value is still carried in `collected` so the
        // chat can say what the person came to do, and the return marker is
        // still there so they come back to the same conversation.
        const result = buildAgentHandoff('roles.member.grant', { role: 'tenant_agent' });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.plan.href).toBe(`/admin/users?${AGENT_HANDOFF_RETURN_PARAM}=roles.member.grant`);
        expect(result.plan.collected).toEqual({ role: 'tenant_agent' });
    });

    it('refuses rather than guessing, and says which field', () => {
        const missing = buildAgentHandoff('channels.account.connect', {});
        expect(missing.ok).toBe(false);
        if (missing.ok) return;
        expect(missing.refusal.missing).toEqual(['channelType']);

        const invalid = buildAgentHandoff('channels.account.connect', { channelType: 'sms' });
        expect(invalid.ok).toBe(false);
        if (invalid.ok) return;
        // SMS is not a conversational channel any more. A handoff that passed it
        // through would land the person on a screen that refuses them.
        expect(invalid.refusal.invalid).toEqual(['channelType']);
    });

    it('never forwards a field nobody declared', () => {
        const result = buildAgentHandoff('roles.member.grant',
            { role: 'tenant_agent', accessToken: 'sk-live-should-never-travel' });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.plan.href).not.toContain('sk-live');
        expect(result.plan.collected).toEqual({ role: 'tenant_agent' });
    });

    it('bounds a free-text value instead of putting it in a URL', () => {
        // No routed operation declares free text today, so the rule is checked
        // against the builder rather than against a declaration that could be
        // removed. It is the guard that has to exist before one is added.
        const long = 'x'.repeat(200);
        const result = buildAgentHandoff('channels.account.connect', { channelType: long });
        expect(result.ok).toBe(false);
    });

    it('reports the readiness that is not met, so the trip is not wasted', () => {
        const notReady = buildAgentHandoff('publication.agent.publish', {},
            ['channel_assignment', 'business_hours']);
        expect(notReady.ok).toBe(true);
        if (!notReady.ok) return;
        // Only the codes this operation actually depends on, not everything the
        // agent happens to be failing.
        expect(notReady.plan.readiness).toEqual(['channel_assignment']);

        const ready = buildAgentHandoff('publication.agent.publish', {}, []);
        expect(ready.ok && ready.plan.readiness).toEqual([]);
    });

    it('will not hand off to something Assist can already do', () => {
        // An executable operation reached through this path would skip the
        // proposal, the diff and the review the whole content path is built on.
        const executable = buildAgentHandoff('knowledge.faq.create', {});
        expect(executable.ok).toBe(false);
        expect(buildAgentHandoff('made.up.operation', {}).ok).toBe(false);
    });
});
