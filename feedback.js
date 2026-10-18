/* Editable feedback drafts; optional model calls go through the server only. */
'use strict';
(()=>{
 const text=value=>String(value??'').trim();
 function prepare(rows){
  if(!rows.length)throw Error('请先勾选这名学生的课程签单。');
  if(rows.length>20)throw Error('每次最多选择20份课程签单。');
  const lessons=rows.map(({id,record:r})=>({id,studentName:text(r.studentName),courseName:text(r.courseName),lessonDate:text(r.lessonDate),checkIn:text(r.checkIn),checkOut:text(r.checkOut),teacherName:text(r.teacherName),content:text(r.content),homework:text(r.homework)}));
  if(lessons.some(r=>!r.studentName))throw Error('所选签单中有学生姓名为空，请先补充姓名。');
  if(new Set(lessons.map(r=>r.studentName)).size!==1)throw Error('请只勾选同一位学生的签单，可先搜索学生姓名再选择课程。');
  lessons.sort((a,b)=>(a.lessonDate+' '+a.checkIn).localeCompare(b.lessonDate+' '+b.checkIn));
  return {studentName:lessons[0].studentName,lessons};
 }
 function defaults(input){
  const teachers=[...new Set(input.lessons.map(r=>r.teacherName).filter(Boolean))];
  const dated=input.lessons.every(r=>r.lessonDate);
  const last=input.lessons.at(-1),latest=dated?input.lessons.filter(r=>r.lessonDate===last.lessonDate&&r.checkIn===last.checkIn):[];
  return {teacherName:teachers.length===1?teachers[0]:'',project:'',progress:'',pronoun:'学生',observation:'',advice:'',homework:[...new Set(latest.map(r=>r.homework).filter(Boolean))].join('；')};
 }
 function draft({studentName,lessons},options={}){
  const o={...defaults({lessons}),...options};
  const lines=['🔸学生姓名：'+studentName];
  lines.push('🔸当前项目：'+text(o.project));
  lines.push('🔸当前导师：'+text(o.teacherName));
  if(text(o.progress)){
   const n=Number(o.progress);
   if(!Number.isFinite(n)||n<0||n>100)throw Error('学生进度请填写 0–100 之间的数值。');
   lines.push('🔸最新进度百分比：'+n+'%');
  }else lines.push('🔸最新进度百分比：');
  const contents=[...new Set(lessons.map(r=>r.content).filter(Boolean))];
  lines.push('🔸课程内容：'+contents.join('；'));
  lines.push('🔸最新作业：'+text(o.homework));
  lines.push('🔸学生表现：'+(text(o.observation)||(contents.length?'可以按自己的节奏逐步熟悉课程内容，在尝试中慢慢积累经验。':'')));
  lines.push('🔸学习建议：'+(text(o.advice)?'建议'+(['他','她'].includes(o.pronoun)?o.pronoun:'学生')+'：'+text(o.advice):''));
  return lines.join('\n');
 }
 const style=document.createElement('style');style.textContent=`
 #feedback-dialog{width:min(760px,calc(100vw - 24px));padding:24px;color:inherit}
 #feedback-dialog .dialog-bar{gap:12px}#feedback-dialog h2{margin:0;font-size:20px}
 #feedback-dialog p{font-size:13px;line-height:1.7;overflow-wrap:anywhere}
 #feedback-settings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}#feedback-settings label{margin:0}#feedback-settings .wide{grid-column:1/-1}#feedback-settings label>span{display:block;margin-bottom:7px}#feedback-settings textarea{min-height:90px}#feedback-settings small{display:block;font-weight:400;color:#69748a;line-height:1.6;margin-top:6px}#feedback-sources{margin:14px 0;font-size:13px}#feedback-sources ul{padding-left:20px;line-height:1.8;overflow-wrap:anywhere}
 #feedback-text{min-height:320px;max-height:52vh}#feedback-dialog .actions{justify-content:flex-end}
 #feedback-dialog .actions button{flex:0 1 auto}#feedback-status{min-height:22px}
 @media(max-width:600px){#feedback-dialog{padding:16px}#feedback-text{min-height:260px}#feedback-settings{grid-template-columns:1fr}}
 `;document.head.append(style);
 const dialog=document.createElement('dialog');dialog.id='feedback-dialog';dialog.setAttribute('aria-labelledby','feedback-title');dialog.setAttribute('aria-describedby','feedback-note');
 dialog.innerHTML=`<div class="dialog-bar"><h2 id="feedback-title">补充反馈信息</h2><button type="button" id="feedback-close">关闭</button></div>
 <p id="feedback-note" class="hint">AI 生成会将所选课程文字和补充信息提交给 DeepSeek，按用量计费。请核对后发送；正文不添加日期和上课时间。</p>
 <p id="feedback-source"></p><details id="feedback-sources"><summary>核对所选课程（日期仅用于核对）</summary><ul></ul></details>
 <form id="feedback-settings">
 <label><span>当前导师</span><input id="feedback-teacher" maxlength="100" placeholder="填写老师姓名"><small>所选课程导师一致时自动带入，可修改。</small></label>
 <label><span>学生进度（%）</span><input id="feedback-progress" type="number" min="0" max="100" step="any" placeholder="例如 35；不确定可留空"></label>
 <label><span>学生称谓</span><select id="feedback-pronoun"><option value="学生">学生（不指定）</option><option value="她">她</option><option value="他">他</option></select><small>用于建议措辞；不会根据姓名推测性别。</small></label>
 <label><span>当前项目（选填）</span><input id="feedback-project" maxlength="200" placeholder="例如：项目一 · 对视"></label>
 <label class="wide"><span>本次作业（可调整）</span><textarea id="feedback-homework" maxlength="4000" placeholder="填写本次需要反馈的作业"></textarea><small id="feedback-homework-hint"></small></label>
 <label class="wide"><span>课堂表现补充（选填）</span><textarea id="feedback-observation" maxlength="2000" placeholder="填写实际观察，例如：能根据测试结果调整结构。"></textarea><small>可填写实际观察；留空时生成温和鼓励，不推测态度或成绩。</small></label>
 <label class="wide"><span>学习建议（选填）</span><textarea id="feedback-advice" maxlength="2000" placeholder="例如：先梳理主要问题，再逐项测试。"></textarea><small>与作业分开，可补充一句简短鼓励；留空时由 AI 根据课程提出建议。</small></label>
 <div class="actions wide"><button type="button" id="feedback-template">使用本地模板（免费）</button><button type="submit" id="feedback-regenerate" hidden>重新生成（再次计费）</button><button type="submit" id="feedback-generate" class="primary">AI 生成反馈</button></div></form>
 <div id="feedback-result" hidden><label for="feedback-text">反馈正文（可直接修改）</label><textarea id="feedback-text"></textarea>
 <div class="actions"><button type="button" id="feedback-back">返回调整信息</button><button type="button" class="primary" id="feedback-copy">复制反馈</button></div></div><p id="feedback-status" class="hint" role="status"></p>`;
 document.body.append(dialog);
 const el=id=>dialog.querySelector('#feedback-'+id);
 const body=el('text'),status=el('status'),copy=el('copy'),settings=el('settings'),result=el('result');
 let current=null,pending=null,lastResult=null,shownCacheKey=null;
 const CACHE_TTL=15*60*1000;
 const fields={teacherName:'teacher',progress:'progress',pronoun:'pronoun',project:'project',homework:'homework',observation:'observation',advice:'advice'};
 const readOptions=()=>Object.fromEntries(Object.entries(fields).map(([key,id])=>[key,el(id).value.trim()]));
 function showResult(value,message){body.value=value;settings.hidden=true;result.hidden=false;el('title').textContent='课程反馈草稿';status.textContent=message;copy.disabled=false;body.focus();}
 function payload(){const lessons=current.lessons.map(({studentName,courseName,content})=>({studentName,courseName,content}));return {studentName:current.studentName,lessons,options:readOptions()};}
 function cacheKey(input){return JSON.stringify({version:'0.8',site:window.SFK_CONFIG?.supabaseUrl,input,ids:current.lessons.map(r=>r.id)});}
 function cached(key){return lastResult?.key===key&&Date.now()-lastResult.at<CACHE_TTL&&lastResult.text.trim();}
 function updateCacheButton(){if(!current||pending)return;const available=cached(cacheKey(payload()));el('generate').textContent=available?'查看上次反馈（不计费）':'AI 生成反馈';el('regenerate').hidden=!available;}
 settings.addEventListener('input',updateCacheButton);settings.addEventListener('change',updateCacheButton);
 function controls(disabled){for(const control of settings.querySelectorAll('input,select,textarea,button'))control.disabled=disabled;el('generate').disabled=disabled||!SFKCloud.configured;}
 el('close').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{pending?.abort();pending=null;controls(false);});
 el('template').onclick=()=>{shownCacheKey=null;try{showResult(draft(current,readOptions()),'本地模板草稿 · 未调用AI，可修改后复制。');}catch(e){status.textContent=e.message;}};
 settings.onsubmit=async e=>{
  e.preventDefault();if(pending)return;
  const options=readOptions();
  try{draft(current,options);}catch(error){status.textContent=error.message;return;}
  const input=payload(),key=cacheKey(input);
  if(cached(key)&&e.submitter?.id!=='feedback-regenerate'){shownCacheKey=key;showResult(lastResult.text,'已复用本页上次反馈，未新增API调用。');return;}
  const checked={...input,lessons:input.lessons.map(({courseName,content})=>({courseName,content}))};
  if(JSON.stringify(checked).length>16000){status.textContent='所选课程内容过多，请减少课程或缩短补充文字。';return;}
  shownCacheKey=null;
  const controller=new AbortController();pending=controller;controls(true);status.textContent='正在调用DeepSeek，请稍候…';el('generate').textContent='生成中…';
  try{
   // Project only the text fields used by the function; no signature or share token.
   const response=await SFKCloud.generateFeedback(input,controller.signal);
   if(pending!==controller||!dialog.open)return;
   lastResult={key,text:response.text,at:Date.now()};shownCacheKey=key;
   const usage=response.usage,counts=Number.isFinite(usage?.inputTokens)&&Number.isFinite(usage?.outputTokens)?' 输入 '+usage.inputTokens+' / 输出 '+usage.outputTokens+' token。':'';
   showResult(response.text,'DeepSeek生成草稿，请核对事实后复制。'+(response.adviceFallback||response.observationFallback?' 部分内容使用通用鼓励或建议补充，请按实际情况调整。':'')+counts);
  }catch(error){if(pending===controller&&dialog.open)status.textContent='生成失败：'+error.message+' 填写内容已保留，可稍后重试或使用本地模板。';}
  finally{if(pending===controller){pending=null;controls(false);updateCacheButton();}}
 };
 el('back').onclick=()=>{settings.hidden=false;result.hidden=true;el('title').textContent='补充反馈信息';status.textContent='重新生成会替换正文中的手动修改。';el('teacher').focus();updateCacheButton();};
 body.oninput=()=>{status.textContent='';copy.disabled=!body.value.trim();if(shownCacheKey&&lastResult?.key===shownCacheKey)lastResult.text=body.value;};
 copy.onclick=async()=>{const value=body.value;if(!value.trim())return;copy.disabled=true;try{await navigator.clipboard.writeText(value);status.textContent='已复制，可粘贴发送给学生或家长。';}catch{body.focus();body.select();status.textContent='无法自动复制，正文已选中，请手动复制。';}finally{copy.disabled=!body.value.trim();}};
 // Keep drafts in memory only; no feedback or reference history is persisted.
 window.SFKFeedback={prepare,draft,open(rows){
  pending?.abort();pending=null;controls(false);el('generate').textContent='AI 生成反馈';current=prepare(rows);const values=defaults(current);
  for(const [key,id] of Object.entries(fields))el(id).value=values[key];
  body.value='';copy.disabled=true;status.textContent=SFKCloud.configured?'':'本地预览尚未配置Supabase，可使用免费模板。';settings.hidden=false;result.hidden=true;el('title').textContent='补充反馈信息';
  el('source').textContent=current.studentName+' · 已选 '+current.lessons.length+' 次课程 · 同名学生请核对课程归属';
  const sources=el('sources');sources.open=false;const list=sources.querySelector('ul');list.replaceChildren();
  for(const r of current.lessons){const li=document.createElement('li');li.textContent=[r.lessonDate||'日期未提供',r.checkIn,r.courseName,r.teacherName&&'导师：'+r.teacherName,'内容：'+(r.content||'未填写'),'作业：'+(r.homework||'未填写')].filter(Boolean).join(' · ');list.append(li);}
  el('homework-hint').textContent=current.lessons.every(r=>r.lessonDate)?'仅带入最近一次上课的作业；最新记录为空时不沿用旧作业。请确认是否仍适用。':'部分课程缺少日期，无法确定最新作业，请手动填写。';
  updateCacheButton();dialog.showModal();el('teacher').focus();
 }};
})();
