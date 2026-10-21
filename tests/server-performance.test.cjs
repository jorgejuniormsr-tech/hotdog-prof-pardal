const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const catalog={
 app_settings:[{key:'delivery_open',value:true}],
 products:[{id:'dog',name:'Hot Dog Tradicional',category:'Hot Dogs',price:23,active:true},{id:'juice',name:'Suco Natural',category:'Sucos',price:7,active:true}],
 product_composition:[{product_id:'dog',ingredient_id:'bread',removable:false,ingredients:{name:'Pão',active:true}},{product_id:'dog',ingredient_id:'sausage',removable:true,ingredients:{name:'Salsicha',active:true}}],
 product_extras:[{product_id:'dog',ingredient_id:'cal',price:3,max_quantity:2,active:true,ingredients:{name:'Linguiça calabresa',active:true}},{product_id:'dog',ingredient_id:'bacon',price:3,max_quantity:1,active:true,ingredients:{name:'Bacon',active:true}}],
 product_drink_options:[],ingredients:[{id:'sausage',name:'Salsicha',category:'Hot Dogs',active:true},{id:'orange',name:'Laranja',category:'Sucos',active:true}],
 admin_profiles:[{user_id:'admin',active:true,must_change_password:false}],
 orders:[{id:7,updated_at:'2026-10-21T12:00:00Z',created_at:'2026-10-21T12:00:00Z',status:'Novo',order_items:[]}]
};
function backend(path){
 let handler;const queries=[],writes=[];
 const sb={auth:{getUser:async token=>({data:{user:token==='admin'?{id:'admin'}:null},error:token==='admin'?null:{message:'invalid'}})},from(table){
  const q={table,filters:[],write:null,singleRow:false};queries.push(q);
  const api={select(){return api},eq(k,v){q.filters.push(row=>row[k]===v);return api},in(k,values){q.filters.push(row=>values.includes(row[k]));return api},order(){return api},limit(){return api},single(){q.singleRow=true;return api},maybeSingle(){q.singleRow=true;return api},insert(data){q.write=data;return api},upsert(data){q.write=data;return api},update(data){q.write=data;return api},then(resolve,reject){
   let data;
   if(q.write){writes.push({table,data:q.write});data=[{...q.write,id:table==='orders'?101:table==='customers'?'customer':writes.length,created_at:'2026-10-21T12:00:00Z'}]}
   else data=structuredClone(catalog[table]||[]).filter(row=>q.filters.every(f=>f(row)));
   return Promise.resolve({data:q.singleRow?(data[0]||null):data,error:null}).then(resolve,reject);
  }};return api;
 }};
 const context={Request,Response,URL,TextEncoder,Uint8Array,AbortSignal,crypto:globalThis.crypto,console,createClient:()=>sb,Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://example.invalid':'service'},serve:fn=>handler=fn},EdgeRuntime:{waitUntil(){}},fetch:async()=>new Response('{}')};
 vm.createContext(context);const source=fs.readFileSync(path,'utf8').replace(/^import .*\n/gm,'');vm.runInContext(stripTypeScriptTypes(source),context);
 return {async request(body,auth,path='/'){const r=await handler(new Request('https://example.invalid'+path,{method:body?'POST':'GET',headers:auth?{Authorization:'Bearer '+auth}:{},body:body?JSON.stringify(body):undefined}));return {status:r.status,body:await r.json()}},queries,writes};
}
const payload=items=>({customer:'Teste local',phone:'00000000000',type:'Retirada',payment:'Dinheiro',needsChange:true,changeFor:1000,items});
test('batched validation preserves totals, free swaps and ingredient snapshots',async()=>{
 const items=[{product:'Hot Dog Tradicional',qty:2,remove:['Salsicha'],extras:['2× Linguiça calabresa (1 troca sem custo)','Bacon']},{product:'Suco Natural',qty:3,flavor:'Laranja',sugar:'Sem açúcar',remove:[],extras:[]}];
 const after=backend('supabase/functions/submit-order/index.ts');
 const b=await after.request(payload(items));assert.equal(b.status,200);assert.equal(b.body.order.total,79);
 const rows=after.writes.filter(q=>q.table==='order_item_extras')[0].data;assert.equal(rows.length,3);assert.equal(rows[0].unit_price,0);assert.equal(rows[1].unit_price,3);assert.equal(rows[2].ingredient_name,'Bacon');const removed=after.writes.find(q=>q.table==='order_item_removals');assert.equal(removed.data[0].ingredient_name,'Salsicha');
});
test('catalog reads stay constant for 30 items and avoid repeated removal lookups',async()=>{
 const b=backend('supabase/functions/submit-order/index.ts');await b.request(payload(Array.from({length:30},()=>({product:'Hot Dog Tradicional',qty:1,remove:['Salsicha'],extras:['Linguiça calabresa (troca sem custo)']}))));
 for(const table of ['product_composition','product_extras','product_drink_options'])assert.equal(b.queries.filter(q=>q.table===table&&!q.write).length,1);
 assert.equal(b.queries.filter(q=>q.table==='ingredients'&&!q.write).length,0);
});
test('bread removal, excess extras and forged free swaps are rejected',async()=>{
 for(const item of [{remove:['Pão'],extras:[]},{remove:[],extras:['3× Linguiça calabresa']},{remove:[],extras:['Linguiça calabresa (troca sem custo)']}]){
 const b=backend('supabase/functions/submit-order/index.ts');const r=await b.request(payload([{product:'Hot Dog Tradicional',qty:1,...item}]));assert.equal(r.status,400);assert.equal(b.writes.length,0);
 }
});
test('ADM rejects invalid auth and returns a lightweight unchanged response',async()=>{
 const b=backend('supabase/functions/admin-orders/index.ts');assert.equal((await b.request(null)).status,401);assert.equal((await b.request(null,'invalid')).status,401);
 const first=await b.request(null,'admin');assert.equal(first.status,200);assert.equal(first.body.orders.length,1);assert.ok(first.body.revision);
 const second=await b.request(null,'admin','/?revision='+first.body.revision);assert.equal(second.body.unchanged,true);assert.equal(second.body.orders,undefined);
 catalog.orders[0].updated_at='2026-10-21T12:01:00Z';const third=await b.request(null,'admin','/?revision='+first.body.revision);assert.equal(third.body.orders.length,1);assert.notEqual(third.body.revision,first.body.revision);
});
