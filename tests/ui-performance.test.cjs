const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
// Optional DOM test dependency is installed outside the application checkout.
const {parseHTML}=require(process.env.PARDAL_DOM_MODULE||'linkedom');
async function app(file){
 const html=fs.readFileSync(file,'utf8'),{window}=parseHTML(html),doc=window.document,store=new Map(),errors=[];
 // Browser globals exposed by element IDs are explicit in this test context.
 const context={console:{info(){},warn(...x){errors.push(x.join(' '))}},document:doc,window,location:{href:'https://example.invalid/',reload(){}},navigator:{userAgent:'test'},crypto:globalThis.crypto,Uint8Array,Intl,URL,Event:window.Event,CSS:{escape:String},structuredClone,setTimeout(){},setInterval(){},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},fetch:async url=>({ok:true,status:200,json:async()=>String(url).includes('customer-orders')?{ok:true,orders:[]}:[]}),matchMedia:()=>({matches:false}),alert(){},confirm:()=>false,history:{replaceState(){}}};
 window.matchMedia=context.matchMedia;window.scrollTo=()=>{};
 for(const element of doc.querySelectorAll('[id]'))context[element.id]=element;
 const select=context.delivery;if(select){Object.defineProperty(select,'value',{get(){return this._value||'Entrega'},set(v){this._value=v},configurable:true});for(const o of select.options)Object.defineProperty(o,'value',{get(){return this.textContent},configurable:true})}
 // The login panel remains locked: no real admin session is used in tests.
 context.adminOrderAlerts={observe:async()=>{},authenticated(){}};
 vm.createContext(context);for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(match[1],context);
 await new Promise(resolve=>setImmediate(resolve));return {context,doc,errors,run:code=>vm.runInContext(code,context)};
}
test('client starts without seed products or hidden administration',async()=>{
 const a=await app('index.html');assert.deepEqual(a.errors,[]);assert.equal(a.doc.querySelector('#adminProducts'),null);assert.equal(a.run('db.products.length'),0);assert.equal(a.run('db.orders.length'),0);
 a.run("show('cart')");assert.equal(a.doc.querySelector('.screen.active').id,'cart');
});
test('quantity two totals remain correct and do not multiply cash-change check twice',async()=>{
 const a=await app('index.html');a.run("cart=[{product:'Teste',qty:2,unitPrice:23,price:46,remove:[],extras:[]}];show('cart')");assert.match(a.doc.querySelector('#cartMiniTotal').textContent,/46,00/);assert.match(a.doc.querySelector('#cartList').textContent,/2× Teste/);
 const source=fs.readFileSync('index.html','utf8');assert.ok(!source.includes('(Number(i.price)||0)*(parseInt(i.qty)||1)'));
});
test('ADM initializes without customer screens or demonstration orders',async()=>{
 const a=await app('admin.html');assert.deepEqual(a.errors,[]);assert.equal(a.run('db.orders.length'),0);assert.equal(a.doc.querySelector('#cart'),null);assert.equal(a.doc.querySelector('.screen.active').id,'adminOrders');
});
test('polling preserves pending product prices and WhatsApp message edits',async()=>{
 const a=await app('admin.html');
 a.run("db.products=[{id:'p',name:'Teste',cat:'Hot Dogs',price:20,active:true,composition:[],extraConfig:[]}];show('adminProducts')");
 const price=a.doc.querySelector('[data-price-id]');price.value='27';a.run('renderOrderUpdate()');assert.equal(a.doc.querySelector('[data-price-id]'),price);assert.equal(price.value,'27');
 a.run("show('adminWhatsApp')");const message=a.doc.querySelector('.waMsg');message.value='Texto em edição';a.run('renderOrderUpdate()');assert.equal(a.doc.querySelector('.waMsg'),message);assert.equal(message.value,'Texto em edição');
});
