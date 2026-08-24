import { WhatsappConnectionService } from './whatsapp-connection.service';

function setup(denyNew = false) {
  const sqlCalls: string[] = [];
  const prisma = {
    tenant: {
      findUnique: jest.fn(async () => ({ id: 'tenant-1', schemaName: 'tenant_schema' })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    channelAccount: {
      count: jest.fn(async () => 1),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: 'account-new' })),
    },
    whatsappCredential: {
      findFirst: jest.fn(async () => ({ id: 'credential-1', encryptedValue: 'encrypted-old', expiresAt: null })),
      update: jest.fn(async () => ({})),
      create: jest.fn(async () => ({})),
    },
    executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
      sqlCalls.push(sql);
      if (sql.includes('SELECT DISTINCT meta_waba_id')) return [{ meta_waba_id: 'waba-old' }];
      if (sql.includes('INSERT INTO whatsapp_channels')) return [{ id: 'channel-new' }];
      return [];
    }),
  };
  const crypto = {
    decryptToken: jest.fn(() => 'permanent-old-token'),
    encryptToken: jest.fn(() => 'encrypted-selected'),
  };
  const throttle = { enforceChannelAccountLimit: jest.fn(async () => undefined) };
  const service = new WhatsappConnectionService(prisma as any, crypto as any, {} as any, throttle as any);
  const originalFetch = global.fetch;
  global.fetch = jest.fn(async (url: string) => {
    const wabaId = url.includes('waba-new') ? 'waba-new' : 'waba-old';
    if (denyNew && wabaId === 'waba-new') {
      return { ok: false, json: async () => ({ error: { code: 200 } }) } as any;
    }
    return { ok: true, json: async () => ({ id: wabaId }) } as any;
  }) as any;
  return { service, prisma, crypto, sqlCalls, restore: () => { global.fetch = originalFetch; } };
}

describe('manual WhatsApp connection credential coverage', () => {
  it('keeps a permanent credential when it covers all existing and new WABAs', async () => {
    const h = setup();
    try {
      await h.service.saveConnection('tenant_schema', 'tenant-1', {
        phoneNumberId: 'phone-new', wabaId: 'waba-new', accessToken: 'temporary-new',
      });
    } finally { h.restore(); }

    expect(h.prisma.whatsappCredential.update).not.toHaveBeenCalled();
    expect(h.crypto.encryptToken).toHaveBeenCalledWith('permanent-old-token');
    expect(h.prisma.channelAccount.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: expect.objectContaining({ wabaId: 'waba-new' }) }),
    }));
  });

  it('fails before channel mutation when replacing the permanent token would reduce coverage', async () => {
    const h = setup(true);
    try {
      await expect(h.service.saveConnection('tenant_schema', 'tenant-1', {
        phoneNumberId: 'phone-new', wabaId: 'waba-new', accessToken: 'temporary-new',
      })).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'whatsapp_token_coverage_required' }),
      });
    } finally { h.restore(); }

    expect(h.sqlCalls.some(sql => sql.includes('DELETE FROM whatsapp_channels'))).toBe(false);
    expect(h.prisma.channelAccount.create).not.toHaveBeenCalled();
  });
});
