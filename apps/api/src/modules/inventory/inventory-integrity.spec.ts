import { InventoryService } from './inventory.service';

describe('Inventory read and input integrity',()=>{
    function service(rows:any[]=[]) {
        const prisma={executeInTenantSchema:jest.fn().mockResolvedValue(rows)};
        const instance=new InventoryService(prisma as any,{get:async(key:string)=>key.endsWith(':schema')?'tenant_inventory':'ready'} as any);
        return {instance,prisma};
    }
    it('propagates failed reads so order creation cannot confuse unavailable data with no products',async()=>{
        const {instance,prisma}=service();prisma.executeInTenantSchema.mockRejectedValue(new Error('connection failed'));
        await expect(instance.getProducts('tenant')).rejects.toThrow('connection failed');
    });
    it('returns a genuinely empty catalog only after successful reads',async()=>{
        const {instance}=service();await expect(instance.getProducts('tenant')).resolves.toEqual([]);
    });
    it('rejects malformed product names before attempting a write',async()=>{
        const {instance,prisma}=service();
        await expect(instance.updateProduct('tenant','11111111-1111-4111-8111-111111111111',{name:42} as any)).rejects.toThrow('inventory_product_invalid');
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });
});
