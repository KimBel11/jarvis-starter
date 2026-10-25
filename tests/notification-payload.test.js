const test=require('node:test'),assert=require('node:assert/strict');
const payload=require('../lib/notification-payload');
test('push preview contains actual update and retains its destination',()=>{
 const p=payload({id:'test-1',title:'Agent needs attention',body:'Social Analyst reached its usage limit. Retry after reset.',href:'#/team/social-analytics'});
 assert.equal(p.aps.alert.title,'Agent needs attention');assert.match(p.aps.alert.body,/Social Analyst/);assert.equal(p.route,'#/team/social-analytics');assert.equal(p.notificationId,'test-1');
});
test('long multilingual and escaped messages fit the APNs byte limit',()=>{
 for(const text of ['🪐','漢','"','\\','\n']){
 const p=payload({id:'i'.repeat(220),href:'h'.repeat(512),title:'🪐'.repeat(180),body:text.repeat(1500)});
 assert(Buffer.byteLength(JSON.stringify(p))<=4096);assert(p.aps.alert.body.length>0);
 }
});
