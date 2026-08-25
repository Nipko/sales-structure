// ===================================
// Parallext Engine - Shared Types
// ===================================

// ---- Timezones (worldwide curated IANA list) ----
export * from './timezones';

// ---- Versioned vertical operational contract ----
export * from './vertical-capability-manifest';
export * from './vertical-product-policy';
export * from './vertical-builder-contract';
export * from './automation-trigger-contract';
export * from './agent-quality-contract';

// ---- Read semantics for agent tools (empty vs stale vs error) ----
export * from './tool-read-result';

// ---- Operating identity, separated from billing identity ----
export * from './tenant-regional-profile';

// ---- Country language behaviour packs (recognition, not generation) ----
export * from './country-language-pack';

// ---- The single registry for what a subtype is ----
export * from './subtype-experience-profile';
export * from './subtype-taxonomy-migration';
export * from './vertical-domain-contract';
export * from './vertical-certification-contract';
export * from './vertical-operation-contract';
export * from './resource-rental-details';
export * from './integration-scaffolding';
export * from './runtime-config-compatibility';
export * from './system-of-record-policy';

// ---- Effective agent capability: subtype x agent x plan x readiness ----
export * from './effective-capability-contract';
export * from './provider-integration-policy';

// ---- Navigation semantics: two objects never share a label ----
export * from './navigation-semantics';
export * from './agent-skillset-policy';

// ---- Plan gating for navigation: no visible option that ends in 403 ----
export * from './navigation-plan-gate';

// ---- Operating is not managing the catalogue ----
export * from './navigation-surface-kind';

// ---- Where a human opens the object the agent is talking about ----
export * from './active-object-deep-link';

// ---- Counting the dead ends Gate 4 says must not exist ----
export * from './navigation-telemetry';

// ---- What each profile calls the things it works with ----
export * from './subtype-terminology';
export * from './eval-phrase';
export * from './subtype-eval-pack';
export * from './subtype-eval-derivation';

// ---- Channel Types ----
export type ChannelType = 'whatsapp' | 'instagram' | 'messenger' | 'telegram' | 'sms' | 'email' | 'web_widget';
/** Certified two-way conversational surfaces available to live Agent Test. */
export type ConversationalChannelType = Exclude<ChannelType, 'sms' | 'email'>;

export type MessageContentType = 'text' | 'image' | 'audio' | 'video' | 'document' | 'location' | 'sticker' | 'reaction';

export type MessageDirection = 'inbound' | 'outbound';

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface NormalizedMessage {
    id: string;
    tenantId: string;
    channelType: ChannelType;
    channelAccountId: string;
    contactId: string;
    conversationId: string;
    direction: MessageDirection;
    content: MessageContent;
    timestamp: Date;
    status: MessageStatus;
    metadata: Record<string, unknown>;
}

export interface MessageContent {
    type: MessageContentType;
    text?: string;
    mediaUrl?: string;
    mimeType?: string;
    caption?: string;
    latitude?: number;
    longitude?: number;
    filename?: string;
}

export interface OutboundMessage {
    tenantId: string;
    to: string;
    channelType: ChannelType;
    channelAccountId: string;
    content: MessageContent;
    metadata?: Record<string, unknown>;
    /**
     * Stable identity of this logical reply, used as the BullMQ jobId so the
     * same reply is never queued twice. Derived from the inbound turn (provider
     * message id + a per-turn sequence), so replaying a turn — a retry, or a
     * queue-backed re-run after a restart — re-derives the SAME ids and BullMQ
     * drops the duplicates. Omit for sends with no natural identity (broadcasts
     * already carry their own dedupe upstream).
     */
    dedupeId?: string;
}

// ---- LLM Router Types ----
export type ModelTier = 'tier_1_premium' | 'tier_2_standard' | 'tier_3_efficient' | 'tier_4_budget';

export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'xai' | 'deepseek';

export interface LLMModel {
    id: string;
    provider: LLMProvider;
    name: string;
    tier: ModelTier;
    costPer1kTokens: number;
    maxContextTokens: number;
    supportsTools: boolean;
    supportsVision: boolean;
}

export interface RoutingFactors {
    ticketValue: number;        // 0-100 score
    complexity: number;         // 0-100 score
    conversationStage: number;  // 0-100 score
    sentiment: number;          // 0-100 score
    intentType: number;         // 0-100 score
}

export interface RoutingWeights {
    ticketValue: number;
    complexity: number;
    conversationStage: number;
    sentiment: number;
    intentType: number;
}

export interface RoutingDecision {
    selectedTier: ModelTier;
    selectedModel: LLMModel;
    compositeScore: number;
    factors: RoutingFactors;
    reasoning: string;
}

// ---- Conversation Types ----
export type ConversationStatus = 'active' | 'waiting_human' | 'with_human' | 'resolved' | 'archived';

export type ConversationStage = 'greeting' | 'discovery' | 'negotiation' | 'closing' | 'support' | 'complaint';

