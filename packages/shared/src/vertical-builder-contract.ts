export const VERTICAL_BUILDER_CONTRACT_VERSION = 1 as const;

export type VerticalBuilderFieldType = 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'money' | 'reference';
export type VerticalBuilderStatus = 'draft' | 'validated' | 'approved' | 'applied' | 'rolled_back';

export interface VerticalBuilderFieldDefinition {
    key: string;
    label: string;
    type: VerticalBuilderFieldType;
    required: boolean;
    sensitive: boolean;
    referenceObject?: string;
}

export interface VerticalBuilderObjectDefinition {
    key: string;
    label: string;
    fields: VerticalBuilderFieldDefinition[];
}

export interface VerticalBuilderDraftV1 {
    contractVersion: typeof VERTICAL_BUILDER_CONTRACT_VERSION;
    id: string;
    version: number;
    baseIndustry: 'otro';
    status: 'draft';
    objects: VerticalBuilderObjectDefinition[];
    requestedCapabilities: string[];
}

export interface VerticalBuilderPreviewV1 {
    contractVersion: typeof VERTICAL_BUILDER_CONTRACT_VERSION;
    draftId: string;
    draftVersion: number;
    schemaObjects: string[];
    generatedToolNames: string[];
    generatedTestIds: string[];
    destructiveChanges: false;
    warnings: string[];
    requiresExplicitApproval: true;
    applySupported: false;
}

const SAFE_IDENTIFIER = /^[a-z][a-z0-9_]{1,62}$/;
const FIELD_TYPES = new Set<VerticalBuilderFieldType>([
    'text', 'number', 'boolean', 'date', 'datetime', 'money', 'reference',
]);

function validLabel(value: unknown, max = 120): boolean {
    return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

export function validateVerticalBuilderDraft(draft: VerticalBuilderDraftV1): string[] {
    const failures: string[] = [];
    if (draft.contractVersion !== VERTICAL_BUILDER_CONTRACT_VERSION) failures.push('unsupported_contract_version');
    if (draft.baseIndustry !== 'otro') failures.push('base_industry_must_be_otro');
    if (draft.status !== 'draft') failures.push('only_drafts_can_be_previewed');
    if (typeof draft.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(draft.id)) failures.push('invalid_draft_id');
    if (!Number.isInteger(draft.version) || draft.version < 1) failures.push('invalid_version');
    if (!Array.isArray(draft.objects) || draft.objects.length < 1 || draft.objects.length > 8) failures.push('objects_out_of_bounds');
    if (!Array.isArray(draft.requestedCapabilities) || draft.requestedCapabilities.length > 32) {
        failures.push('capabilities_out_of_bounds');
    } else {
        const capabilities = new Set<string>();
        for (const capability of draft.requestedCapabilities) {
            if (!SAFE_IDENTIFIER.test(capability)) failures.push(`invalid_capability:${capability}`);
            if (capabilities.has(capability)) failures.push(`duplicate_capability:${capability}`);
            capabilities.add(capability);
        }
    }

    const objectKeys = new Set<string>();
    for (const object of draft.objects || []) {
        if (!SAFE_IDENTIFIER.test(object.key)) failures.push(`invalid_object_key:${object.key}`);
        if (objectKeys.has(object.key)) failures.push(`duplicate_object_key:${object.key}`);
        objectKeys.add(object.key);
        if (!validLabel(object.label)) failures.push(`invalid_object_label:${object.key}`);
        if (!Array.isArray(object.fields) || object.fields.length < 1 || object.fields.length > 32) {
            failures.push(`fields_out_of_bounds:${object.key}`);
            continue;
        }
        const fieldKeys = new Set<string>();
        for (const field of object.fields) {
            if (!SAFE_IDENTIFIER.test(field.key)) failures.push(`invalid_field_key:${object.key}.${field.key}`);
            if (fieldKeys.has(field.key)) failures.push(`duplicate_field_key:${object.key}.${field.key}`);
            fieldKeys.add(field.key);
            if (!validLabel(field.label)) failures.push(`invalid_field_label:${object.key}.${field.key}`);
            if (!FIELD_TYPES.has(field.type)) failures.push(`invalid_field_type:${object.key}.${field.key}`);
            if (typeof field.required !== 'boolean') failures.push(`invalid_required_flag:${object.key}.${field.key}`);
            if (typeof field.sensitive !== 'boolean') failures.push(`invalid_sensitive_flag:${object.key}.${field.key}`);
            if (field.type === 'reference' && !field.referenceObject) failures.push(`missing_reference:${object.key}.${field.key}`);
            if (field.type !== 'reference' && field.referenceObject) failures.push(`unexpected_reference:${object.key}.${field.key}`);
            if (field.referenceObject && !SAFE_IDENTIFIER.test(field.referenceObject)) failures.push(`invalid_reference:${object.key}.${field.key}`);
        }
    }

    for (const object of draft.objects || []) {
        for (const field of object.fields || []) {
            if (field.referenceObject && !objectKeys.has(field.referenceObject)) {
                failures.push(`unknown_reference:${object.key}.${field.key}`);
            }
        }
    }
    return [...new Set(failures)];
}

export function previewVerticalBuilderDraft(draft: VerticalBuilderDraftV1): VerticalBuilderPreviewV1 {
    const failures = validateVerticalBuilderDraft(draft);
    if (failures.length) throw new Error(`Invalid vertical builder draft: ${failures.join(',')}`);
    return {
        contractVersion: VERTICAL_BUILDER_CONTRACT_VERSION,
        draftId: draft.id,
        draftVersion: draft.version,
        schemaObjects: draft.objects.map((object) => object.key),
        generatedToolNames: draft.objects.flatMap((object) => [
            `list_${object.key}`,
            `get_${object.key}`,
            `create_${object.key}`,
            `update_${object.key}`,
        ]),
        generatedTestIds: draft.objects.flatMap((object) => [
            `builder.${object.key}.tenant_isolation`,
            `builder.${object.key}.ownership`,
            `builder.${object.key}.schema_validation`,
            `builder.${object.key}.rollback`,
        ]),
        destructiveChanges: false,
        warnings: ['apply_runtime_not_implemented', 'migration_and_rollback_required'],
        requiresExplicitApproval: true,
        applySupported: false,
    };
}
