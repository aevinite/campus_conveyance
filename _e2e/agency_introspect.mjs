import { chromium } from 'playwright';
const b=await chromium.launch();
const ctx=await b.newContext({ storageState:'_e2e/agency_state.json' });
const p=await ctx.newPage();
for(const r of ['/agency/account','/agency/add-bus','/agency/add-route','/agency/drivers']){
  try{
    const resp=await p.goto('http://localhost:3000'+r,{waitUntil:'networkidle',timeout:30000});
    await p.waitForTimeout(1000);
    const f=await p.evaluate(()=>{
      const inp=[...document.querySelectorAll('input,select,textarea')].filter(e=>e.type!=='hidden').map(e=>({t:e.tagName.toLowerCase(),type:e.type||'',name:e.name||'',ph:e.placeholder||''}));
      const btn=[...document.querySelectorAll('button')].map(e=>(e.innerText||'').trim()).filter(Boolean).slice(0,12);
      const h=[...document.querySelectorAll('h1,h2,h3')].map(e=>e.innerText.trim()).slice(0,6);
      return {inp,btn,h};
    });
    console.log('\n==== '+r+' (status '+(resp&&resp.status())+') ====');
    console.log('H:',JSON.stringify(f.h));
    console.log('INPUTS:',JSON.stringify(f.inp));
    console.log('BUTTONS:',JSON.stringify(f.btn));
  }catch(e){console.log('\n==== '+r+' ERR '+e.message);}
}
await b.close();