export interface Conversation {
    id: string;
    tenantId: string;
    contactId: string;
    channelType: ChannelType;
    channelAccountId: string;
    status: ConversationStatus;
    stage: ConversationStage;
    assignedTo?: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}

// ---- Structured human handoff contract ----
export interface HandoffSourceCitation {
    type: 'message' | 'knowledge' | 'trace' | 'system';
    id: string;
    label: string;
    citation: string;
}

export interface HandoffToolOutcome {
    tool: string;
    status: 'success' | 'failed' | 'unknown';
    outcome: string;
    occurredAt?: string;
}

export interface StructuredHandoffSummary {
    version: 1;
    reason: string;
    customerIntent: string;
    knownFacts: string[];
    sources: HandoffSourceCitation[];
    lastToolOutcomes: HandoffToolOutcome[];
    pendingActions: string[];
    confidence: number;
    uncertainty: string[];
    language: string;
    traceId: string;
    generatedAt: string;
    generatedBy: 'llm' | 'deterministic_fallback';
}

export interface ConversationAssignedEvent {
    tenantId: string;
    schemaName: string;
    conversationId: string;
    agentId: string;
    contactId?: string;
    phone?: string;
    assignmentSource: 'manual' | 'auto';
    assignedAt: string;
}

// ---- Tenant / Persona Types ----
export type EditorMode = 'guided' | 'prompt';

export interface TenantConfig {
    id: string;
    name: string;
    slug: string;
    industry: string;
    language: string;
    isActive: boolean;
    persona: PersonaConfig;
    behavior: BehaviorConfig;
    llm: LLMConfig;
    rag: RAGConfig;
    hours: BusinessHoursConfig;
    editorMode?: EditorMode;
    customPrompt?: string;
    tools?: ToolsConfig;
    /** Dual-skillset (T2.17): whether the agent sells, supports, or both. Default 'both'. */
    skillset?: AgentSkillset;
    /** Upsell/cross-sell behavior (T2.17), only meaningful for sales/both skillsets. */
    upsell?: UpsellConfig;
}

/** T2.17 — the agent's primary skillset. */
export type AgentSkillset = 'sales' | 'support' | 'both';

/** T2.17 — proactive upsell / cross-sell configuration. */
export interface UpsellConfig {
    enabled: boolean;
    /** How assertive the upsell should be. Default 'subtle'. */
    intensity?: 'subtle' | 'moderate' | 'aggressive';
    /** Max discount % the agent may offer via apply_discount (0 disables). */
    maxDiscountPercent?: number;
}

export interface PersonaConfig {
    name: string;
    role: string;
    personality: {
        tone: string;
        formality: string;
        emojiUsage: 'none' | 'minimal' | 'moderate' | 'heavy';
        humor: string;
    };
    greeting: string;
    fallbackMessage: string;
}

export interface BehaviorConfig {
    rules: string[];
    requiredFields: Record<string, RequiredField[]>;
    forbiddenTopics: string[];
    handoffTriggers: string[];
}

export interface RequiredField {
    field: string;
    question: string;
    validation?: string;
}

export interface LLMConfig {
    temperature: number;
    maxTokens: number;
    routing: {
        tiers: Record<ModelTier, { models: string[]; costLevel: string }>;
        factors: Record<string, { weight: number;[key: string]: unknown }>;
        fallback: 'auto_upgrade' | 'default_model';
    };
    memory: {
        shortTerm: number;
        longTerm: boolean;
        summaryAfter: number;
    };
}

export interface RAGConfig {
    enabled: boolean;
    chunkSize: number;
    chunkOverlap: number;
    topK: number;
    similarityThreshold: number;
}

export interface BusinessHoursConfig {
    timezone: string;
    schedule: Record<string, string>;
    afterHoursMessage: string;
    aiOutsideHours?: boolean;
    afterHoursMessageOverride?: string;
}

