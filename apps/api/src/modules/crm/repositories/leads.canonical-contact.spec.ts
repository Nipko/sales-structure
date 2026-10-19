import { BadRequestException } from '@nestjs/common';
import { LeadsRepository } from './leads.repository';

describe('Manual CRM lead operational contact', () => {
  const tenant = '11111111-1111-4111-8111-111111111111';
  const leadId = '22222222-2222-4222-8222-222222222222';
  const existingContact = '33333333-3333-4333-8333-333333333333';
  function setup(existing = false, failLead = false) {
    const writes: Array<{ sql: string; params: any[] }> = [];
    const query = jest.fn(async (sql: string, params: any[] = []) => {
      writes.push({ sql, params });
      if (sql.includes('SELECT id FROM contacts')) return existing ? [{ id: existingContact }] : [];
      if (sql.includes('INSERT INTO contacts')) return [{ id: params[0] }];
      if (sql.includes('INSERT INTO leads')) {
        if (failLead) throw new Error('lead insert failed');
        return [{ id: leadId }];
      }
      return [];
    });
    const prisma: any = {
      executeInTenantSchema: jest.fn((_s: string, sql: string, params: any[]) => query(sql, params)),
      transactionInTenantSchema: jest.fn((_s: string, fn: any) => fn(query)),
    };
    const repo = new LeadsRepository(prisma, { get: jest.fn().mockResolvedValue('tenant_qa') } as any,
      { resolveTenantStage: jest.fn().mockResolvedValue({ slug: 'consulta' }) } as any,
      { phoneRegionFor: jest.fn().mockResolvedValue('US') } as any);
    return { repo, prisma, writes };
  }
  it('creates a named operational contact and links the lead in one tenant transaction', async () => {
    const { repo, prisma, writes } = setup();
    await repo.createLead(tenant, { first_name: 'QA', last_name: 'Paciente', phone: '+12025550127', email: 'qa@example.invalid' } as any);
    expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
    expect(prisma.transactionInTenantSchema.mock.calls[0][0]).toBe('tenant_qa');
    expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    const contact = writes.find(x => x.sql.includes('INSERT INTO contacts'))!;
    const lead = writes.find(x => x.sql.includes('INSERT INTO leads'))!;
    expect(contact).toBeDefined();
    expect(contact.params).toContain('QA Paciente');
    expect(contact.params).toContain('manual');
    expect(contact.params).toContain('qa@example.invalid');
    const columns = /INSERT INTO leads \(([^)]+)\)/.exec(lead.sql)![1].split(', ').map(x => x.trim());
    expect(lead.params[columns.indexOf('contact_id')]).toBe(contact.params[0]);
  });
  it('rejects another tenant contact instead of linking it or inserting an orphan lead', async () => {
    const { repo, writes } = setup(false);
    await expect(repo.createLead(tenant, { phone: '+12025550127', contact_id: existingContact } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(writes.some(x => x.sql.includes('INSERT'))).toBe(false);
  });
  it('reuses an explicitly supplied own contact without creating a duplicate', async () => {
    const { repo, writes } = setup(true);
    await repo.createLead(tenant, { phone: '+12025550127', contact_id: existingContact } as any);
    expect(writes.some(x => x.sql.includes('INSERT INTO contacts'))).toBe(false);
    expect(writes.some(x => x.sql.includes('SELECT id FROM contacts'))).toBe(true);
  });
  it('propagates lead failure from inside the shared contact transaction', async () => {
    const { repo, prisma } = setup(false, true);
    await expect(repo.createLead(tenant, { phone: '+12025550127' } as any)).rejects.toThrow('lead insert failed');
    expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
    expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
  });
});
