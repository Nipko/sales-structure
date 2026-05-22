// ===================================
// Parallext Engine - Shared Types
// ===================================

// ---- Channel Types ----
export type ChannelType = 'whatsapp' | 'instagram' | 'messenger' | 'telegram' | 'sms';

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
    };
    offers?: {
        enabled: boolean;
    };
    crm?: {
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
    | 'model_used';

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
}

export interface TurnContext {
    language: string;
    timezone: string;
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
    /** Directive from booking engine — tells the LLM WHAT to communicate, not HOW */
    directive?: string;
    /** Number of messages in the current conversation (used for anti-repetition) */
    messageCount?: number;
    /** Vertical-specific context injected based on tenant industry */
    verticalContext?: VerticalContext;
}

// ---- Vertical Context (injected into LLM turn) ----
export interface VerticalContext {
    customerNoun?: string;
    customerNounPlural?: string;
    transactionNoun?: string;
    serviceNoun?: string;
    industryGuidance?: string;
}

// ---- Test Agent Types ----
export interface TestAgentRequest {
    message: string;
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
    channelType?: ChannelType;
}

export interface TestAgentToolCall {
    name: string;
    args: Record<string, unknown>;
    result: unknown;
    durationMs: number;
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

export interface VerticalStageDefinition {
    name: LocalizedString;
    slug: string;
    color: string;
    probability: number;
    slaHours?: number;
    isTerminal: boolean;
}

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
}
