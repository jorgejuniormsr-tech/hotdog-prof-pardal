import { createClient } from "npm:@supabase/supabase-js@2.110.0";
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
  // Load validation metadata once per request, independent of item count.
  const productIds=(products||[]).map((p:any)=>p.id);
  const flavors=[...new Set(b.items.map((x:any)=>String(x.flavor||"").trim()).filter(Boolean))];
  const [compositions,extras,drinkOptions,juiceFlavors]=await Promise.all([
   sb.from("product_composition").select("product_id,ingredient_id,removable,ingredients(name,active)").in("product_id",productIds),
   sb.from("product_extras").select("product_id,price,max_quantity,active,ingredient_id,ingredients(name,active)").in("product_id",productIds).eq("active",true),
   sb.from("product_drink_options").select("product_id,active,drink_options(name,active)").in("product_id",productIds).eq("active",true),
   flavors.length?sb.from("ingredients").select("id,name").in("name",flavors).in("category",["Sucos","Todos"]).eq("active",true):Promise.resolve({data:[],error:null})
  ]);
  for(const result of [compositions,extras,drinkOptions,juiceFlavors])if(result.error)throw result.error;
  const groupByProduct=(rows:any[])=>{const grouped=new Map();for(const row of rows||[]){const list=grouped.get(row.product_id)||[];list.push(row);grouped.set(row.product_id,list)}return grouped};
  const compositionByProduct=groupByProduct(compositions.data),extrasByProduct=groupByProduct(extras.data),drinksByProduct=groupByProduct(drinkOptions.data);
  const availableFlavors=new Set((juiceFlavors.data||[]).map((f:any)=>f.name));
  const prepared:any[]=[]; let subtotal=0, hasKitchen=false, hasBar=false;
  for(const raw of b.items){
   const p:any=pm.get(String(raw.product||"").trim()); if(!p||!p.active) return out({error:"Produto indisponível: "+String(raw.product||"")},400);
   const reqComp=compositionByProduct.get(p.id)||[];
   const blocked=(reqComp||[]).filter((c:any)=>c.ingredients?.active===false);
   if(blocked.length) return out({error:"Produto indisponível no momento: "+p.name},400);
   if(p.category==="Bebidas"){
     const optName=String(raw.drinkOption||"").trim(); if(!optName)return out({error:"Escolha uma opção de bebida para "+p.name},400);
     const pdo=drinksByProduct.get(p.id)||[];
     if(!(pdo||[]).some((x:any)=>x.drink_options?.active!==false&&x.drink_options?.name===optName))return out({error:"Opção de bebida indisponível: "+optName},400);
   }
   if(p.category==="Sucos"){
     const flavor=String(raw.flavor||"").trim(); if(!flavor)return out({error:"Escolha o sabor do suco"},400);
     const fi=availableFlavors.has(flavor);
     if(!fi)return out({error:"Sabor indisponível: "+flavor},400);
     if(!["Com açúcar","Sem açúcar"].includes(String(raw.sugar||"")))return out({error:"Escolha se deseja o suco com ou sem açúcar"},400);
   }
   const removals=Array.isArray(raw.remove)?raw.remove:[];
   if(removals.length){const allowedRemovalNames=(reqComp||[]).filter((c:any)=>c.removable!==false).map((c:any)=>c.ingredients?.name);if(removals.some((n:any)=>!allowedRemovalNames.includes(String(n))))return out({error:"Remoção inválida no produto "+p.name},400);}
   const qty=Math.max(1,Math.min(99,parseInt(raw.qty)||1)); let unit=Number(p.price); const extraRows:any[]=[];
   const requested=Array.isArray(raw.extras)?raw.extras:[];
   const ex=extrasByProduct.get(p.id)||[];
   const extraQuantities=new Map<string,number>();let freeSwapUsed=false;
   for(const ex0 of requested){
    const text=String(ex0),m=text.match(/^\s*(\d+)×\s*(.+)$/);
    const label=(m?m[2]:text).trim(),exQty=m?parseInt(m[1]):1;
    const swap=/\s*\((?:1 )?troca sem custo\)$/.test(label);
    const exName=label.replace(/\s*\((?:1 )?troca sem custo\)$/,"").trim();
    const found=(ex||[]).find((e:any)=>e.ingredients?.name===exName&&e.ingredients?.active!==false);
    const totalQty=(extraQuantities.get(exName)||0)+exQty;
    if(!found||exQty<1||totalQty>found.max_quantity)return out({error:"Adicional inválido: "+exName},400);
    extraQuantities.set(exName,totalQty);
    if(swap){
     const hasSausageRemoval=removals.some((n:any)=>norm(n)==="salsicha")&&(reqComp||[]).some((c:any)=>norm(c.ingredients?.name)==="salsicha"&&c.removable!==false);
     if(freeSwapUsed||!hasSausageRemoval||norm(exName)!=="linguica calabresa")return out({error:"Troca de carne inválida"},400);
     freeSwapUsed=true;
     extraRows.push({ingredient_id:found.ingredient_id,ingredient_name:exName+" (troca sem custo)",quantity:1,unit_price:0});
    }
    const paidQty=exQty-(swap?1:0);
    unit+=Number(found.price)*paidQty;
    if(paidQty)extraRows.push({ingredient_id:found.ingredient_id,ingredient_name:exName,quantity:paidQty,unit_price:Number(found.price)});
   }
   const line=unit*qty; subtotal+=line; if(p.category==="Hot Dogs")hasKitchen=true;if(p.category==="Sucos")hasBar=true;
   prepared.push({p,qty,unit,line,raw,extraRows,removalRows:reqComp.filter((c:any)=>removals.includes(c.ingredients?.name)).map((c:any)=>({ingredient_id:c.ingredient_id,ingredient_name:c.ingredients.name}))});
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
   if(x.removalRows.length){const {error}=await sb.from("order_item_removals").insert(x.removalRows.map((r:any)=>({...r,order_item_id:oi.id})));if(error)throw error;}
   if(x.extraRows.length){const {error}=await sb.from("order_item_extras").insert(x.extraRows.map((e:any)=>({...e,order_item_id:oi.id})));if(error)throw error;}
  }
  // Notify only after all order items have been saved. Push failures never reject a sale.
  const notify=fetch(Deno.env.get("SUPABASE_URL")!+"/functions/v1/admin-notifications",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!},body:JSON.stringify({action:"dispatch",orderId:ord.id}),signal:AbortSignal.timeout(15000)}).then(r=>{if(!r.ok)console.error("Order push dispatch failed",r.status)}).catch(()=>console.error("Order push dispatch unavailable"));
  EdgeRuntime.waitUntil(notify);
  return out({ok:true,order:{id:ord.id,created_at:ord.created_at,subtotal,delivery_fee:deliveryFee,total:Number(ord.total),status:ord.status}});
 }catch(e){console.error(e);return out({error:"Não foi possível registrar o pedido."},500)}
});

