import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await (await b.newContext({storageState:'_e2e/agency_state.json'})).newPage();
await p.goto('http://localhost:3000/agency/account',{waitUntil:'networkidle',timeout:30000});
await p.waitForTimeout(1200);
const btns=await p.evaluate(()=>[...document.querySelectorAll('button')].map((e,i)=>({i,txt:(e.innerText||'').trim().slice(0,40),disabled:e.disabled,type:e.type})));
console.log('BUTTONS:',JSON.stringify(btns,null,0));
// find the service section heading and following controls
const sec=await p.evaluate(()=>{
  const h=[...document.querySelectorAll('h1,h2,h3')].map(e=>e.innerText.trim());
  return h;
});
console.log('HEADINGS:',JSON.stringify(sec));
await b.close();
