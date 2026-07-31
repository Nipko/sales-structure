import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewsService } from './reviews.service';
import { CronLockService } from '../redis/cron-lock.service';

/**
 * Reviews cron (T3.23): every 6h, sync GBP reviews for connected tenants and
 * auto-reply when the tenant enabled it.
 */
@Injectable()
export class ReviewsCronService {
    private readonly logger = new Logger(ReviewsCronService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly reviews: ReviewsService,
        private readonly cronLock: CronLockService,
    ) {}

    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('30 */6 * * *')
    async syncAllCron() {
        await this.cronLock.runExclusive('reviews-cron.syncAll', 3600, () => this.syncAll());
    }

    async syncAll(): Promise<void> {
        let tenants: any[] = [];
        try {
            tenants = await this.prisma.$queryRaw<any[]>`
                SELECT id FROM tenants
                WHERE is_active = true AND settings -> 'googleBusiness' ->> 'encryptedRefreshToken' IS NOT NULL`;
        } catch (e: any) {
            this.logger.error(`[Reviews] tenant scan failed: ${e.message}`);
            return;
        }

        for (const tenant of tenants) {
            try {
                await this.reviews.syncReviews(tenant.id);
                if (await this.reviews.isAutoReplyEnabled(tenant.id)) {
                    const n = await this.reviews.autoReplyUnreplied(tenant.id);
                    if (n > 0) this.logger.log(`[Reviews] auto-replied ${n} reviews for tenant ${tenant.id}`);
                }
            } catch (e: any) {
                this.logger.warn(`[Reviews] sync failed for tenant ${tenant.id}: ${e.message}`);
            }
        }
    }
}
