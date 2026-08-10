import { BadRequestException } from '@nestjs/common';
import { LeadsRepository } from './leads.repository';

/**
 * Regression cover for the phantom-column bug.
 *
 * `ALLOWED_FIELDS` used to name five columns that `leads` never had — `source`,
 * `notes`, `tags`, `customer_profile_id` and `converted_at`. Because the mobile
 * app stamps `source: 'mobile'` on every lead, the whitelist promoted it into
 * the INSERT and Postgres rejected the statement with 42703
 * (`column "source" of relation "leads" does not exist`). Creating a lead from
 * the phone failed 100% of the time and surfaced as a button that did nothing.
 */
describe('LeadsRepository column whitelist', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const leadId = '22222222-2222-4222-8222-222222222222';

  // Columns that actually exist in prisma/tenant-schema.sql.
  const REAL_COLUMNS = new Set([
    'id', 'contact_id', 'company_id', 'first_name', 'last_name', 'phone',
    'phone_normalized', 'email', 'score', 'stage', 'primary_intent',
    'secondary_intent', 'is_vip', 'preferred_contact', 'campaign_id',
    'course_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
    'referrer_url', 'gclid', 'fbclid', 'assigned_to', 'opted_out',
    'opted_out_at', 'last_contacted_at', 'metadata', 'archived_at',
    'created_at', 'updated_at',
  ]);

  function setup() {
    const calls: Array<{ sql: string; values: any[] }> = [];
    const prisma: any = {
      executeInTenantSchema: jest.fn(async (_schema: string, sql: string, values: any[]) => {
        calls.push({ sql, values });
        return [{ id: leadId }];
      }),
    };
    const redis: any = { get: jest.fn().mockResolvedValue('tenant_test') };
    const pipeline: any = {
      resolveTenantStage: jest.fn().mockResolvedValue({ slug: 'nuevo' }),
    };
    return { repository: new LeadsRepository(prisma, redis, pipeline), calls };
  }

  /** Pulls the column list out of `INSERT INTO leads (a, b, c) VALUES …`. */
  function insertedColumns(sql: string): string[] {
    const match = sql.match(/INSERT INTO leads \(([^)]+)\)/);
    return match ? match[1].split(',').map((c) => c.trim()) : [];
  }

  /** Pulls the assigned columns out of `UPDATE leads SET a = $2, b = $3 …`. */
  function updatedColumns(sql: string): string[] {
    return Array.from(sql.matchAll(/(\w+) = \$\d+/g))
      .map((m) => m[1])
      .filter((c) => c !== 'updated_at');
  }

  it('never writes a column the leads table does not have', async () => {
    const { repository, calls } = setup();

    await repository.createLead(tenantId, {
      first_name: 'Camila',
      last_name: 'Restrepo',
      phone: '573000000101',
      email: 'camila.restrepo@ejemplo.com',
      source: 'mobile',
      notes: 'nota suelta',
      tags: ['a'],
      customer_profile_id: leadId,
      converted_at: new Date().toISOString(),
    } as any);

    const columns = insertedColumns(calls[0].sql);
    expect(columns.length).toBeGreaterThan(0);
    for (const column of columns) expect(REAL_COLUMNS).toContain(column);
    expect(columns).not.toContain('source');
    expect(columns).not.toContain('notes');
    expect(columns).not.toContain('tags');
    expect(columns).not.toContain('customer_profile_id');
    expect(columns).not.toContain('converted_at');
  });

  it('keeps the caller-supplied source in metadata instead of dropping it', async () => {
    const { repository, calls } = setup();

    await repository.createLead(tenantId, {
      first_name: 'Camila',
      phone: '573000000101',
      source: 'mobile',
    } as any);

    const columns = insertedColumns(calls[0].sql);
    const metadata = calls[0].values[columns.indexOf('metadata')];
    expect(metadata).toEqual(expect.objectContaining({ source: 'mobile' }));
  });

  it('merges folded keys into an existing metadata object', async () => {
    const { repository, calls } = setup();

    await repository.createLead(tenantId, {
      phone: '573000000101',
      metadata: { campaign: 'verano' },
      source: 'mobile',
    } as any);

    const columns = insertedColumns(calls[0].sql);
    const metadata = calls[0].values[columns.indexOf('metadata')];
    expect(metadata).toEqual({ campaign: 'verano', source: 'mobile' });
  });

  it('rejects a lead without a phone instead of letting NOT NULL raise a 500', async () => {
    const { repository, calls } = setup();

    await expect(repository.createLead(tenantId, { first_name: 'Camila' } as any))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(0);
  });

  it('applies the same whitelist on update', async () => {
    const { repository, calls } = setup();

    await repository.updateLead(tenantId, leadId, {
      first_name: 'Camila',
      source: 'mobile',
      converted_at: new Date().toISOString(),
    } as any);

    const columns = updatedColumns(calls[0].sql);
    for (const column of columns) expect(REAL_COLUMNS).toContain(column);
    expect(columns).not.toContain('source');
    expect(columns).not.toContain('converted_at');
    expect(columns).toContain('first_name');
  });
});
