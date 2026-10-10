import { createClient } from "npm:@supabase/supabase-js@2";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const out=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:CORS});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:CORS});
 if(req.method!=="POST") return out({error:"Método inválido"},405);
 try{
  const b=await req.json(), deviceToken=String(b.deviceToken||"").trim().slice(0,200), name=String(b.customer||"").trim().slice(0,120), phone=String(b.phone||"").replace(/[^0-9+]/g,"").slice(0,30);
  const type=b.type==="Retirada"?"Retirada":"Entrega", payment=String(b.payment||"").trim().slice(0,80);
  const allowedPayments=new Set(["Cartão de crédito","Cartão de débito","PIX na entrega","Dinheiro"]);
  if(!allowedPayments.has(payment)) return out({error:"Forma de pagamento inválida"},400);
  if(!name||!phone||!payment||!Array.isArray(b.items)||!b.items.length||b.items.length>30) return out({error:"Dados do pedido incompletos"},400);
  let changeFor:null|number=null;
  if(payment==="Dinheiro"&&b.needsChange===true){changeFor=Number(b.changeFor);if(!Number.isFinite(changeFor)||changeFor<=0)return out({error:"Informe um valor válido para o troco"},400);}
  const addr=type==="Entrega"?b.address:null;
  if(type==="Entrega"&&(!addr?.street||!addr?.number||!addr?.neighborhood||!addr?.city||String(addr?.state||"").length!==2)) return out({error:"Endereço incompleto"},400);
  const norm=(v:any)=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase();
  let deliveryFee=0;
  if(type==="Entrega"){
    const city=norm(addr.city), state=norm(addr.state), hood=norm(addr.neighborhood);
    const rural=/(^|\s)(interior|linha|zona rural|area rural|rural)(\s|$)/.test(hood);
    if(city!=="pinhalzinho"||state!=="sc"||rural) return out({error:"Não fornecemos este tipo de serviço para esta localidade",code:"DELIVERY_UNAVAILABLE"},400);
    deliveryFee=hood==="centro"?10:15;
  }
  const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data:openSetting}=await sb.from("app_settings").select("value").eq("key","delivery_open").maybeSingle();
  if(openSetting&&openSetting.value===false)return out({error:"O delivery está fechado no momento"},400);
  const names=[...new Set(b.items.map((x:any)=>String(x.product||"").trim()))];
  const {data:products,error:pe}=await sb.from("products").select("id,name,category,price,active").in("name",names);
  if(pe) throw pe;
  const pm=new Map((products||[]).map((p:any)=>[p.name,p]));
  const prepared:any[]=[]; let subtotal=0, hasKitchen=false, hasBar=false;
  for(const raw of b.items){
   const p:any=pm.get(String(raw.product||"").trim()); if(!p||!p.active) return out({error:"Produto indisponível: "+String(raw.product||"")},400);
   const {data:reqComp,error:rce}=await sb.from("product_composition").select("ingredient_id,removable,ingredients(name,active)").eq("product_id",p.id); if(rce)throw rce;
   const blocked=(reqComp||[]).filter((c:any)=>c.ingredients?.active===false);
   if(blocked.length) return out({error:"Produto indisponível no momento: "+p.name},400);
   if(p.category==="Bebidas"){
     const optName=String(raw.drinkOption||"").trim(); if(!optName)return out({error:"Escolha uma opção de bebida para "+p.name},400);
     const {data:pdo}=await sb.from("product_drink_options").select("active,drink_options(name,active)").eq("product_id",p.id).eq("active",true);
     if(!(pdo||[]).some((x:any)=>x.drink_options?.active!==false&&x.drink_options?.name===optName))return out({error:"Opção de bebida indisponível: "+optName},400);
   }
   if(p.category==="Sucos"){
     const flavor=String(raw.flavor||"").trim(); if(!flavor)return out({error:"Escolha o sabor do suco"},400);
     const {data:fi}=await sb.from("ingredients").select("id").eq("name",flavor).in("category",["Sucos","Todos"]).eq("active",true).maybeSingle();
     if(!fi)return out({error:"Sabor indisponível: "+flavor},400);
     if(!["Com açúcar","Sem açúcar"].includes(String(raw.sugar||"")))return out({error:"Escolha se deseja o suco com ou sem açúcar"},400);
   }
   const removals=Array.isArray(raw.remove)?raw.remove:[];
   if(removals.length){const allowedRemovalNames=(reqComp||[]).filter((c:any)=>c.removable!==false).map((c:any)=>c.ingredients?.name);if(removals.some((n:any)=>!allowedRemovalNames.includes(String(n))))return out({error:"Remoção inválida no produto "+p.name},400);}
   const qty=Math.max(1,Math.min(99,parseInt(raw.qty)||1)); let unit=Number(p.price); const extraRows:any[]=[];
   const requested=Array.isArray(raw.extras)?raw.extras:[];
   for(const ex0 of requested){
    const m=String(ex0).match(/^\s*(\d+)×\s*(.+)$/); const exName=(m?m[2]:String(ex0)).trim(); const exQty=m?parseInt(m[1]):1;
    const {data:ex}=await sb.from("product_extras").select("price,max_quantity,active,ingredient_id,ingredients(name,active)").eq("product_id",p.id).eq("active",true);
    const found=(ex||[]).find((e:any)=>e.ingredients?.name===exName&&e.ingredients?.active!==false);
    if(!found||exQty<1||exQty>found.max_quantity) return out({error:"Adicional inválido: "+exName},400);
    unit+=Number(found.price)*exQty; extraRows.push({ingredient_id:found.ingredient_id,ingredient_name:exName,quantity:exQty,unit_price:Number(found.price)});
   }
   const line=unit*qty; subtotal+=line; if(p.category==="Hot Dogs")hasKitchen=true;if(p.category==="Sucos")hasBar=true;
   prepared.push({p,qty,unit,line,raw,extraRows});
  }
  const {data:cust,error:ce}=await sb.from("customers").upsert({name,phone,updated_at:new Date().toISOString()},{onConflict:"phone"}).select("id").single(); if(ce)throw ce;
  if(deviceToken){const h=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(deviceToken)))).map(x=>x.toString(16).padStart(2,"0")).join("");await sb.from("customer_device_sessions").upsert({customer_id:cust.id,token_hash:h,last_used_at:new Date().toISOString()},{onConflict:"token_hash"});}
  const snapshot=addr?{street:String(addr.street).trim(),number:String(addr.number).trim(),neighborhood:String(addr.neighborhood).trim(),city:String(addr.city).trim(),state:String(addr.state).trim().toUpperCase(),complement:String(addr.complement||"").trim(),reference:String(addr.reference||"").trim(),location:addr.location||null}:null;
  if(changeFor!==null&&changeFor<subtotal+deliveryFee)return out({error:"O valor para troco deve ser igual ou maior que o total do pedido"},400);
  const {data:ord,error:oe}=await sb.from("orders").insert({customer_id:cust.id,customer_name:name,phone,order_type:type,payment_method:payment,change_for:changeFor,address_snapshot:snapshot,status:"Novo",kitchen_status:hasKitchen?"Novo":null,bar_status:hasBar?"Novo":null,subtotal,delivery_fee:deliveryFee,total:subtotal+deliveryFee}).select("id,created_at,total,status").single(); if(oe)throw oe;
  if(snapshot){const loc=snapshot.location||{};await sb.from("customer_addresses").insert({customer_id:cust.id,street:snapshot.street,number:snapshot.number,neighborhood:snapshot.neighborhood,city:snapshot.city,state:snapshot.state,complement:snapshot.complement,reference:snapshot.reference,latitude:Number.isFinite(Number(loc.lat))?Number(loc.lat):null,longitude:Number.isFinite(Number(loc.lng))?Number(loc.lng):null,is_default:true});}
  for(const x of prepared){
   const r=x.raw; const {data:oi,error:ie}=await sb.from("order_items").insert({order_id:ord.id,product_id:x.p.id,product_name:x.p.name,category:x.p.category,quantity:x.qty,unit_price:x.unit,line_total:x.line,flavor:r.flavor||null,sugar:r.sugar||null,drink_option:r.drinkOption||null,observation:String(r.obs||"").slice(0,500)}).select("id").single(); if(ie)throw ie;
   const removals=Array.isArray(r.remove)?r.remove:[];
   if(removals.length){const {data:ings}=await sb.from("ingredients").select("id,name").in("name",removals); if(ings?.length) await sb.from("order_item_removals").insert(ings.map((i:any)=>({order_item_id:oi.id,ingredient_id:i.id,ingredient_name:i.name})));}
   if(x.extraRows.length) await sb.from("order_item_extras").insert(x.extraRows.map((e:any)=>({...e,order_item_id:oi.id})));
  }
  // Notify only after all order items have been saved. Push failures never reject a sale.
  const notify=fetch(Deno.env.get("SUPABASE_URL")!+"/functions/v1/admin-notifications",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!},body:JSON.stringify({action:"dispatch",orderId:ord.id}),signal:AbortSignal.timeout(15000)}).then(r=>{if(!r.ok)console.error("Order push dispatch failed",r.status)}).catch(()=>console.error("Order push dispatch unavailable"));
  EdgeRuntime.waitUntil(notify);
  return out({ok:true,order:{id:ord.id,created_at:ord.created_at,subtotal,delivery_fee:deliveryFee,total:Number(ord.total),status:ord.status}});
 }catch(e){console.error(e);return out({error:"Não foi possível registrar o pedido."},500)}
});
