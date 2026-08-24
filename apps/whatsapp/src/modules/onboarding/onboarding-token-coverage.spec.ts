import * as fs from 'fs';
import * as path from 'path';
import { OnboardingService } from './onboarding.service';

function harness(options: { existingExpiresAt: Date | null; denied?: string }) {
  const prisma = {
    tenant: { findUnique: jest.fn(async () => ({ schemaName: 'tenant_schema' })) },
    executeInTenantSchema: jest.fn(async () => [{ meta_waba_id: 'waba-old' }]),
    whatsappCredential: {
      findFirst: jest.fn(async () => ({ encryptedValue: 'encrypted-existing', expiresAt: options.existingExpiresAt })),
    },
  };
  const metaGraph = {
    getWabaDirectly: jest.fn(async (wabaId: string, token: string) => {
      if (wabaId === options.denied) throw new Error('permission denied');
      return { id: wabaId, token };
    }),
  };
  const service = new OnboardingService(prisma as any, metaGraph as any, {} as any, {} as any);
  jest.spyOn(service as any, 'decryptToken').mockReturnValue('permanent-existing');
  return { service, metaGraph };
}

describe('Embedded Signup tenant-wide token coverage', () => {
  it('retains an existing permanent token when it covers the new WABA', async () => {
    const { service, metaGraph } = harness({ existingExpiresAt: null });
    const result = await (service as any).resolveCredentialForCoverage(
      'tenant-1', 'waba-new', 'temporary-candidate', 5_184_000,
    );

    expect(result).toEqual({ accessToken: 'permanent-existing', expiresInSeconds: 0 });
    expect(metaGraph.getWabaDirectly).toHaveBeenCalledWith('waba-old', 'permanent-existing');
    expect(metaGraph.getWabaDirectly).toHaveBeenCalledWith('waba-new', 'permanent-existing');
  });

  it('fails closed instead of degrading a permanent token that lacks new-WABA coverage', async () => {
    const { service } = harness({ existingExpiresAt: null, denied: 'waba-new' });
    await expect((service as any).resolveCredentialForCoverage(
      'tenant-1', 'waba-new', 'temporary-candidate', 5_184_000,
    )).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'WHATSAPP_TOKEN_COVERAGE_REQUIRED' }),
    });
  });

  it('validates a newly generated permanent token against old and new WABAs', async () => {
    const { service, metaGraph } = harness({ existingExpiresAt: new Date() });
    const result = await (service as any).resolveCredentialForCoverage(
      'tenant-1', 'waba-new', 'new-system-token', 0,
    );
    expect(result).toEqual({ accessToken: 'new-system-token', expiresInSeconds: 0 });
    expect(metaGraph.getWabaDirectly).toHaveBeenCalledWith('waba-old', 'new-system-token');
    expect(metaGraph.getWabaDirectly).toHaveBeenCalledWith('waba-new', 'new-system-token');
  });

  it('checks quota and coverage before publishing the channel row', () => {
    const source = fs.readFileSync(path.join(__dirname, 'onboarding.service.ts'), 'utf8');
    const quota = source.indexOf("assertChannelAccountQuotaViaApi(tenantId, 'whatsapp', primaryPhone.id)");
    const coverage = source.indexOf('resolveCredentialForCoverage(');
    const persist = source.indexOf('await this.persistWhatsAppChannel(', coverage);
    expect(quota).toBeGreaterThan(0);
    expect(coverage).toBeGreaterThan(quota);
    expect(persist).toBeGreaterThan(coverage);
  });
});
