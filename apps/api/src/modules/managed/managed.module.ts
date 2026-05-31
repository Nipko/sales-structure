import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ManagedService } from './managed.service';
import { ManagedController } from './managed.controller';

/**
 * Managed / done-for-you tier (T3.24): resolution-guarantee tracking for
 * outcome-based, super-admin-operated accounts.
 */
@Module({
    imports: [PrismaModule],
    providers: [ManagedService],
    controllers: [ManagedController],
    exports: [ManagedService],
})
export class ManagedModule {}
