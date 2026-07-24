import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await (await b.newContext({storageState:'_e2e/agency_state.json'})).newPage();
await p.goto('http://localhost:3000/agency/add-route',{waitUntil:'networkidle',timeout:30000});
await p.waitForTimeout(1500);
const search=p.locator('input[placeholder*="nearby area" i]');
await search.click(); await search.type('Prahlad Nagar Ahmedabad',{delay:60});
await p.waitForTimeout(3000);
const html=await p.evaluate(()=>{
  const inp=document.querySelector('input[placeholder*="nearby area" i]');
  let n=inp; for(let i=0;i<5&&n;i++) n=n.parentElement;
  return n? n.outerHTML.replace(/\s+/g,' ').slice(0,2500):'(no container)';
});
console.log('CONTAINER_HTML:', html);
await b.close();
