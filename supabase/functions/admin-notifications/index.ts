import { createClient } from 'npm:@supabase/supabase-js@2.110.0';
import webpush from 'npm:web-push@3.6.7';

const headers = {'Access-Control-Allow-Origin':'https://hotdog-prof-pardal.vercel.app','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Content-Type':'application/json'};
const out = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers});
function validSubscription(s: any) {
  try {
    const u = new URL(s.endpoint);
    const allowed = ['fcm.googleapis.com','updates.push.services.mozilla.com','push.services.mozilla.com','web.push.apple.com'];
    return u.protocol==='https:' && !u.username && !u.password && !u.port && (allowed.includes(u.hostname) || u.hostname.endsWith('.notify.windows.com')) && s.endpoint.length<2048 && typeof s.keys?.auth==='string' && typeof s.keys?.p256dh==='string' && /^[A-Za-z0-9_-]{22,24}$/.test(s.keys.auth) && /^[A-Za-z0-9_-]{87,90}$/.test(s.keys.p256dh);
  } catch { return false; }
}
Deno.serve(async req => {
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(!['GET','POST'].includes(req.method))return out({error:'Método inválido'},405);
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb=createClient(Deno.env.get('SUPABASE_URL')!,service);
  const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
  if(!token)return out({error:'Não autorizado'},401);
  try {
    const b=req.method==='POST'?await req.json():{};
    // Only the order server can dispatch. Browser users cannot send alerts.
    if(token===service && b.action==='dispatch') {
      const {data:order,error}=await sb.from('orders').select('id,created_at,status').eq('id',b.orderId).single();
      if(error||!order||order.status!=='Novo'||Date.now()-Date.parse(order.created_at)>120000)return out({error:'Pedido inválido'},400);
      const {data:config}=await sb.from('admin_push_config').select('*').eq('id',true).maybeSingle();
      if(!config)return out({ok:true,sent:0});
      const {data:subs,error:se}=await sb.from('admin_push_subscriptions').select('*');
      if(se)throw se;
      const {data:profiles,error:pe}=await sb.from('admin_profiles').select('user_id').eq('active',true).eq('must_change_password',false);
      if(pe)throw pe;
      const admins=new Set((profiles||[]).map(p=>p.user_id));
      let sent=0,failed=0;
      await Promise.all((subs||[]).filter(s=>admins.has(s.user_id)).map(async s=>{
        try {
          await webpush.sendNotification(s.subscription,JSON.stringify({orderId:String(order.id),title:'Novo pedido #'+order.id,body:'Há um novo pedido aguardando atendimento.',sound:s.sound_enabled}),{TTL:120,timeout:10000,vapidDetails:{subject:'https://hotdog-prof-pardal.vercel.app',publicKey:config.public_key,privateKey:config.private_key}});
          sent++;
        } catch(e) {
          if([404,410].includes(e.statusCode))await sb.from('admin_push_subscriptions').delete().eq('endpoint',s.endpoint);
          else failed++;
        }
      }));
      return out({ok:true,sent,failed});
    }
    const {data:{user},error:ue}=await sb.auth.getUser(token);
    if(ue||!user)return out({error:'Sessão inválida'},401);
    const {data:profile,error:pe}=await sb.from('admin_profiles').select('active,must_change_password').eq('user_id',user.id).maybeSingle();
    if(pe||!profile?.active||profile.must_change_password)return out({error:'Acesso administrativo não autorizado'},403);
    if(req.method==='GET') {
      let {data:config,error}=await sb.from('admin_push_config').select('public_key').eq('id',true).maybeSingle();
      if(error)throw error;
      if(!config) {
        const keys=webpush.generateVAPIDKeys();
        const {error:ie}=await sb.from('admin_push_config').upsert({id:true,public_key:keys.publicKey,private_key:keys.privateKey},{onConflict:'id',ignoreDuplicates:true});
        if(ie)throw ie;
        const result=await sb.from('admin_push_config').select('public_key').eq('id',true).single();
        if(result.error)throw result.error;
        config=result.data;
      }
      return out({publicKey:config.public_key});
    }
    if(b.action==='unsubscribe') {
      const {error}=await sb.from('admin_push_subscriptions').delete().eq('endpoint',String(b.endpoint||'')).eq('user_id',user.id);
      if(error)throw error;
      return out({ok:true});
    }
    if(b.action!=='subscribe'||!validSubscription(b.subscription))return out({error:'Inscrição inválida'},400);
    const {error}=await sb.from('admin_push_subscriptions').upsert({endpoint:b.subscription.endpoint,user_id:user.id,subscription:b.subscription,sound_enabled:b.sound!==false,updated_at:new Date().toISOString()},{onConflict:'endpoint'});
    if(error)throw error;
    return out({ok:true});
  } catch(e) {console.error('admin-notifications failed',e?.name);return out({error:'Não foi possível configurar as notificações'},500);}
});
