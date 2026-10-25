'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/desktop-clean.js'),'utf8');
const functions=source.slice(source.indexOf(' function layoutItems('),source.indexOf(' // Responsive placement'));
test('viewport fitting never shrinks saved dimensions or moves saved coordinates',()=>{
 const saved={w:1800,h:900,x:.82,y:.7,z:10,font:14,hidden:false};
 const context={innerWidth:1500,innerHeight:600,state:{margin:24,items:{test:{...saved},orb:{...saved,w:900,h:900}}},legacy:{},selected:null,editing:false,clamp:(v,min,max)=>Math.max(min,Math.min(Math.max(min,max),v)),number:(v,f)=>typeof v==='number'&&Number.isFinite(v)?v:f};
 vm.createContext(context);vm.runInContext(functions,context);
 const style={setProperty(){}};const el={style,classList:{toggle(){}}};
 context.apply('test',el);assert.equal(style.width,'1452px');assert.equal(style.height,'552px');assert.deepEqual(context.state.items.test,saved);
 context.apply('orb',el);assert.equal(style.width,style.height);assert.equal(context.state.items.orb.w,900);
 context.innerWidth=2000;context.innerHeight=1200;context.apply('test',el);assert.equal(style.width,'1800px');assert.equal(style.height,'900px');assert.deepEqual(context.state.items.test,saved);
});

test('compact-screen edits do not replace the large-screen layout',()=>{
 const context={innerWidth:1200,innerHeight:800,state:{items:{widget:{w:340,h:400,x:.8,y:.3}}},legacy:{},selected:null,editing:false,clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),number:(v,f)=>typeof v==='number'&&Number.isFinite(v)?v:f};
 vm.createContext(context);vm.runInContext(functions,context);
 const compact=context.config('widget');compact.w=260;compact.x=.2;
 context.innerWidth=1920;assert.equal(context.config('widget').w,340);assert.equal(context.config('widget').x,.8);
 context.innerWidth=1200;assert.equal(context.config('widget').w,260);assert.equal(context.config('widget').x,.2);
});

test('Done preserves closely spaced widgets at their saved viewport; smaller screens may fit temporarily',()=>{
 const context={innerWidth:3440,innerHeight:1440,state:{items:{},canvasViewport:{width:3440,height:1440}}};
 vm.createContext(context);vm.runInContext(functions,context);
 assert.equal(context.needsResponsiveFit(true),false);
 context.innerWidth=1920;assert.equal(context.needsResponsiveFit(true),true);
 context.innerWidth=3440;assert.equal(context.needsResponsiveFit(true),false);
 delete context.state.canvasViewport;assert.equal(context.needsResponsiveFit(true),false);
 context.innerWidth=1200;assert.equal(context.needsResponsiveFit(true),true);
 context.state.compactManual=true;context.state.compactViewport={width:1200,height:1440};
 assert.equal(context.needsResponsiveFit(true),false);
 context.innerHeight=800;assert.equal(context.needsResponsiveFit(true),true);
});

test('orb uses identical saved placement while editing and after Done',()=>{
 const context={innerWidth:1920,innerHeight:1080,state:{items:{orb:{w:500,h:500,x:.43,y:.45,z:10,font:14}},margin:24},legacy:{},selected:null,editing:true,clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),number:(v,f)=>typeof v==='number'&&Number.isFinite(v)?v:f};
 vm.createContext(context);vm.runInContext(functions,context);
 const el={style:{setProperty(){}},classList:{toggle(){}}};context.apply('orb',el);const before={...el.style};
 context.editing=false;context.apply('orb',el);assert.deepEqual(el.style,before);
});

test('closely spaced widget cards are not moved into rails when editing finishes',()=>{
 const classes={};const host={classList:{toggle(k,v){classes[k]=v;}},querySelectorAll(){return []}};
 const card=()=>({parentElement:host});
 const context={innerWidth:3440,innerHeight:1440,state:{items:{a:{w:340,h:250,x:.9,y:.2},b:{w:340,h:250,x:.9,y:.38}},widgets:[{id:'a'},{id:'b'}],margin:24,canvasViewport:{width:3440,height:1440}},host,els:new Map([['a',card()],['b',card()]]),editing:false,drag:null,legacy:{},selected:null,document:{body:{classList:{toggle(){}}}},clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),number:(v,f)=>typeof v==='number'&&Number.isFinite(v)?v:f};
 vm.createContext(context);vm.runInContext(functions+source.slice(source.indexOf(' function fitWidgets('),source.indexOf(' function select(')),context);
 context.fitWidgets();assert.equal(classes['dc-fitted'],false);
});
