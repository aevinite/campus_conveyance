import { chromium } from 'playwright';
const b=await chromium.launch();
const ctx=await b.newContext({storageState:'_e2e/student_state.json'});
const p=await ctx.newPage();
await p.goto('http://localhost:3000/student/details?next=%2Fstudent%2Froutes%2F30f5f518-1dbf-477d-9c65-9312c9d53032',{waitUntil:'networkidle',timeout:30000});
await p.waitForTimeout(1200);
const set=async(n,v)=>{const el=await p.$(`input[name=${n}], textarea[name=${n}]`); if(el) await el.fill(v);};
await set('fullName','Demo Student'); await set('phone','9876500010');
await set('address','12 Student Housing, Ahmedabad'); await set('grade','FY B.Tech');
await set('guardianName','Demo Guardian'); await set('guardianPhone','9876500011');
await p.getByRole('button',{name:/save & continue|save and continue/i}).click();
await p.waitForTimeout(5000);
console.log('after save url:',p.url());
const rd=await p.evaluate(()=>({
  h:[...document.querySelectorAll('h1,h2,h3')].map(e=>e.innerText.trim()).slice(0,6),
  btns:[...document.querySelectorAll('button')].map(e=>(e.innerText||'').trim()).filter(Boolean).slice(0,18),
  snip:document.body.innerText.replace(/\s+/g,' ').slice(0,500)
}));
console.log('H:',JSON.stringify(rd.h));
console.log('BTNS:',JSON.stringify(rd.btns));
console.log('SNIP:',rd.snip);
await ctx.storageState({path:'_e2e/student_state.json'});
await p.screenshot({path:'_e2e/route_detail2.png',fullPage:true});
await b.close();
