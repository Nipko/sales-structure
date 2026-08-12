import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    UseGuards,
    Logger,
    Req,
    BadRequestException,
    ForbiddenException,
    UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { CopilotService, CopilotChatRequest } from './copilot.service';
import { CopilotChatRateLimitGuard } from './copilot-chat-rate-limit.guard';

interface CopilotChatClientRequest {
    message?: unknown;
    history?: unknown;
    locale?: unknown;
    page?: unknown;
}

const CHAT_ALLOWED_FIELDS = new Set(['message', 'history', 'locale', 'page']);
const CHAT_LOCALES = new Set(['es', 'en', 'pt', 'fr']);
const MAX_CHAT_MESSAGE_LENGTH = 2_000;
const MAX_CHAT_HISTORY_ITEMS = 20;
const MAX_CHAT_HISTORY_CONTENT_LENGTH = 2_000;
const MAX_CHAT_HISTORY_TOTAL_LENGTH = 12_000;
const MAX_CHAT_PAGE_LENGTH = 256;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTERNAL_ADMIN_PAGE_PATTERN = /^\/admin(?:\/[a-zA-Z0-9._~()[\]-]+)*\/?$/;

@ApiTags('copilot')
@Controller('copilot')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class CopilotController {
    private readonly logger = new Logger(CopilotController.name);

    constructor(private readonly copilotService: CopilotService) {}

    // ─── Platform Copilot Chat (existing) ───────────────────────────────────

    @Post('chat')
    @UseGuards(CopilotChatRateLimitGuard)
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Platform copilot chat (general assistant)' })
    async chat(
        @Body() body: CopilotChatClientRequest,
        @Req() req: any,
        @CurrentTenant() tenantId: string,
    ) {
        const request = this.buildAuthenticatedChatRequest(body, req?.user, tenantId);
        this.logger.log(`Copilot chat from user ${request.context.userName} on ${request.context.page}`);
        const result = await this.copilotService.chat(request);
        // Standard {success,data} envelope — the dashboard's apiPost returns the
        // backend JSON verbatim and both chat surfaces check `success`/`data.reply`.
        // Returning the bare object made every reply render as an error.
        return { success: true, data: result };
    }

    private buildAuthenticatedChatRequest(
        body: CopilotChatClientRequest,
        user: any,
        tenantId: string,
    ): CopilotChatRequest {
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new BadRequestException('Invalid chat request');
        }

        const unexpectedFields = Object.keys(body).filter((key) => !CHAT_ALLOWED_FIELDS.has(key));
        if (unexpectedFields.length > 0) {
            throw new BadRequestException(`Unexpected chat fields: ${unexpectedFields.sort().join(', ')}`);
        }

        if (!user || typeof user.role !== 'string') {
            throw new UnauthorizedException('Authenticated user required');
        }
        if (typeof tenantId !== 'string' || !UUID_PATTERN.test(tenantId)) {
            throw new ForbiddenException('A valid tenant context is required');
        }

        const message = this.readBoundedText(body.message, 'message', MAX_CHAT_MESSAGE_LENGTH);
        const page = this.readInternalAdminPage(body.page);
        const locale = this.readSupportedLocale(body.locale);
        const history = this.readChatHistory(body.history);
        const userName = this.authenticatedUserName(user, locale);

        return {
            message,
            history,
            context: {
                page,
                tenantId,
                userName,
                userRole: user.role,
                locale,
            },
        };
    }

    private readBoundedText(value: unknown, field: string, maxLength: number): string {
        if (typeof value !== 'string') {
            throw new BadRequestException(`${field} must be a string`);
        }
        const text = value.trim();
        if (!text || text.length > maxLength) {
            throw new BadRequestException(`${field} must contain between 1 and ${maxLength} characters`);
        }
        return text;
    }

    private readSupportedLocale(value: unknown): string {
        if (typeof value !== 'string') {
            throw new BadRequestException('locale must be a supported language');
        }
        const normalized = value.trim().toLowerCase();
        if (!CHAT_LOCALES.has(normalized)) {
            throw new BadRequestException('locale must be one of: es, en, pt, fr');
        }
        return normalized;
    }

    private readInternalAdminPage(value: unknown): string {
        if (typeof value !== 'string') {
            throw new BadRequestException('page must be an internal dashboard path');
        }
        const page = value.trim();
        if (
            !page
            || page.length > MAX_CHAT_PAGE_LENGTH
            || !INTERNAL_ADMIN_PAGE_PATTERN.test(page)
            || page.includes('..')
        ) {
            throw new BadRequestException('page must be an internal /admin path');
        }
        return page === '/admin/' ? '/admin' : page.replace(/\/$/, '');
    }

    private readChatHistory(value: unknown): CopilotChatRequest['history'] {
        if (value === undefined) return [];
        if (!Array.isArray(value) || value.length > MAX_CHAT_HISTORY_ITEMS) {
            throw new BadRequestException(`history must contain at most ${MAX_CHAT_HISTORY_ITEMS} messages`);
        }

        let totalLength = 0;
        const history = value.map((entry, index) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                throw new BadRequestException(`history[${index}] is invalid`);
            }
            const record = entry as Record<string, unknown>;
            const unexpectedFields = Object.keys(record).filter((key) => key !== 'role' && key !== 'content');
            if (unexpectedFields.length > 0 || (record.role !== 'user' && record.role !== 'assistant')) {
                throw new BadRequestException(`history[${index}] has an invalid role or fields`);
            }
            const role: 'user' | 'assistant' = record.role;
            const content = this.readBoundedText(
                record.content,
                `history[${index}].content`,
                MAX_CHAT_HISTORY_CONTENT_LENGTH,
            );
            totalLength += content.length;
            if (totalLength > MAX_CHAT_HISTORY_TOTAL_LENGTH) {
                throw new BadRequestException('history is too long');
            }
            return { role, content };
        });

        return history;
    }

    private authenticatedUserName(user: any, locale: string): string {
        const candidate = [user.firstName, user.displayName]
            .find((value) => typeof value === 'string' && value.trim()) as string | undefined;
        const fallback: Record<string, string> = {
            es: 'Usuario autenticado',
            en: 'Authenticated user',
            pt: 'Usuário autenticado',
            fr: 'Utilisateur authentifié',
        };
        if (!candidate) return fallback[locale] || fallback.en;
        const sanitized = Array.from(candidate, (character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint <= 31 || codePoint === 127 ? ' ' : character;
        }).join('');
        return sanitized.trim().slice(0, 120) || fallback[locale] || fallback.en;
    }

    // ─── Conversation Copilot Endpoints ─────────────────────────────────────

    @Get(':conversationId/suggestions')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Get 3 AI-suggested replies for a conversation' })
    async getSuggestions(
        @CurrentTenant() tenantId: string,
        @Param('conversationId') conversationId: string,
        @Req() req: any,
    ) {
        this.logger.log(`Suggestions requested for conversation ${conversationId}`);
        const suggestions = await this.copilotService.getSuggestions(
            tenantId, conversationId, req.user.id, req.user.role,
        );
        return { success: true, data: suggestions };
    }

    @Get(':conversationId/summary')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Get AI-generated conversation summary' })
    async getSummary(
        @CurrentTenant() tenantId: string,
        @Param('conversationId') conversationId: string,
        @Req() req: any,
    ) {
        this.logger.log(`Summary requested for conversation ${conversationId}`);
        const summary = await this.copilotService.getSummary(
            tenantId, conversationId, req.user.id, req.user.role,
        );
        return { success: true, data: summary };
    }

    @Get(':conversationId/intent')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Detect customer intent from conversation' })
    async detectIntent(
        @CurrentTenant() tenantId: string,
        @Param('conversationId') conversationId: string,
        @Req() req: any,
    ) {
        this.logger.log(`Intent detection requested for conversation ${conversationId}`);
        const intent = await this.copilotService.detectIntent(
            tenantId, conversationId, req.user.id, req.user.role,
        );
        return { success: true, data: intent };
    }

    @Post(':conversationId/rewrite')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Rewrite an agent draft reply in a given tone' })
    async rewriteReply(
        @CurrentTenant() tenantId: string,
        @Param('conversationId') conversationId: string,
        @Body() body: { draft: string; tone: string },
        @Req() req: any,
    ) {
        const result = await this.copilotService.rewriteReply(
            tenantId,
            body?.draft || '',
            body?.tone || 'professional',
            conversationId,
            req.user.id,
            req.user.role,
        );
        return { success: true, data: result };
    }

    @Post(':conversationId/ask')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Agent asks Copilot a question about the conversation' })
    async askCopilot(
        @CurrentTenant() tenantId: string,
        @Param('conversationId') conversationId: string,
        @Body() body: { query: string },
        @Req() req: any,
    ) {
        this.logger.log(`Agent asking copilot about conversation ${conversationId}: "${body.query}"`);
        const answer = await this.copilotService.getContextualHelp(
            tenantId,
            conversationId,
            body.query,
            req.user.id,
            req.user.role,
        );
        return { success: true, data: answer };
    }
}
