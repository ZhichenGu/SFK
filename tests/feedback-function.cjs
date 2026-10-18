// Execute the single-file Deno handler with mocked environment and provider.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('supabase/functions/generate-feedback/index.ts','utf8');
function fixture({key='isolated-key',response,throws=false}={}){
 let handler;const requests=[];
 vm.runInNewContext(source,{Response,Request,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,Date,
  Deno:{env:{get:name=>name==='DEEPSEEK_API_KEY'?key:undefined},serve:fn=>{handler=fn;}},
  fetch:async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});if(throws)throw Error('private upstream detail');return response||new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'🔸课程内容：测试反馈'}}],usage:{prompt_tokens:50,completion_tokens:20}}));}
 });
 const call=(body,method='POST')=>handler(new Request('https://example.test',{method,body:method==='POST'?JSON.stringify(body):undefined}));
 return {call,requests};
}
const input=()=>({studentName:'学生A',lessons:[{studentName:'学生A',courseName:'项目课',content:'开题调研',signatures:'must-not-forward',lessonDate:'2026-10-18'}],options:{progress:'0',pronoun:'她',homework:'画草图'}});
(async()=>{
 let f=fixture(),res=await f.call(input());assert.equal(res.status,200);const output=(await res.json()).text;assert.ok(output.includes('🔸课程内容：测试反馈'));for(const title of ['学生姓名','当前项目','当前导师','最新进度百分比','课程内容','最新作业','学生表现','学习建议'])assert.equal(output.split('🔸'+title+'：').length-1,1);
 const request=f.requests[0];assert.equal(request.url,'https://api.deepseek.com/chat/completions');
 assert.equal(request.body.thinking.type,'disabled');assert.equal(request.body.max_tokens,1000);
 const data=JSON.parse(request.body.messages[1].content);assert.equal(data.options.progress,'0');assert.ok(!JSON.stringify(data).includes('must-not-forward'));assert.ok(!JSON.stringify(data).includes('2026-10-18'));
 assert.ok(request.body.messages[0].content.includes('不得覆盖'));
 console.log('PASS provider contract, prompt rules, field projection, output');
 for(const change of [x=>{x.lessons[0].studentName='另一学生';},x=>{x.options.progress='101';},x=>{x.options.pronoun='guess';},x=>{x.lessons=[];},x=>{x.lessons[0].content='长'.repeat(12001);}]){
  f=fixture();const bad=input();change(bad);res=await f.call(bad);assert.equal(res.status,400);assert.equal(f.requests.length,0);
 }
 console.log('PASS invalid requests rejected before paid call');
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
