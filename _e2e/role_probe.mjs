import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await (await b.newContext()).newPage();
await p.goto('http://localhost:3000/register',{waitUntil:'networkidle',timeout:30000});
await p.waitForTimeout(900);
// dump the role control area
const before=await p.evaluate(()=>{
  const btns=[...document.querySelectorAll('button')].map(e=>({txt:(e.innerText||'').trim().slice(0,20),role:e.getAttribute('role')||'',ap:e.getAttribute('aria-pressed')}));
  return {btns, role:document.querySelector('input[name=role]')?.value};
});
console.log('BEFORE role=',before.role,'btns=',JSON.stringify(before.btns));
// try clicking a button literally containing Parent
const parentBtn=p.getByText(/parent/i).first();
if(await parentBtn.count()){ await parentBtn.click(); await p.waitForTimeout(600); }
const after=await p.evaluate(()=>document.querySelector('input[name=role]')?.value);
console.log('AFTER clicking Parent text, role=',after);
await b.close();