export interface ToolsConfig {
    appointments?: {
        enabled: boolean;
        canBook?: boolean;
        canCancel?: boolean;
        emailConfirmations?: boolean;
    };
    catalog?: {
        enabled: boolean;
        canCheckStock?: boolean;
    };
    faqs?: {
        enabled: boolean;
    };
    policies?: {
        enabled: boolean;
    };
    knowledge?: {
        enabled: boolean;
    };
    orders?: {
        enabled: boolean;
        emailConfirmations?: boolean;
    };
    /** E-commerce sales tools (T2.17): recommend_products / get_order_status / apply_discount. */
    ecommerce?: {
        enabled: boolean;
        canRecommend?: boolean;
        canApplyDiscount?: boolean;
    };
    /** Tenant-owned hosted checkout links for purchases made by its customers. */
    payments?: {
        enabled: boolean;
        canCreateLinks?: boolean;
    };
    offers?: {
        enabled: boolean;
    };
    crm?: {
        enabled: boolean;
    };
    properties?: {
        enabled: boolean;
        emailConfirmations?: boolean;
    };
    tours?: {
        enabled: boolean;
        emailConfirmations?: boolean;
    };
    treatments?: {
        enabled: boolean;
        emailConfirmations?: boolean;
    };
    realEstate?: {
        enabled: boolean;
        emailConfirmations?: boolean;
    };
    pets?: {
        enabled: boolean;
        emailConfirmations?: boolean;
    };
    restaurants?: {
        enabled: boolean;
        emailConfirmations?: boolean;
    };
    gyms?: {
        enabled: boolean;
        emailConfirmations?: boolean;
    };
    education?: {
        enabled: boolean;
        emailConfirmations?: boolean;
    };
    insurance?: {
        enabled: boolean;
        emailConfirmations?: boolean;
    };
    homeServices?: {
        enabled: boolean;
        emailConfirmations?: boolean;
    };
    petServices?: {
        enabled: boolean;
        emailConfirmations?: boolean;
    };
    /**
     * Vehicle inventory tools. Dashboard and runtime have always read this key;
     * it was simply missing from the shared contract, so every consumer had to
     * widen the type by hand.
     */
    vehicles?: {
        enabled: boolean;
        emailConfirmations?: boolean;
    };
    /** Vehicle rental writer over `resource_rentals` (`automotriz/alquiler`). */
    vehicleRentals?: {
        enabled: boolean;
        emailConfirmations?: boolean;
    };
    /** Daycare / boarding writer over `resource_rentals` (`pet_services`). */
    petBoarding?: {
        enabled: boolean;
        emailConfirmations?: boolean;
    };
    photography?: {
        enabled: boolean;
        emailConfirmations?: boolean;
    };
    professionalServices?: {
        enabled: boolean;
    };
}

// ---- Tool Types ----
export type ToolType = 'internal' | 'external';

export interface ToolConfig {
    name: string;
    description: string;
    type: ToolType;
    endpoint?: string;
    auth?: string;
    parameters?: ToolParameter[];
}

export interface ToolParameter {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'date';
    required: boolean;
    description: string;
}

// ---- Contact Types ----
export interface Contact {
    id: string;
    tenantId: string;
    externalId: string;
    channelType: ChannelType;
    name?: string;
    phone?: string;
    email?: string;
    metadata: Record<string, unknown>;
    firstContactAt: Date;
    lastContactAt: Date;
}

// ---- Analytics Types ----
export type AnalyticsEventType =
    | 'conversation_started'
    | 'conversation_resolved'
    | 'message_sent'
    | 'message_received'
    | 'handoff_triggered'
    | 'tool_executed'
    | 'order_created'
    | 'payment_received'
    | 'model_used'
    // Navegación: lo excepcional. Un 403 y un callejón sin salida son raros
    // por construcción, y si dejan de serlo eso es el hallazgo.
    | 'navigation.access_denied'
    | 'navigation.dead_end'
    | 'navigation.plan_locked'
    // Y el esfuerzo. Los tres de arriba cuentan tropiezos: dicen si algo está
    // roto, no si encontrar las cosas cuesta. Un menú donde todo funciona y
    // nada se encuentra produce cero eventos y usuarios que se van. Éstos se
    // emiten una vez por EPISODIO, no por vista.
    | 'navigation.task_reached'
    | 'navigation.backtracked'
    | 'navigation.search_used';

export interface AnalyticsEvent {
    id: string;
    tenantId: string;
    eventType: AnalyticsEventType;
    conversationId?: string;
    contactId?: string;
    data: Record<string, unknown>;
    timestamp: Date;
}

// ---- Auth Types ----
export type UserRole = 'super_admin' | 'tenant_admin' | 'tenant_supervisor' | 'tenant_agent' | 'tenant_viewer';

export interface AuthUser {
    id: string;
    email: string;
    role: UserRole;
    tenantId?: string;
    isActive: boolean;
}

export interface JwtPayload {
    sub: string;
    email: string;
    role: UserRole;
    tenantId?: string;
    sid?: string;
    iat?: number;
    exp?: number;
    /**
     * Impersonation delegation. The effective identity stays in `sub` while
     * these carry the REAL actor, so downstream writers can record
     * "X acting as Y" instead of attributing the action to the impersonated
     * user. Never overwrite `sub` with the operator's id.
     */
    impersonatedBy?: string;
    isImpersonation?: boolean;
    /** Id of the impersonation session, used to pair start/end audit rows. */
    impersonationSid?: string;
}

// ---- API Response Types ----
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
        details?: unknown;
    };
    meta?: {
        page?: number;
        limit?: number;
        total?: number;
    };
}

// ---- Business Identity Types ----
export interface SocialLinks {
    facebook?: string;
    instagram?: string;
    twitter?: string;
    linkedin?: string;
    youtube?: string;
    tiktok?: string;
}

export interface BusinessIdentity {
    id: string;
    tenantId: string;
    companyName: string;
    industry?: string;
    about?: string;
    phone?: string;
    email?: string;
    website?: string;
    address?: string;
    city?: string;
    country?: string;
    logoUrl?: string;
    socialLinks?: SocialLinks;
    isPrimary: boolean;
    createdAt: Date;
    updatedAt: Date;
}

