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
export type UserRole = 'super_admin' | 'tenant_admin' | 'tenant_agent' | 'tenant_viewer';

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

export interface ChatMessage {
    role: ChatRole;
    content: string;
    name?: string;
    toolCallId?: string;
    toolCalls?: ToolCall[];
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
