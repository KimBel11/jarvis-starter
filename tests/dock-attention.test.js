const test=require('node:test'),assert=require('node:assert/strict');
const {actionable}=require('../public/dock-attention');
const item=(id,status,createdAt=1)=>({id,status,createdAt,agent:{id:'a'},project:'study'});
test('counts approval, input and unresolved failures, not normal work',()=>assert.deepEqual(actionable([item('a','running'),item('b','awaiting_approval'),item('c','waiting'),item('d','done'),item('e','failed')]).map(i=>i.id),['b','c','e']));
test('deduplicates and removes resolved requests',()=>{assert.equal(actionable([item('a','waiting'),item('a','done')]).length,0);assert.equal(actionable([item('a','failed'),item('b','done',2)]).length,0);});
test('keeps older approvals and separates project failures',()=>{assert.equal(actionable([item('a','awaiting_approval'),item('b','done',2)]).length,1);assert.equal(actionable([item('a','failed'),{...item('b','done',2),project:'other'}]).length,1);});