// ---- FAQ Types ----
export interface FAQ {
    id: string;
    question: string;
    answer: string;
    category?: string;
    orderIndex: number;
    isPublished: boolean;
    tags: string[];
    views: number;
    createdAt: Date;
    updatedAt: Date;
}

// ---- Policy Types ----
export type PolicyType = 'shipping' | 'return' | 'warranty' | 'cancellation' | 'terms' | 'privacy';

export interface Policy {
    id: string;
    type: PolicyType;
    title: string;
    content: string;
    version: number;
    effectiveFrom: Date;
    effectiveTo?: Date;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

// ---- Product / Inventory Types ----
export interface Product {
    id: string;
    tenantId: string;
    name: string;
    description: string;
    price: number;
    currency: string;
    category: string;
    isAvailable: boolean;
    stock?: number;
    images: string[];
    metadata: Record<string, unknown>;
}

// ---- Order Types ----
export type OrderStatus = 'pending' | 'confirmed' | 'processing' | 'completed' | 'cancelled' | 'refunded';

export interface Order {
    id: string;
    tenantId: string;
    contactId: string;
    conversationId: string;
    items: OrderItem[];
    totalAmount: number;
    currency: string;
    status: OrderStatus;
    paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}

export interface OrderItem {
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
}

// ---- LLM Provider Types ----
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export type ContentPart = TextContentPart | ImageUrlContentPart;

export interface TextContentPart {
    type: 'text';
    text: string;
}

export interface ImageUrlContentPart {
    type: 'image_url';
    image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export interface ChatMessage {
    role: ChatRole;
    content: string | ContentPart[];
    name?: string;
    toolCallId?: string;
    toolCalls?: ToolCall[];
}

// ---- Media Processing Types ----
export interface MediaProcessingLimits {
    audioPerMonth: number;
    imagePerMonth: number;
    maxAudioDurationSec: number;
    perContactPerDay: number;
    perConvPer5min: number;
    perTenantPerHour: number;
    dailyBudgetCentsUsd: number;
}

export interface MediaProcessingResult {
    type: 'transcription' | 'vision';
    text: string;
    durationSec?: number;
    costCentsUsd: number;
    model: string;
    provider: string;
}

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, any>;
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string; // JSON string
    };
}

export interface ToolResult {
    toolCallId: string;
    result: string;
}

// ---- Turn Context (Layer 3 of prompt assembly) ----
export type KnowledgeSource = 'faq' | 'policy' | 'kb_article' | 'product' | 'service';

export interface RetrievedKnowledgeItem {
    source: KnowledgeSource;
    id: string;
    score?: number;
    title?: string;
    content: string;
    metadata?: Record<string, unknown>;
    /**
     * Provenance for regulated sources.
     *
     * A regulatory answer without the issuing authority and its validity window
     * cannot be audited after the fact — and "the rule says X" is only checkable
     * if we know WHICH rule, from whom, and whether it was in force.
     */
    jurisdiction?: string;
    authority?: string;
    validFrom?: string;
    validTo?: string;
    isRegulated?: boolean;
}

// ---- Versioned active domain-object context ----
// This is an intentionally narrow, allow-listed projection for the LLM prompt.
// It is not a generic record and must never grow free-form fields such as notes,
// addresses, access codes, clinical descriptions or other domain payloads.
export const ACTIVE_OBJECT_CONTEXT_VERSION = 1 as const;
export const ACTIVE_OBJECT_CONTEXT_MAX_ITEMS = 20 as const;
export const ACTIVE_OBJECT_CONTEXT_MAX_XML_CHARS = 12_000 as const;

export const ACTIVE_OBJECT_KINDS = [
    'appointment',
    'order',
    'food_order',
    'property_booking',
    'tour_booking',
    'treatment_plan',
    'treatment_session',
    'catalog_item',
    'real_estate_listing',
    'vehicle',
    'tour_package',
    // El alojamiento en si, no la reserva: es el sujeto de un property_booking,
    // igual que tour_package lo es de un tour_booking. Sin el, el unico id que
    // veia el agente era el de la reserva y terminaba pasandolo como propertyId.
    'property',
    'course',
    'enrollment',
    'professional_case',
    'pet',
    'membership',
    'class_booking',
    'insurance_policy',
    'insurance_claim',
    'insurance_quote',
    'service_request',
    'photo_session',
    // CRM writers return these exact records so the agent console can open
    // what was created instead of treating every mutation as an opaque success.
    'crm_lead',
    'crm_opportunity',
    'crm_task',
    'consent_record',
    // Los alquileres de recurso —un auto, una estadía de mascota— no tenían
    // NINGÚN tipo declarado, así que `create_vehicle_rental` y
    // `create_pet_boarding` escribían una fila que el turno siguiente no podía
    // ver: el cliente preguntaba "¿hasta cuándo lo tengo?" y el agente no tenía
    // dónde mirar.
    'vehicle_rental',
    'pet_boarding',
] as const;
export type ActiveObjectKind = typeof ACTIVE_OBJECT_KINDS[number];

