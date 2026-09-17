import { WhatsappConnectionService } from './whatsapp-connection.service';

/**
 * ═══ THE HEADER READS THE CONNECTED NUMBER, NOT THE OLDEST ROW ═══
 *
 * A disconnected number keeps its `whatsapp_channels` row. `getChannelStatus`
 * answered with the OLDEST row, so once a tenant had disconnected one number
 * and connected another, the page header said "Desconectado" about a tenant
 * whose WhatsApp was working — the one screen somebody opens to check.
 *
 * `channel` is now the oldest CONNECTED row, falling back to the oldest row
 * when none is connected; `channels` keeps its order, because the profile and
 * template screens pick `channels[0]` and the template seeder groups by it.
 */
function serviceWith(rows: any[] | undefined) {
  const sql: string[] = [];
  const prisma = {
    executeInTenantSchema: jest.fn(async (_schema: string, query: string) => {
      sql.push(query);
      return rows;
    }),
  };
  const service = new WhatsappConnectionService(prisma as any, {} as any, {} as any, {} as any);
  return { service, sql };
}

const channel = (id: string, status: string | null, connectedAt: string) => ({
  id, channel_status: status, connected_at: new Date(connectedAt),
  phone_number_id: `phone-${id}`, meta_waba_id: `waba-${id}`, display_phone_number: `+57 ${id}`,
});

describe('WhatsApp channel status', () => {
  it('reports the newer connected number when the oldest row is a disconnected leftover', async () => {
    const rows = [channel('old', 'disconnected', '2026-09-10'), channel('new', 'connected', '2026-09-16')];
    const { service } = serviceWith(rows);

    const result = await service.getChannelStatus('tenant_schema');

    expect(result.status).toBe('connected');
    expect(result.channel).toBe(rows[1]);
    // Order unchanged: consumers that read channels[0] see what they saw before.
    expect(result.channels.map((entry: any) => entry.id)).toEqual(['old', 'new']);
  });

  it('picks the OLDEST connected row when several are connected', async () => {
    const rows = [
      channel('gone', 'disconnected', '2026-09-01'),
      channel('first', 'connected', '2026-09-05'),
      channel('second', 'connected', '2026-09-12'),
    ];
    const { service } = serviceWith(rows);

    const result = await service.getChannelStatus('tenant_schema');

    expect(result.channel).toBe(rows[1]);
    expect(result.status).toBe('connected');
  });

  it('treats a stray capital or space as connected when choosing the row', async () => {
    const rows = [channel('old', 'disconnected', '2026-09-10'), channel('new', ' Connected ', '2026-09-16')];
    const { service } = serviceWith(rows);

    const result = await service.getChannelStatus('tenant_schema');

    expect(result.channel).toBe(rows[1]);
  });

  it('falls back to the oldest row and its status when nothing is connected', async () => {
    const rows = [channel('a', 'disconnected', '2026-09-01'), channel('b', 'pending', '2026-09-02')];
    const { service } = serviceWith(rows);

    const result = await service.getChannelStatus('tenant_schema');

    expect(result).toEqual({ status: 'disconnected', channel: rows[0], channels: rows });
  });

  it('answers disconnected with no channel when the tenant has no rows', async () => {
    await expect(serviceWith([]).service.getChannelStatus('tenant_schema'))
      .resolves.toEqual({ status: 'disconnected', channel: null, channels: [] });
    await expect(serviceWith(undefined).service.getChannelStatus('tenant_schema'))
      .resolves.toEqual({ status: 'disconnected', channel: null, channels: [] });
  });

  it('still orders the rows by connection time, oldest first', async () => {
    const { service, sql } = serviceWith([]);
    await service.getChannelStatus('tenant_schema');
    expect(sql[0]).toMatch(/ORDER BY connected_at ASC NULLS LAST/);
  });
});
