import { Controller, Post, Body, UseGuards, Req, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';

/**
 * Copilot Controller
 * 
 * Handles AI-powered Copilot chat requests.
 * Uses OpenAI API (gpt-4o-mini) with a context-aware system prompt.
 */
@Controller('copilot')
export class CopilotController {
    private readonly logger = new Logger(CopilotController.name);

    constructor(private configService: ConfigService) { }

    @Post('chat')
    @UseGuards(AuthGuard('jwt'))
    async chat(
        @Body() body: {
            message: string;
            context: {
                page: string;
                tenantId?: string;
                tenantName?: string;
                userName: string;
                userRole: string;
            };
            history: { role: string; content: string }[];
        },
        @Req() req: any,
    ) {
        const openaiKey = this.configService.get<string>('OPENAI_API_KEY');

        if (!openaiKey || openaiKey.startsWith('sk-your')) {
            this.logger.warn('OpenAI API key not configured, returning fallback response');
            return {
                reply: this.getFallbackResponse(body.message, body.context.page),
            };
        }

        try {
            const systemPrompt = this.buildSystemPrompt(body.context);

            const messages = [
                { role: 'system', content: systemPrompt },
                ...body.history.slice(-10),
                { role: 'user', content: body.message },
            ];

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
                this.logger.error(`OpenAI API error: ${response.status}`);
                return { reply: this.getFallbackResponse(body.message, body.context.page) };
            }

            const data = await response.json();
            const reply = data.choices?.[0]?.message?.content || 'No pude generar una respuesta. ¿Podrías reformular tu pregunta?';

            this.logger.log(`Copilot response generated for user ${body.context.userName} on ${body.context.page}`);
            return { reply };
        } catch (error) {
            this.logger.error('Copilot chat error:', error);
            return { reply: this.getFallbackResponse(body.message, body.context.page) };
        }
    }

    private buildSystemPrompt(ctx: {
        page: string;
        tenantId?: string;
        tenantName?: string;
        userName: string;
        userRole: string;
    }): string {
        return `Eres **Parallext Copilot**, el asistente inteligente de la plataforma Parallext Engine.
Tu misión es ayudar al usuario a entender, configurar y operar todos los módulos.

## Contexto actual
- **Usuario:** ${ctx.userName} (Rol: ${ctx.userRole})
- **Tenant activo:** ${ctx.tenantName || "Ninguno (Super Admin global)"}
- **Página actual:** ${ctx.page}

## Conocimiento de la plataforma Parallext Engine
Parallext Engine es una plataforma SaaS multi-tenant para automatización de ventas conversacionales vía WhatsApp.

### Módulos:
1. **Dashboard** (/admin) — Métricas globales de revenue, leads, CSAT.
2. **Tenants** (/admin/tenants) — Gestión de organizaciones multi-tenant con schemas PostgreSQL separados.
3. **Contactos** (/admin/contacts) — Base de contactos (nombre, teléfono, email, tags).
4. **Pipeline** (/admin/pipeline) — Kanban: Nuevos → Calificados → Propuesta → Negociación → Ganado.
5. **Inbox** (/admin/inbox) — Chat con clientes, notas internas, resolución.
6. **Automatización** (/admin/automation) — Reglas (autoresponse, assignment, follow_up, escalation).
7. **Broadcast** (/admin/broadcast) — Campañas masivas WhatsApp con templates {{name}}.
8. **Conversaciones** (/admin/conversations) — Vista global de conversaciones, filtros sentimiento/tags.
9. **AI / LLM Router** (/admin/ai) — Configuración modelos IA y reglas de enrutamiento.
10. **Knowledge Base** (/admin/knowledge) — Documentos RAG para alimentar al LLM (PDF, MD, Excel, URLs).
11. **Analytics** (/admin/agent-analytics) — Performancias de agentes y CSAT.
12. **Usuarios** (/admin/users) — Roles: super_admin, tenant_admin, agent.
13. **Settings** (/admin/settings) — API Keys, configuración general.

### Arquitectura:
- Frontend: Next.js 16 + React
- Backend: NestJS + Prisma ORM + PostgreSQL (multi-schema/tenant)
- Hosting: Docker Compose, Cloudflare Tunnel, Watchtower auto-deploy
- Auth: JWT + Refresh Tokens
- AI: OpenAI, Anthropic, embeddings text-embedding-3-small, pgvector para RAG

## Reglas:
- Responde SIEMPRE en español (Colombia).
- Sé conciso. Usa listas y Markdown.
- Da instrucciones paso a paso cuando sea útil.
- Si no sabes algo, dilo honestamente.
- Máximo 2-3 emojis por respuesta.`;
    }

    private getFallbackResponse(message: string, page: string): string {
        const pageName = page.replace('/admin/', '').replace('/admin', 'Dashboard') || 'Dashboard';

        const fallbacks: Record<string, string> = {
            'dashboard': '📊 Estás en el **Dashboard**. Aquí ves un resumen global de tus métricas: revenue, leads activos, CSAT promedio y actividad reciente. Las tarjetas superiores muestran los KPIs principales.',
            'tenants': '🏢 En **Tenants** gestionas las organizaciones. Cada tenant tiene su propio espacio aislado en la base de datos. Puedes crear nuevos tenants con el botón "Nuevo Tenant".',
            'contacts': '👥 En **Contactos** ves tu base de datos de clientes. Puedes buscar, filtrar por tags y ver el historial de cada contacto.',
            'pipeline': '📈 El **Pipeline** es tu tablero Kanban de ventas. Arrastra los deals entre etapas (Nuevos → Ganado). Crea deals con "Nuevo Deal".',
            'inbox': '💬 El **Inbox** es donde chateas con clientes. Puedes enviar mensajes, agregar notas internas y resolver conversaciones.',
            'automation': '⚡ En **Automatización** configuras reglas de auto-respuesta, asignación automática de agentes y seguimientos programados.',
            'broadcast': '📢 En **Broadcast** creas campañas masivas de WhatsApp. Usa {{name}} en los templates para personalizar cada mensaje.',
            'conversations': '💬 La vista de **Conversaciones** muestra todas las charlas con filtros de estado (activa, esperando, resuelta) y análisis de sentimiento.',
            'ai': '🧠 El **AI Router** configura qué modelo de IA responde cada tipo de consulta. GPT-4o para ventas complejas, GPT-3.5 para FAQs rápidas.',
            'knowledge': '📚 La **Knowledge Base** alimenta al LLM con información real de tu empresa. Sube PDFs, excels o URLs y el sistema los vectoriza automáticamente.',
        };

        return fallbacks[pageName.toLowerCase()] ||
            `¡Hola! 👋 Estás en la página **${pageName}**. Actualmente estoy operando en modo offline porque la API key de OpenAI no está configurada. Contacta al administrador para activar el Copilot completo.`;
    }
}
