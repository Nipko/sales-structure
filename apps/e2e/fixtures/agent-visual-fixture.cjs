/**
 * Local visual-review fixture. Every account and response is fictional.
 * Never forwards to a real API. Undeclared endpoints fail with 501.
 * Run from the repository: node apps/e2e/fixtures/agent-visual-fixture.cjs
 * See docs/agent-platform-visual-review-2026-09-07.md for scope and setup.
 */

const http=require('node:http'), fs=require('node:fs'), ts=require('typescript');
const path=require('node:path');
const repositoryRoot=path.resolve(__dirname,'../../..');
process.chdir(repositoryRoot);
const source=fs.readFileSync('apps/e2e/tests/dashboard/navigation.spec.ts','utf8');
if(!source.includes('const TENANT_ID')||!source.includes('test("the Parallly logo'))throw new Error('Navigation fixture contract changed; update the visual fixture extractor.');
const helpers=source.slice(source.indexOf('const TENANT_ID'),source.indexOf('test("the Parallly logo'));
const js=ts.transpileModule(helpers,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
// Evaluate only the trusted repository fixture helpers, before all test registrations.
const {bootstrapTenantAdmin,qualityOverviewAllPassing}=new Function(js+';return {bootstrapTenantAdmin,qualityOverviewAllPassing};')();
const tid='11111111-1111-4111-8111-111111111111',aid='44444444-4444-4444-8444-444444444444';
// These handlers are reused as synthetic HTTP responses. No Playwright browser is created.
const routes=[],overrides=new Map(); let assessmentFails=false;
const user={id:'22222222-2222-4222-8222-222222222222',email:'novato@example.test',firstName:'Andrea',lastName:'Prueba',role:'tenant_admin',tenantId:tid,tenantName:'Consultorio Demo Local',emailVerified:true,onboardingCompleted:true,onboardingStage:'completed',plan:'pro'};
const config={persona:{name:'Luna',role:'Orientar y coordinar consultas',language:'es',greeting:'Hola, soy Luna. ¿En qué puedo ayudarte?',fallbackMessage:'Voy a consultar con nuestro equipo.',rules:['Consultar información vigente antes de responder.'],handoffTriggers:['Cuando el cliente pide una persona.']},tools:{appointments:{enabled:true}},channels:['web_widget'],editorMode:'guided'};
const agent={id:aid,name:'Luna',version:3,is_active:true,is_default:true,channels:['web_widget'],config_json:config,config};
const task=(key,status,href,tourId=null)=>({key,status,href,tourId,checks:[],dependsOn:[]});
const assessment=()=>({version:1,revision:'fixture-review-3',generatedAt:new Date().toISOString(),agent:{id:aid,name:'Luna',version:3,isActive:true},overview:qualityOverviewAllPassing(),mission:{source:'not_configured',definition:null,templateId:'healthcare',profileId:null,availableIntentKeys:['book_appointment','ask_question'],unsupportedIntents:[]},tasks:[task('mission','fail','/admin/agent/'+aid),task('business','fail','/admin/settings/business-info','business_identity'),task('knowledge','unknown','/admin/knowledge','knowledge_base'),task('team','pass','/admin/users'),task('tests','unknown','/admin/agent/'+aid+'/test','run_agent_tests')],nextTask:'mission',channels:[{channelType:'web_widget',scope:'assigned',status:'unavailable',contract:null}],requiredTests:[],configuration:config});
(async()=>{await bootstrapTenantAdmin({context:()=>({addCookies:async()=>{}}),addInitScript:async()=>{},on:()=>{},route:async(p,h)=>routes.push([p,h])});http.createServer(async(req,res)=>{
res.setHeader('X-Parallly-Fixture','synthetic-only');res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:3001');res.setHeader('Access-Control-Allow-Headers','content-type,authorization,x-idempotency-key');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');res.setHeader('Content-Type','application/json');if(req.method==='OPTIONS'){res.end();return;}
const url=new URL(req.url,'http://127.0.0.1:3999'),p=url.pathname.replace(/^\/api\/v1/,''); const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks).toString();const ok=data=>res.end(JSON.stringify({success:true,data}));
if(p==='/_fixture/state'){assessmentFails=url.searchParams.get('assessment')==='fail';return ok({assessmentFails});}
if(p==='/_fixture/override'&&req.method==='POST'){const v=JSON.parse(body);overrides.set(v.path,v);return ok({registered:v.path});}
if(overrides.has(p)){const v=overrides.get(p);res.statusCode=v.status||200;return res.end(JSON.stringify(v.response));}
console.log(req.method+' '+p);
if(p==='/auth/login')return ok({accessToken:'local-synthetic-token',refreshToken:'local-synthetic-refresh',user});
if(p==='/auth/refresh')return ok({accessToken:'local-synthetic-token',refreshToken:'local-synthetic-refresh',onboardingStage:'completed'});
if(p==='/copilot/assessment/'+tid){if(assessmentFails){res.statusCode=503;return res.end(JSON.stringify({success:false,message:'Synthetic assessment unavailable'}));}return ok(assessment());}
if(p==='/persona/'+tid+'/plan-features')return ok({channels:['whatsapp','instagram','messenger','telegram','web_widget'],maxAgents:5,rag:true,appointments:true});
if(p==='/persona/'+tid+'/agents')return ok([agent]);
if(p==='/persona/'+tid+'/agents/'+aid)return ok(agent);
if(p==='/learning/'+tid+'/'+aid)return ok({examples:[],releases:[],coverage:[]});
if(p==='/billing/'+tid+'/restriction-status')return ok({level:'none',status:'active'});
if(p==='/copilot/chat')return ok({reply:'Tu agente Luna necesita una misión clara y verificar su conocimiento. Empecemos por definir qué debe lograr y cuándo pedir ayuda al equipo.',actions:[]});
if(p.includes('/channel-bindings')||p.includes('/capabilities')||p.includes('/templates'))return ok([]);
for(const [pattern,handler] of routes){if(pattern.test(url.href)){await handler({request:()=>({url:()=>url.href,method:()=>req.method,postData:()=>body}),fulfill:async(v)=>{res.statusCode=v.status||200;res.end(v.body);},abort:async()=>{res.statusCode=502;res.end('{}');}});return;}}
res.statusCode=501;res.end(JSON.stringify({success:false,message:'Undeclared visual fixture route'}));
}).listen(3999,'127.0.0.1',()=>console.log('SYNTHETIC VISUAL FIXTURE ready, no real accounts'))})();