export const ACTIVE_OBJECT_SOURCES = [
    'appointments',
    'orders',
    'food_orders',
    'property_bookings',
    'tour_bookings',
    'treatment_plans',
    'treatment_sessions',
    'products',
    'ecommerce_products',
    'real_estate_listings',
    'vehicles',
    'tour_packages',
    'courses',
    'enrollments',
    'opportunities',
    'pets',
    'members',
    'class_bookings',
    'insurance_policies',
    'insurance_claims',
    'insurance_quotes',
    'service_requests',
    'photo_sessions',
    'leads',
    'tasks',
    'consent_records',
    'resource_rentals',
    'external_integration',
    'legacy_active_bookings',
    'legacy_recent_orders',
] as const;
export type ActiveObjectSource = typeof ACTIVE_OBJECT_SOURCES[number];

export const ACTIVE_OBJECT_STATUS_CLASSES = [
    'pending',
    'active',
    'paused',
    'completed',
    'cancelled',
    'failed',
    'unknown',
] as const;
export type ActiveObjectStatusClass = typeof ACTIVE_OBJECT_STATUS_CLASSES[number];

export interface ActiveObjectSubject {
    kind: ActiveObjectKind;
    id: string;
    label?: string;
}

export interface ActiveObjectProgress {
    current: number;
    total: number;
}

export interface ActiveObjectContextItemV1 {
    kind: ActiveObjectKind;
    id: string;
    /** Exact source status, bounded at render time. */
    status: string;
    /** Cross-domain status used by prompt rules; loaders own the mapping. */
    statusClass: ActiveObjectStatusClass;
    /** Auditable authoritative source. Arbitrary source strings are not allowed. */
    source: ActiveObjectSource;
    reference?: string;
    label?: string;
    /** Full ISO-8601 timestamps with Z or an explicit offset. */
    startsAt?: string;
    endsAt?: string;
    updatedAt?: string;
    /** Null means the source explicitly has no amount; absence means not applicable. */
    amount?: number | null;
    /** ISO-4217 code. */
    currency?: string;
    subject?: ActiveObjectSubject;
    progress?: ActiveObjectProgress;
    /** Reviewed read tool for details that are deliberately absent from the prompt. */
    detailsTool?: string;
}

export interface ActiveObjectsContextV1 {
    version: typeof ACTIVE_OBJECT_CONTEXT_VERSION;
    /** Full ISO-8601 timestamp describing snapshot freshness. */
    asOf: string;
    items: ActiveObjectContextItemV1[];
}

/** Versioned union: append V2 here instead of mutating the V1 wire contract. */
export type ActiveObjectsContext = ActiveObjectsContextV1;

/**
 * The regional facts a turn runs under.
 *
 * Kept as a small, typed block rather than a pile of loose fields, and
 * deliberately NOT a list of idioms: the prompt receives terms it may generate
 * and the pack's identity, while recognition of local expressions happens in a
 * deterministic normaliser before the model sees anything. Injecting hundreds
 * of regionalisms into a system prompt teaches caricature, not comprehension.
 */
export interface TurnRegionalContext {
    /** Where the BUSINESS operates. Not where it pays us. */
    operatingCountry: string;
    /** ISO 4217. Currency this business quotes in. */
    currency: string;
    /** BCP 47, e.g. `es-CO`. */
    locale: string;
    /** `usted` | `tu` | `vos` | `voce` | `senhor_senhora`. */
    addressForm: string;
    countryPackId: string;
    countryPackVersion: string;
    /** `draft` packs must not be presented as certified market coverage. */
    countryPackStatus: string;
    /** Country-reviewed vocabulary the agent may generate. Internal keys are stable. */
    preferredTerms?: Readonly<Record<string, string>>;
    /** Registers the agent must never imitate for this operating country. */
    prohibitedRegisters?: readonly string[];
}

/**
 * Qué puede hacer el agente en ESTE turno, según el contrato efectivo.
 *
 * - `ok` — el contrato resolvió y el perfil puede operar.
 * - `degraded` — resolvió pero alguna puerta no se pudo evaluar; se opera con
 *   lo que sí se pudo confirmar.
 * - `blocked` — el perfil está declarado `stop`: lee y deriva, no cierra nada.
 * - `unresolved` — el contrato NO se pudo resolver. No se conserva el toolset
 *   anterior: quedan sólo lecturas con política revisada y se deriva.
 *
 * Viaja al turno porque el modelo tiene que poder DECIRLO. Un agente al que se
 * le quitan las tools sin explicarle por qué improvisa una excusa, y la excusa
 * que inventa suele ser peor que la verdad.
 */
export type TurnCapabilityStatus = 'ok' | 'degraded' | 'blocked' | 'unresolved';

export interface TurnCapability {
    status: TurnCapabilityStatus;
    /** Motivo tipado y corto. Nunca el mensaje de una excepción. */
    reason?: string;
    profileId?: string;
}

