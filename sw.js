const VERSION="pardal-v8.52";const CORE=["/","/index.html","/manifest.webmanifest","/assets/hotdog.webp","/assets/logo.webp"];
self.addEventListener("install",e=>e.waitUntil(caches.open(VERSION).then(c=>c.addAll(CORE))));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('pardal-v') && k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("message",e=>{if(e.data==="SKIP_WAITING")self.skipWaiting()});
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET")return;
 const url=new URL(e.request.url);
 // Supabase responses and other origins must never enter the offline cache.
 if(url.origin!==self.location.origin)return;
 if(e.request.mode==="navigate"){
  const path=url.pathname;
  if(path!=='/' && path!=='/index.html')return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();e.waitUntil(caches.open(VERSION).then(x=>x.put('/index.html',copy)))}return r}).catch(()=>caches.match('/index.html')));return;
 }
 if(!/\.(?:webp|png|svg|js|webmanifest)$/.test(url.pathname))return;
 e.respondWith(caches.open(VERSION).then(async cache=>{
  const cached=await cache.match(e.request);if(cached)return cached;
  const response=await fetch(e.request);
  if(response.ok&&response.type!=='opaque'){const copy=response.clone();e.waitUntil(cache.put(e.request,copy))}
  return response;
 }));
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
  else await self.clients.openWindow('/admin.html?order='+encodeURIComponent(e.notification.data?.orderId||''));
 })());
});

