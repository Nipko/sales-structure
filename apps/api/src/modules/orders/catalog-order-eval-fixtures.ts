import { EVAL_SANDBOX_CONTACT_ID } from '../conversations/agent-test-tool-policy';
import type { EvalNamespaceQuery } from '../simulation/isolated-eval-namespace';
export const CATALOG_EVAL_IDS = Object.freeze({
    catalogOrder:'00000000-0000-4000-8000-00000000b030',paidCatalogOrder:'00000000-0000-4000-8000-00000000b031',
    otherCatalogOrder:'00000000-0000-4000-8000-00000000b032',otherCatalogContact:'00000000-0000-4000-8000-00000000b033',
    prescriptionProduct:'00000000-0000-4000-8000-00000000b034',emptyProduct:'00000000-0000-4000-8000-00000000b035',
});
export async function prepareCatalogEvalFixtures(query:EvalNamespaceQuery,schema:string,productId:string):Promise<void>{
    if(!/^tenant_eval_[a-f0-9]{8}_[a-f0-9]{24}$/.test(schema)) throw new Error('eval_fixture_namespace_required');
    const t=(name:string)=>`"${schema}".${name}`,f=CATALOG_EVAL_IDS;
    await query(`INSERT INTO ${t('contacts')}(id,external_id,channel_type,name) VALUES($1::uuid,'eval-catalog-other','web_widget','[EVAL] Other buyer')`,[f.otherCatalogContact]);
    for(const [id,name,stock,prescription] of [[f.prescriptionProduct,'[EVAL] Prescription product',10,true],[f.emptyProduct,'[EVAL] Out of stock',0,false]]) {
        await query(`INSERT INTO ${t('products')}(id,name,price,currency,stock,is_available,requires_prescription) VALUES($1::uuid,$2,10,'COP',$3,true,$4)`,[id,name,stock,prescription]);
    }
    for(const [id,contact,status,payment] of [[f.catalogOrder,EVAL_SANDBOX_CONTACT_ID,'pending','pending'],[f.paidCatalogOrder,EVAL_SANDBOX_CONTACT_ID,'confirmed','paid'],[f.otherCatalogOrder,f.otherCatalogContact,'pending','pending']]) {
        await query(`INSERT INTO ${t('orders')}(id,contact_id,status,payment_status,total_amount,currency,notes,version) VALUES($1::uuid,$2::uuid,$3,$4,10,'COP','[EVAL] Existing order',1)`,[id,contact,status,payment]);
        const line=await query(`INSERT INTO ${t('order_items')}(order_id,product_id,product_name,quantity,unit_price,total_price,stock_deducted) VALUES($1::uuid,$2::uuid,'[EVAL] Sandbox Product',1,10,10,1) RETURNING id`,[id,productId]);
        await query(`INSERT INTO ${t('stock_movements')}(product_id,type,quantity,previous_stock,new_stock,reason,order_id,order_item_id) VALUES($1::uuid,'out',1,101,100,'eval_fixture',$2::uuid,$3::uuid)`,[productId,id,line[0]?.id]);
    }
}
