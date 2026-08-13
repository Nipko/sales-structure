import { OnboardingMode, OnboardingStatus } from '../../common/enums/onboarding-status.enum';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService Business Portfolio resolution', () => {
  const tenantId = '090baca7-46da-4061-b5ea-7f72350178e6';
  const onboardingId = '11111111-1111-4111-8111-111111111111';
  const wabaId = 'waba-selected';
  const phone = {
    id: 'phone-1',
    displayPhoneNumber: '+573001112233',
    verifiedName: 'Parallext',
    qualityRating: 'GREEN',
  };

  function createHarness(options?: {
    directWaba?: Record<string, any>;
    discoveredWabas?: Array<Record<string, any>>;
    systemUserToken?: { accessToken: string; tokenType: string } | null;
  }) {
    let persistedOnboarding: Record<string, any> = {};
    const prisma = {
      whatsappOnboarding: {
        update: jest.fn().mockImplementation(async ({ data }: any) => {
          persistedOnboarding = { ...persistedOnboarding, ...data };
          return persistedOnboarding;
        }),
        findUnique: jest.fn().mockImplementation(async () => ({
          id: onboardingId,
          tenantId,
          mode: OnboardingMode.COEXISTENCE,
          isCoexistence: true,
          createdAt: new Date('2026-08-09T12:00:00Z'),
          ...persistedOnboarding,
        })),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ schemaName: 'tenant_test' }),
      },
      executeInTenantSchema: jest.fn().mockImplementation(async (...args: [string, string]) =>
        args[1].includes('SELECT id FROM whatsapp_channels') ? [{ id: 'channel-1' }] : [],
      ),
    };
    const metaGraph = {
      debugToken: jest.fn().mockResolvedValue({ isValid: true, type: 'USER', scopes: [] }),
      getWabaDirectly: jest.fn().mockResolvedValue(
        options?.directWaba || { id: wabaId, name: 'Selected WABA' },
      ),
      getBusinessAccountsForToken: jest.fn().mockResolvedValue(options?.discoveredWabas || []),
      getPhoneNumbersForWaba: jest.fn().mockResolvedValue([phone]),
      registerPhoneNumber: jest.fn().mockResolvedValue(true),
      generateSystemUserToken: jest.fn().mockResolvedValue(options?.systemUserToken ?? null),
      subscribeAppToWaba: jest.fn().mockResolvedValue(true),
      getBusinessVerificationStatus: jest.fn().mockResolvedValue('verified'),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const config = { get: jest.fn() };
    const service = new OnboardingService(
      prisma as any,
      metaGraph as any,
      config as any,
      audit as any,
    );

    jest.spyOn(service as any, 'registerChannelAccount').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'storeEncryptedCredential').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'syncTemplatesInBackground').mockImplementation(() => undefined);

    const continueOnboarding = (businessId?: string) => (service as any).continueOnboardingFromDiscovery(
      onboardingId,
      tenantId,
      'user-1',
      'long-lived-token',
      5184000,
      {
        businessId,
        phoneNumberId: phone.id,
        wabaId,
        mode: OnboardingMode.COEXISTENCE,
      },
    );

    return { service, prisma, metaGraph, audit, config, continueOnboarding };
  }

  function getAssetUpdate(prisma: any) {
    return prisma.whatsappOnboarding.update.mock.calls
      .map(([args]: any[]) => args.data)
      .find((data: any) => data.status === OnboardingStatus.ASSETS_DISCOVERED);
  }

  function getChannelInsert(prisma: any) {
    return prisma.executeInTenantSchema.mock.calls
      .find(([, sql]: any[]) => sql.includes('INSERT INTO whatsapp_channels'));
  }

  it('uses the portfolio correlated to the selected WABA when session_info disagrees', async () => {
    const harness = createHarness({
      discoveredWabas: [
        { id: wabaId, name: 'Selected WABA', businessId: 'business-from-discovery' },
      ],
    });

    await harness.continueOnboarding('business-from-session');

    expect(getAssetUpdate(harness.prisma)).toEqual(expect.objectContaining({
      metaBusinessId: 'business-from-discovery',
      wabaId,
    }));
    expect(getChannelInsert(harness.prisma)?.[2]).toEqual(expect.arrayContaining([
      'business-from-discovery',
      wabaId,
    ]));
    expect(getChannelInsert(harness.prisma)?.[2]?.slice(0, 2)).toEqual([
      'business-from-discovery',
      wabaId,
    ]);
    expect(harness.metaGraph.getBusinessVerificationStatus).toHaveBeenCalledWith(
      'business-from-discovery',
      'long-lived-token',
    );
    expect(harness.metaGraph.getBusinessAccountsForToken).toHaveBeenCalled();
  });

  it('correlates the selected WABA through /me/businesses when businessId is missing', async () => {
    const harness = createHarness({
      discoveredWabas: [
        { id: 'waba-other', name: 'Other WABA', businessId: 'business-other' },
        { id: wabaId, name: 'Selected WABA', businessId: 'business-owner' },
      ],
    });

    await harness.continueOnboarding();

    expect(getAssetUpdate(harness.prisma)).toEqual(expect.objectContaining({
      metaBusinessId: 'business-owner',
      wabaId,
    }));
    expect(getChannelInsert(harness.prisma)?.[2]?.slice(0, 2)).toEqual([
      'business-owner',
      wabaId,
    ]);
    expect(harness.metaGraph.getBusinessVerificationStatus).toHaveBeenCalledWith(
      'business-owner',
      'long-lived-token',
    );
  });

  it('stores a null Business ID and never queries verification with the WABA ID when fallback cannot resolve it', async () => {
    const harness = createHarness({
      discoveredWabas: [
        { id: 'waba-other', name: 'Other WABA', businessId: 'business-other' },
      ],
    });

    await harness.continueOnboarding();

    expect(getAssetUpdate(harness.prisma)).toEqual(expect.objectContaining({
      metaBusinessId: null,
      wabaId,
    }));
    expect(getChannelInsert(harness.prisma)?.[2]?.slice(0, 2)).toEqual([null, wabaId]);
    expect(harness.metaGraph.getBusinessVerificationStatus).not.toHaveBeenCalled();
  });

  it('uses the customer user token for portfolio verification even when a System User token exists', async () => {
    const harness = createHarness({
      discoveredWabas: [
        { id: wabaId, name: 'Selected WABA', businessId: 'business-owner' },
      ],
      systemUserToken: {
        accessToken: 'system-user-token',
        tokenType: 'system_user',
      },
    });

    await harness.continueOnboarding('business-owner');

    expect(harness.metaGraph.getBusinessVerificationStatus).toHaveBeenCalledWith(
      'business-owner',
      'long-lived-token',
    );
    expect(harness.metaGraph.getBusinessVerificationStatus).not.toHaveBeenCalledWith(
      'business-owner',
      'system-user-token',
    );
    expect(harness.metaGraph.subscribeAppToWaba).toHaveBeenCalledWith(
      wabaId,
      'system-user-token',
    );
    expect((harness.service as any).storeEncryptedCredential).toHaveBeenCalledWith(
      tenantId,
      'system-user-token',
      0,
    );
  });

  it('updates an existing phone row before inserting during asset resync', async () => {
    const harness = createHarness();

    await (harness.service as any).syncPhoneNumbersToDb(
      tenantId,
      'business-owner',
      wabaId,
      [phone],
    );

    const syncCall = harness.prisma.executeInTenantSchema.mock.calls
      .find(([, sql]: any[]) => sql.includes('WITH updated AS'));
    expect(syncCall?.[1]).toContain('UPDATE whatsapp_channels');
    expect(syncCall?.[1]).toContain('WHERE phone_number_id = $3');
    expect(syncCall?.[1]).toContain('WHERE NOT EXISTS (SELECT 1 FROM updated)');
    expect(syncCall?.[2]).toEqual([
      'business-owner',
      wabaId,
      phone.id,
      phone.displayPhoneNumber,
      phone.verifiedName,
      phone.qualityRating,
    ]);
  });

  it('notifies the API quality bridge after Embedded Signup completes', async () => {
    const harness = createHarness();
    harness.config.get.mockImplementation((key: string) => {
      if (key === 'API_INTERNAL_URL') return 'http://api:3000/api/v1';
      if (key === 'INTERNAL_API_KEY') return 'internal-secret';
      return undefined;
    });
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (globalThis as any).fetch = fetchMock;

    try {
      await (harness.service as any).notifyAgentQualityChannelUpdated(tenantId);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api:3000/api/v1/internal/agent-quality-channel-updated',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-internal-key': 'internal-secret' }),
        body: JSON.stringify({ tenantId }),
      }),
    );
  });
});