export interface TurnContext {
    language: string;
    timezone: string;
    /** Operating country, currency, locale and form of address for this turn. */
    regional?: TurnRegionalContext;
    /** Lo que el contrato efectivo autorizó para este turno. */
    capability?: TurnCapability;
    now: string;
    upcomingDays: Array<{ date: string; weekday: string; label?: string }>;
    businessHoursStatus: 'open' | 'closed' | 'unknown';
    business?: Pick<BusinessIdentity, 'companyName' | 'industry' | 'about' | 'phone' | 'email' | 'website' | 'address' | 'city' | 'country' | 'socialLinks'>;
    contact?: {
        name?: string;
        email?: string;
        phone?: string;
        isKnown: boolean;
        knownSince?: string;
    };
    bookingState?: {
        step?: string;
        service?: { id: string; name: string; durationMinutes?: number };
        date?: string;
        slot?: string;
    };
    availableServices?: Array<{
        id: string;
        name: string;
        durationMinutes?: number;
        price?: number;
        currency?: string;
    }>;
    retrievedKnowledge?: RetrievedKnowledgeItem[];
    /** Probable but unverified knowledge; must be presented with uncertainty. */
    possibleKnowledge?: RetrievedKnowledgeItem[];
    /** E-commerce catalog sample (T2.17): real products so the agent never invents them. */
    catalog?: Array<{
        id: string;
        title: string;
        price?: number;
        currency?: string;
        inStock?: boolean;
        category?: string;
    }>;
    /** The current customer's recent orders (T2.17) for support/sales context. */
    recentOrders?: Array<{
        id: string;
        status: string;
        total?: number;
        currency?: string;
        date?: string;
    }>;
    /** Directive from booking engine — tells the LLM WHAT to communicate, not HOW */
    directive?: string;
    /** Long-term memory about this customer (cross-conversation): durable facts +
     *  a rolling summary, injected so the agent doesn't "forget" between sessions. */
    customerMemory?: {
        facts?: string[];
        summary?: string;
    };
    /** Number of messages in the current conversation (used for anti-repetition) */
    messageCount?: number;
    /** Vertical-specific context injected based on tenant industry */
    verticalContext?: VerticalContext;
    /** Authoritative, bounded domain-object snapshot for this turn. */
    activeObjects?: ActiveObjectsContext;
    /** @deprecated Compatibility input while loaders migrate to activeObjects. */
    activeBookings?: Array<{
        id: string;
        type: 'property' | 'tour' | 'appointment';
        name: string;
        status: string;
        dateLabel: string;
        priceLabel?: string;
        details?: string;
    }>;
}

// ---- Vertical Context (injected into LLM turn) ----
export interface VerticalContext {
    customerNoun?: string;
    customerNounPlural?: string;
    transactionNoun?: string;
    serviceNoun?: string;
    industryGuidance?: string;
    /** Industry + sub-type declared at signup (e.g. salud / dental). */
    industry?: string;
    subType?: string;
    /** Onboarding answers: what the owner wants the agent to achieve (free text for "other:…"). */
    businessGoals?: string[];
    /** Onboarding answers: who the business serves. */
    targetAudiences?: string[];
    /** Lo que este perfil vende o gestiona, en su propio nombre. */
    primaryObjectNoun?: string;
    primaryObjectNounPlural?: string;
    /**
     * Lo que este perfil declara que NO hace.
     *
     * Vive en el registro de perfiles y alimenta el set dorado desde U22: se
     * medía que el agente rechazara estas cosas y **nada se las decía**. Una
     * prueba que exige un comportamiento que el prompt nunca pidió mide al
     * modelo adivinando, no al sistema.
     */
    notOffered?: string[];
    /**
     * Palabras que este perfil NO usa con el cliente.
     *
     * No es estilo: son términos que significan otra cosa en el rubro o que
     * prometen algo que el perfil no hace — "reserva de mesa" en una dark
     * kitchen, "paciente" en una farmacia, "prueba de manejo" en un taller.
     */
    avoidTerms?: string[];
    /**
     * Compact, runtime-safe projection of VerticalDomainContractV2.
     *
     * The complete draft remains available to audit APIs; the turn only needs
     * the promises, intent/tool boundary and unresolved review flags. Keeping
     * this typed stops the audit contract from being documentation-only.
     */
    domainContract?: {
        contractVersion: number;
        profileId: string;
        status: string;
        scope: string;
        claims: readonly string[];
        intents: ReadonlyArray<{
            key: string;
            commits: boolean;
            /** Domain-authored sequence; stable across tenants and plans. */
            toolPlan: readonly string[];
            /** Subset actually published by the effective contract for this turn. */
            runtimeToolPlan?: readonly string[];
            /** Whether this turn can complete the authored sequence end to end. */
            runtimeStatus?: 'available' | 'partial' | 'unavailable';
            /** Authored steps withheld by plan, readiness, provider or policy. */
            missingTools?: readonly string[];
        }>;
        unresolved: readonly string[];
    };
    /** Expert-authored localization is still pending for these source fields. */
    domainReviewRequired?: readonly string[];
}

// ---- Test Agent Types ----
export interface TestAgentRequest {
    message: string;
    /** Resolve the exact live capability contract for this certified channel. */
    channelType?: ConversationalChannelType;
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
    options?: {
        /** Public endpoint control. Internal eval/sandbox controls are not exposed. */
        disableTools?: boolean;
    };
}

