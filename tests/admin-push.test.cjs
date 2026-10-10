const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(){
 const listeners={},notifications=[],entries=new Map();let windows=[],focused=false,opened=null,message=null;
 const cache={match:async k=>entries.get(k),put:async(k,v)=>entries.set(k,v),keys:async()=>[...entries.keys()],delete:async k=>entries.delete(k)};
 const ctx={URL,Response,Promise,encodeURIComponent,caches:{open:async()=>cache},self:{addEventListener:(t,cb)=>listeners[t]=cb,registration:{showNotification:async(t,o)=>notifications.push({t,o})},clients:{matchAll:async()=>windows,openWindow:async u=>opened=u}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('sw.js','utf8'),ctx);
 async function push(id,sound=true){let work;listeners.push({data:{json:()=>({orderId:id,title:'Novo pedido #'+id,sound})},waitUntil:p=>work=p});await work}
 async function click(){let work;listeners.notificationclick({notification:{close(){},data:{orderId:'9'}},waitUntil:p=>work=p});await work}
 return {notifications,push,click,setAdmin(){windows=[{url:'https://hotdog-prof-pardal.vercel.app/admin.html',focus:async()=>focused=true,postMessage:m=>message=m}]},focused:()=>focused,opened:()=>opened,message:()=>message};
}
test('closed app receives one notification per order and opens ADM',async()=>{
 const a=setup();await a.push('9');await a.push('9');await a.push('10');assert.equal(a.notifications.length,2);assert.equal(a.notifications[0].o.silent,false);assert.equal(a.notifications[0].o.tag,'pardal-order-9');await a.click();assert.equal(a.opened(),'/admin.html?order=9');
});
test('open ADM avoids a second device sound and notification click focuses it',async()=>{
 const a=setup();a.setAdmin();await a.push('9');assert.equal(a.notifications[0].o.silent,true);await a.click();assert.equal(a.focused(),true);assert.equal(a.message().type,'OPEN_ADMIN_ORDERS');
});
test('disabled sound creates silent background notification',async()=>{const a=setup();await a.push('9',false);assert.equal(a.notifications[0].o.silent,true)});
