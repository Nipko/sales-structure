import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QualityScoreDetails } from '@/app/admin/analytics-v2/_components/QualityWidget';

let mockLocale='es';
const mockMessages:Record<string,any>=Object.fromEntries(['es','en','pt','fr'].map(locale=>[locale,require(`../../../messages/${locale}.json`).quality]));
jest.mock('next-intl',()=>({useTranslations:()=>((key:string,values?:Record<string,unknown>)=>{
    const text=mockMessages[mockLocale][key];if(typeof text!=='string')throw new Error(`Missing ${mockLocale}.${key}`);
    return text.replace(/\{(\w+)\}/g,(_match:string,name:string)=>String(values?.[name]));
})}));
jest.mock('@/lib/api',()=>({api:{}}));
jest.mock('@/components/analytics/QualitySamplingCard',()=>({__esModule:true,default:()=>null}));
const summary={scored:30,avgOverall:9,avgResolution:9,avgTone:9,avgAccuracy:8,avgEmpathy:8,
    distribution:{excellent:0,ok:0,poor:0},flagged:1,verifiedResolutionRate:null,operationalKnown:0,operationalUnknown:30,partialTranscripts:12};

describe('QA presentation distinguishes opinion from verified outcomes',()=>{
    it.each(['es','en','pt','fr'])('renders unknown and lost coverage explicitly in %s',locale=>{
        mockLocale=locale;
        const html=renderToStaticMarkup(createElement(QualityScoreDetails,{summary,flagged:[{conversationId:'one',overall:9,flags:[],resolutionType:'ai_resolved',resolutionVerified:null,verificationReason:null}]}));
        expect(html).toContain(mockMessages[locale].unknownOutcome);
        expect(html).toContain(mockMessages[locale].opinionNotice);
        expect(html).toContain('12');expect(html).toContain('30');
        expect(html).not.toContain('>0%<');expect(html).not.toContain('>null%<');
    });
});
