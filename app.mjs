const $=id=>document.getElementById(id);
const canvas=$('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
let source=null,result=null,width=0,height=0,filename='',color=[255,255,255],autoColor=color;
let tolerance=6,softness=6,seeds=[],overrides=null,tool='region',originalView=false,working=false;
let undo=[],redo=[],requestId=0,loadVersion=0,timer,noticeTimer,rangeGesture=false,stroke=null;
let worker;
function notice(message,error=false){clearTimeout(noticeTimer);$('notice').textContent=message;$('notice').classList.toggle('error',error);$('notice').hidden=false;noticeTimer=setTimeout(()=>$('notice').hidden=true,error?9000:5000);}
try{worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});}
catch(e){notice('このブラウザでは画像処理を開始できません。最新版のChrome・Edge・Safariなどで開いてください。',true);}
function hex(c){return '#'+c.map(v=>v.toString(16).padStart(2,'0')).join('');}
function setBusy(value){working=value;$('busy').hidden=!value;$('save').disabled=value||!result;}
function sync(){
  $('bgcolor').value=hex(color);$('colorText').textContent=hex(color).toUpperCase();
  $('tolerance').value=tolerance;$('toleranceValue').value=tolerance;
  $('softness').value=softness;$('softnessValue').value=softness;
  $('undo').disabled=!undo.length;$('redo').disabled=!redo.length;
}
function snapshot(){return {color:[...color],tolerance,softness,seeds:seeds.map(s=>({...s,color:[...s.color]})),overrides:overrides.slice()};}
function trim(stack){const limit=Math.max(2,Math.min(14,Math.floor(64e6/(width*height))));while(stack.length>limit)stack.shift();}
function remember(){if(!source)return;undo.push(snapshot());trim(undo);redo=[];sync();}
function apply(s){({color,tolerance,softness,seeds,overrides}=s);sync();process();}
function process(delay=0){
  clearTimeout(timer);if(!source||!worker)return;
  // Invalidate in-flight work immediately, including during a slider debounce.
  const id=++requestId;setBusy(true);
  timer=setTimeout(()=>worker.postMessage({type:'process',id,options:{color,tolerance,softness,seeds,overrides}}),delay);
}
if(worker){
  worker.onmessage=({data:m})=>{
    if(m.id!==requestId)return;
    if(m.type==='loaded'){autoColor=m.color;color=[...autoColor];sync();process();}
    if(m.type==='result'){
      result=new ImageData(new Uint8ClampedArray(m.data),width,height);setBusy(false);draw();
      $('resultInfo').textContent=`${(100*m.removed/(width*height)).toFixed(1)}% を透過 · ${seeds.length?'追加の背景 '+seeds.length+'か所':'小物もそのまま'}`;
    }
    if(m.type==='error'){setBusy(false);notice('処理できませんでした。画像を読み込み直すか、サイズの小さい画像で試してください。',true);}
  };
  worker.onerror=()=>{setBusy(false);$('save').disabled=true;notice('画像処理が停止しました。ページを開き直して試してください。',true);};
}
async function loadImage(blob,name){
  if(!worker)return;
  const version=++loadVersion;
  if(blob.size>50*1024*1024){notice('画像は50MB以下で選んでください。',true);return;}
  notice('画像を読み込んでいます…');
  let bitmap;
  try{
    bitmap=await createImageBitmap(blob);
    if(version!==loadVersion){bitmap.close();return;}
    if(bitmap.width*bitmap.height>20e6)throw new Error('large');
    if(bitmap.width<2||bitmap.height<2)throw new Error('small');
    const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;
    const context=c.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);
    const decoded=context.getImageData(0,0,c.width,c.height);bitmap.close();bitmap=null;
    clearTimeout(timer);stroke=null;source=decoded;width=c.width;height=c.height;filename=name;
    result=null;overrides=new Uint8Array(width*height);seeds=[];tolerance=6;softness=6;undo=[];redo=[];
    canvas.width=width;canvas.height=height;$('empty').hidden=true;$('editor').hidden=false;
    $('filename').textContent=filename;$('dimensions').textContent=`${width.toLocaleString()} × ${height.toLocaleString()} px · 元のサイズで保存`;
    $('zoom').value='fit';setView(false);chooseTool('region');sync();resize();setBusy(true);draw();
    $('notice').hidden=true;worker.postMessage({type:'load',id:++requestId,width,height,data:source.data});
  }catch(e){
    bitmap?.close();
    notice(e.message==='large'?'20メガピクセルを超える画像です。縦×横が2000万画素以下の画像を選んでください。':e.message==='small'?'縦・横が2px以上の画像を選んでください。':'画像を開けませんでした。PNG・JPEG・WebPなどに変換して試してください。',true);
  }
}
$('file').onchange=e=>{const f=e.target.files[0];if(f)loadImage(f,f.name);e.target.value='';};
$('change').onclick=()=>$('file').click();
$('dropzone').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('file').click();}};
for(const ev of ['dragenter','dragover'])$('dropzone').addEventListener(ev,e=>{e.preventDefault();$('dropzone').classList.add('drag');});
$('dropzone').ondragleave=()=>$('dropzone').classList.remove('drag');
document.addEventListener('dragover',e=>e.preventDefault());
document.addEventListener('drop',e=>{e.preventDefault();$('dropzone').classList.remove('drag');const f=e.dataTransfer.files[0];if(f)loadImage(f,f.name);});
$('sample').onclick=async()=>{
  try{$('sample').disabled=true;const response=await fetch('./sample.webp');if(!response.ok)throw new Error();await loadImage(await response.blob(),'トマトを持つ虹髪の妖精.png');}
  catch(e){notice('サンプルを読み込めませんでした。画像を選んで試してください。',true);}
  finally{$('sample').disabled=false;}
};
function draw(){if(!source)return;ctx.putImageData(originalView?source:(result||source),0,0);}
function resize(){
  if(!source)return;
  const v=$('viewport'),z=$('zoom').value;
  const scale=z==='fit'?Math.max(.01,Math.min((v.clientWidth-28)/width,(v.clientHeight-28)/height,1)):Number(z);
  canvas.style.width=`${width*scale}px`;canvas.style.height=`${height*scale}px`;
  $('canvasWrap').style.marginTop=z==='fit'?`${Math.max(0,(v.clientHeight-height*scale)/2)}px`:'0';
}
new ResizeObserver(resize).observe($('viewport'));
$('zoom').onchange=resize;
function setView(original){originalView=original;$('originalTab').classList.toggle('selected',original);$('processedTab').classList.toggle('selected',!original);$('originalTab').setAttribute('aria-pressed',original);$('processedTab').setAttribute('aria-pressed',!original);$('brushCursor').hidden=true;draw();}
$('originalTab').onclick=()=>setView(true);$('processedTab').onclick=()=>setView(false);
document.querySelectorAll('[data-bg]').forEach(button=>button.onclick=()=>{
  document.querySelectorAll('[data-bg]').forEach(b=>b.classList.toggle('selected',b===button));
  $('viewport').classList.toggle('checker',button.dataset.bg==='checker');
  $('viewport').style.backgroundColor=({light:'#fff',dark:'#293532',pink:'#e9c8cc',checker:''})[button.dataset.bg];
});
function chooseTool(t){
  tool=t;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));
  $('pick').classList.toggle('active',t==='pick');$('brushSettings').hidden=!['restore','erase'].includes(t);
  $('canvasWrap').classList.toggle('brushing',['restore','erase'].includes(t));
  $('canvasWrap').classList.toggle('picking',['region','pick'].includes(t));
  $('toolHelp').textContent=({region:'囲まれて残った背景をクリック。つながる同系色を追加で抜きます。',restore:'残したい部分をなぞると、元の画像に戻ります。先に塗っておくと、その場所を保護できます。',erase:'消したい部分をなぞると、色に関係なく透明になります。',pick:'背景の色をクリック。外側につながる同じ色を抜きます。'})[t];
}
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{setView(false);chooseTool(b.dataset.tool);});
$('pick').onclick=()=>{setView(false);chooseTool(tool==='pick'?'region':'pick');};
$('bgcolor').onchange=e=>{if(!source)return;const h=e.target.value;remember();color=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));sync();process();};
$('autoColor').onclick=()=>{if(!source)return;remember();color=[...autoColor];sync();process();};
for(const key of ['tolerance','softness']){
  $(key).oninput=e=>{if(!source)return;const value=Number(e.target.value);if(!rangeGesture){remember();rangeGesture=true;}if(key==='tolerance')tolerance=value;else softness=value;sync();process(100);};
  $(key).onchange=()=>{rangeGesture=false;};
}
$('brush').oninput=e=>$('brushValue').value=`${e.target.value} px`;
$('undo').onclick=()=>{if(!undo.length||stroke)return;redo.push(snapshot());trim(redo);apply(undo.pop());};
$('redo').onclick=()=>{if(!redo.length||stroke)return;undo.push(snapshot());trim(undo);apply(redo.pop());};
$('reset').onclick=()=>{if(!source)return;remember();color=[...autoColor];tolerance=6;softness=6;seeds=[];overrides.fill(0);sync();process();};
document.addEventListener('keydown',e=>{
  if(!source||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$(e.shiftKey?'redo':'undo').click();}
});
function point(e){const r=canvas.getBoundingClientRect();return {x:Math.min(width-1,Math.max(0,Math.floor((e.clientX-r.left)*width/r.width))),y:Math.min(height-1,Math.max(0,Math.floor((e.clientY-r.top)*height/r.height)))};}
function cursor(e){
  const brush=['restore','erase'].includes(tool);const c=$('brushCursor');c.hidden=!brush||originalView||working;
  const r=canvas.getBoundingClientRect();c.style.left=`${e.clientX-r.left}px`;c.style.top=`${e.clientY-r.top}px`;const size=Number($('brush').value)*r.width/width;c.style.width=`${size}px`;c.style.height=`${size}px`;
}
function dab(x,y){
  const radius=Number($('brush').value)/2,value=tool==='restore'?1:2;
  const minX=Math.max(0,Math.floor(x-radius)),maxX=Math.min(width-1,Math.ceil(x+radius)),minY=Math.max(0,Math.floor(y-radius)),maxY=Math.min(height-1,Math.ceil(y+radius));
  for(let iy=minY;iy<=maxY;iy++)for(let ix=minX;ix<=maxX;ix++){
    if((ix-x)**2+(iy-y)**2>radius*radius)continue;
    const i=iy*width+ix,p=i*4;overrides[i]=value;
    if(value===1){result.data[p]=source.data[p];result.data[p+1]=source.data[p+1];result.data[p+2]=source.data[p+2];result.data[p+3]=source.data[p+3];}
    else result.data[p+3]=0;
  }
}
canvas.onpointerdown=e=>{
  if(!source||working||!result||e.button!==0)return;
  if(originalView){notice('編集するには「透過後」に切り替えてください。');return;}
  const p=point(e),i=(p.y*width+p.x)*4;
  if(tool==='pick'){
    remember();color=Array.from(source.data.slice(i,i+3));sync();chooseTool('region');process();return;
  }
  if(tool==='region'){
    if(seeds.length>=20){notice('追加できる背景は20か所までです。消す筆も使ってみてください。');return;}
    remember();seeds.push({...p,color:Array.from(source.data.slice(i,i+3))});process();return;
  }
  remember();stroke={...p,pointerId:e.pointerId};canvas.setPointerCapture(e.pointerId);dab(p.x,p.y);draw();cursor(e);$('save').disabled=true;
};
canvas.onpointermove=e=>{
  cursor(e);if(!stroke||stroke.pointerId!==e.pointerId)return;
  const p=point(e),dx=p.x-stroke.x,dy=p.y-stroke.y,steps=Math.ceil(Math.hypot(dx,dy)/Math.max(1,Number($('brush').value)/5));
  for(let i=1;i<=steps;i++)dab(stroke.x+dx*i/steps,stroke.y+dy*i/steps);
  stroke.x=p.x;stroke.y=p.y;draw();
};
function finishStroke(e){if(!stroke||stroke.pointerId!==e.pointerId)return;stroke=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);process();}
canvas.onpointerup=finishStroke;canvas.onpointercancel=finishStroke;canvas.onlostpointercapture=finishStroke;
canvas.onpointerleave=()=>$('brushCursor').hidden=true;
$('save').onclick=()=>{
  if(!result||working||stroke)return;
  const out=document.createElement('canvas');out.width=width;out.height=height;out.getContext('2d').putImageData(result,0,0);
  $('save').disabled=true;
  out.toBlob(blob=>{
    $('save').disabled=working;
    if(!blob){notice('PNGを作成できませんでした。もう一度お試しください。',true);return;}
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename.replace(/\.[^.]+$/,'')+'_透過.png';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    notice('透過PNGを作成しました。ダウンロード先を確認してください。');
  },'image/png');
};
