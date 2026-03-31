import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { KnowledgeService } from '../knowledge/knowledge.service';

// ─── Existing interfaces (platform copilot chat) ────────────────────────────

export interface CopilotChatRequest {
    message: string;
    context: {
        page: string;
        tenantId?: string;
        tenantName?: string;
        userName: string;
        userRole: string;
    };
    history: { role: string; content: string }[];
}

export interface CopilotChatResponse {
    reply: string;
    model?: string;
    tokensUsed?: number;
}

// ─── New interfaces (conversation copilot) ──────────────────────────────────

export interface SuggestedReply {
    text: string;
    tone: 'formal' | 'friendly' | 'empathetic';
}

export interface ConversationSummary {
    summary: string;
    customerIntent: string;
    keyInfoShared: string[];
    pendingQuestions: string[];
}

export interface IntentAnalysis {
    primaryIntent: string;
    confidence: number;
    recommendedAction: string;
}

export interface ContextualAnswer {
    answer: string;
    sources: string[];
}

const COPILOT_CACHE_TTL = 60; // seconds

@Injectable()
export class CopilotService {
    private readonly logger = new Logger(CopilotService.name);

    constructor(
        private configService: ConfigService,
        private prisma: PrismaService,
        private redis: RedisService,
        private llmRouter: LLMRouterService,
        private knowledgeService: KnowledgeService,
    ) {}

    // ─── Conversation Copilot Methods ───────────────────────────────────────

