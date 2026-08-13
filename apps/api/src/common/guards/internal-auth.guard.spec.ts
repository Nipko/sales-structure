import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InternalAuthGuard } from './internal-auth.guard';

function contextFor(headers: Record<string, string>): { context: ExecutionContext; request: any } {
  const request: any = { headers };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext,
  };
}

describe('InternalAuthGuard', () => {
  it('rejects dashboard bearer tokens when no internal key is present', async () => {
    const guard = new InternalAuthGuard({ get: jest.fn().mockReturnValue('internal-secret') } as any);
    const { context } = contextFor({ authorization: 'Bearer dashboard-jwt' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an invalid internal key', async () => {
    const guard = new InternalAuthGuard({ get: jest.fn().mockReturnValue('internal-secret') } as any);
    const { context } = contextFor({ 'x-internal-key': 'wrong-secret' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts the configured key and marks the caller as an internal service', async () => {
    const guard = new InternalAuthGuard({ get: jest.fn().mockReturnValue('internal-secret') } as any);
    const { context, request } = contextFor({
      'x-internal-key': 'internal-secret',
      'x-tenant-id': '11111111-1111-4111-8111-111111111111',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({
      id: 'internal-service',
      role: 'super_admin',
      tenantId: '11111111-1111-4111-8111-111111111111',
      isInternalService: true,
    });
  });
});
