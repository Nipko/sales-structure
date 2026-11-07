import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantBoardService } from './tenant-board.service';

/**
 * Tablero de tenants para el dueño de la plataforma.
 *
 * Ruta de plataforma, no de tenant: cruza todos los negocios para responder si
 * cada uno está configurado, en vivo, con canales sanos, entregando respuestas
 * y con sus tools funcionando. Sólo lee; nunca dispara una evaluación nueva.
 */
@ApiTags('admin-tenant-board')
@ApiBearerAuth()
@Controller('admin/tenant-board')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
export class TenantBoardController {
    constructor(private readonly board: TenantBoardService) { }

    @Get()
    @ApiOperation({ summary: 'Health of every tenant (setup, go-live, channels, delivery, tools) with explicit reasons' })
    async getBoard(@Query('refresh') refresh?: string) {
        return { success: true, data: await this.board.getBoard({ refresh: refresh === 'true' || refresh === '1' }) };
    }
}
