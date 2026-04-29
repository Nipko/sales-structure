// Canonical Parallly representations passed to every adapter.
// Adapters translate to/from the provider's vocabulary internally.

export type CrmProvider = 'hubspot' | 'pipedrive' | 'kommo' | 'zoho' | 'salesforce' | 'mock';

export type CrmEntity = 'contact' | 'lead' | 'deal' | 'activity';

export type SyncDirection = 'outbound' | 'inbound' | 'both';

export type SyncOperation = 'create' | 'update' | 'delete' | 'noop';

export interface CanonicalContact {
    id: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    email?: string;
    phoneE164?: string;
    countryCode?: string;
    company?: string;
    jobTitle?: string;
    customAttributes?: Record<string, unknown>;
    consents?: { whatsapp?: boolean; email?: boolean; marketing?: boolean };
    source?: string;                                  // whatsapp|instagram|messenger|telegram|web
    createdAt?: Date;
}

export interface CanonicalDeal {
    id: string;
    contactId: string;
    title: string;
    pipeline?: string;
    stage: string;                                    // canonical stage name (we map from pipeline_stages.key)
    valueCents?: number;
    currency?: string;                                // ISO 4217
    probability?: number;
    expectedCloseDate?: Date;
    ownerEmail?: string;
    customAttributes?: Record<string, unknown>;
}

// "Activity" = a logged interaction (message, call, note, appointment).
// Used to push WhatsApp conversation history into the CRM timeline so reps see context.
export interface CanonicalActivity {
    id: string;
    contactId: string;
    dealId?: string;
    type: 'message' | 'note' | 'call' | 'meeting' | 'task';
    channel?: string;                                 // whatsapp|instagram|messenger|telegram
    direction?: 'inbound' | 'outbound';
    body: string;                                     // plain text
    occurredAt: Date;
    metadata?: Record<string, unknown>;
}

export interface UpsertResult {
    externalId: string;
    operation: SyncOperation;
    externalUrl?: string;
}

// Pull (initial import) returns a page; cursor is provider-specific opaque string.
export interface PullPage<T> {
    items: T[];
    nextCursor?: string | null;
    total?: number;
}

export interface CrmAdapterContext {
    tenantId: string;
    schemaName: string;
    connectionId: string;
    accessToken: string;
    refreshToken?: string;
    metadata: Record<string, any>;
}
