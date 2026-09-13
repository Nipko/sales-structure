export interface CatalogReview {
    fingerprint:string;termsHash:string;
    terms:{currency:string;totalAmountCents:string;items:{productId:string;productName:string;quantity:number;unitAmountCents:string;totalAmountCents:string}[]};
}
export function currentOrderReview(value:unknown,fingerprint:string):CatalogReview|null{
    if(!value||typeof value!=='object')return null;
    const review=value as CatalogReview,terms=review.terms;
    if(review.fingerprint!==fingerprint||!/^[a-f0-9]{64}$/.test(review.termsHash||'')||!terms||!/^[A-Z]{3}$/.test(terms.currency)
        ||!/^\d+$/.test(terms.totalAmountCents)||!Array.isArray(terms.items)||!terms.items.length||terms.items.length>100)return null;
    const seen=new Set<string>();let total=BigInt(0);
    for(const item of terms.items){
        if(!item||typeof item.productId!=='string'||seen.has(item.productId)||typeof item.productName!=='string'
            ||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>10000||!/^\d+$/.test(item.unitAmountCents)||!/^\d+$/.test(item.totalAmountCents))return null;
        seen.add(item.productId);const amount=BigInt(item.unitAmountCents)*BigInt(item.quantity);
        if(amount!==BigInt(item.totalAmountCents))return null;total+=amount;
    }
    return total===BigInt(terms.totalAmountCents)&&total<=BigInt('999999999999999')?review:null;
}
export function catalogRequestKey(previous:{fingerprint:string;key:string}|null,fingerprint:string,generate:()=>string){
    return previous?.fingerprint===fingerprint?previous:{fingerprint,key:generate()};
}
export function catalogMoney(value:unknown,currency:unknown,locale:string):string{
    if(value==null||!Number.isFinite(Number(value))||typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency))return '—';
    return new Intl.NumberFormat(locale,{style:'currency',currency,maximumFractionDigits:2}).format(Number(value));
}
export function catalogPaymentKey(value:unknown):string{
    return `ops.catalog.payment.${['pending','paid','failed','refunded'].includes(String(value))?value:'unknown'}`;
}
