import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QualitySamplingCard, { QualitySamplingEvidence } from './QualitySamplingCard';
import { readQualitySampling, type QualitySamplingReport } from '@/lib/quality-sampling';

let mockLocale='es';
const mockMessages:Record<string,any>=Object.fromEntries(['es','en','pt','fr'].map(locale=>[locale,require(`../../../messages/${locale}.json`).qualitySampling]));
jest.mock('next-intl',()=>({useTranslations:()=>((key:string)=>{
    const value=mockMessages[mockLocale][key];if(typeof value!=='string')throw new Error(`Missing translation ${mockLocale}.${key}`);return value;
})}));
jest.mock('@/lib/api',()=>({api:{}}));
const available:QualitySamplingReport={state:'available',day:'2026-09-06',eligible:1021,selected:50,queued:46,pending:1,failed:1,erased:2,evidence:'queue_acceptance'};
const absent:QualitySamplingReport={state:'not_captured',day:'2026-09-06',eligible:null,selected:null,queued:null,pending:null,failed:null,erased:null};

describe('Daily sampling explains its evidence',()=>{
    it.each(['es','en','pt','fr'])('distinguishes queue acceptance and actual quality in %s',locale=>{
        mockLocale=locale;const html=renderToStaticMarkup(createElement(QualitySamplingEvidence,{report:available}));
        for(const key of ['eligible','selected','queued','failed','failedHelp','queueEvidence'])expect(html).toContain(mockMessages[locale][key]);
        expect(html).toContain('1021');expect(html).toContain('50');expect(html).toContain('46');
        const unknown=renderToStaticMarkup(createElement(QualitySamplingEvidence,{report:absent}));
        expect(unknown).toContain(mockMessages[locale].notCaptured);expect(unknown).not.toContain('<dd>0</dd>');
        const loading=renderToStaticMarkup(createElement(QualitySamplingCard,{tenantId:'tenant'}));
        expect(loading).toContain(mockMessages[locale].loading);expect(loading).not.toContain(mockMessages[locale].notCaptured);
    });
    it('rejects failed requests, inconsistent denominators and grading claims disguised as queue evidence',async()=>{
        await expect(readQualitySampling(async()=>({success:false}))).rejects.toThrow('sampling_unavailable');
        await expect(readQualitySampling(async()=>({success:true,data:{...available,selected:49}}))).rejects.toThrow('sampling_unavailable');
        await expect(readQualitySampling(async()=>({success:true,data:{...available,evidence:'quality_verified'}}))).rejects.toThrow('sampling_unavailable');
        await expect(readQualitySampling(async()=>({success:true,data:{...absent,eligible:0}}))).rejects.toThrow('sampling_unavailable');
    });
    it('can recover to a verified empty population after a failed request',async()=>{
        const load=jest.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({success:true,data:{...available,eligible:0,selected:0,queued:0,pending:0,failed:0,erased:0}});
        await expect(readQualitySampling(load)).rejects.toThrow('network');
        await expect(readQualitySampling(load)).resolves.toMatchObject({state:'available',eligible:0,selected:0});
    });
});