    /**
     * Returns 3 suggested replies based on conversation context.
     */
    async getSuggestions(tenantId: string, conversationId: string): Promise<SuggestedReply[]> {
        const cacheKey = this.redis.tenantKey(tenantId, `copilot:suggestions:${conversationId}`);
        const cached = await this.redis.getJson<SuggestedReply[]>(cacheKey);
        if (cached) return cached;

        const messages = await this.loadRecentMessages(tenantId, conversationId);
        if (!messages || messages.length === 0) {
            return [{ text: 'No hay suficiente contexto para generar sugerencias.', tone: 'formal' }];
        }

        const chatHistory = this.buildChatMessages(messages);

        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: chatHistory,
                systemPrompt: `Eres un copiloto de ventas que asiste a agentes humanos de atención al cliente en Latinoamérica.
Basándote en el historial de la conversación, genera exactamente 3 respuestas sugeridas que el agente podría enviar al cliente.

Cada sugerencia debe ser:
- Corta (máximo 2 oraciones)
- Profesional y cálida
- En español latinoamericano
- Relevante al último mensaje del cliente

Responde ÚNICAMENTE con un JSON array con este formato:
[
  { "text": "respuesta 1", "tone": "formal" },
  { "text": "respuesta 2", "tone": "friendly" },
  { "text": "respuesta 3", "tone": "empathetic" }
]

No incluyas explicaciones, solo el JSON.`,
                temperature: 0.7,
                maxTokens: 500,
            });

            const suggestions = this.parseJsonSafe<SuggestedReply[]>(response.content, [
                { text: 'Gracias por contactarnos. Permítame revisar su caso.', tone: 'formal' },
                { text: '¡Claro! Con gusto le ayudo con eso.', tone: 'friendly' },
                { text: 'Entiendo su situación. Vamos a resolverlo juntos.', tone: 'empathetic' },
            ]);

            await this.redis.setJson(cacheKey, suggestions, COPILOT_CACHE_TTL);
            return suggestions;
        } catch (error: any) {
            this.logger.error(`getSuggestions failed: ${error.message}`);
            return [
                { text: 'Gracias por contactarnos. Permítame revisar su caso.', tone: 'formal' },
                { text: '¡Claro! Con gusto le ayudo con eso.', tone: 'friendly' },
                { text: 'Entiendo su situación. Vamos a resolverlo juntos.', tone: 'empathetic' },
            ];
        }
    }

    /**
     * Returns a concise summary of the conversation so far.
     */
    async getSummary(tenantId: string, conversationId: string): Promise<ConversationSummary> {
        const cacheKey = this.redis.tenantKey(tenantId, `copilot:summary:${conversationId}`);
        const cached = await this.redis.getJson<ConversationSummary>(cacheKey);
        if (cached) return cached;

        const messages = await this.loadRecentMessages(tenantId, conversationId);
        if (!messages || messages.length === 0) {
            return {
                summary: 'No hay mensajes en esta conversación.',
                customerIntent: 'desconocido',
                keyInfoShared: [],
                pendingQuestions: [],
            };
        }

        const chatHistory = this.buildChatMessages(messages);

        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: chatHistory,
                systemPrompt: `Eres un copiloto de ventas que analiza conversaciones para agentes humanos.
Analiza el historial de la conversación y genera un resumen conciso.

Responde ÚNICAMENTE con un JSON con este formato:
{
  "summary": "Resumen breve de la conversación en 1-2 oraciones",
  "customerIntent": "Qué busca o necesita el cliente",
  "keyInfoShared": ["dato clave 1", "dato clave 2"],
  "pendingQuestions": ["pregunta sin resolver 1", "pregunta sin resolver 2"]
}

Usa español latinoamericano. No incluyas explicaciones, solo el JSON.`,
                temperature: 0.3,
                maxTokens: 500,
            });

            const summary = this.parseJsonSafe<ConversationSummary>(response.content, {
                summary: 'No se pudo generar el resumen.',
                customerIntent: 'desconocido',
                keyInfoShared: [],
                pendingQuestions: [],
            });

            await this.redis.setJson(cacheKey, summary, COPILOT_CACHE_TTL);
            return summary;
        } catch (error: any) {
            this.logger.error(`getSummary failed: ${error.message}`);
            return {
                summary: 'Error al generar el resumen.',
                customerIntent: 'desconocido',
                keyInfoShared: [],
                pendingQuestions: [],
            };
        }
    }

    /**
     * Analyzes the last few messages and returns intent analysis.
     */
    async detectIntent(tenantId: string, conversationId: string): Promise<IntentAnalysis> {
        const cacheKey = this.redis.tenantKey(tenantId, `copilot:intent:${conversationId}`);
        const cached = await this.redis.getJson<IntentAnalysis>(cacheKey);
        if (cached) return cached;

        const messages = await this.loadRecentMessages(tenantId, conversationId);
        if (!messages || messages.length === 0) {
            return {
                primaryIntent: 'unknown',
                confidence: 0,
                recommendedAction: 'Esperar más contexto del cliente.',
            };
        }

        const chatHistory = this.buildChatMessages(messages);

        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: chatHistory,
                systemPrompt: `Eres un analizador de intención de clientes para un equipo de ventas en Latinoamérica.
Analiza los últimos mensajes de la conversación y determina la intención del cliente.

Intenciones posibles:
- "product_inquiry" — Pregunta sobre productos o servicios
- "complaint" — Queja o reclamo
- "purchase_intent" — Intención de compra
- "support" — Solicitud de soporte técnico
- "pricing" — Consulta de precios
- "scheduling" — Agendar cita o reunión
- "follow_up" — Seguimiento de caso anterior
- "general_info" — Información general

Responde ÚNICAMENTE con un JSON con este formato:
{
  "primaryIntent": "una_de_las_intenciones_anteriores",
  "confidence": 0.85,
  "recommendedAction": "Acción recomendada para el agente en español"
}

El campo confidence debe ser un número entre 0 y 1. No incluyas explicaciones, solo el JSON.`,
                temperature: 0.2,
                maxTokens: 300,
            });

            const intent = this.parseJsonSafe<IntentAnalysis>(response.content, {
                primaryIntent: 'unknown',
                confidence: 0,
                recommendedAction: 'No se pudo determinar la intención.',
            });

            // Clamp confidence to 0-1
            intent.confidence = Math.max(0, Math.min(1, intent.confidence));

            await this.redis.setJson(cacheKey, intent, COPILOT_CACHE_TTL);
            return intent;
        } catch (error: any) {
            this.logger.error(`detectIntent failed: ${error.message}`);
            return {
                primaryIntent: 'unknown',
                confidence: 0,
                recommendedAction: 'Error al analizar la intención.',
            };
        }
    }

    /**
     * Agent asks a question about the conversation/product. Uses RAG knowledge base + conversation context.
     */
    async getContextualHelp(
        tenantId: string,
        conversationId: string,
        agentQuery: string,
    ): Promise<ContextualAnswer> {
        const messages = await this.loadRecentMessages(tenantId, conversationId);
        const conversationContext = messages
            ? messages.map((m: any) => `${m.direction === 'inbound' ? 'Cliente' : 'Agente'}: ${m.content_text}`).join('\n')
            : '(Sin contexto de conversación)';

        // Search knowledge base for relevant info
        let knowledgeContext = '';
        const sources: string[] = [];
        try {
            const results = await this.knowledgeService.searchRelevant(tenantId, agentQuery, 3);
            if (results && results.length > 0) {
                knowledgeContext = results
                    .map((r: any) => r.chunk_text)
                    .join('\n---\n');
                sources.push(
                    ...results.map((r: any) => r.document_title).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i),
                );
            }
        } catch (error: any) {
            this.logger.warn(`Knowledge search failed: ${error.message}`);
        }

        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: agentQuery }],
                systemPrompt: `Eres un copiloto inteligente que ayuda a agentes de ventas y soporte en Latinoamérica.
El agente te hace una pregunta mientras atiende a un cliente. Responde de forma útil y concisa.

## Contexto de la conversación actual:
${conversationContext}

${knowledgeContext ? `## Información de la base de conocimiento:\n${knowledgeContext}` : '## No hay información relevante en la base de conocimiento.'}

