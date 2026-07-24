import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await (await b.newContext()).newPage();
await p.goto('http://localhost:3000/agency/register',{waitUntil:'networkidle',timeout:30000});
const btn=p.getByRole('button',{name:/search and select colleges/i});
const dis=await btn.isDisabled().catch(()=>null);
console.log('college button disabled(before verify)=', dis);
try{ await btn.click({timeout:5000}); }catch(e){ console.log('click err:',e.message); }
await p.waitForTimeout(1200);
// type a search
const q=await p.$('input[type=search], input[placeholder*="ollege" i], input[placeholder*="earch" i]');
if(q){ await q.fill('University'); await p.waitForTimeout(1500); console.log('typed search "University"'); }
else console.log('no search input found in popover');
const dump=await p.evaluate(()=>{
  const els=[...document.querySelectorAll('*')].filter(e=>/University|School/i.test(e.textContent||'')&&e.children.length===0);
  return els.slice(0,15).map(e=>({tag:e.tagName.toLowerCase(),role:e.getAttribute('role')||'',cls:(e.className||'').toString().slice(0,40),txt:(e.textContent||'').trim().slice(0,30)}));
});
console.log('MATCHES:',JSON.stringify(dump,null,0));
await p.screenshot({path:'_e2e/college_probe.png',fullPage:true});
await b.close();
