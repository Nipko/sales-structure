import { Controller, Get, Post, Body, Param, UseGuards, Logger, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ConversationsService } from './conversations.service';
import { PreChatService } from './pre-chat.service';
import { ActiveOperationsContextService } from './active-operations-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { PersonaService } from '../persona/persona.service';
import { NormalizedMessage } from '@parallext/shared';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@ApiTags('conversations')
@Controller('conversations')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class ConversationsController {
    private readonly logger = new Logger(ConversationsController.name);

    constructor(
        private conversationsService: ConversationsService,
        private preChatService: PreChatService,
        private readonly activeOperations: ActiveOperationsContextService,
        private readonly prisma: PrismaService,
        private readonly personaService: PersonaService,
    ) { }

    /**
     * Los objetos operativos abiertos del contacto de esta conversación.
     *
     * El agente de IA recibe esto en cada turno desde hace un release; quien
     * atiende, no. Leía "confirmame la reserva" y tenía que adivinar cuál,
     * salir a buscarla y volver. Se devuelve el MISMO contrato acotado que ve
     * el modelo —tipo, estado, referencia, fechas, importe, sujeto— y nada
     * más: el panel del Inbox no es una ventana a la base.
     */
    @Get(':tenantId/:conversationId/active-objects')
    @ApiOperation({ summary: 'Active operational objects for this conversation, same bounded contract the agent sees' })
    async getActiveObjects(
        @Param('tenantId') tenantId: string,
        @Param('conversationId') conversationId: string,
    ) {
        if (!UUID_PATTERN.test(conversationId)) {
            throw new BadRequestException('conversationId must be a valid UUID');
        }
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT contact_id FROM conversations WHERE id = $1::uuid LIMIT 1`,
            [conversationId],
        );
        const contactId = rows?.[0]?.contact_id || null;
        // Sin contacto no hay objetos que mostrar, y eso NO es un error: una
        // conversación recién abierta por un número desconocido está en ese
        // estado. Devolver vacío es la verdad; fallar mandaría a buscar un
        // problema que no existe.
        if (!contactId) return { success: true, data: { items: [] } };

        const config = await this.personaService.getActivePersona(tenantId).catch(() => null);
        const result = await this.activeOperations.load({
            tenantId,
            schemaName,
            contactId,
            config: (config || {}) as any,
        });
        return {
            success: true,
            data: result.activeObjects || { items: [] },
            // Un loader caído no puede parecer "este contacto no tiene nada".
            degraded: result.failures.length > 0 ? result.failures.map(f => f.loader) : undefined,
        };
    }

    @Get('prechat-form/:tenantId')
    @ApiOperation({ summary: 'Get active pre-chat form for a tenant' })
    async getPrechatForm(@Param('tenantId') tenantId: string) {
        const form = await this.preChatService.getActiveForm(tenantId);
        return { success: true, data: form };
    }

    @Post('prechat-form/:tenantId')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Save pre-chat form configuration' })
    async savePrechatForm(
        @Param('tenantId') tenantId: string,
        @Body() body: { is_active: boolean; greeting_message?: string; fields: any[] },
    ) {
        const form = await this.preChatService.saveForm(tenantId, body);
        return { success: true, data: form };
    }

    @Post('test-message')
    @ApiOperation({ summary: 'Simulate an inbound message for testing' })
    async simulateMessage(
        @CurrentTenant() tenantId: string,
        @Body() body: { text: string; contactId: string; channelType: 'whatsapp' | 'instagram' }
    ) {
        if (process.env.NODE_ENV === 'production') {
            throw new ForbiddenException('This endpoint is disabled in production');
        }

        const mockMsg: NormalizedMessage = {
            id: 'mock-' + Date.now(),
            tenantId,
            channelType: body.channelType,
            contactId: body.contactId,
            channelAccountId: 'mock-account',
            conversationId: '',
            direction: 'inbound',
            content: { type: 'text', text: body.text },
            timestamp: new Date(),
            status: 'pending',
            metadata: {}
        };

        // Process asynchronously (do not await) to simulate webhook behavior
        this.conversationsService.processIncomingMessage(mockMsg).catch(err => {
            this.logger.error(`Error in simulated message: ${err}`);
        });

        return { success: true, message: 'Simulated message processing started' };
    }
}
