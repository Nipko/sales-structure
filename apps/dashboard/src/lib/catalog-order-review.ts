export interface CatalogQuoteReview {
    termsHash:string;
    terms:{currency:string;totalAmountCents:string;items:{productId:string;productName:string;quantity:number;unitAmountCents:string;totalAmountCents:string}[]};
    fingerprint:string;
}
/** A form edit invalidates the reviewed facts even before React effects run. */
export function currentCatalogReview(value:unknown,fingerprint:string):CatalogQuoteReview|null{
    if(!value||typeof value!=='object')return null;
    const review=value as CatalogQuoteReview,terms=review.terms;
    if(review.fingerprint!==fingerprint||!/^[a-f0-9]{64}$/.test(review.termsHash||'')||!terms||!/^[A-Z]{3}$/.test(terms.currency)
        ||!/^\d+$/.test(terms.totalAmountCents)||!Array.isArray(terms.items)||terms.items.length<1||terms.items.length>100)return null;
    const seen=new Set<string>();let total=BigInt(0);
    for(const item of terms.items){
        if(!item||typeof item.productId!=='string'||seen.has(item.productId)||typeof item.productName!=='string'
            ||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>10000||!/^\d+$/.test(item.unitAmountCents)||!/^\d+$/.test(item.totalAmountCents))return null;
        seen.add(item.productId);const amount=BigInt(item.unitAmountCents)*BigInt(item.quantity);
        if(amount!==BigInt(item.totalAmountCents))return null;total+=amount;
    }
    return total===BigInt(terms.totalAmountCents)&&total<=BigInt('999999999999999')?review:null;
}
