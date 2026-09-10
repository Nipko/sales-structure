import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { AIToolExecutorService } from '../conversations/ai-tool-executor.service';
import { PropertiesService } from '../vacation-rental/properties.service';
import { ChannelManagerService } from './channel-manager.service';
import { LodgingSourceOfTruthService } from './lodging-source-of-truth.service';

const tenant = '11111111-1111-4111-8111-111111111111';
const property = '22222222-2222-4222-8222-222222222222';
describe('lodging ownership isolation in evaluation', () => {
    const make = () => {
        const redis = { get: jest.fn(async () => '4'), getJson: jest.fn(async () => ({ sor:'local', connected:false, stale:false, health:'healthy' })), setJson: jest.fn() };
        const prisma = { executeInTenantSchema: jest.fn(async () => [{ id:property, provider:'hostaway', last_synced_at:new Date() }]),
            tenant: { findUnique: jest.fn(async () => ({ settings: { channelManager: { provider:'hostaway', syncInterval:30,
                apiKey:'never-decrypt-for-evaluation', apiSecret:'never-serialize-for-evaluation' } } })) } };
        const manager = new ChannelManagerService(prisma as any,redis as any,{} as any,{} as any);
        const config = jest.spyOn(manager,'getConfig').mockRejectedValue(new Error('secret_decryption_unavailable'));
        return { redis,prisma,manager,config,service:new LodgingSourceOfTruthService(prisma as any,redis as any,manager) };
    };
    it.each(['tenant_source','tenant_eval_owned'])('reads %s mapping without the live ownership cache or credentials', async schema => {
        const { service,redis,prisma,config } = make();
        const result = await service.resolveForProperty(tenant,schema,property,AGENT_TEST_EXECUTION_CONTEXT);
        expect(result.sor).toBe('channel_manager');
        expect(result.writerBlockedReason).toBe('channel_manager_owns_calendar');
        expect(prisma.executeInTenantSchema).toHaveBeenCalledWith(schema,expect.stringContaining('FROM cm_listings'),[property]);
        expect(redis.get).not.toHaveBeenCalled(); expect(redis.getJson).not.toHaveBeenCalled(); expect(redis.setJson).not.toHaveBeenCalled();
        expect(config).not.toHaveBeenCalled();
        expect(JSON.stringify(result)).not.toContain('never-');
    });
    it('also isolates an older namespace caller that omits execution context', async () => {
        const { service,redis,config } = make();
        expect((await service.resolveForProperty(tenant,'tenant_eval_owned',property)).sor).toBe('channel_manager');
        expect(redis.get).not.toHaveBeenCalled(); expect(config).not.toHaveBeenCalled();
    });
    it('keeps an unbound unit uncertain when the real tenant has an external system of record', async () => {
        const { service,prisma } = make();
        prisma.executeInTenantSchema.mockResolvedValue([]);
        const result = await service.resolveForProperty(tenant,'tenant_eval_owned',property,AGENT_TEST_EXECUTION_CONTEXT);
        expect(result).toMatchObject({ sor:'unknown', connected:true, writerBlockedReason:'ownership_unknown' });
    });
    it('never treats unavailable tenant ownership configuration as no external provider', async () => {
        const { service,prisma } = make();
        prisma.executeInTenantSchema.mockResolvedValue([]);
        prisma.tenant.findUnique.mockRejectedValue(new Error('database_unavailable'));
        expect((await service.resolveForProperty(tenant,'tenant_source',property,AGENT_TEST_EXECUTION_CONTEXT)).sor).toBe('unknown');
    });
    it('projects only nonsecret ownership fields and rejects missing/unknown tenant ownership', async () => {
        const { manager,prisma } = make();
        expect(await manager.getOwnershipConfig(tenant)).toEqual({ provider:'hostaway', syncInterval:30 });
        prisma.tenant.findUnique.mockResolvedValue(null as any);
        await expect(manager.getOwnershipConfig(tenant)).rejects.toThrow('tenant_not_found');
        prisma.tenant.findUnique.mockResolvedValue({settings:{channelManager:{provider:'unreviewed'}}} as any);
        await expect(manager.getOwnershipConfig(tenant)).rejects.toThrow('channel_manager_provider_invalid');
    });
    it('propagates context through both executor readers and the domain availability reader', async () => {
        const properties = { checkAvailability: jest.fn(async () => ({available:true,totalPrice:1,nights:1})) };
        const executor = Object.create(AIToolExecutorService.prototype) as any;
        Object.assign(executor,{ propertiesService:properties, prisma:{$queryRawUnsafe:async () => [{id:property}]},logger:{warn:jest.fn()} });
        await executor.listProperties('tenant_source',1,'2027-01-01','2027-01-02',tenant,AGENT_TEST_EXECUTION_CONTEXT);
        await executor.checkPropertyAvailability('tenant_source',property,'2027-01-01','2027-01-02',undefined,tenant,AGENT_TEST_EXECUTION_CONTEXT);
        expect(properties.checkAvailability).toHaveBeenCalledWith('tenant_source',property,'2027-01-01','2027-01-02',tenant,AGENT_TEST_EXECUTION_CONTEXT);
        const sor = { resolveForProperty:jest.fn(async () => ({sor:'local',connected:false,stale:false,health:'unknown'})) };
        const domain = new PropertiesService({ executeInTenantSchema:async (_schema:string,sql:string) => sql.includes('SELECT * FROM properties')
            ?[{id:property,is_active:true,night_price:1,cleaning_fee:0,min_nights:1}]:[] } as any,{} as any,{} as any,sor as any);
        await domain.checkAvailability('tenant_source',property,'2027-01-01','2027-01-02',tenant,AGENT_TEST_EXECUTION_CONTEXT);
        expect(sor.resolveForProperty).toHaveBeenCalledWith(tenant,'tenant_source',property,AGENT_TEST_EXECUTION_CONTEXT);
    });
});
