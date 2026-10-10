// Device preferences: permissions and audio activation belong to each device.
const adminOrderAlerts = (() => {
  const key='pardalAdminAlertsV1', seenKey='pardalAdminAlertedOrdersV1';
  let prefs={sound:true,push:false}, baseline=false, seen=new Set(), audio=null, observing=false;
  try{prefs={...prefs,...JSON.parse(localStorage.getItem(key)||'{}')};seen=new Set(JSON.parse(localStorage.getItem(seenKey)||'[]'))}catch{}
  const $=id=>document.getElementById(id);
  function persist(){localStorage.setItem(key,JSON.stringify(prefs))}
  function status(text){$('notificationStatus').textContent=text}
  function refresh(){
    $('orderSoundEnabled').checked=prefs.sound;
    $('orderNotificationsEnabled').checked=prefs.push;
    const supported='Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator;
    $('orderNotificationsEnabled').disabled=!supported;
    if(!supported)status('Notificações não disponíveis neste navegador. No iPhone, instale o ADM pela Tela de Início.');
    else if(Notification.permission==='denied')status('Notificações bloqueadas. Libere nas configurações do navegador.');
    else if(prefs.push)status('Notificações ativadas neste dispositivo, inclusive com o ADM fechado.');
    else status('Ative as notificações neste dispositivo. O som funciona com o ADM aberto.');
    $('orderSoundStatus').textContent=prefs.sound?(audio?.state==='running'?'Som pronto: um toque por novo pedido.':'Toque em Testar som para habilitar o áudio nesta sessão.'):'Alerta sonoro desativado.';
  }
  async function unlock(){
    try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return false;if(!audio)audio=new C();if(audio.state!=='running')await audio.resume();return audio.state==='running'}catch{return false}
  }
  function ring(){
    if(!audio||audio.state!=='running')return false;
    const start=audio.currentTime;
    [880,1174].forEach((hz,i)=>{const o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.value=hz;g.gain.setValueAtTime(0,start+i*.18);g.gain.linearRampToValueAtTime(.22,start+i*.18+.02);g.gain.exponentialRampToValueAtTime(.001,start+i*.18+.25);o.connect(g);g.connect(audio.destination);o.start(start+i*.18);o.stop(start+i*.18+.27)});
    return true;
  }
  async function api(body){const r=await adminFetch(SUPABASE_URL+'/functions/v1/admin-notifications',{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Falha ao configurar notificações');return d}
  async function syncSubscription(){
    const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();
    if(sub)await api({action:'subscribe',subscription:sub.toJSON(),sound:prefs.sound});
  }
  async function togglePush(){
    const enabled=$('orderNotificationsEnabled').checked;
    $('orderNotificationsEnabled').disabled=true;
    try{
      // Request immediately in the user gesture (required by Safari).
      const permission=enabled?await Notification.requestPermission():Notification.permission;
      if(enabled&&permission!=='granted')throw Error('Permita as notificações nas configurações do navegador.');
      const reg=await navigator.serviceWorker.ready;
      let sub=await reg.pushManager.getSubscription();
      if(enabled){
        const {publicKey}=await api();
        const bytes=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
        if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
        await api({action:'subscribe',subscription:sub.toJSON(),sound:prefs.sound});
      }else if(sub){await api({action:'unsubscribe',endpoint:sub.endpoint});await sub.unsubscribe()}
      prefs.push=enabled;persist();refresh();
    }catch(e){$('orderNotificationsEnabled').checked=prefs.push;status(e.message)}
    finally{$('orderNotificationsEnabled').disabled=false}
  }
  async function observe(orders){
    const count=orders.filter(o=>o.status==='Novo').length;$('newOrderCount').textContent=count;
    if(observing)return;
    observing=true;
    try{
      const run=()=>{
        // Fresh storage inside lock prevents two ADM tabs from playing together.
        try{seen=new Set(JSON.parse(localStorage.getItem(seenKey)||'[]'))}catch{}
        const fresh=baseline?orders.filter(o=>o.status==='Novo'&&!seen.has(String(o.id))):[];
        orders.forEach(o=>seen.add(String(o.id)));baseline=true;
        localStorage.setItem(seenKey,JSON.stringify([...seen].slice(-2000)));
        for(const o of fresh){
          if(prefs.sound)ring();
          const banner=$('newOrderNotice');banner.hidden=false;banner.textContent='Novo pedido #'+o.id+' recebido. Abrir Pedidos';
        }
      };
      if(navigator.locks)await navigator.locks.request('pardal-admin-order-alert',run);else run();
    }finally{observing=false}
  }
  $('orderSoundEnabled').addEventListener('change',async()=>{
    prefs.sound=$('orderSoundEnabled').checked;persist();if(prefs.sound)await unlock();refresh();
    if(prefs.push)try{await syncSubscription()}catch(e){status(e.message)}
  });
  $('orderNotificationsEnabled').addEventListener('change',togglePush);
  $('testOrderSound').addEventListener('click',async()=>{if(await unlock())ring();refresh()});
  $('newOrderNotice').addEventListener('click',()=>{$('newOrderNotice').hidden=true;show('adminOrders')});
  document.addEventListener('pointerdown',()=>{if(prefs.sound)unlock().then(refresh)},{passive:true});
  document.addEventListener('keydown',()=>{if(prefs.sound)unlock().then(refresh)});
  window.addEventListener('storage',e=>{if(e.key===key){try{prefs={...prefs,...JSON.parse(e.newValue||'{}')};refresh()}catch{}}});
  navigator.serviceWorker?.addEventListener('message',e=>{if(e.data?.type==='OPEN_ADMIN_ORDERS'){show('adminOrders');loadRemoteOrders(true)}});
  refresh();
  return {observe,async authenticated(){if(prefs.push&&'Notification' in window&&Notification.permission==='granted')try{await syncSubscription()}catch(e){status(e.message)}}};
})();
