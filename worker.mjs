import {backgroundColor,removeBackground} from './engine.mjs';
let source,w,h;
self.onmessage=({data:m})=>{
  try {
    if(m.type==='load'){source=new Uint8ClampedArray(m.data);w=m.width;h=m.height;self.postMessage({type:'loaded',color:backgroundColor(source,w,h),id:m.id});return;}
    const result=removeBackground(source,w,h,m.options);
    self.postMessage({type:'result',data:result.data.buffer,removed:result.removed,id:m.id},[result.data.buffer]);
  }catch(e){self.postMessage({type:'error',message:e.message,id:m.id});}
};
