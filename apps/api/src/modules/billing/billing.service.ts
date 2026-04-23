import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * Provider-agnostic subscription billing service.
 *
 * Orchestrates subscription lifecycle by delegating provider-specific work to
 * an IPaymentProvider adapter resolved per-tenant, while owning the internal
 * state machine and emitting normalized BillingEventType events.
 *
 * Scope of this file during Sprint 1.2: class skeleton only. Method bodies
 * land in Sprint 1.4 together with the full persistence + event-emission
 * logic.
 */
@Injectable()
export class BillingService {
    private readonly logger = new Logger(BillingService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    // TODO (Sprint 1.4): createTrialSubscription, upgradeSubscription,
    // cancelSubscription, handleBillingEvent, getActiveSubscription.
}
