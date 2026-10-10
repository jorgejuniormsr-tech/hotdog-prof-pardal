const VERSION="pardal-v8.49";const CORE=["/","/index.html","/manifest.webmanifest","/Cachorro-quente%20gourmet%20com%20batata%20palha.png"];
self.addEventListener("install",e=>e.waitUntil(caches.open(VERSION).then(c=>c.addAll(CORE))));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION && !k.startsWith('pardal-push-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("message",e=>{if(e.data==="SKIP_WAITING")self.skipWaiting()});
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET")return;
 if(e.request.mode==="navigate"){
  const path=new URL(e.request.url).pathname,cachePath=path==='/admin.html'?'/admin.html':'/index.html';
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){let c=r.clone();caches.open(VERSION).then(x=>x.put(cachePath,c))}return r}).catch(()=>caches.match(cachePath)));return;
 }
 e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request)));
});
self.addEventListener('push',e=>e.waitUntil((async()=>{
 const data=e.data?.json();if(!data?.orderId)return;
 // Persistent receipt survives reloads and worker/cache updates.
 const cache=await caches.open('pardal-push-receipts-v1'),receipt='/__push_receipts/'+encodeURIComponent(String(data.orderId));
 if(await cache.match(receipt))return;
 const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
 const openAdmin=windows.some(c=>new URL(c.url).pathname==='/admin.html');
 await self.registration.showNotification(data.title||'Novo pedido',{
  body:data.body||'Há um novo pedido aguardando atendimento.',
  icon:'/admin-icon-192-any.png',tag:'pardal-order-'+data.orderId,renotify:false,
  // Open ADM plays its own single chime; background uses device sound.
  silent:openAdmin || data.sound===false,data:{url:'/admin.html',orderId:String(data.orderId)}
 });
 await cache.put(receipt,new Response('received'));
 const keys=await cache.keys();await Promise.all(keys.slice(0,Math.max(0,keys.length-2000)).map(k=>cache.delete(k)));
})()));
self.addEventListener('notificationclick',e=>{
 e.notification.close();
 e.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const adm=windows.find(c=>new URL(c.url).pathname==='/admin.html');
  if(adm){await adm.focus();adm.postMessage({type:'OPEN_ADMIN_ORDERS',orderId:e.notification.data?.orderId})}
  else await self.clients.openWindow('/admin.html');
 })());
});
