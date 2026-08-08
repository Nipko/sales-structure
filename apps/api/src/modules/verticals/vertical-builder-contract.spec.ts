import {
    previewVerticalBuilderDraft,
    validateVerticalBuilderDraft,
    VERTICAL_BUILDER_CONTRACT_VERSION,
    type VerticalBuilderDraftV1,
} from '@parallext/shared';

const validDraft = (): VerticalBuilderDraftV1 => ({
    contractVersion: VERTICAL_BUILDER_CONTRACT_VERSION,
    id: 'draft-1',
    version: 1,
    baseIndustry: 'otro',
    status: 'draft',
    requestedCapabilities: ['crm_pipeline'],
    objects: [{
        key: 'work_items',
        label: 'Work items',
        fields: [
            { key: 'title', label: 'Title', type: 'text', required: true, sensitive: false },
            { key: 'amount', label: 'Amount', type: 'money', required: false, sensitive: false },
        ],
    }],
});

describe('Vertical builder contract v1', () => {
    it('produces a bounded preview and never enables apply implicitly', () => {
        const preview = previewVerticalBuilderDraft(validDraft());
        expect(preview.schemaObjects).toEqual(['work_items']);
        expect(preview.generatedToolNames).toEqual([
            'list_work_items', 'get_work_items', 'create_work_items', 'update_work_items',
        ]);
        expect(preview.generatedTestIds).toHaveLength(4);
        expect(preview.destructiveChanges).toBe(false);
        expect(preview.requiresExplicitApproval).toBe(true);
        expect(preview.applySupported).toBe(false);
    });

    it('fails closed for unsafe identifiers, duplicate fields and unknown references', () => {
        const draft = validDraft();
        draft.objects[0].key = 'Bad-Key';
        draft.objects[0].fields.push(
            { key: 'title', label: 'Duplicate', type: 'text', required: false, sensitive: false },
            { key: 'owner', label: 'Owner', type: 'reference', required: false, sensitive: true, referenceObject: 'missing' },
        );
        expect(validateVerticalBuilderDraft(draft)).toEqual(expect.arrayContaining([
            'invalid_object_key:Bad-Key',
            'duplicate_field_key:Bad-Key.title',
            'unknown_reference:Bad-Key.owner',
        ]));
        expect(() => previewVerticalBuilderDraft(draft)).toThrow('Invalid vertical builder draft');
    });

    it('bounds capabilities and validates runtime field flags/types', () => {
        const draft = validDraft() as any;
        draft.requestedCapabilities = ['crm_pipeline', 'crm_pipeline', 'Bad capability'];
        draft.objects[0].fields[0] = {
            key: 'title', label: '', type: 'executable_code', required: 'yes', sensitive: null,
            referenceObject: 'work_items',
        };
        expect(validateVerticalBuilderDraft(draft)).toEqual(expect.arrayContaining([
            'duplicate_capability:crm_pipeline',
            'invalid_capability:Bad capability',
            'invalid_field_label:work_items.title',
            'invalid_field_type:work_items.title',
            'invalid_required_flag:work_items.title',
            'invalid_sensitive_flag:work_items.title',
            'unexpected_reference:work_items.title',
        ]));
    });
});
