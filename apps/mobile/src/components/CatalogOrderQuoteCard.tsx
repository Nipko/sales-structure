import React from 'react';
import { Text,View } from 'react-native';
import { useI18n } from '../i18n';
import { catalogMoney,type CatalogReview } from '../lib/catalogOrderReview';
import { theme } from '../theme';
export function CatalogOrderQuoteCard({review}:{review:CatalogReview}){
    const {t,locale}=useI18n(),terms=review.terms;
    return <View accessibilityRole="summary" style={{padding:16,marginTop:16,gap:8,borderWidth:1,borderColor:theme.border,borderRadius:12}}>
        <Text style={{color:theme.text,fontWeight:'700'}}>{t('ops.catalog.review')}</Text>
        {terms.items.map(item=><Text key={item.productId} style={{color:theme.text}}>{item.productName} × {item.quantity} · {catalogMoney(Number(item.unitAmountCents)/100,terms.currency,locale)} = {catalogMoney(Number(item.totalAmountCents)/100,terms.currency,locale)}</Text>)}
        <Text style={{color:theme.text,fontWeight:'700'}}>{t('ops.catalog.total',{amount:catalogMoney(Number(terms.totalAmountCents)/100,terms.currency,locale),currency:terms.currency})}</Text>
        <Text style={{color:theme.textSecondary}}>{t('ops.catalog.separation')}</Text>
    </View>;
}
