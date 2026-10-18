/* Schedule OCR: upload a timetable screenshot -> Google Cloud Vision (via Edge
 * Function) -> parse rows -> confirm/edit -> fill content -> batch create links.
 * Reuses the existing repository / compactRecord / publish link pipeline.
 */
'use strict';
window.SFKOCR=(()=>{
  const cloud=window.SFKCloud,repo=window.SFKRepo;
  if(!repo||!cloud)return {show(){},hide(){},view:null};
  const uid=()=>Math.random().toString(36).slice(2,10);
  const newRow=()=>({key:uid(),selected:true,studentName:'',courseName:'',lessonDate:'',checkIn:'',checkOut:'',teacherName:'',content:'',homework:'',status:'new',link:'',error:'',id:null,revision:0});

  let stage='upload',rows=[],imageDataUrl=null,showMineOnly=true,busy=false,lastOCR=null;

  const style=document.createElement('style');
  style.textContent='.ocr-view{max-width:1428px;margin:30px auto;padding:0 24px}.ocr-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px}.ocr-bar h2{margin:0}.ocr-status{color:#69748a;font-size:14px;line-height:1.6}.dropzone{border:2px dashed var(--line);border-radius:16px;background:#fff;padding:44px 20px;text-align:center;cursor:pointer;color:#69748a}.dropzone.drag{border-color:var(--blue);background:#eef3ff}.dropzone strong{color:#202637;font-size:16px}.ocr-preview{max-width:100%;max-height:320px;margin:16px auto 0;border-radius:12px;border:1px solid var(--line);display:block}.ocr-section{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}.ocr-head{display:grid;grid-template-columns:44px minmax(210px,1.5fr) minmax(150px,1fr) 120px 120px 120px 120px 76px;gap:10px;padding:0 13px 8px;color:#69748a;font-size:13px}.ocr-row{display:grid;grid-template-columns:44px minmax(210px,1.5fr) minmax(150px,1fr) 120px 120px 120px 120px 76px;gap:10px;align-items:start;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:10px}.ocr-row.done{border-color:#9fe1cb}.ocr-row select,.ocr-row input{width:100%}.ocr-row textarea{width:100%;resize:vertical;min-height:46px}.ocr-row .cell{min-width:0}.ocr-actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:14px 0}.ocr-actions button{min-height:40px}.apply-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px}.apply-grid textarea{width:100%;resize:vertical;min-height:64px}.copyall{background:#f7f8fb;border:1px dashed var(--line);border-radius:10px;padding:14px;margin-top:12px;white-space:pre-wrap;font-size:13px;color:#333;word-break:break-all}.badge{padding:4px 8px;border-radius:8px;font-size:12px}@media(max-width:1100px){.ocr-view{padding:0 24px 90px;margin-top:16px}.ocr-head{display:none}.ocr-row{display:flex;flex-direction:column;gap:10px;padding:14px}.ocr-row .cell{padding-left:0}.ocr-row .cell::before{content:attr(data-label);display:block;font-size:12px;color:#69748a;margin-bottom:4px}.apply-grid{grid-template-columns:1fr}}';
  style.textContent+='@media(max-width:600px){.ocr-view{padding-left:14px;padding-right:14px}}';
  document.head.append(style);
  style.textContent+=`
  .ocr-content-row{grid-template-columns:minmax(160px,.8fr) minmax(0,1.2fr) minmax(0,1.2fr) minmax(120px,.6fr)}.ocr-content-row strong{overflow-wrap:anywhere}.ocr-content-row textarea{min-width:0}
  @media(max-width:1100px){.ocr-row{align-items:stretch}.ocr-row>.cell{width:100%}}
  .ocr-guide{margin-top:32px;padding:24px;background:#fff;border:1px solid var(--line);border-radius:16px}
  .ocr-guide h3{font-size:18px;margin:0 0 8px}.ocr-guide-intro{margin:0;color:#69748a;font-size:14px;line-height:1.7}
  .ocr-guide-steps{list-style:none;padding:0;margin:22px 0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}
  .ocr-guide-steps li{display:flex;align-items:flex-start;gap:10px;min-width:0}.ocr-guide-number{flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#eef1ff;color:var(--blue);font-size:14px;font-weight:700}
  .ocr-guide-steps strong{font-size:14px}.ocr-guide-steps p{font-size:13px;line-height:1.7;color:#69748a;margin:6px 0 0}
  .ocr-guide-images{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:start}
  .ocr-guide figure{margin:0;min-width:0}.ocr-guide figcaption{font-size:13px;line-height:1.6;margin-bottom:10px;color:#59667f}
  .ocr-guide-images a{display:block;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#f4f6fa}.ocr-guide-images a:focus-visible{outline:3px solid #9aaeff;outline-offset:3px}
  .ocr-guide img{display:block;width:100%;height:auto}.ocr-guide-tip{font-size:13px;color:#69748a;line-height:1.7;margin:18px 0 0}
  @media(max-width:700px){.ocr-guide{padding:18px 16px;margin-top:24px}.ocr-guide-steps,.ocr-guide-images{grid-template-columns:1fr;gap:18px}}
  `;

  const view=document.createElement('main');view.className='ocr-view';view.id='ocr-view';view.hidden=true;
  view.innerHTML='<div class="ocr-bar"><div><h2>课表识别新建</h2><p class="ocr-status">上传课表截图，自动识别学生 / 课程 / 时间，确认后批量生成签单。</p></div><div><button type="button" id="ocr-back">← 返回管理</button></div></div>'+
   '<div id="ocr-stage"></div><p class="ocr-status" id="ocr-status" role="status"></p>'+`
   <section class="ocr-guide" id="ocr-guide" aria-labelledby="ocr-guide-title">
    <h3 id="ocr-guide-title">课表识别怎么用？</h3>
    <p class="ocr-guide-intro">按下面三步操作。参考图里有两张课程卡片，核对时应是两节课。</p>
    <ol class="ocr-guide-steps">
     <li><span class="ocr-guide-number">1</span><div><strong>截取完整课程卡片</strong><p>保留课程名称、学生姓名和起止时间。上传清晰的 JPG / PNG，然后点「开始识别」。</p></div></li>
     <li><span class="ocr-guide-number">2</span><div><strong>核对每一节课</strong><p>检查姓名、时间和课程类型；日期、教师等缺项可手动补充。多余项删除，漏项可手动添加。</p></div></li>
     <li><span class="ocr-guide-number">3</span><div><strong>填写并生成链接</strong><p>点「下一步：填写内容」，填写上课内容和作业，生成签单后复制链接发给对应学生。</p></div></li>
    </ol>
    <div class="ocr-guide-images">
     <figure><figcaption>截图参考 · 完整保留两张课程卡片</figcaption><a href="assets/ocr-guide/timetable-reference.png" target="_blank" rel="noopener noreferrer" aria-label="放大查看课表参考图"><img src="assets/ocr-guide/timetable-reference.png" width="670" height="332" loading="lazy" alt="课表参考：Michael Zhicheng Fan 的课程为 13:30 至 14:30，金紫宁的课程为 14:30 至 15:30"></a></figure>
     <figure><figcaption>填写界面示例 · 两张卡片对应两节课（演示）</figcaption><a href="assets/ocr-guide/confirmation-example.png" target="_blank" rel="noopener noreferrer" aria-label="放大查看课程核对示例"><img src="assets/ocr-guide/confirmation-example.png" loading="lazy" alt="课程核对界面示例，两名学生分别对应一条课程记录，可编辑姓名、课程类型、日期、开始和结束时间"></a></figure>
    </div>
    <p class="ocr-guide-tip">点击图片可放大查看。截图未包含的信息不会被自动识别出来；结果有误时，可直接在核对页修改。</p>
   </section>`;
  document.body.append(view);

  const $=id=>document.getElementById(id);
  const stageEl=()=>$('ocr-stage');
  function status(t){$('ocr-status').textContent=t||'';}
  const curUser=()=>window.SFKUser&&SFKUser.current();

  async function rosterNames(){
    try{const t=await (cloud.configured?cloud.listTeachers():JSON.parse(localStorage.getItem('sfk-teachers-v1')||'[]'));return (t||[]).map(x=>x.name).filter(Boolean);}catch{return[];}
  }

  function renderUpload(){
    $('ocr-guide').hidden=false;
    stageEl().innerHTML='<div class="ocr-section"><div class="dropzone" id="ocr-drop"><strong>点击或拖拽上传课表截图</strong><br>支持 JPG / JPEG / PNG，单张图片</div><input id="ocr-file" type="file" accept="image/jpeg,image/png" hidden><img id="ocr-preview" class="ocr-preview" alt="课表预览" hidden></div><div class="ocr-actions"><button type="button" class="primary" id="ocr-recognize" disabled>开始识别</button><button type="button" id="ocr-reset">重新上传</button></div>';
    const drop=$('ocr-drop'),file=$('ocr-file'),preview=$('ocr-preview'),rec=$('ocr-recognize');
    drop.onclick=()=>file.click();
    ['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag');}));
    ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag');}));
    drop.addEventListener('drop',e=>{const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];if(f)readImage(f);});
    file.onchange=()=>{const f=file.files&&file.files[0];if(f)readImage(f);};
    $('ocr-reset').onclick=()=>{imageDataUrl=null;file.value='';preview.hidden=true;preview.src='';rec.disabled=true;renderUpload();};
    function readImage(f){
      if(!['image/jpeg','image/png'].includes(f.type)){status('请选择 JPG / PNG 图片');return;}
      if(f.size>10*1024*1024){status('图片过大，请小于 10 MB');return;}
      const r=new FileReader();r.onload=()=>{imageDataUrl=r.result;preview.src=r.result;preview.hidden=false;rec.disabled=false;status('');};
      r.onerror=()=>status('读取图片失败，请重试');
      r.readAsDataURL(f);
    }
    if(imageDataUrl){preview.src=imageDataUrl;preview.hidden=false;rec.disabled=false;}
    rec.onclick=()=>recognize();
  }

  async function recognize(){
    if(busy)return;busy=true;$('ocr-guide').hidden=true;stageEl().innerHTML='<div class="ocr-section" style="text-align:center;padding:60px 20px"><p class="ocr-status" style="font-size:16px">正在识别课表…</p><p class="ocr-status">首次调用 Google Vision 可能需数秒</p></div>';
    status('');
    try{
      if(!cloud.configured){throw Error('当前是本地预览，无法调用 OCR。请先配置 Supabase 并部署 ocr-schedule 函数。');}
      const reused=lastOCR?.image===imageDataUrl;
      const result=reused?lastOCR.result:await cloud.ocrSchedule(imageDataUrl);
      lastOCR={image:imageDataUrl,result};
      const roster=await rosterNames();
      const u=curUser();
      rows=[];
      for(const parsed of SFKScheduleParser.parse(result.words,roster)){
        const row=newRow();Object.assign(row,parsed,{courseTitle:parsed.courseName,courseName:courseType(parsed.courseName),selected:!!parsed.studentName});
        rows.push(row);
      }
      if(!rows.length){status('没有找到可确认的课程卡片或完整课程行；请手动添加，不会将零散文字生成多节课。');stage='confirm';renderConfirm();busy=false;return;}
      showMineOnly=!!(u&&rows.some(r=>r.teacherName===u.name));
      stage='confirm';renderConfirm();
      status((reused?'已复用本次图片结果，未再次请求 OCR。':'')+'识别出 '+rows.length+' 节课，请核对姓名、时间和签单类型；截图未提供的信息保留为空。');
    }catch(e){
      status('识别失败：'+e.message);
      renderUpload();
    }finally{busy=false;}
  }

  function filteredRows(){
    const u=curUser();
    if(showMineOnly&&u)return rows.filter(r=>r.teacherName===u.name);
    return rows;
  }

  function renderConfirm(){
    const u=curUser();
    const list=filteredRows();
    const mineBtn=u?('<button type="button" id="ocr-toggle">'+(showMineOnly?'显示全部课程':'仅显示我的课程')+'</button>'):'';
    stageEl().innerHTML='<div class="ocr-section"><div class="ocr-actions"><button type="button" id="ocr-upload-again">返回上传</button><button type="button" id="ocr-add">＋ 手动添加一条</button>'+mineBtn+'<button type="button" class="primary" id="ocr-next">下一步：填写内容</button></div>'+
      '<div class="ocr-head"><span>选择</span><span>学生</span><span>课程</span><span>日期</span><span>开始</span><span>结束</span><span>教师</span><span></span></div><div id="ocr-rows"></div></div>';
    const box=$('ocr-rows');
    box.replaceChildren();
    if(!list.length){const p=document.createElement('p');p.className='ocr-status';p.textContent='没有可显示的课程。';box.append(p);}
    list.forEach(r=>box.append(renderRow(r)));
    $('ocr-upload-again').onclick=()=>{stage='upload';renderUpload();status('同一张图片在本页内会复用识别结果。');};
    $('ocr-add').onclick=()=>{rows.push(newRow());if(u)rows[rows.length-1].teacherName=u.name;renderConfirm();};
    if(u)$('ocr-toggle').onclick=()=>{showMineOnly=!showMineOnly;renderConfirm();};
    $('ocr-next').onclick=()=>{const visible=new Set(filteredRows());rows.forEach(r=>{if(!visible.has(r))r.selected=false;});const sel=rows.filter(r=>r.selected);if(!sel.length){status('请至少勾选一条课程');return;}if(sel.some(r=>!r.studentName.trim())){status('有学生姓名未确认，请补全或取消勾选');return;}stage='content';renderContent();};
  }

  function courseType(title){
    // Both existing signature types stay editable; mixed courses use the existing project default.
    return /基础|软件/.test(title)&&!/项目/.test(title)?'基础/软件课':'项目课';
  }

  function renderRow(row){
    const box=document.createElement('div');box.className='ocr-row';
    const chk=document.createElement('input');chk.type='checkbox';chk.checked=row.selected;chk.onchange=()=>{row.selected=chk.checked;};
    const student=input(row.studentName);student.placeholder='姓名';
    const course=document.createElement('select');
    course.innerHTML='<option value="项目课">项目课</option><option value="基础/软件课">基础/软件课</option>';course.value=row.courseName||'项目课';
    const date=input(row.lessonDate);date.type='date';
    const tin=input(row.checkIn);tin.type='time';tin.step='1800';
    const tout=input(row.checkOut);tout.type='time';tout.step='1800';
    const teacher=input(row.teacherName);teacher.placeholder='教师（可空）';
    const del=document.createElement('button');del.type='button';del.className='danger';del.textContent='删除';del.onclick=()=>{rows.splice(rows.indexOf(row),1);renderConfirm();};
    const cells=[[chk,'选择'],[student,'学生'],[course,'课程'],[date,'日期'],[tin,'开始时间'],[tout,'结束时间'],[teacher,'教师'],[del,'操作']];
    cells.forEach(([el,label])=>{const c=document.createElement('div');c.className='cell';c.setAttribute('data-label',label);c.append(el);if(el===course&&row.courseTitle){const source=document.createElement('p');source.className='ocr-status';source.textContent='原课程：'+row.courseTitle;c.append(source);}box.append(c);});
    student.oninput=()=>row.studentName=student.value;
    course.onchange=()=>row.courseName=course.value;
    date.oninput=()=>row.lessonDate=date.value;
    tin.oninput=()=>row.checkIn=tin.value;
    tout.oninput=()=>row.checkOut=tout.value;
    teacher.oninput=()=>row.teacherName=teacher.value;
    return box;
  }
  function input(val){const i=document.createElement('input');i.value=val||'';return i;}

  function buildRecord(row){
    const rec=initialRecord();
    rec.studentName=row.studentName.trim();
    rec.courseName=row.courseName||'项目课';
    rec.lessonDate=row.lessonDate||'';
    rec.checkIn=row.checkIn||'';rec.checkOut=row.checkOut||'';
    rec.content=row.content||'';rec.homework=row.homework||'';
    rec.teacherName=row.teacherName||(curUser()?curUser().name:'');
    rec.signatures.mentor={mode:'text',text:rec.teacherName,image:null,strokes:[],loading:false,revision:0};
    rec.signatures.student=blankSignature();
    return rec;
  }

  function renderContent(){
    stageEl().innerHTML='<div class="ocr-section"><div class="ocr-actions"><button type="button" id="ocr-back-confirm">← 返回确认</button><button type="button" class="primary" id="ocr-generate">批量生成签单</button></div>'+
      '<div class="apply-grid"><div><label>上课内容（应用到全部）</label><textarea id="ocr-apply-content" placeholder="填写后点「应用到全部」"></textarea></div><div><label>课后作业（应用到全部）</label><textarea id="ocr-apply-homework" placeholder="填写后点「应用到全部」"></textarea></div></div>'+
      '<div class="ocr-actions"><button type="button" id="ocr-apply">应用到全部（勾选的签单）</button></div>'+
      '<div id="ocr-content-rows"></div></div><div class="ocr-section" id="ocr-results" hidden></div>';
    const box=$('ocr-content-rows');box.replaceChildren();
    rows.filter(r=>r.selected).forEach(r=>box.append(renderContentRow(r)));
    $('ocr-back-confirm').onclick=()=>{stage='confirm';renderConfirm();};
    $('ocr-apply').onclick=()=>{const c=$('ocr-apply-content').value,hm=$('ocr-apply-homework').value;if(!c&&!hm){status('请先在上方填写内容或作业');return;}rows.forEach(r=>{if(r.selected){if(c)r.content=c;if(hm)r.homework=hm;}});renderContent();status('已应用到全部勾选的签单。');};
    $('ocr-generate').onclick=()=>generate();
    generationControls();
  }

  function renderContentRow(row){
    const box=document.createElement('div');box.className='ocr-row ocr-content-row';
    const name=document.createElement('div');name.className='cell';name.setAttribute('data-label','学生');const n=document.createElement('strong');n.textContent=row.studentName||'未命名';name.append(n);
    const content=document.createElement('textarea');content.value=row.content;content.placeholder='上课内容…';
    const homework=document.createElement('textarea');homework.value=row.homework;homework.placeholder='课后作业…';
    const ccell=document.createElement('div');ccell.className='cell';ccell.setAttribute('data-label','上课内容');ccell.append(content);
    const hcell=document.createElement('div');hcell.className='cell';hcell.setAttribute('data-label','课后作业');hcell.append(homework);
    const state=document.createElement('div');state.className='cell';state.setAttribute('data-label','状态');
    const linkArea=document.createElement('div');
    if(row.status==='linked'&&row.link){const a=document.createElement('a');a.href=row.link;a.target='_blank';a.rel='noopener noreferrer';a.textContent='打开';const c=document.createElement('button');c.type='button';c.textContent='复制链接';c.onclick=async()=>{try{await navigator.clipboard.writeText(row.link);c.textContent='已复制';}catch{status('复制失败，请打开链接后手动复制地址。');}};linkArea.append(a,' ',c);}
    else if(row.status==='error'){const s=document.createElement('span');s.className='ocr-status';s.style.color='#a52626';s.textContent='失败：'+row.error;linkArea.append(s);}
    else if(row.status==='new'){linkArea.append(document.createTextNode('待生成'));}
    state.append(linkArea);
    box.append(name,ccell,hcell,state);
    content.oninput=()=>row.content=content.value;
    homework.oninput=()=>row.homework=homework.value;
    return box;
  }

  function generationControls(){view.querySelectorAll('input,textarea,select,button').forEach(el=>el.disabled=busy);}
  const sameRecord=(a,b)=>JSON.stringify(cloud.cleanRecord(a))===JSON.stringify(cloud.cleanRecord(b));
  async function generate(){
    if(busy)return;
    const target=rows.filter(r=>r.selected&&r.studentName.trim()&&r.status!=='linked');
    if(!target.length){status('没有待生成的签单（已生成或未填写学生姓名）。');return;}
    busy=true;generationControls();const teacher=curUser()?.id||null;
    let ok=0,fail=[];
    try{
      for(const r of target){
        status('正在生成 '+r.studentName+' …');
        try{
          if(r.pending){
            let latest;
            try{latest=await repo.get(r.id);}catch(e){if(r.pending.revision!==0||!/^(没有找到这份签单。|没有找到签单)$/.test(e.message))throw e;}
            if(latest){
              if(latest.revision===r.pending.revision+1&&sameRecord(latest.record,r.pending.record)){r.revision=latest.revision;r.savedRecord=latest.record;}
              else if(latest.revision!==r.pending.revision)throw Error('记录已更新，请从管理页核对，不能覆盖重试。');
            }
            r.pending=null;
          }
          const record=await cloud.compactRecord(buildRecord(r));
          if(!r.savedRecord||!sameRecord(r.savedRecord,record)){
            r.id=r.id||crypto.randomUUID();r.link='';r.pending={revision:r.revision||0,record};
            const saved=await repo.save(r.id,r.pending.revision,record,teacher);
            r.id=saved.id;r.revision=saved.revision;r.savedRecord=saved.record;r.pending=null;
          }
          if(cloud.configured&&!r.link){const base=new URL(window.SFK_CONFIG.siteUrl);if(base.protocol!=='https:')throw Error('请配置 HTTPS 网站地址。');const share=await cloud.publish(r.id);base.hash='request='+share.token;base.search='';r.link=base.href;}
          r.status='linked';r.error='';ok++;
        }catch(e){r.status='error';r.error=e.message;fail.push(r.studentName+'：'+e.message);}
        renderContent();
      }
      status('成功 '+ok+' 份'+(fail.length?'；失败 '+fail.length+' 份：'+fail.join('；'):''));
      renderResults();
    }catch(e){status('生成未完成：'+e.message);}
    finally{busy=false;generationControls();}
  }

  function renderResults(){
    const linked=rows.filter(r=>r.status==='linked'&&r.link);
    const failed=rows.filter(r=>r.status==='error');
    const box=$('ocr-results');box.replaceChildren();
    if(!linked.length&&!failed.length){box.hidden=true;return;}
    box.hidden=false;
    box.innerHTML='<h3 style="margin:0 0 10px">生成结果</h3>'+'<div class="ocr-actions">'+(linked.length?'<button type="button" id="ocr-copyall">复制全部链接</button>':'')+(failed.length?'<button type="button" id="ocr-retry">仅重试失败项</button>':'')+'</div>'+'<div id="ocr-result-list"></div>';
    const list=$('ocr-result-list');
    linked.forEach(r=>{const line=document.createElement('div');line.className='ocr-status';line.style.cssText='display:flex;justify-content:space-between;gap:10px;margin-bottom:6px';line.innerHTML='<span>'+esc(r.studentName)+'｜'+esc(r.courseName)+'</span><span><a href="'+esc(r.link)+'" target="_blank" rel="noopener noreferrer">打开</a> <button type="button" class="cp">复制链接</button></span>';line.querySelector('.cp').onclick=async()=>{try{await navigator.clipboard.writeText(r.link);line.querySelector('.cp').textContent='已复制';}catch{status('复制失败，请打开链接后手动复制地址。');}};list.append(line);});
    if(linked.length){$('ocr-copyall').onclick=async()=>{const txt=linked.map(r=>r.studentName+'｜'+r.courseName+'\n'+r.link).join('\n\n');try{await navigator.clipboard.writeText(txt);status('已复制全部链接。');}catch{const t=document.createElement('textarea');t.value=txt;document.body.append(t);t.select();const copied=document.execCommand('copy');t.remove();status(copied?'已复制全部链接。':'复制失败，请逐条打开链接后复制地址。');}};}
    if(failed.length){$('ocr-retry').onclick=()=>{failed.forEach(r=>{r.status='new';r.error='';});renderContent();generate();};}
  }
  function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  function show(){
    stage='upload';rows=[];imageDataUrl=null;showMineOnly=true;busy=false;status('');
    document.querySelector('main.layout').hidden=true;
    const dash=document.getElementById('dashboard');if(dash)dash.hidden=true;
    if(window.SFKBatch&&SFKBatch.view)SFKBatch.view.hidden=true;
    if(window.SFKUser&&SFKUser.view)SFKUser.view.hidden=true;
    view.hidden=false;document.querySelector('h1').textContent='课表识别新建';
    renderUpload();window.scrollTo(0,0);
  }
  function hide(){view.hidden=true;}

  $('ocr-back').onclick=()=>{if(window.SFKShowDashboard)window.SFKShowDashboard();else hide();};

  return {show,hide,view,isBusy:()=>busy,_parse:SFKScheduleParser.parse};
})();
