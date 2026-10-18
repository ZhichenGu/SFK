/* Batch entry: one row per student with batch-level defaults, then generate all
 * links at once. Desktop = table, mobile = one card at a time with prev/next.
 * Draft persists locally. Same repository abstraction as workspace.js.
 */
'use strict';
window.SFKBatch=(()=>{
  const repo=window.SFKRepo,cloud=window.SFKCloud;
  if(!repo||!cloud)return {show(){},hide(){},view:null};
  const D=window.SFKBatchDefaults||{read:()=>({}),remember(){}};
  const DRAFT='sfk-batch-draft-v1',COPIED='sfk-copied-v1';
  const uid=()=>Math.random().toString(36).slice(2,10);
  const newRow=()=>({key:uid(),id:null,revision:0,studentName:'',courseName:'',lessonDate:'',checkIn:'',checkOut:'',lessonNumber:'',content:'',homework:'',previousHomework:null,status:'new',link:'',error:'',copied:false});
  const copiedIds=()=>{try{return new Set(JSON.parse(localStorage.getItem(COPIED)||'[]'));}catch{return new Set();}};

  let defaults={courseName:'项目课',lessonDate:'',checkIn:'',checkOut:'',mentor:null,teacherName:''};
  let rows=[],pageIndex=0,generating=false;

  const style=document.createElement('style');
  style.textContent='.batch-view{max-width:1428px;margin:30px auto;padding:0 24px}.batch-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px}.batch-bar h2{margin:0}.batch-defaults{display:grid;grid-template-columns:150px 160px 120px 120px minmax(180px,1fr);gap:12px;align-items:end;background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:18px}.batch-defaults label{display:block;font-size:13px;color:#69748a;margin-bottom:6px}.batch-defaults select,.batch-defaults input{width:100%}.batch-defaults .mentor-note{grid-column:1/-1;font-size:12px;color:#69748a}.batch-list{margin-bottom:18px}.batch-head{display:grid;grid-template-columns:160px 1fr 1fr 190px;gap:10px;padding:0 15px 8px;color:#69748a;font-size:13px}.batch-row{display:grid;grid-template-columns:160px 1fr 1fr 190px;gap:10px;align-items:start;background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:10px}.batch-row.done{border-color:#9fe1cb}.batch-row select,.batch-row input{width:100%}.cell-time{display:grid;grid-template-columns:1fr 1fr;gap:6px}.cell-text{width:100%;resize:none;overflow:hidden;min-height:46px;height:46px;transition:height .15s}.cell-text:focus{height:120px;overflow:auto}.batch-sub{grid-column:1/-1;display:none;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;border-top:1px dashed var(--line);padding-top:12px}.batch-sub .cell::before{content:attr(data-label);display:block;font-size:12px;color:#69748a;margin-bottom:4px}.batch-row.expanded .batch-sub{display:grid}.cell.ops{display:flex;flex-wrap:wrap;gap:6px;align-content:start}.cell.ops button{min-height:32px;padding:4px 8px;font-size:12px}.row-link{margin-top:8px;font-size:13px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%}.row-link a{color:var(--blue);word-break:break-all}.batch-actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:16px}.batch-status{color:#69748a;font-size:14px;line-height:1.6}.batch-empty{padding:28px;text-align:center;color:#69748a}.row-error{color:#a52626;font-size:12px}.batch-pager{display:none;align-items:center;gap:10px;margin-bottom:12px}.batch-pager button{min-height:40px;padding:0 14px}.batch-mobilebar{display:none;position:fixed;left:0;right:0;bottom:0;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid var(--line);z-index:20;gap:10px}.batch-mobilebar button{flex:1;min-height:46px}@media(max-width:820px){.batch-view{padding:0 24px 90px;margin-top:16px}.batch-head{display:none}.batch-defaults{grid-template-columns:1fr 1fr}.batch-defaults .mentor{grid-column:1/-1}.batch-defaults .mentor-note{grid-column:1/-1}.batch-row{display:flex;flex-direction:column;gap:12px;padding:16px}.cell{padding-left:0}.cell::before{content:attr(data-label);display:block;font-size:12px;color:#69748a;margin-bottom:4px}.cell.ops::before{content:""}.cell.ops{flex-direction:row}.batch-pager{display:flex}.batch-mobilebar{display:flex}}';
  style.textContent+=`
  .batch-row>.cell,.batch-defaults>div{min-width:0}.batch-row textarea,.batch-row input,.batch-defaults input,.batch-defaults select{min-width:0}
  @media(min-width:821px) and (max-width:1000px){.batch-defaults{grid-template-columns:repeat(2,minmax(0,1fr))}.batch-defaults .mentor{grid-column:1/-1}}
  @media(max-width:820px){.batch-row{align-items:stretch}.batch-row>.cell,.batch-row>.batch-sub{width:100%}.batch-row .cell.ops{flex-direction:row}.batch-defaults{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  style.textContent+='@media(max-width:600px){.batch-view{padding-left:14px;padding-right:14px}}';
  document.head.append(style);

  const view=document.createElement('main');
  view.className='batch-view';view.id='batch-view';view.hidden=true;
  view.innerHTML='<div class="batch-bar"><div><h2>批量新建签单</h2><p class="batch-status">一行一个学生；课程/日期/时间用顶部默认值，个别行不同时点「更多」单独改。</p></div><div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" id="batch-back">← 返回管理</button></div></div>'+
   '<div class="batch-defaults"><div><label for="b-course">课程类型（默认）</label><select id="b-course"><option value="项目课">项目课</option><option value="基础/软件课">基础/软件课</option></select></div>'+
   '<div><label for="b-date">上课日期（默认）</label><input id="b-date" type="date"></div>'+
   '<div><label for="b-in">开始时间</label><select id="b-in"></select></div>'+
   '<div><label for="b-out">结束时间</label><select id="b-out"></select></div>'+
   '<div class="mentor"><label for="b-mentor">导师姓名（常用，首页按此检索）</label><input id="b-mentor" maxlength="24" placeholder="输入你的姓名，自动带入每份"></div>'+
   '<div class="mentor-note" id="b-mentor-note"></div></div>'+
   '<div class="batch-list"><div class="batch-pager" id="batch-pager"><button type="button" id="pg-prev">上一份</button><span id="pg-count" class="batch-status">第 1 / 1 份</span><button type="button" id="pg-next">下一份</button><button type="button" id="pg-add">＋ 新增</button></div><div class="batch-head"><span>学生姓名</span><span>上课内容</span><span>课后作业</span><span>操作</span></div><div id="batch-rows"></div></div>'+
   '<div class="batch-actions"><button type="button" id="batch-add">＋ 添加一行</button><button type="button" class="primary" id="batch-generate">批量保存并生成链接</button><span class="batch-status" id="batch-status" role="status"></span></div>'+
   '<div class="batch-actions" id="batch-exportall" hidden><button type="button" id="batch-copyall">复制全部链接文本</button></div>'+
   '<div class="batch-mobilebar" id="batch-mobilebar"><button type="button" id="batch-generate2" class="primary">批量保存并生成链接</button></div>'+
   '<datalist id="batch-names"></datalist>';
  document.body.append(view);

  const $=id=>document.getElementById(id);
  function timeOptions(sel,val){let o='';for(let n=0;n<1440;n+=30){const t=clockText(n);o+='<option value="'+t+'"'+(t===val?' selected':'')+'>'+t+'</option>';}sel.innerHTML=o;}
  const isMobile=()=>window.matchMedia('(max-width:820px)').matches;

  function readDraft(){try{const d=JSON.parse(localStorage.getItem(DRAFT)||'null');if(d&&Array.isArray(d.rows)){defaults=Object.assign(defaults,d.defaults||{});rows=d.rows.map(r=>Object.assign(newRow(),r));return true;}}catch{}return false;}

  let draftTimer=null;
  function writeDraft(){
    clearTimeout(draftTimer);
    localStorage.setItem(DRAFT,JSON.stringify({defaults,rows}));
  }
  function saveDraft(){clearTimeout(draftTimer);draftTimer=setTimeout(()=>{try{writeDraft();}catch{status('草稿保存失败，请勿刷新或关闭页面。');}},300);}
  const sameRecord=(a,b)=>JSON.stringify(cloud.cleanRecord(a))===JSON.stringify(cloud.cleanRecord(b));
  // Persist intent before sending. A lost response is reconciled using the same ID.
  async function reconcile(row){
    if(!row.pending)return;
    let current;
    try{current=await repo.get(row.id);}catch(e){
      if(row.pending.revision===0&&/^(没有找到这份签单。|没有找到签单)$/.test(e.message)){row.pending=null;writeDraft();return;}
      throw Error('无法确认上次保存结果：'+e.message);
    }
    if(current.revision===row.pending.revision+1&&sameRecord(current.record,row.pending.record)){
      row.revision=current.revision;row.savedRecord=current.record;row.pending=null;writeDraft();return;
    }
    if(current.revision===row.pending.revision){row.pending=null;writeDraft();return;}
    throw Error('记录已被更新，请从管理页核对；已保留草稿，不会覆盖或新建重复签单。');
  }
  function buildMentor(){const d=defaults.mentor;if(d&&signaturePresent(d)&&d.mode==='image')return d;const text=$('b-mentor').value.trim();return text?{mode:'text',text,image:null,strokes:[],loading:false,revision:0}:blankSignature();}
  function buildRecord(row){const rec=initialRecord();rec.studentName=row.studentName.trim();rec.courseName=row.courseName||defaults.courseName;rec.lessonDate=row.lessonDate||defaults.lessonDate;rec.lessonNumber=row.lessonNumber||'';rec.checkIn=row.checkIn||defaults.checkIn;rec.checkOut=row.checkOut||defaults.checkOut;rec.content=row.content;rec.homework=row.homework;rec.previousHomework=row.previousHomework||null;rec.teacherName=$('b-mentor').value.trim();rec.signatures.mentor=buildMentor();rec.signatures.student=blankSignature();return rec;}

  function el(tag,cls,label){const e=document.createElement(tag);if(cls)e.className=cls;if(label)e.setAttribute('data-label',label);return e;}
  function input(val){const i=document.createElement('input');i.value=val||'';return i;}

  function renderRow(row,index){
    const box=el('div','batch-row'+(row.status==='linked'?' done':''));
    box.dataset.key=row.key;
    const name=input(row.studentName);name.setAttribute('list','batch-names');name.placeholder='姓名';name.autocomplete='off';
    const course=document.createElement('select');course.innerHTML='<option value="">继承默认</option><option value="项目课">项目课</option><option value="基础/软件课">基础/软件课</option>';course.value=row.courseName||'';
    const date=input(row.lessonDate);date.type='date';date.title='留空继承默认';
    const tin=input(row.checkIn);tin.type='time';tin.step='1800';
    const tout=input(row.checkOut);tout.type='time';tout.step='1800';
    const content=document.createElement('textarea');content.className='cell-text';content.rows=1;content.value=row.content;content.placeholder='本课内容…';
    const homework=document.createElement('textarea');homework.className='cell-text';homework.rows=1;homework.value=row.homework;homework.placeholder='课后作业…';
    const ops=el('div','cell ops');
    const more=document.createElement('button');more.type='button';more.textContent='更多';
    const reuse=document.createElement('button');reuse.type='button';reuse.textContent='沿用上次';
    const dup=document.createElement('button');dup.type='button';dup.textContent='复制上一行';if(index===0)dup.disabled=true;
    const del=document.createElement('button');del.type='button';del.className='danger';del.textContent='删除';
    ops.append(more,reuse,dup,del);
    const linkArea=el('div','row-link');
    if(row.status==='linked'&&row.link){const a=document.createElement('a');a.href=row.link;a.target='_blank';a.rel='noopener noreferrer';a.textContent='打开链接';const c=document.createElement('button');c.type='button';c.textContent=row.copied||copiedIds().has(row.id)?'已复制':'复制链接';c.onclick=async()=>{let copied=false;try{await navigator.clipboard.writeText(row.link);copied=true;}catch{const t=document.createElement('input');t.value=row.link;document.body.append(t);try{t.select();copied=document.execCommand('copy');}catch{}finally{t.remove();}}if(!copied){status('复制失败，请打开链接后手动复制地址。');return;}row.copied=true;try{const s=copiedIds();s.add(row.id);localStorage.setItem(COPIED,JSON.stringify([...s]));}catch{}c.textContent='已复制';};linkArea.append(a,c);}
    if(row.error)linkArea.append(span('row-error',row.error));
    ops.append(linkArea);
    const sub=el('div','batch-sub');
    const num=input(row.lessonNumber);num.type='number';num.min='1';num.max='999';num.placeholder='如 3';num.inputMode='numeric';
    const prev=document.createElement('select');prev.innerHTML='<option value="">未填</option><option value="yes">是，已完成</option><option value="no">否，未完成</option>';prev.value=row.previousHomework||'';
    const subCells=[[course,'课程（留空继承）'],[date,'日期（留空继承）'],[tin,'开始时间'],[tout,'结束时间'],[num,'第几次课'],[prev,'作业完成']];
    subCells.forEach(([control,label])=>{const c=el('div','cell',label);c.append(control);sub.append(c);});
    const cells=[[name,'学生'],[content,'上课内容'],[homework,'课后作业'],[ops,'操作']];
    cells.forEach(([control,label])=>{const c=el('div','cell',label);c.append(control);box.append(c);});
    box.append(sub);
    if(generating)box.querySelectorAll('input,textarea,select,button').forEach(e=>e.disabled=true);
    name.oninput=()=>{row.studentName=name.value;saveDraft();};
    course.onchange=()=>{row.courseName=course.value;saveDraft();};
    date.onchange=()=>{row.lessonDate=date.value;saveDraft();};
    tin.onchange=()=>{row.checkIn=tin.value;saveDraft();};
    tout.onchange=()=>{row.checkOut=tout.value;saveDraft();};
    content.oninput=()=>{row.content=content.value;saveDraft();};
    homework.oninput=()=>{row.homework=homework.value;saveDraft();};
    num.oninput=()=>{row.lessonNumber=num.value;saveDraft();};
    prev.onchange=()=>{row.previousHomework=prev.value||null;saveDraft();};
    more.setAttribute('aria-expanded','false');more.onclick=()=>{const expanded=box.classList.toggle('expanded');more.setAttribute('aria-expanded',String(expanded));more.textContent=expanded?'收起':'更多';};
    reuse.onclick=async()=>{reuse.disabled=true;try{await reuseLast(row);}catch(e){status(e.message);}finally{reuse.disabled=false;}};
    dup.onclick=()=>{if(index>0){const p=rows[index-1];row.courseName=p.courseName;row.lessonDate=p.lessonDate;row.checkIn=p.checkIn;row.checkOut=p.checkOut;row.lessonNumber=p.lessonNumber;row.content=p.content;row.homework=p.homework;row.previousHomework=p.previousHomework;draw();saveDraft();}};
    del.onclick=()=>{rows.splice(index,1);if(pageIndex>=rows.length)pageIndex=Math.max(0,rows.length-1);draw();saveDraft();};
    return box;
  }
  function span(cls,txt){const s=document.createElement('span');s.className=cls;s.textContent=txt;return s;}

  function applyPager(){const mobile=isMobile();$('batch-pager').style.display=mobile?'flex':'none';$('batch-mobilebar').style.display=mobile?'flex':'none';if(pageIndex>=rows.length)pageIndex=Math.max(0,rows.length-1);const list=document.querySelectorAll('.batch-row');list.forEach((r,i)=>{r.style.display=(!mobile||i===pageIndex)?'':'none';});if(mobile){$('pg-count').textContent='第 '+(rows.length?(pageIndex+1):0)+' / '+rows.length+' 份';$('pg-prev').disabled=pageIndex<=0;$('pg-next').disabled=pageIndex>=rows.length-1;}}

  function draw(){const list=$('batch-rows');list.replaceChildren();if(!rows.length){const p=document.createElement('div');p.className='batch-empty';p.textContent='还没有学生，点“＋ 添加一行”开始。';list.append(p);applyPager();return;}rows.forEach((r,i)=>list.append(renderRow(r,i)));applyPager();}

  async function reuseLast(row){const name=row.studentName.trim();if(!name){status('先填写学生姓名，再“沿用上次”。');return;}const meta=await repo.list();const last=meta.filter(r=>(r.student_name||'')===name).sort((a,b)=>(b.lesson_date+' '+b.check_in).localeCompare(a.lesson_date+' '+a.check_in))[0];if(!last){status('没有找到「'+name+'」的历史记录。');return;}const full=await repo.get(last.id),rec=full.record;row.courseName=rec.courseName||'';row.content=rec.content||'';row.homework=rec.homework||'';row.previousHomework=rec.previousHomework;row.lessonNumber=String((parseInt(rec.lessonNumber,10)||0)+1);draw();saveDraft();status('已从「'+name+'」上次记录带入，第几次课 +1。');}

  function status(t){$('batch-status').textContent=t||'';}

  async function loadNames(){try{const meta=await repo.list();$('batch-names').replaceChildren(...[...new Set(meta.map(r=>(r.student_name||'').trim()).filter(Boolean))].map(n=>{const o=document.createElement('option');o.value=n;return o;}));}catch{}}

  function generationControls(){
    ['batch-generate','batch-generate2','batch-add','pg-add','batch-back','b-course','b-date','b-in','b-out','b-mentor'].forEach(id=>$(id).disabled=generating);
  }
  async function generate(){
    if(generating)return;
    const target=rows.filter(r=>r.studentName.trim());
    if(!target.length){status('请至少填写一名学生姓名。');return;}
    generating=true;generationControls();
    const teacher=window.SFKUser?.current()?.id||null;
    let ok=0,fail=[];
    try{
      writeDraft();draw();
      for(let i=0;i<target.length;i++){
        const row=target[i];status('正在保存 '+(i+1)+' / '+target.length+' …');
        try{
          await reconcile(row);
          const record=await cloud.compactRecord(buildRecord(row));
          if(!record.teacherName)record.teacherName=(record.signatures.mentor.text||'').trim();
          // A linked row with unchanged input is already complete, including on retry.
          if(!(row.savedRecord&&sameRecord(row.savedRecord,record))){
            row.id=row.id||crypto.randomUUID();row.link='';row.copied=false;
            row.pending={revision:row.revision||0,record,teacherId:teacher};writeDraft();
            const saved=await repo.save(row.id,row.pending.revision,record,teacher);
            row.id=saved.id;row.revision=saved.revision;row.savedRecord=saved.record;row.pending=null;
            writeDraft();
          }
          if(cloud.configured&&!row.link){
            const base=new URL(window.SFK_CONFIG.siteUrl);
            if(base.protocol!=='https:')throw Error('请配置学生可访问的 HTTPS 网站地址。');
            const share=await cloud.publish(row.id);base.hash='request='+share.token;base.search='';row.link=base.href;
          }
          row.status='linked';row.error='';ok++;writeDraft();
        }catch(e){row.status='error';row.error=e.message;fail.push(row.studentName+'：'+e.message);try{writeDraft();}catch{throw Error('草稿保存失败，请勿刷新或关闭页面。');}}
        draw();
      }
      D.remember(defaults.courseName,teacher?null:buildMentor(),teacher?null:$('b-mentor').value.trim());
      status('已完成 '+ok+' 份'+(fail.length?'；失败 '+fail.length+' 份：'+fail.join('；'):'')+(cloud.configured?'':'（本地预览模式，未生成链接）'));
      $('batch-exportall').hidden=!rows.some(r=>r.link);
      if(rows.every(r=>r.status==='linked')){clearTimeout(draftTimer);localStorage.removeItem(DRAFT);}else writeDraft();
    }catch(e){status('生成未完成：'+e.message);}
    finally{generating=false;generationControls();draw();}
  }

  function show(){
    const restored=readDraft();
    const init=initialRecord();
    if(!defaults.lessonDate)defaults.lessonDate=init.lessonDate;
    if(!defaults.checkIn)defaults.checkIn=init.checkIn;
    if(!defaults.checkOut)defaults.checkOut=init.checkOut;
    const d=D.read();
    if(!restored&&d.courseName)defaults.courseName=d.courseName;
    defaults.mentor=defaults.mentor||d.mentor||null;
    defaults.teacherName=defaults.teacherName||d.teacherName||(d.mentor&&d.mentor.mode==='text'&&d.mentor.text)||'';if(!restored&&window.SFKUser&&SFKUser.current()){defaults.teacherName=SFKUser.current().name;defaults.mentor=null;}
    $('b-course').value=defaults.courseName;
    $('b-date').value=defaults.lessonDate;
    timeOptions($('b-in'),defaults.checkIn);timeOptions($('b-out'),defaults.checkOut);
    const mentorMode=defaults.mentor&&defaults.mentor.mode;
    if(mentorMode==='image'){$('b-mentor-note').textContent='签名使用上次的图片签名；上面的姓名会作为导师姓名保存，用于首页检索。';}
    else{$('b-mentor-note').textContent='';}
    $('b-mentor').value=defaults.teacherName||'';
    if(!rows.length){rows=[newRow()];pageIndex=0;}
    document.querySelector('main.layout').hidden=true;
    const dash=document.getElementById('dashboard');if(dash)dash.hidden=true;if(window.SFKOCR&&SFKOCR.view)SFKOCR.view.hidden=true;
    view.hidden=false;
    document.querySelector('h1').textContent='批量新建签单';
    $('batch-exportall').hidden=!rows.some(r=>r.link);
    draw();loadNames();status(cloud.configured?'':'本地预览：记录保存在此浏览器，无法生成远程链接。');
    window.scrollTo(0,0);
  }
  function hide(){view.hidden=true;}

  $('batch-add').onclick=()=>{rows.push(newRow());pageIndex=rows.length-1;draw();saveDraft();};
  $('pg-add').onclick=$('batch-add').onclick;
  $('pg-prev').onclick=()=>{if(pageIndex>0){pageIndex--;applyPager();window.scrollTo(0,0);}};
  $('pg-next').onclick=()=>{if(pageIndex<rows.length-1){pageIndex++;applyPager();window.scrollTo(0,0);}};
  $('batch-generate').onclick=generate;
  $('batch-generate2').onclick=generate;
  $('batch-back').onclick=()=>{saveDraft();if(window.SFKShowDashboard)window.SFKShowDashboard();else hide();};
  $('batch-copyall').onclick=async()=>{const lines=rows.filter(r=>r.link).map(r=>(r.studentName||'未命名')+' '+r.link).join('\n');try{await navigator.clipboard.writeText(lines);status('已复制 '+rows.filter(r=>r.link).length+' 条链接文本。');}catch{status('复制失败，请手动复制。');}};
  $('b-course').onchange=()=>{defaults.courseName=$('b-course').value;saveDraft();};
  $('b-date').onchange=()=>{defaults.lessonDate=$('b-date').value;saveDraft();};
  $('b-in').onchange=()=>{defaults.checkIn=$('b-in').value;saveDraft();};
  $('b-out').onchange=()=>{defaults.checkOut=$('b-out').value;saveDraft();};
  $('b-mentor').oninput=()=>{defaults.teacherName=$('b-mentor').value;saveDraft();};
  window.addEventListener('resize',applyPager);

  return {show,hide,view,isBusy:()=>generating};
})();
