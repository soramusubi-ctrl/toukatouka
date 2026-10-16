// Color-connected removal. No object detector, model, or network access.
export function backgroundColor(data, w, h) {
  const bins = new Map();
  function add(p) {
    p *= 4; if (data[p+3] < 128) return;
    const key = (data[p] >> 4)*256 + (data[p+1] >> 4)*16 + (data[p+2] >> 4);
    const b = bins.get(key) || [0,0,0,0];
    b[0]++; b[1]+=data[p]; b[2]+=data[p+1]; b[3]+=data[p+2]; bins.set(key,b);
  }
  for(let x=0;x<w;x++){add(x);add((h-1)*w+x);}
  for(let y=1;y<h-1;y++){add(y*w);add(y*w+w-1);}
  const b = [...bins.values()].sort((a,b)=>b[0]-a[0])[0];
  return b ? b.slice(1).map(v=>Math.round(v/b[0])) : [255,255,255];
}
const distance=(d,p,c)=>Math.sqrt(((d[p]-c[0])**2+(d[p+1]-c[1])**2+(d[p+2]-c[2])**2)/3);
export function removeBackground(data,w,h,{color,tolerance=6,softness=6,seeds=[],overrides=null}) {
  const n=w*h, removed=new Uint8Array(n), queue=new Int32Array(n);
  const output=new Uint8ClampedArray(data), colors=[color,...seeds.map(s=>s.color)];
  // One connected region per palette color. The first starts at all four edges.
  for(let ci=0;ci<colors.length;ci++) {
    const c=colors[ci],seen=new Uint8Array(n); let head=0,tail=0;
    function visit(i) {
      if(seen[i])return; seen[i]=1;
      if(overrides?.[i]===1)return;
      if(data[i*4+3]!==0 && distance(data,i*4,c)>tolerance)return;
      removed[i]=1; queue[tail++]=i;
    }
    if(ci===0){
      for(let x=0;x<w;x++){visit(x);visit((h-1)*w+x);}
      for(let y=1;y<h-1;y++){visit(y*w);visit(y*w+w-1);}
    } else {
      const s=seeds[ci-1];visit(Math.max(0,Math.min(h-1,s.y))*w+Math.max(0,Math.min(w-1,s.x)));
    }
    while(head<tail) {
      const i=queue[head++],x=i%w;
      if(x>0)visit(i-1); if(x<w-1)visit(i+1);
      if(i>=w)visit(i-w); if(i<n-w)visit(i+w);
    }
  }
  let count=0;
  for(let i=0;i<n;i++) {
    const p=i*4;
    if(overrides?.[i]===1)continue;
    if(removed[i] || overrides?.[i]===2){output[p+3]=0;count++;continue;}
    if(softness<=0)continue;
    const x=i%w;
    const edge=(x>0&&removed[i-1])||(x<w-1&&removed[i+1])||(i>=w&&removed[i-w])||(i<n-w&&removed[i+w]);
    if(!edge)continue;
    let best=Infinity,bg=color;
    for(const c of colors){const d=distance(data,p,c);if(d<best){best=d;bg=c;}}
    const a=Math.max(0,Math.min(1,(best-tolerance)/softness));
    if(a<1){
      output[p+3]=Math.round(data[p+3]*a);
      if(a>0)for(let k=0;k<3;k++)output[p+k]=Math.max(0,Math.min(255,Math.round((data[p+k]-(1-a)*bg[k])/a)));
    }
  }
  return {data:output,removed:count};
}
