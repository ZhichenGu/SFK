/* Local feedback drafts. No model requests or automatic messages. */
'use strict';
(()=>{
 const text=value=>String(value??'').trim();
 function prepare(rows){
  if(!rows.length)throw Error('请先勾选这名学生的课程签单。');
  const lessons=rows.map(({id,record:r})=>({id,studentName:text(r.studentName),courseName:text(r.courseName),lessonDate:text(r.lessonDate),checkIn:text(r.checkIn),checkOut:text(r.checkOut),teacherName:text(r.teacherName),content:text(r.content),homework:text(r.homework)}));
  if(lessons.some(r=>!r.studentName))throw Error('所选签单中有学生姓名为空，请先补充姓名。');
  if(new Set(lessons.map(r=>r.studentName)).size!==1)throw Error('请只勾选同一位学生的签单，可先搜索学生姓名再选择课程。');
  lessons.sort((a,b)=>(a.lessonDate+' '+a.checkIn).localeCompare(b.lessonDate+' '+b.checkIn));
  return {studentName:lessons[0].studentName,lessons};
 }
 function draft({studentName,lessons}){
  const sections=lessons.map(r=>[
   [r.lessonDate||'日期未填写',r.checkIn&&r.checkOut?r.checkIn+'–'+r.checkOut:r.checkIn||r.checkOut,r.courseName,r.teacherName&&'导师：'+r.teacherName].filter(Boolean).join(' · '),
   '课堂内容：'+(r.content||'未填写'),
   '课后作业：'+(r.homework||'未填写')
  ].join('\n'));
  return studentName+'同学及家长，您好！\n以下是本次选取的 '+lessons.length+' 次课程记录与作业安排：\n\n'+sections.join('\n\n');
 }
 const style=document.createElement('style');style.textContent=`
 #feedback-dialog{width:min(760px,calc(100vw - 24px));padding:24px;color:inherit}
 #feedback-dialog .dialog-bar{gap:12px}#feedback-dialog h2{margin:0;font-size:20px}
 #feedback-dialog p{font-size:13px;line-height:1.7;overflow-wrap:anywhere}
 #feedback-text{min-height:320px;max-height:52vh}#feedback-dialog .actions{justify-content:flex-end}
 #feedback-dialog .actions button{flex:0 1 auto}#feedback-status{min-height:22px}
 @media(max-width:600px){#feedback-dialog{padding:16px}#feedback-text{min-height:260px}}
 `;document.head.append(style);
 const dialog=document.createElement('dialog');dialog.id='feedback-dialog';dialog.setAttribute('aria-labelledby','feedback-title');dialog.setAttribute('aria-describedby','feedback-note');
 dialog.innerHTML=`<div class="dialog-bar"><h2 id="feedback-title">课程反馈草稿</h2><button type="button" id="feedback-close">关闭</button></div>
 <p id="feedback-note" class="hint">模板草稿 · 尚未接入 AI。按原文整理课堂内容和作业，请核对后复制发送。同名学生请核对课程归属。</p>
 <p id="feedback-source"></p><label for="feedback-text">反馈正文（可直接修改）</label><textarea id="feedback-text"></textarea>
 <div class="actions"><button type="button" class="primary" id="feedback-copy">复制反馈</button></div><p id="feedback-status" class="hint" role="status"></p>`;
 document.body.append(dialog);
 const body=dialog.querySelector('#feedback-text'),status=dialog.querySelector('#feedback-status'),copy=dialog.querySelector('#feedback-copy');
 dialog.querySelector('#feedback-close').onclick=()=>dialog.close();
 body.oninput=()=>{status.textContent='';copy.disabled=!body.value.trim();};
 copy.onclick=async()=>{const value=body.value;if(!value.trim())return;copy.disabled=true;try{await navigator.clipboard.writeText(value);status.textContent='已复制，可粘贴发送给学生或家长。';}catch{body.focus();body.select();status.textContent='无法自动复制，正文已选中，请手动复制。';}finally{copy.disabled=!body.value.trim();}};
 // Keep drafts in memory only; no feedback or reference history is persisted.
 window.SFKFeedback={prepare,draft,open(rows){
  const input=prepare(rows);body.value=draft(input);copy.disabled=false;status.textContent='';
  dialog.querySelector('#feedback-source').textContent=input.studentName+' · 已选 '+input.lessons.length+' 次课程 · 按上课时间排序';
  dialog.showModal();body.focus();
 }};
})();