Reglas:
- Responde en español latinoamericano
- Sé conciso y directo (máximo 3-4 oraciones)
- Si no tienes suficiente información, indícalo honestamente
- Prioriza la información de la base de conocimiento cuando esté disponible`,
                temperature: 0.4,
                maxTokens: 500,
            });

            return {
                answer: response.content || 'No pude generar una respuesta.',
                sources,
            };
        } catch (error: any) {
            this.logger.error(`getContextualHelp failed: ${error.message}`);
            return {
                answer: 'Error al procesar tu consulta. Intenta reformularla.',
                sources: [],
            };
        }
    }

    /**
     * Invalidate all copilot caches for a conversation (call on new message).
     */
    async invalidateCache(tenantId: string, conversationId: string): Promise<void> {
        const keys = [
            this.redis.tenantKey(tenantId, `copilot:suggestions:${conversationId}`),
            this.redis.tenantKey(tenantId, `copilot:summary:${conversationId}`),
            this.redis.tenantKey(tenantId, `copilot:intent:${conversationId}`),
        ];
        for (const key of keys) {
            await this.redis.del(key);
        }
    }

    // ─── Platform Copilot Chat (existing) ───────────────────────────────────

    async chat(request: CopilotChatRequest): Promise<CopilotChatResponse> {
        const openaiKey = this.configService.get<string>('OPENAI_API_KEY');

        if (!openaiKey || openaiKey.startsWith('sk-your')) {
            this.logger.warn('OpenAI API key not configured, returning fallback response');
            return { reply: this.getFallbackResponse(request.message, request.context.page) };
        }

        const systemPrompt = this.buildSystemPrompt(request.context);
        const messages = [
            { role: 'system', content: systemPrompt },
            ...request.history.slice(-10),
            { role: 'user', content: request.message },
        ];

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${openaiKey}`,
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages,
                    max_tokens: 800,
                    temperature: 0.7,
                }),
            });

            if (!response.ok) {
                this.logger.error(`OpenAI API error: ${response.status} ${response.statusText}`);
                return { reply: this.getFallbackResponse(request.message, request.context.page) };
            }

            const data = await response.json() as {
                choices: { message: { content: string } }[];
                usage?: { total_tokens: number };
                model?: string;
            };

            const reply = data.choices?.[0]?.message?.content
                || 'No pude generar una respuesta. ¿Podrías reformular tu pregunta?';

            this.logger.log(
                `Copilot reply for user "${request.context.userName}" on ${request.context.page} ` +
                `(tokens: ${data.usage?.total_tokens ?? '?'})`
            );

            return {
                reply,
                model: data.model,
                tokensUsed: data.usage?.total_tokens,
            };
        } catch (error) {
            this.logger.error('Copilot chat error:', error);
            return { reply: this.getFallbackResponse(request.message, request.context.page) };
        }
    }

    // ─── Private Helpers ────────────────────────────────────────────────────

    private async loadRecentMessages(tenantId: string, conversationId: string): Promise<any[] | null> {
        const schemaName = await this.tenantSchema(tenantId);

        try {
            const messages = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, content_text, content_type, direction, created_at, metadata
                 FROM messages
                 WHERE conversation_id = $1
                 ORDER BY created_at DESC
                 LIMIT 10`,
                [conversationId],
            );
            return messages && messages.length > 0 ? messages.reverse() : null;
        } catch (error: any) {
            this.logger.error(`Failed to load messages for ${conversationId}: ${error.message}`);
            return null;
        }
    }

    private buildChatMessages(messages: any[]): { role: 'user' | 'assistant'; content: string }[] {
        return messages
            .filter((m: any) => m.content_text)
            .map((m: any) => ({
                role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
                content: m.content_text,
            }));
    }

    private parseJsonSafe<T>(raw: string, fallback: T): T {
        try {
            // Try to extract JSON from the response (handles markdown code blocks)
            const jsonMatch = raw.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]) as T;
            }
            return JSON.parse(raw) as T;
        } catch {
            this.logger.warn(`Failed to parse LLM JSON response, using fallback`);
            return fallback;
        }
    }

    private async tenantSchema(tenantId: string): Promise<string> {
        return this.prisma.getTenantSchemaName(tenantId);
    }

    // ─── System Prompt (platform copilot) ───────────────────────────────────

    private buildSystemPrompt(ctx: {
        page: string;
        tenantId?: string;
        tenantName?: string;
        userName: string;
        userRole: string;
    }): string {
        return `Eres **Parallext Copilot**, el asistente inteligente de la plataforma Parallext Engine.
Tu misión es ayudar al usuario a entender, configurar y operar todos los módulos de la plataforma.

## Contexto actual
- **Usuario:** ${ctx.userName} (Rol: ${ctx.userRole})
- **Tenant activo:** ${ctx.tenantName || 'Ninguno (Super Admin global)'}
- **Página actual:** ${ctx.page}

## Plataforma Parallext Engine
Plataforma SaaS multi-tenant para captura, calificación y calentamiento de leads comerciales vía WhatsApp, con agente IA (Carla), CRM conversacional y analítica.

### Módulos:
1. **Dashboard** — KPIs comerciales: leads, conversiones, handoffs, costo LLM.
2. **Tenants** — Gestión de organizaciones con schemas PostgreSQL aislados.
3. **Contactos / Leads** — CRM de leads con score, etapa, campaña, curso y historial.
4. **Pipeline** — Kanban comercial: nuevo → contactado → calificado → caliente → listo para cierre → ganado.
5. **Inbox** — Chat unificado: mensajes, notas internas, handoff a humano, score visible.
6. **Automatización** — Reglas de nurturing, follow-up, horarios y límites de intentos.
7. **Broadcast** — Campañas masivas WhatsApp con templates por curso/campaña.
8. **Conversaciones** — Historial con filtros de etapa, sentimiento e intención.
9. **AI / LLM Router** — Config de modelos: Tier 1 (GPT-4o/Claude) a Tier 4 (DeepSeek).
10. **Knowledge Base** — RAG: PDFs, URLs, precios, fichas de curso, políticas.
11. **Analytics** — Dashboard ejecutivo y operativo, métricas de Carla, campañas.
12. **Usuarios** — Roles: super_admin, tenant_admin, agent.
13. **Settings** — API Keys, webhooks, horarios, fallback email.

## Reglas:
- Responde SIEMPRE en español (Colombia).
- Sé conciso. Usa listas y Markdown cuando sea útil.
- Máximo 2-3 emojis por respuesta.
- Si no sabes algo, dilo honestamente.`;
    }

    // ─── Fallback (platform copilot) ────────────────────────────────────────

    private getFallbackResponse(message: string, page: string): string {
        const pageName = page.replace('/admin/', '').replace('/admin', 'dashboard').toLowerCase();

        const fallbacks: Record<string, string> = {
            'dashboard': '📊 El **Dashboard** muestra tus KPIs comerciales en tiempo real: leads nuevos, calientes, costo LLM y handoffs. Si ves datos mock, el API key de OpenAI aún no está configurado.',
            'tenants': '🏢 En **Tenants** gestionas las organizaciones. Cada tenant tiene su propio schema PostgreSQL aislado. Crea un tenant y el sistema provisiona el schema automáticamente.',
            'contacts': '👥 Los **Leads/Contactos** son el corazón del CRM. Cada lead tiene score (1-10), etapa comercial, campaña y curso asociado.',
            'pipeline': '📈 El **Pipeline** es tu Kanban comercial. Los leads avanzan de "nuevo" a "listo para cierre". Puedes moverlos manualmente o dejar que la IA los avance por score.',
            'inbox': '💬 El **Inbox** es donde Carla conversa con leads y los humanos hacen handoff. El score y la etapa del lead son visibles en el panel lateral.',
            'automation': '⚡ En **Automatización** configuras reglas de nurturing: esperas, intentos, horarios y fallback a email si WhatsApp falla.',
            'broadcast': '📢 **Broadcast** envía campañas masivas de WhatsApp. Cada curso puede tener su propio template de primer contacto.',
            'conversations': '💬 **Conversaciones** muestra el historial completo con filtros por etapa, sentimiento e intención detectada por la IA.',
            'ai': '🧠 El **AI Router** selecciona el modelo adecuado según el valor del ticket, complejidad e intención del lead (4 tiers de costo/calidad).',
            'knowledge': '📚 La **Knowledge Base** alimenta a Carla con PDFs, precios y fichas de curso. Los documentos se vectorizan con pgvector para RAG.',
            'agent-analytics': '📊 **Analytics** muestra rendimiento de Carla: tasa de handoff, score promedio generado, costo por conversación y conversiones por campaña.',
            'settings': '⚙️ En **Settings** configuras las API Keys de LLM, webhooks de WhatsApp, horario de oficina y fallback email.',
        };

        return fallbacks[pageName] ||
            `¡Hola! 👋 Estoy en modo offline porque la API key de OpenAI no está configurada todavía. ` +
            `Configúrala en **Settings** para activar el Copilot completo.`;
    }
}
