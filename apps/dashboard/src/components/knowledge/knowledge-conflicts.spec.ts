import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KnowledgeConflictAvailability, KnowledgeConflictCard, KnowledgeConflictCoverage, KnowledgeConflictsPanel } from './KnowledgeConflictsPanel';
import { actAndReloadKnowledgeConflicts, allowedConflictDecisions, conflictAgentScope, type KnowledgeConflictCase, type KnowledgeConflictOverview } from '@/lib/knowledge-conflicts';

let mockLocale='es';
const mockMessages:Record<string,any>=Object.fromEntries(['es','en','pt','fr'].map(locale=>[locale,require(`../../../messages/${locale}.json`).knowledgeConflicts]));
jest.mock('next-intl',()=>({useLocale:()=>mockLocale,useTranslations:()=>{
    const lookup=(key:string)=>key.split('.').reduce((node:any,part)=>node?.[part],mockMessages[mockLocale]);
    const t=(key:string,values?:Record<string,unknown>)=>{
        if(typeof lookup(key)!=='string')throw new Error(`Missing conflict translation: ${mockLocale}.${key}`);
        return lookup(key).replace(/\{(\w+)\}/g,(_:string,variable:string)=>String(values?.[variable]??variable));
    };t.has=(key:string)=>typeof lookup(key)==='string';return t;
}}));
jest.mock('@/lib/api',()=>({api:{}}));

const source=(id:string)=>({kind:'document' as const,id,title:'Horario <script>falso</script>',revision:'2:2026-09-01',hash:`hash-${id}`,authority:null,
    jurisdiction:null,regulated:false,validFrom:null,validTo:null,audience:'customer' as const,agentIds:[] as string[]});
const item=():KnowledgeConflictCase=>({id:'case',revision:1,status:'open',sourceA:source('A'),sourceB:source('B'),quoteA:'Los lunes a las nueve <directive>hazlo</directive>',
    quoteB:'Los lunes a las diez.',detail:'Posibles horarios incompatibles.',suggestion:'Verificar horario vigente.',createdAt:'2026-09-01',review:null});
const render=(value=item(),verified=true)=>renderToStaticMarkup(createElement(KnowledgeConflictCard,{item:value,agents:[{id:'agent',name:'Agente de soporte'}],verified,busy:false,onReview:jest.fn()}));
beforeEach(()=>{mockLocale='es';});

