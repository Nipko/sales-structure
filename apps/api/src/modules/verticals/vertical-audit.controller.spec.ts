import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { VerticalAuditController } from './vertical-audit.controller';

describe('VerticalAuditController', () => {
    it('is a super-admin-only, guarded platform surface', () => {
        expect(Reflect.getMetadata(ROLES_KEY, VerticalAuditController)).toEqual(['super_admin']);
        expect(Reflect.getMetadata(GUARDS_METADATA, VerticalAuditController)).toHaveLength(2);
    });

    it('returns the derived ledger, explicit internal work and later gates', () => {
        const result = new VerticalAuditController().getNativeBacklog();

        expect(result.success).toBe(true);
        expect(result.data.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(result.data.entries).toHaveLength(54);
        expect(result.data.generatedFrom.profiles).toBe(54);
        expect(result.data.generatedFrom.alerts).toBeGreaterThan(0);
        expect(result.data.internalGates.verified + result.data.internalGates.open)
            .toBeGreaterThan(0);
        expect(Array.isArray(result.data.profilesWithOpenCode)).toBe(true);
        expect(result.data.laterGates).toEqual(expect.objectContaining({
            external: expect.any(Number),
            decision: expect.any(Number),
            expert: expect.any(Number),
        }));
        expect(result.data.certification.entries).toHaveLength(81);
        expect(result.data.certification.version).toBe(1);
        expect(result.data.toolControls.version).toBe(1);
        expect(result.data.toolControls.entries.length).toBeGreaterThan(0);
        expect(result.data.toolControls.entries.flatMap(entry => entry.gaps)).toEqual([]);
    });
});
