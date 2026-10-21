const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function worker(){
 const events={},store=new Map();let downloads=0;
 const cache={match:async request=>store.get(request.url||request),put:async(request,response)=>store.set(request.url||request,response),addAll:async()=>{}};
 const ctx={URL,Response,console,caches:{open:async()=>cache,match:cache.match},fetch:async()=>{downloads++;return new Response('image',{status:200})},self:{location:{origin:'https://app.test'},addEventListener:(name,fn)=>events[name]=fn}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('sw.js','utf8'),ctx);
 return {events,store,downloads:()=>downloads,async request(url,mode='cors'){let response;const tasks=[];events.fetch({request:{url,method:'GET',mode},respondWith:r=>response=r,waitUntil:p=>tasks.push(p)});const r=await response;await Promise.all(tasks);return r}};
}
test('same-origin images are downloaded once and cached for following views',async()=>{const w=worker();await w.request('https://app.test/assets/lata.webp');await w.request('https://app.test/assets/lata.webp');assert.equal(w.downloads(),1)});
test('Supabase API calls and ADM navigation never enter offline cache',async()=>{const w=worker();assert.equal(await w.request('https://project.supabase.co/rest/v1/orders'),undefined);assert.equal(await w.request('https://app.test/admin.html','navigate'),undefined);assert.equal(w.downloads(),0);assert.equal(w.store.size,0)});
