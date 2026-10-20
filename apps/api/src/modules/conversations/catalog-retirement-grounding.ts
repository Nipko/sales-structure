/** Current successful tool reads, never user text/history, can establish sale state. */
interface CatalogRead { name: string; result: unknown }
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPLIES:Record<string,(name:string)=>string>={
 es:name=>`El producto "${name}" está retirado de la venta; no se puede comprar. Su estado no es simplemente "agotado".`,
 en:name=>`The product "${name}" has been withdrawn from sale and cannot be purchased. It is not merely out of stock.`,
 pt:name=>`O produto "${name}" foi retirado de venda e não pode ser comprado. Não está apenas sem estoque.`,
 fr:name=>`Le produit "${name}" a été retiré de la vente et ne peut pas être acheté. Il ne s’agit pas simplement d’une rupture de stock.`,
};

/**
 * `status: ok` describes query health; it never overrides `isAvailable: false`.
 * Limit the deterministic answer to a single current product and an explicit
 * availability/retirement question. Price-only, multi-product and failed/stale
 * reads keep the normal response path. A later active read supersedes an old
 * inactive read from the same turn.
 */
export function groundInactiveCatalogReply(customerText:string,executedTools:CatalogRead[]|undefined,language?:string):string|null {
 const text=String(customerText||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(!/(?:\b(?:venta|venda|vente|sale|buy|purchase|comprar|comprado|acheter|retirado|retirada|retire|retired|withdrawn|agotado|agotada|stock|estoque|existencias)\b|disponib|availability|available)/.test(text))return null;
 const reads=(executedTools||[]).filter(tool=>['get_product','check_stock'].includes(tool.name));
 if(!reads.length)return null;
 const products:Record<string,any>[]=[];
 for(const read of reads){
  let result:any=read.result;
  if(typeof result==='string'){try{result=JSON.parse(result);}catch{return null;}}
  if(!result||Array.isArray(result)||typeof result!=='object'||result.status!=='ok'||result.source!=='tenant_db'||result.stale===true||result.error
    ||typeof result.id!=='string'||!UUID.test(result.id)||typeof result.name!=='string'||!result.name.trim()
    ||typeof result.isAvailable!=='boolean'||typeof result.asOf!=='string'||!Number.isFinite(Date.parse(result.asOf)))return null;
  products.push(result);
 }
 if(new Set(products.map(p=>p.id.toLowerCase())).size!==1)return null;
 const current=products[products.length-1];if(current.isAvailable!==false)return null;
 const name=Array.from(current.name,(char:string)=>{
  const code=char.charCodeAt(0);return code<=31||code===127?' ':char;
 }).join('').trim().slice(0,200);
 return(REPLIES[String(language||'es').toLowerCase().split(/[-_]/)[0]]||REPLIES.es)(name);
}
