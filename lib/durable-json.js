'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function read(file,fallback=null) { for(const p of [file,file+'.bak']) {try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{}}return fallback; }
function write(file,value) {
 fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+process.pid+'.'+crypto.randomBytes(5).toString('hex')+'.tmp';
 try {
  const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  // Keep a valid previous version for recovery; never replace it with corrupt data.
  if(fs.existsSync(file)){try{JSON.parse(fs.readFileSync(file,'utf8'));const bt=tmp+'.bak';fs.copyFileSync(file,bt);fs.renameSync(bt,file+'.bak');}catch{}}
  fs.renameSync(tmp,file);
 }finally{try{fs.unlinkSync(tmp);}catch{}}
}
module.exports={read,write};