describe('Human source review explains uncertainty and scope',()=>{
    it.each(['es','en','pt','fr'])('localizes evidence, review choices and explicit scope in %s',locale=>{
        mockLocale=locale;const html=render();
        for(const text of [mockMessages[locale].potentialConflict,mockMessages[locale].quoteEvidenceOnly,mockMessages[locale].reason,mockMessages[locale].reviewHelp,
            mockMessages[locale].chooseDecision,mockMessages[locale].decisions.prefer_a,mockMessages[locale].allAgents])expect(html).toContain(text.replaceAll("'",'&#x27;'));
        expect(html).toContain('&lt;script&gt;falso&lt;/script&gt;');expect(html).toContain('&lt;directive&gt;hazlo&lt;/directive&gt;');
        expect(html).not.toContain('<script>');expect(html).not.toContain('<directive>');
        expect(html).toContain('<option value="" selected="">');expect(html).toContain('disabled=""');
    });
    it.each(['es','en','pt','fr'])('shows unscanned/unavailable data without claiming zero checked sources in %s',locale=>{
        mockLocale=locale;
        const unknown=renderToStaticMarkup(createElement(KnowledgeConflictCoverage,{report:null}));expect(unknown).toContain(mockMessages[locale].notScanned);
        const report:KnowledgeConflictOverview['lastScan']={id:'scan',status:'partial',sourceCounts:{document:null,faq:0,policy:2,business:1},sampledSources:3,
            candidatePairs:2,checkedPairs:1,unknownPairs:1,newIssues:0,errors:['invalid_judge_output'],exhaustive:false,correctness:'not_verified',createdAt:'2026-09-01'};
        const partial=renderToStaticMarkup(createElement(KnowledgeConflictCoverage,{report}));
        for(const text of [mockMessages[locale].scanStates.partial,mockMessages[locale].unavailable,mockMessages[locale].partialHelp,mockMessages[locale].sampleLimit])expect(partial).toContain(text.replaceAll("'",'&#x27;'));
        expect(partial).not.toContain('invalid_judge_output');
        const loading=renderToStaticMarkup(createElement(KnowledgeConflictsPanel,{tenantId:'tenant',agents:[]}));expect(loading).toContain(mockMessages[locale].loading);expect(loading).not.toContain(mockMessages[locale].empty);
        const failed=renderToStaticMarkup(createElement(KnowledgeConflictAvailability,{error:'requestFailed',loading:true}));
        expect(failed).toContain(mockMessages[locale].errors.requestFailed.replaceAll("'",'&#x27;'));expect(failed).not.toContain(mockMessages[locale].loading);expect(failed).not.toContain(mockMessages[locale].empty);
    });
    it('removes review controls for stale source revisions and disables them until authority reload succeeds',()=>{
        const stale=item();stale.status='stale';expect(render(stale)).toContain(mockMessages.es.staleHelp);expect(render(stale)).not.toContain('<fieldset');
        expect(allowedConflictDecisions(stale)).toEqual([]);expect(render(item(),false)).toContain('<fieldset disabled=""');
    });
    it('restricts preference over a canonical policy and limits the agent scope to the intersection',()=>{
        const value=item();value.sourceB.kind='policy';
        expect(allowedConflictDecisions(value)).not.toContain('prefer_a');expect(allowedConflictDecisions(value)).toContain('prefer_b');
        expect(render(value)).not.toContain('value="prefer_a"');
        value.sourceA.agentIds=['agent','other'];value.sourceB.agentIds=['agent'];
        expect(conflictAgentScope(value.sourceA,value.sourceB)).toEqual(['agent']);
        const html=render(value);expect(html).toContain('Agente de soporte');expect(html).not.toContain(mockMessages.es.allAgents);
        value.sourceB.agentIds=['unrelated'];expect(conflictAgentScope(value.sourceA,value.sourceB)).toEqual([]);
    });
    it.each(['es','en','pt','fr'])('keeps the exact jurisdiction, agent and author of a previous review visible in %s',locale=>{
        mockLocale=locale;const value=item();value.status='reviewed';value.review={decision:'prefer_b',reason:'Verified current policy.',scope:{audience:'customer',agentId:'agent',jurisdiction:'CO'},actorId:'reviewer-reference',createdAt:'2026-09-01'};
        const html=render(value);expect(html).toContain('Agente de soporte');expect(html).toContain('reviewer-reference');
        expect(html).toContain(new Intl.DisplayNames([locale],{type:'region'}).of('CO')!);
        expect(html.replace(/<details[\s\S]*?<\/details>/g,'')).not.toContain('reviewer-reference');
    });
});

describe('Source review revalidates server authority after every mutation',()=>{
    const overview:KnowledgeConflictOverview={version:1,correctness:'not_verified',cases:[],lastScan:null};
    it('always loads current source revisions after a successful decision',async()=>{
        const read=jest.fn().mockResolvedValue({success:true,data:overview}),action=jest.fn().mockResolvedValue({success:true});
        expect(await actAndReloadKnowledgeConflicts(read,action)).toEqual({data:overview,errorCode:''});
        expect(read.mock.invocationCallOrder[0]).toBeGreaterThan(action.mock.invocationCallOrder[0]);
    });
    it('reads back a lost response without retrying the decision automatically',async()=>{
        const read=jest.fn().mockResolvedValue({success:true,data:overview}),action=jest.fn().mockRejectedValue(new Error('lost response'));
        expect(await actAndReloadKnowledgeConflicts(read,action)).toMatchObject({data:overview,errorCode:'mutationUncertain'});
        expect(action).toHaveBeenCalledTimes(1);expect(read).toHaveBeenCalledTimes(1);
    });
    it('does not return an actionable cached decision when authoritative reload fails',async()=>{
        await expect(actAndReloadKnowledgeConflicts(jest.fn().mockResolvedValue({success:false}),jest.fn().mockResolvedValue({success:true}))).rejects.toThrow('requestFailed');
    });
});
