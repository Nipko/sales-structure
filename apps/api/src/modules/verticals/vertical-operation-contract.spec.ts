import {
    VERTICAL_OPERATION_CONTRACT_VERSION,
    listCanonicalSubtypeExperienceProfileIds,
} from '@parallext/shared';
import { STATIC_TOOL_NAMES, isBusinessWriteTool } from '../conversations/tool-policy-registry';
import { buildToolControlCatalog, buildVerticalOperationContract } from './vertical-operation-contract';

describe('CTR-02 operation contracts', () => {
    it('versions object/action/permission/readiness/SoR for every canonical profile', () => {
        const contracts = listCanonicalSubtypeExperienceProfileIds().map((id) => {
            const [industry, subtype] = id.split('/');
            return buildVerticalOperationContract(industry, subtype);
        });
        expect(contracts).toHaveLength(76);
        expect(contracts.every(contract => contract.version === VERTICAL_OPERATION_CONTRACT_VERSION)).toBe(true);

        const actionGaps = contracts.flatMap(contract => contract.actions.flatMap(action => (
            action.gaps.map(gap => `${contract.profileId}:${action.tool}:${gap}`)
        )));
        expect(actionGaps).toEqual([]);
    });

    it('projects the booking writer without weakening its existing controls', () => {
        const contract = buildVerticalOperationContract('turismo', 'alquiler_vacacional');
        const action = contract.actions.find(entry => entry.tool === 'create_property_booking');
        expect(action).toMatchObject({
            family: 'properties',
            effect: 'write',
            commitsBusiness: true,
            activeObject: 'property_booking',
            deepLink: '/admin/stays',
            readiness: 'properties',
            assurance: 'A1',
            confirmation: 'runtime_enforced',
            idempotency: 'central_ledger',
            systemOfRecord: { boundary: 'conditional_provider', owner: 'conditional_binding' },
        });
    });

    it('publishes one complete global control catalog for Ops', () => {
        const catalog = buildToolControlCatalog();
        expect(catalog.version).toBe(VERTICAL_OPERATION_CONTRACT_VERSION);
        expect(catalog.entries.map(entry => entry.tool)).toEqual(STATIC_TOOL_NAMES);
        expect(catalog.entries.flatMap(entry => (
            entry.gaps.map(gap => `${entry.tool}:${gap}`)
        ))).toEqual([]);
        const writersWithoutExplicitClassification = catalog.entries
            .filter(entry => isBusinessWriteTool(entry.tool))
            .filter(entry => !Object.prototype.hasOwnProperty.call(entry, 'activeObject'));
        expect(writersWithoutExplicitClassification).toEqual([]);
    });
});
