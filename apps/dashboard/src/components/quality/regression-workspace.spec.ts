import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RegressionEditor,RegressionMetrics} from './RegressionWorkspace';
let mockLocale='es';
const mockMessages:Record<string,any>=Object.fromEntries(['es','en','pt','fr'].map(locale=>[locale,require(`../../../messages/${locale}.json`).qualityRegressions]));
jest.mock('next-intl',()=>({useTranslations:()=>{
    return (key:string,values?:Record<string,unknown>)=>{
        const value=key.split('.').reduce((node:any,part)=>node?.[part],mockMessages[mockLocale]);
        if(typeof value!=='string')throw new Error(`Missing regression translation ${mockLocale}.${key}`);
        return value.replace(/\{(\w+)\}/g,(_:string,key:string)=>String(values?.[key]??key));
    };
}}));
jest.mock('@/lib/api',()=>({api:{}}));
const value=()=>({id:'case',state:'proposed',revision:2,sourceState:'current',sourceKind:'quality_score',sourceRevision:'3',sourceAgentVersion:4,
    sourceConfiguration:'captured',scope:{profileId:'salud/dental',mission:'ask_question',language:'es',channel:'web_widget',difficulty:'standard'},
    proposal:{title:'Reviewed question',messages:['<script>untrusted</script>'],criteria:'Use configured hours',expectedActions:[],observedReplies:['<img src=x onerror=alert(1)>'],
        coverage:{sourceMessages:10,selectedMessages:8,truncatedMessages:1}}});
const options={profiles:[{id:'salud/dental',intents:[{key:'ask_question',tools:['search_faqs'],commits:false}]}],families:[]};
describe('reviewed regression workspace',()=>{
    it.each(['es','en','pt','fr'])('localizes unknown coverage and does not display unavailable data as zero in %s',locale=>{
        mockLocale=locale;
        const html=renderToStaticMarkup(createElement(RegressionMetrics,{data:null,unavailable:true}));
        expect(html).toContain(mockMessages[locale].metricsUnavailable.replaceAll("'",'&#x27;'));
        expect(html).not.toContain('<table');
        const populated=renderToStaticMarkup(createElement(RegressionMetrics,{unavailable:false,data:{eligible_turns:5,observed_turns:2,unobserved_turns:3,
            groups:[{mission:'unknown',language:'unknown',channel:'web_widget',difficulty:'unknown',eligible_turns:3,outcome_unknown_turns:3}]}}));
        expect(populated).toContain('<table');expect(populated).toContain(mockMessages[locale].unknown);expect(populated).not.toContain('100%');
    });
    it.each(['es','en','pt','fr'])('requires explicit human checks and escapes source content in %s',locale=>{
        mockLocale=locale;
        const html=renderToStaticMarkup(createElement(RegressionEditor,{value:value(),options,busy:false,save:jest.fn(),review:jest.fn()}));
        expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).not.toContain('<img src=x');
        expect(html.match(/type="checkbox"/g)).toHaveLength(4);
        const approve=html.match(/<button[^>]*disabled=""[^>]*>[^<]*<\/button>/g)||[];
        expect(approve.join(' ')).toContain(mockMessages[locale].actions.approved);
    });
    it('keeps retired proposals read-only',()=>{
        mockLocale='es';const row=value();row.state='retired';
        const html=renderToStaticMarkup(createElement(RegressionEditor,{value:row,options,busy:false,save:jest.fn(),review:jest.fn()}));
        expect(html.match(/<fieldset disabled=""/g)).toHaveLength(2);
    });
});
