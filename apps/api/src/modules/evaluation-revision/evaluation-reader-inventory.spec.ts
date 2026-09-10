import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AGENT_TEST_SAFE_TOOL_NAMES } from '../conversations/agent-test-tool-policy';
import { CANONICAL_EVAL_TOOLS, CANONICAL_EVAL_TOOL_FAMILIES } from '../simulation/isolated-eval-namespace';
import { EVALUATION_CONTEXT_READS, EVALUATION_TOOL_READ_GROUPS } from './evaluation-reader-inventory';
import { SERVICE_CATALOG_COLUMNS } from './evaluation-service-catalog-capture';

describe('evaluation read inventory coverage', () => {
    it('accounts for every executable read, without duplicating or silently ignoring a new tool', () => {
        const names = EVALUATION_TOOL_READ_GROUPS.flatMap(group => [...group.tools]);
        expect(names.length).toBe(new Set(names).size);
        expect(names.sort()).toEqual([...AGENT_TEST_SAFE_TOOL_NAMES].sort());
        for (const group of EVALUATION_TOOL_READ_GROUPS) expect(group.readers.length).toBeGreaterThan(0);
    });
    it('accounts separately for all domain writers and the three guarded readers added by the namespace adapter', () => {
        const extra = [...CANONICAL_EVAL_TOOLS].filter(tool => !AGENT_TEST_SAFE_TOOL_NAMES.includes(tool));
        expect(extra.sort()).toEqual(['check_availability', 'get_appointment_details', 'list_customer_appointments', ...Object.keys(CANONICAL_EVAL_TOOL_FAMILIES)].sort());
        expect(EVALUATION_CONTEXT_READS.find(port => port.port === 'canonical_commands')?.boundary).toBe('owned_namespace');
    });
    it('does not silently narrow the pilot projection if the canonical service reader adds a field or predicate', () => {
        const source = readFileSync(resolve(__dirname, '../conversations/ai-tool-executor.service.ts'), 'utf8');
        const body = source.slice(source.indexOf('private async listServices('), source.indexOf('private async getTenantTimezone('));
        const sql = body.match(/`SELECT ([\s\S]*?)FROM "\$\{schema\}"\.services ([\s\S]*?)`/);
        expect(sql).not.toBeNull();
        expect(sql![1].split(',').map(value => value.trim())).toEqual([...SERVICE_CATALOG_COLUMNS]);
        expect(sql![2].replace(/\s+/g, ' ').trim()).toBe('WHERE is_active = true AND (is_public IS NULL OR is_public = true) ORDER BY sort_order, name');
    });
});
