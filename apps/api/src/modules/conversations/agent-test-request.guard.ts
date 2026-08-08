import {
    CanActivate,
    ExecutionContext,
    Injectable,
    ValidationPipe,
} from '@nestjs/common';
import { AgentTestRequestDto } from './dto/agent-test-request.dto';

/**
 * Guards run before the application's global whitelist pipe. Validating the
 * raw body here is what lets this endpoint reject (instead of silently strip)
 * unknown top-level and nested fields without changing every API contract.
 */
@Injectable()
export class AgentTestRequestGuard implements CanActivate {
    private readonly pipe = new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
        transformOptions: { enableImplicitConversion: false },
    });

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        request.body = await this.pipe.transform(request.body, {
            type: 'body',
            metatype: AgentTestRequestDto,
        });
        return true;
    }
}
