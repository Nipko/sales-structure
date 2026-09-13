import { randomUUID } from 'crypto';
import { WatchtowerService } from './watchtower.service';
import { watchtowerWindow } from './watchtower-schema';

describe('Watchtower schedule and scope',()=>{
    it('uses a complete UTC day across month/year transitions',()=>{
        expect(watchtowerWindow(new Date('2027-01-01T03:00:00Z'))).toEqual({day:'2026-12-31',start:'2026-12-31T00:00:00.000Z',end:'2027-01-01T00:00:00.000Z'});
        expect(()=>watchtowerWindow(new Date('invalid'))).toThrow('invalid_sampling_time');
    });
    it('paginates beyond the first tenants and continues after a tenant failure',async()=>{
        const tenants=Array.from({length:29},()=>({id:randomUUID()}));
        const prisma={tenant:{findMany:jest.fn().mockResolvedValueOnce(tenants.slice(0,25)).mockResolvedValueOnce(tenants.slice(25))}};
        const service=new WatchtowerService(prisma as any,{} as any);
        const capture=jest.spyOn(service,'capture').mockResolvedValue(undefined).mockRejectedValueOnce(new Error('database unavailable'));
        const dispatch=jest.spyOn(service,'dispatch').mockResolvedValue(undefined);
        await service.sampleDaily();
        expect(capture).toHaveBeenCalledTimes(29);expect(dispatch).toHaveBeenCalledTimes(28);
        expect(prisma.tenant.findMany.mock.calls[1][0]).toMatchObject({cursor:{id:tenants[24].id},skip:1});
    });
    it('rejects invalid dates and tenant ids before any SQL',async()=>{
        const prisma={getTenantSchemaName:jest.fn()};const service=new WatchtowerService(prisma as any,{} as any);
        await expect(service.report(randomUUID(),'2026-02-31')).rejects.toThrow();
        await expect(service.capture('other schema')).rejects.toThrow();
        expect(prisma.getTenantSchemaName).not.toHaveBeenCalled();
    });
});
