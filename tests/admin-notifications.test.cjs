const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(storage=new Map()){
 const els=new Map();let tones=0;
 const el=id=>{if(!els.has(id))els.set(id,{checked:false,disabled:false,textContent:'',hidden:true,dataset:{},listeners:{},addEventListener(t,cb){this.listeners[t]=cb}});return els.get(id)};
 const ctx={console,Set,Uint8Array,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},document:{getElementById:el,addEventListener(){}},navigator:{locks:{request:async(k,cb)=>cb()}},window:{addEventListener(){},AudioContext:class{state='running';currentTime=0;createOscillator(){return {frequency:{},connect(){},start(){tones++},stop(){}}}createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}}}}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('admin-notifications.js','utf8')+'\nglobalThis.alerts=adminOrderAlerts;',ctx);
 return {ctx,els,storage,el,tones:()=>tones};
}
test('old orders, new orders, polling, updates and reloads',async()=>{
 const a=setup();await a.el('testOrderSound').listeners.click();const initial=a.tones();
 await a.ctx.alerts.observe([{id:1,status:'Novo'}]);assert.equal(a.tones(),initial);
 await a.ctx.alerts.observe([{id:2,status:'Novo'},{id:1,status:'Novo'}]);assert.equal(a.tones(),initial+2);assert.equal(a.el('newOrderCount').textContent,2);
 await a.ctx.alerts.observe([{id:2,status:'Novo'},{id:1,status:'Novo'}]);assert.equal(a.tones(),initial+2);
 await a.ctx.alerts.observe([{id:2,status:'Concluído'},{id:1,status:'Novo'}]);assert.equal(a.el('newOrderCount').textContent,1);
 const b=setup(a.storage);await b.el('testOrderSound').listeners.click();await b.ctx.alerts.observe([{id:2,status:'Novo'},{id:1,status:'Novo'}]);assert.equal(b.tones(),2);
 await b.ctx.alerts.observe([{id:3,status:'Novo'},{id:2,status:'Novo'}]);assert.equal(b.tones(),4);
});
test('two open tabs claim each order once',async()=>{
 const a=setup(),b=setup(a.storage);await a.el('testOrderSound').listeners.click();await b.el('testOrderSound').listeners.click();
 await a.ctx.alerts.observe([{id:1,status:'Novo'}]);await b.ctx.alerts.observe([{id:1,status:'Novo'}]);
 await a.ctx.alerts.observe([{id:2,status:'Novo'}]);await b.ctx.alerts.observe([{id:2,status:'Novo'}]);assert.equal(a.tones()+b.tones(),6);
});
test('sound disabled still updates count and notice',async()=>{
 const a=setup();await a.el('testOrderSound').listeners.click();a.el('orderSoundEnabled').checked=false;await a.el('orderSoundEnabled').listeners.change();
 await a.ctx.alerts.observe([]);await a.ctx.alerts.observe([{id:4,status:'Novo'}]);assert.equal(a.tones(),2);assert.equal(a.el('newOrderNotice').hidden,false);assert.equal(a.el('newOrderCount').textContent,1);
});
