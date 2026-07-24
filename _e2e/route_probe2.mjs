import { chromium } from 'playwright';
const b=await chromium.launch();
const ctx=await b.newContext({storageState:'_e2e/agency_state.json'});
const p=await ctx.newPage();
await p.goto('http://localhost:3000/agency/add-route',{waitUntil:'networkidle',timeout:30000});
await p.waitForTimeout(1500);
// test geocode endpoint directly with session
const geo=await p.evaluate(async()=>{ try{const r=await fetch('/api/geocode?q=Prahlad%20Nagar%20Ahmedabad',{headers:{accept:'application/json'}}); return {status:r.status, body:(await r.text()).slice(0,300)};}catch(e){return{err:e.message};} });
console.log('GEOCODE_API:',JSON.stringify(geo));
const search=p.locator('input[placeholder*="nearby area" i]');
await search.click(); await search.type('Prahlad Nagar Ahmedabad',{delay:40});
await p.waitForTimeout(6000);
const dump=await p.evaluate(()=>{
  const els=[...document.querySelectorAll('button,li,[role=option],[role=button],div')].filter(e=>e.offsetParent&&/nagar|ahmedabad|gujarat|road/i.test(e.textContent||'')&&e.textContent.length<80);
  return els.slice(0,10).map(e=>({tag:e.tagName.toLowerCase(),role:e.getAttribute('role')||'',cls:(e.className||'').toString().slice(0,30),txt:(e.textContent||'').trim().slice(0,50)}));
});
console.log('MATCHES:',JSON.stringify(dump,null,0));
await p.screenshot({path:'_e2e/route_probe2.png',fullPage:true});
await b.close();
