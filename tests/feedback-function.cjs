// Execute the single-file Deno handler with mocked environment and provider.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('supabase/functions/generate-feedback/index.ts','utf8');
function fixture({key='isolated-key',response,throws=false,env={},quota,onProvider}={}){
 let handler;const requests=[],quotaRequests=[];
 vm.runInNewContext(source,{Response,Request,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,Date,
  Deno:{env:{get:name=>name==='DEEPSEEK_API_KEY'?key:env[name]},serve:fn=>{handler=fn;}},
  fetch:async(url,options)=>{if(url.includes('/rpc/claim_feedback_quota')){quotaRequests.push(JSON.parse(options.body));return quota?await quota(options):new Response('missing',{status:404});}requests.push({url,options,body:JSON.parse(options.body)});if(onProvider)return onProvider(options);if(throws)throw Error('private upstream detail');return response||new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'🔸课程内容：测试反馈'}}],usage:{prompt_tokens:50,completion_tokens:20}}));}
 });
 const call=(body,method='POST',signal)=>handler(new Request('https://example.test',{method,signal,body:method==='POST'?JSON.stringify(body):undefined}));
 return {call,requests,quotaRequests};
}
const input=()=>({studentName:'学生A',lessons:[{studentName:'学生A',courseName:'项目课',content:'开题调研',signatures:'must-not-forward',lessonDate:'2026-10-18'}],options:{progress:'0',pronoun:'她',homework:'画草图'}});
(async()=>{
 let f=fixture(),res=await f.call(input());assert.equal(res.status,200);const output=(await res.json()).text;assert.ok(output.includes('🔸课程内容：测试反馈'));assert.ok(output.includes('🔸学习建议：可以先选择'));assert.ok(output.includes('🔸学生表现：可以按自己的节奏'));for(const title of ['学生姓名','当前项目','当前导师','最新进度百分比','课程内容','最新作业','学生表现','学习建议'])assert.equal(output.split('🔸'+title+'：').length-1,1);
 const request=f.requests[0];assert.equal(request.url,'https://api.deepseek.com/chat/completions');
 assert.equal(request.body.thinking.type,'disabled');assert.equal(request.body.max_tokens,1000);
 const data=JSON.parse(request.body.messages[1].content);assert.equal(data.options.progress,'0');assert.ok(!JSON.stringify(data).includes('must-not-forward'));assert.ok(!JSON.stringify(data).includes('2026-10-18'));
 assert.ok(request.body.messages[0].content.includes('不得覆盖'));
 console.log('PASS provider contract, prompt rules, field projection, output');
 f=fixture();let custom=input();custom.options.advice='先整理电压参数';res=await f.call(custom);assert.ok((await res.json()).text.includes('🔸学习建议：先整理电压参数'));assert.equal(f.requests.length,1);
 f=fixture({response:new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'🔸学习建议：先核对电机参数。\n🔸学生表现：'}}]}))});res=await f.call(input());const kept=await res.json();assert.ok(kept.text.includes('先核对电机参数。'));assert.equal(kept.adviceFallback,false);
 f=fixture();custom=input();custom.lessons[0].content='';res=await f.call(custom);const empty=await res.json();assert.equal(empty.adviceFallback,false);assert.ok(empty.text.endsWith('🔸学习建议：'));
 f=fixture();custom=input();custom.options.observation='课堂能按测试结果修改接线';res=await f.call(custom);const observed=await res.json();assert.ok(observed.text.includes('🔸学生表现：课堂能按测试结果修改接线'));assert.equal(f.requests.length,1);
 console.log('PASS empty advice fallback, teacher advice, preserved model advice, no invented observations');
 for(const change of [x=>{x.lessons[0].studentName='另一学生';},x=>{x.options.progress='101';},x=>{x.options.pronoun='guess';},x=>{x.lessons=[];},x=>{x.lessons[0].content='长'.repeat(12001);}]){
  f=fixture();const bad=input();change(bad);res=await f.call(bad);assert.equal(res.status,400);assert.equal(f.requests.length,0);
 }
 console.log('PASS invalid requests rejected before paid call');
 const full=input();full.options.project='项目一';full.options.teacherName='导师甲';full.options.progress='35';
 f=fixture({response:new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'🔸学生姓名：错误姓名\n🔸当前导师：错误导师\n🔸课程内容：课程概括\n🔸最新作业：虚构任务'}}]}))});
 res=await f.call(full);const filled=(await res.json()).text;assert.ok(filled.includes('🔸学生姓名：学生A')&&filled.includes('🔸当前导师：导师甲')&&filled.includes('🔸当前项目：项目一')&&filled.includes('🔸最新进度百分比：35%')&&filled.includes('🔸最新作业：画草图'));assert.ok(!filled.includes('错误')&&!filled.includes('虚构任务'));
 console.log('PASS authoritative metadata and homework override missing or incorrect model fields');
 const env={FEEDBACK_DAILY_LIMIT:'3',SUPABASE_URL:'https://isolated.test',SUPABASE_SERVICE_ROLE_KEY:'isolated-service'};let reservations=0;
 const quota=async()=>new Response(JSON.stringify(++reservations<=3));const qa=fixture({env,quota}),qb=fixture({env,quota});
 const statuses=await Promise.all([qa,qb,qa,qb,qa,qb].map(async worker=>(await worker.call(input())).status));assert.equal(statuses.filter(s=>s===200).length,3);assert.equal(statuses.filter(s=>s===429).length,3);assert.equal(qa.requests.length+qb.requests.length,3);assert.ok(qa.quotaRequests.every(r=>r.p_limit===3));
 f=fixture({env});assert.equal((await f.call(input())).status,503);assert.equal(f.requests.length,0);
 f=fixture({env:{...env,FEEDBACK_DAILY_LIMIT:'oops'}});assert.equal((await f.call(input())).status,503);assert.equal(f.requests.length,0);
 console.log('PASS shared quota across simulated workers and fail-closed configuration');
 let started;const ready=new Promise(resolve=>started=resolve);const abort=new AbortController();let signalSeen;
 f=fixture({onProvider:options=>{signalSeen=options.signal;started();return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('abort'),{name:'AbortError'})),{once:true}));}});
 const running=f.call(input(),'POST',abort.signal);await ready;abort.abort();assert.equal((await running).status,502);assert.equal(signalSeen.aborted,true);assert.equal(f.requests.length,1);
 console.log('PASS client disconnect propagates upstream cancellation without retry');
 f=fixture({key:''});assert.equal((await f.call(input())).status,503);assert.equal(f.requests.length,0);
 f=fixture();assert.equal((await f.call(null,'OPTIONS')).status,200);assert.equal((await f.call(null,'GET')).status,405);assert.equal(f.requests.length,0);
 console.log('PASS missing secret, preflight, method handling');
 for(const status of [401,402,429,500]){
  f=fixture({response:new Response('private upstream error',{status})});res=await f.call(input());assert.equal(res.status,502);assert.ok(!(await res.text()).includes('private'));assert.equal(f.requests.length,1);
 }
 f=fixture({throws:true});res=await f.call(input());assert.equal(res.status,502);assert.ok(!(await res.text()).includes('private'));assert.equal(f.requests.length,1);
 console.log('PASS sanitized provider failures without automatic retry');
 f=fixture({response:new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'partial'}}]}))});assert.equal((await f.call(input())).status,502);
 f=fixture();for(let i=0;i<10;i++)assert.equal((await f.call(input())).status,200);assert.equal((await f.call(input())).status,429);assert.equal(f.requests.length,10);
 console.log('PASS incomplete output rejection and per-instance throttle');
})().catch(e=>{console.error(e);process.exitCode=1;});
