import {
    CallHandler,
    ExecutionContext,
    Injectable,
    NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { SubscriptionGuard } from '../guards/subscription.guard';

/**
 * Applies subscription access policy after route guards have authenticated the
 * request.  A global guard runs before controller-level AuthGuard('jwt'), when
 * `request.user` does not exist yet, and would therefore fail open for every
 * authenticated controller.  Nest interceptors run after all guards, so the
 * same policy sees the verified user/tenant while public routes remain public.
 */
@Injectable()
export class SubscriptionEnforcementInterceptor implements NestInterceptor {
    constructor(private readonly subscriptions: SubscriptionGuard) {}

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
        await this.subscriptions.canActivate(context);
        return next.handle();
    }
}
