import { Module } from '@nestjs/common';
import { TenantBoardController } from './tenant-board.controller';
import { TenantBoardRepository } from './tenant-board.repository';
import { TenantBoardService } from './tenant-board.service';

/**
 * Tablero de tenants del superadmin. Prisma es global, así que este módulo no
 * importa nada y no puede formar ciclos.
 */
@Module({
    controllers: [TenantBoardController],
    providers: [TenantBoardRepository, TenantBoardService],
})
export class TenantBoardModule { }
