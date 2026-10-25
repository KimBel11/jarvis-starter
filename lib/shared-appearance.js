'use strict';
const path=require('node:path'),fs=require('node:fs');
const choices={orb:['aurora','orbit','minimal','crystal','halo','liquid','ribbon','wireframe'],motion:['full','subtle','reduced','levitate','drift'],effect:['particles','glow','rings','clean','rays'],density:['comfortable','compact']};
function validate(value,background=false){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid appearance');const out={};
 const enums=background?{style:['aurora','stars','flow','grid','off','nebula','waves','prism'],motion:['slow','lively','still']}:choices;
 const numbers=background?{intensity:[0,100]}:{speed:[.2,2],glow:[0,2],deform:[0,2]};
 for(const [k,v] of Object.entries(value)){if(enums[k]?.includes(v))out[k]=v;else if((background?['color','secondary']:['accent']).includes(k)&&/^#[\da-f]{6}$/i.test(v))out[k]=v;else if(numbers[k]&&typeof v==='number'&&Number.isFinite(v)&&v>=numbers[k][0]&&v<=numbers[k][1])out[k]=v;else throw Error('Invalid appearance field: '+k);}return out;
}
module.exports=ctx=>{const file=path.join(ctx.DATA,'shared-appearance.json');let state={revision:0,appearance:null,atmosphere:null,image:null};try{state={...state,...JSON.parse(fs.readFileSync(file,'utf8'))};}catch(e){if(e.code!=='ENOENT')throw e;}
 return {async handle(req,res,url,p){if(p!=='/api/appearance')return false;
 if(req.method==='GET'){if(url.searchParams.get('since')===String(state.revision)){ctx.send(res,200,{revision:state.revision,unchanged:true});}else ctx.send(res,200,state);return true;}
 if(req.method!=='POST'){ctx.send(res,405,{error:'Method not allowed'});return true;}
 try{const b=await ctx.readBody(req);if(b.revision!==state.revision){ctx.send(res,409,{error:'Appearance changed on another device',...state});return true;}
 const next={...state};if(b.appearance)next.appearance={...(state.appearance||{}),...validate(b.appearance)};if(b.atmosphere)next.atmosphere={...(state.atmosphere||{}),...validate(b.atmosphere,true)};
 if(b.image!==undefined){if(typeof b.image!=='string'||b.image.length>350000||!b.image.startsWith('data:image/png;base64,')||!Buffer.from(b.image.slice(22),'base64').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid orb image');next.image=b.image;}
 next.revision++;next.updatedAt=new Date().toISOString();require('./durable-json').write(file,next);state=next;ctx.send(res,200,state);
 }catch(e){ctx.send(res,400,{error:e.message});}return true;}};
};
module.exports.validate=validate;