export interface TestAgentToolCall {
    name: string;
    args: Record<string, unknown>;
    result: unknown;
    durationMs: number;
}

/**
 * Agent Test tool parity.
 *
 * The test environment resolves the SAME contract production would publish and
 * then says, per tool, whether it may run it here. It used to advertise a
 * smaller toolset with no indication that it was smaller, so an owner could
 * test an agent and ship something whose real contract they had never seen.
 */
export interface TestAgentToolParity {
    resolvedCount: number;
    executableCount: number;
    tools: Array<{
        name: string;
        resolved: true;
        executableInTest: boolean;
        /** `executable`, `writer_blocked_in_test`, `step_up_unavailable_in_test`, … */
        reason: string;
        effect?: string;
        assurance?: string;
    }>;
}

export interface TestAgentDebugInfo {
    systemPrompt: string;
    toolCalls: TestAgentToolCall[];
    ragHits: RetrievedKnowledgeItem[];
    tokens: { input: number; output: number };
    cost: number;
    model: string;
    latencyMs: number;
    turnContext: TurnContext;
    /** Production's contract vs what this environment may execute. */
    toolParity?: TestAgentToolParity;
    /** Operating identity the run used, so a wrong clock is visible. */
    regional?: TurnRegionalContext | null;
    /** Exact capability decision used to publish the Agent Test toolset. */
    effectiveCapability?: import('./effective-capability-contract').EffectiveCapabilityContract | null;
}

export interface TestAgentResponse {
    reply: string;
    debug: TestAgentDebugInfo;
}

// ---- Universal Safety Guardrails ----
// These forbidden topics are always active and cannot be removed by tenants.
// They are enforced at Layer 1 (CONTRACT) of the system prompt.
export const UNIVERSAL_FORBIDDEN_TOPICS = [
    { key: 'csam', label: { es: 'Explotación o abuso de menores', en: 'Child exploitation or abuse', pt: 'Exploração ou abuso de menores', fr: 'Exploitation ou abus de mineurs' } },
    { key: 'trafficking', label: { es: 'Trata de personas o trabajo forzado', en: 'Human trafficking or forced labor', pt: 'Tráfico de pessoas ou trabalho forçado', fr: 'Traite des personnes ou travail forcé' } },
    { key: 'self_harm', label: { es: 'Instrucciones de autolesión o suicidio', en: 'Self-harm or suicide instructions', pt: 'Instruções de autolesão ou suicídio', fr: 'Instructions d\'automutilation ou de suicide' } },
    { key: 'terrorism', label: { es: 'Terrorismo o extremismo violento', en: 'Terrorism or violent extremism', pt: 'Terrorismo ou extremismo violento', fr: 'Terrorisme ou extrémisme violent' } },
    { key: 'illegal_drugs', label: { es: 'Producción o tráfico de drogas ilegales', en: 'Illegal drug production or trafficking', pt: 'Produção ou tráfico de drogas ilegais', fr: 'Production ou trafic de drogues illicites' } },
    { key: 'weapons', label: { es: 'Fabricación de armas o explosivos', en: 'Weapons or explosives manufacturing', pt: 'Fabricação de armas ou explosivos', fr: 'Fabrication d\'armes ou d\'explosifs' } },
    { key: 'non_consensual', label: { es: 'Contenido sexual no consentido', en: 'Non-consensual sexual content', pt: 'Conteúdo sexual não consensual', fr: 'Contenu sexuel non consenti' } },
    { key: 'fraud', label: { es: 'Esquemas de fraude, estafas o phishing', en: 'Fraud schemes, scams, or phishing', pt: 'Esquemas de fraude, golpes ou phishing', fr: 'Fraude, escroqueries ou hameçonnage' } },
    { key: 'financial_data', label: { es: 'Solicitar tarjetas de crédito, cuentas bancarias o documentos de identidad', en: 'Requesting credit cards, bank accounts, or government IDs', pt: 'Solicitar cartões de crédito, contas bancárias ou documentos de identidade', fr: 'Demander des cartes de crédit, comptes bancaires ou pièces d\'identité' } },
    { key: 'other_customers', label: { es: 'Divulgar información personal de otros clientes', en: 'Disclosing other customers\' personal information', pt: 'Divulgar informações pessoais de outros clientes', fr: 'Divulguer les informations personnelles d\'autres clients' } },
    { key: 'medical_advice', label: { es: 'Diagnóstico médico o prescripción de tratamiento', en: 'Medical diagnosis or treatment prescription', pt: 'Diagnóstico médico ou prescrição de tratamento', fr: 'Diagnostic médical ou prescription de traitement' } },
    { key: 'legal_advice', label: { es: 'Asesoría legal como si fuera abogado', en: 'Legal advice as if an attorney', pt: 'Assessoria jurídica como se fosse advogado', fr: 'Conseils juridiques comme un avocat' } },
];

// ---- Vertical Adaptation System ----

export type LocalizedString = Record<string, string>; // {es: '...', en: '...', pt: '...', fr: '...'}

