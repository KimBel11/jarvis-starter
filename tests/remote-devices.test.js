'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),http=require('http');
const makeRemote=require('../lib/remote');
test('device revocation, resume rejection and verified rotation preserve authentication boundaries',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-security-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const ctx={DATA:dir,readBody:async req=>{let s='';for await(const x of req)s+=x;return JSON.parse(s||'{}');},send:(res,status,b)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(b));}};
 const remote=makeRemote(ctx),server=http.createServer(async(req,res)=>{const u=new URL(req.url,'http://x');if(req.headers.host==='test.ts.net'&&await remote.gate(req,res,u,u.pathname))return;if(await remote.handle(req,res,u,u.pathname))return;ctx.send(res,200,{ok:true});});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 async function call(p,body,token,local=false){const headers={Host:local?'localhost':'test.ts.net','Content-Type':'application/json','User-Agent':'iPhone'};if(token)headers.Cookie='jv='+token;return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:p,method:body?'POST':'GET',headers},res=>{let data='';res.on('data',x=>data+=x);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(data)}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});}

 assert.equal((await call('/api/remote/setup',{passphrase:'old-test-passphrase',hosts:['test.ts.net'],enabled:true},null,true)).status,200);
 const a=(await call('/api/remote/login',{passphrase:'old-test-passphrase',device:true})).data.device,b=(await call('/api/remote/login',{passphrase:'old-test-passphrase',device:true})).data.device;
 let list=(await call('/api/remote/devices',null,null,true)).data.devices;assert.equal(list.length,2);assert.ok(!JSON.stringify(list).includes(a));assert.ok(list.every(d=>!d.h&&!d.exp));
 assert.equal((await call('/api/remote/devices/revoke',{id:list[0].id},b)).status,403);
 assert.equal((await call('/api/remote/devices/revoke',{id:list[0].id},null,true)).status,200);
 assert.equal((await call('/api/remote/resume',{device:a})).status,401);assert.equal((await call('/api/protected',null,a)).status,401);assert.equal((await call('/api/protected',null,b)).status,200);
 assert.equal((await call('/api/remote/setup',{passphrase:'bypass-test-passphrase'},null,true)).status,409);
 assert.equal((await call('/api/remote/verification',{currentPassphrase:'wrong',newPassphrase:'new-test-passphrase'},b)).status,401);
 const v=await call('/api/remote/verification',{currentPassphrase:'old-test-passphrase',newPassphrase:'new-test-passphrase'},b);assert.equal(v.status,200);assert.ok(!v.data.code);
 assert.equal((await call('/api/remote/verification',null,b)).status,403);
 const c=(await call('/api/remote/verification',null,null,true)).data.requests[0];
 assert.equal((await call('/api/remote/passphrase',{id:c.id,code:c.code},null,true)).status,400,'challenge is bound to requester');
 assert.equal((await call('/api/remote/passphrase',{id:c.id,code:'000000'},b)).status,400);
 assert.equal((await call('/api/remote/passphrase',{id:c.id,code:c.code},b)).status,200);
 assert.equal((await call('/api/remote/resume',{device:b})).status,401);
 assert.equal((await call('/api/remote/login',{passphrase:'old-test-passphrase'})).status,401);
 assert.equal((await call('/api/remote/login',{passphrase:'new-test-passphrase'})).status,200);
});
