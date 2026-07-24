import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await (await b.newContext({storageState:'_e2e/student_state.json'})).newPage();
const log=(...a)=>console.log(...a);
await p.goto('http://localhost:3000/student/schools',{waitUntil:'networkidle',timeout:30000});
await p.waitForTimeout(1500);
log('STEP1 schools url:',p.url());
// click LJ University
let lj=p.getByText(/LJ University/i).first();
if(await lj.count()){ await lj.click(); await p.waitForTimeout(2500); }
else log('LJ University not found on schools page');
log('STEP2 after LJ url:',p.url());
log('  agencies text:', (await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,300))));
// click Demo Transit Co
let ag=p.getByText(/Demo Transit Co/i).first();
if(await ag.count()){ await ag.click(); await p.waitForTimeout(2500); }
else log('Demo Transit Co not found');
log('STEP3 after agency url:',p.url());
log('  routes text:', (await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,300))));
// click route (Prahlad Nagar or a view/reserve link)
let rt=p.getByText(/Prahlad Nagar/i).first();
if(await rt.count()){ await rt.click(); await p.waitForTimeout(2500); }
else { const v=p.getByRole('link',{name:/view|details|reserve|route/i}).first(); if(await v.count()) await v.click(); await p.waitForTimeout(2500); }
log('STEP4 route detail url:',p.url());
const rd=await p.evaluate(()=>({
  h:[...document.querySelectorAll('h1,h2,h3')].map(e=>e.innerText.trim()).slice(0,6),
  btns:[...document.querySelectorAll('button')].map(e=>(e.innerText||'').trim()).filter(Boolean).slice(0,15),
  inputs:[...document.querySelectorAll('input,select')].filter(e=>e.type!=='hidden').map(e=>({t:e.tagName.toLowerCase(),type:e.type,name:e.name,ph:e.placeholder})),
  snip:document.body.innerText.replace(/\s+/g,' ').slice(0,400)
}));
log('ROUTE_DETAIL H:',JSON.stringify(rd.h));
log('  BTNS:',JSON.stringify(rd.btns));
log('  INPUTS:',JSON.stringify(rd.inputs));
log('  SNIP:',rd.snip);
await p.screenshot({path:'_e2e/route_detail.png',fullPage:true});
await b.close();
