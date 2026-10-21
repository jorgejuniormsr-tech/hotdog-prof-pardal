import { createClient } from "npm:@supabase/supabase-js@2.110.0";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const out=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:CORS});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:CORS});
 const auth=req.headers.get("Authorization")||"";
 if(!auth.startsWith("Bearer ")) return out({error:"Não autorizado"},401);
 const url=Deno.env.get("SUPABASE_URL")!, service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
 const sb=createClient(url,service);
 const token=auth.slice(7);
 const {data:{user},error:userError}=await sb.auth.getUser(token);
 if(userError||!user) return out({error:"Sessão inválida"},401);
 const {data:profile,error:profileError}=await sb.from("admin_profiles").select("username,must_change_password,active").eq("user_id",user.id).maybeSingle();
 if(profileError||!profile||!profile.active) return out({error:"Acesso administrativo não autorizado"},403);
 if(profile.must_change_password) return out({error:"Troca de senha obrigatória",code:"PASSWORD_CHANGE_REQUIRED"},403);
 try{
  if(req.method==="GET"){
   const {data:versions,error:ve}=await sb.from("orders").select("id,updated_at").order("created_at",{ascending:false}).limit(200);
   if(ve)throw ve;
   const revision=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(versions||[]))))).map(x=>x.toString(16).padStart(2,"0")).join("");
   if(new URL(req.url).searchParams.get("revision")===revision)return out({unchanged:true,revision});

   const {data,error}=await sb.from("orders").select("*,order_items(*,order_item_removals(*),order_item_extras(*))").order("created_at",{ascending:false}).limit(200);
   if(error) throw error; return out({orders:data||[],revision});
  }
  if(req.method!=="POST") return out({error:"Método não permitido"},405);
  const b=await req.json(), id=Number(b.id); if(!id)return out({error:"Pedido inválido"},400);
  const allowed=["Novo","Pronto para entrega","Pronto para retirada","Saiu para entrega","Entregue","Retirado","Cancelado","Recusado","Concluído"];
  const patch:any={updated_at:new Date().toISOString()};
  if(b.field==="kitchen_status"&&allowed.includes(b.value))patch.kitchen_status=b.value;
  else if(b.field==="bar_status"&&allowed.includes(b.value))patch.bar_status=b.value;
  else if(b.field==="status"&&allowed.includes(b.value)){patch.status=b.value;if(["Entregue","Retirado","Cancelado","Recusado"].includes(b.value))patch.finalized_at=new Date().toISOString();}
  else return out({error:"Alteração inválida"},400);
  const {data,error}=await sb.from("orders").update(patch).eq("id",id).select("*").single();
  if(error)throw error; return out({ok:true,order:data});
 }catch(e){console.error(e);return out({error:"Falha na operação"},500)}
});