interface VerticalStageDefinitionBase {
    name: LocalizedString;
    slug: string;
    color: string;
    probability: number;
    slaHours?: number;
    transitionRules?: any[];
}

/**
 * Terminal business meaning is part of the vertical contract. It must never be
 * inferred from a translated slug or a display probability.
 */
export type VerticalStageDefinition = VerticalStageDefinitionBase & (
    | { isTerminal: true; terminalOutcome: 'won' | 'lost' }
    | { isTerminal: false; terminalOutcome?: never }
);

export interface VerticalFaqDefinition {
    question: LocalizedString;
    answer: LocalizedString;
    category: string;
}

export interface VerticalServiceDefinition {
    name: LocalizedString;
    description: LocalizedString;
    durationMinutes: number;
    price: number;
    currency: string;
    category: string;
    /** 'open' = day-level availability (multi-day stays, full-day sessions); default 'fixed' slots. */
    durationType?: 'fixed' | 'open';
}

export interface VerticalAgentDefinition {
    name: LocalizedString;
    role: LocalizedString;
    tone: string;
    formality: string;
    greeting: LocalizedString;
    rules: LocalizedString;
    forbiddenTopics: LocalizedString;
    handoffTriggers: LocalizedString;
}

export interface VerticalSidebarConfig {
    labelOverrides: Record<string, LocalizedString>;
    hiddenItems: string[];
    itemOrder?: string[];
}

export interface VerticalKpiDefinition {
    key: string;
    label: LocalizedString;
    icon: string;
    color: string;
}

export interface VerticalTerminology {
    customerNoun: LocalizedString;
    customerNounPlural: LocalizedString;
    transactionNoun: LocalizedString;
    serviceNoun: LocalizedString;
    pipelineNoun: LocalizedString;
}

export interface VerticalDefinition {
    industry: string;
    subTypes: Array<{ key: string; label: LocalizedString }>;
    terminology: VerticalTerminology;
    agent: VerticalAgentDefinition;
    pipeline: { stages: VerticalStageDefinition[] };
    faqs: VerticalFaqDefinition[];
    services: VerticalServiceDefinition[];
    businessHours: {
        schedule: Record<string, string>;
        afterHoursMessage: LocalizedString;
    };
    sidebar: VerticalSidebarConfig;
    dashboard: { kpis: VerticalKpiDefinition[] };
    bookingEnabled: boolean;
    deferred?: boolean;
}

export interface TenantVerticalConfig {
    industry: string;
    subType: string | null;
    terminology: VerticalTerminology;
    sidebar: VerticalSidebarConfig;
    dashboard: { kpis: VerticalKpiDefinition[] };
    bookingEnabled: boolean;
    /** Operational manifest used to resolve this tenant's current capabilities. */
    manifestVersion?: number;
    /** Plan/provisioning-adjusted capabilities, persisted for runtime consumers. */
    effectiveCapabilities?: import('./vertical-capability-manifest').VerticalCapability[];
}

// ---- Procedures (AOP/SOP) — T2.12 ----
// A tenant writes an SOP in natural language; it compiles to a deterministic
// step graph the engine executes (the LLM only voices the steps, never decides
// the flow), mirroring the booking engine's directive pattern.
export type ProcedureStepType = 'message' | 'ask' | 'tool' | 'condition' | 'handoff';

export type ProcedureConditionOperator = 'eq' | 'neq' | 'contains' | 'exists' | 'not_exists';

export interface ProcedureStep {
    /** Stable step id (referenced by next/then/else). */
    id: string;
    type: ProcedureStepType;
    config: {
        /** message: what to communicate to the customer. */
        text?: string;
        /** ask: the field to collect + the question to ask. */
        field?: string;
        question?: string;
        /** tool: an AI tool name (same registry as the agent tools) + args + where to store the result. */
        tool?: string;
        args?: Record<string, any>;
        saveAs?: string;
        /** condition: evaluate a collected field and branch. */
        conditionField?: string;
        operator?: ProcedureConditionOperator;
        value?: string;
        then?: string;
        else?: string;
        /** handoff: reason passed to the handoff service. */
        reason?: string;
    };
    /** Explicit next step id; defaults to the next step in order. */
    next?: string;
}

export interface ProcedureTrigger {
    /** Lowercased keywords; if any appears in the customer message, the procedure starts. */
    keywords: string[];
    description?: string;
}

export type ProcedureStatus = 'draft' | 'active' | 'inactive';

export interface ProcedureDefinition {
    id: string;
    name: string;
    description?: string;
    trigger: ProcedureTrigger;
    steps: ProcedureStep[];
    status: ProcedureStatus;
    vertical?: string;
    version: number;
    sourceSop?: string;
}

/** Redis-backed execution state for an in-progress procedure. */
export interface ProcedureRunState {
    procedureId: string;
    version: number;
    currentStepId: string | null;
    collected: Record<string, any>;
    /** When set, the previous turn asked for this field and we await the answer. */
    awaitingField?: string | null;
    startedAt: string;
}
