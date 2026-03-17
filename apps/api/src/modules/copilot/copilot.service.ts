import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

@Injectable()
export class CopilotService {
    private readonly logger = new Logger(CopilotService.name);

    constructor(private configService: ConfigService) { }

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

    // ─── System Prompt ────────────────────────────────────────────────────────

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

    // ─── Fallback ─────────────────────────────────────────────────────────────

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
