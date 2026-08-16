import {
    CanActivate,
    Controller,
    ExecutionContext,
    Get,
    INestApplication,
    Injectable,
    UseGuards,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { get as httpGet } from 'node:http';
import { AddressInfo } from 'node:net';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { RedisService } from '../../modules/redis/redis.service';
import { SubscriptionGuard } from '../guards/subscription.guard';
import { SubscriptionEnforcementInterceptor } from './subscription-enforcement.interceptor';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

@Injectable()
class PopulateAuthenticatedUserGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        context.switchToHttp().getRequest().user = {
            role: 'tenant_admin',
            tenantId: TENANT_ID,
        };
        return true;
    }
}

@Controller('protected-test-route')
@UseGuards(PopulateAuthenticatedUserGuard)
class ProtectedTestController {
    @Get()
    read(): { leaked: boolean } {
        return { leaked: true };
    }
}

describe('SubscriptionEnforcementInterceptor request order', () => {
    let app: INestApplication;

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({
            controllers: [ProtectedTestController],
            providers: [
                PopulateAuthenticatedUserGuard,
                SubscriptionGuard,
                SubscriptionEnforcementInterceptor,
                {
                    provide: APP_INTERCEPTOR,
                    useExisting: SubscriptionEnforcementInterceptor,
                },
                {
                    provide: PrismaService,
                    useValue: {
                        tenant: {
                            findUnique: jest.fn().mockResolvedValue({
                                isInternal: false,
                                subscriptionStatus: 'pending_auth',
                                subscription: {
                                    status: 'pending_auth',
                                    trialEndsAt: null,
                                    cancelAtPeriodEnd: false,
                                    currentPeriodEnd: null,
                                    cancellationReason: null,
                                    dunningStartedAt: null,
                                },
                            }),
                        },
                        billingSubscription: { findUnique: jest.fn() },
                    },
                },
                {
                    provide: RedisService,
                    useValue: {
                        get: jest.fn().mockResolvedValue('pending_auth'),
                        set: jest.fn(),
                    },
                },
            ],
        }).compile();

        app = moduleRef.createNestApplication();
        await app.listen(0, '127.0.0.1');
    });

    afterEach(async () => {
        await app.close();
    });

    it('blocks pending_auth only after the route auth guard has populated request.user', async () => {
        const address = app.getHttpServer().address() as AddressInfo;
        const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            httpGet(`http://127.0.0.1:${address.port}/protected-test-route`, (res) => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
            }).on('error', reject);
        });

        expect(response.status).toBe(403);
        expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
            error: 'payment_method_required',
        }));
    });
});
