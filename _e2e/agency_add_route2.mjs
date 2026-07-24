import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await (await b.newContext({storageState:'_e2e/agency_state.json'})).newPage();
await p.goto('http://localhost:3000/agency/add-route',{waitUntil:'networkidle',timeout:30000});
await p.waitForTimeout(2000);
const search=p.locator('input[aria-label="Search for a pickup area"]');
await search.click();
await p.keyboard.insertText('Prahlad Nagar Ahmedabad');
await p.waitForTimeout(600);
const val=await search.inputValue();
console.log('input value now:', JSON.stringify(val));
await p.waitForTimeout(3500);
// suggestions: look for the unique address token
let added=false;
for(const token of [/Makarba/i,/Vejalpur/i,/Prahlad Nagar/i]){
  const c=p.getByText(token).first();
  if(await c.count()){ try{ await c.click({timeout:2000}); await p.waitForTimeout(1500);
     const t=await p.evaluate(()=>document.body.innerText); if(!/No pickup stops added yet/i.test(t)){added=true;break;} }catch{} }
}
console.log('stop added:', added);
if(added){
  // select bus
  await p.locator('button:has-text("Select a bus")').click(); await p.waitForTimeout(700);
  const opt=p.getByText(/GJ01AB1234|Tata|Bus\s*1|#1/i).first();
  if(await opt.count()) await opt.click(); else { await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); }
  await p.waitForTimeout(400);
  const set=async(n,v)=>{const el=await p.$(`input[name=${n}]`); if(el) await el.fill(v);};
  await set('priceMonthly','1800'); await set('priceSemester','9000'); await set('priceYearly','16000');
  await p.screenshot({path:'_e2e/route_filled2.png',fullPage:true});
  const addBtn=p.getByRole('button',{name:/^add route$/i});
  for(let i=0;i<10 && await addBtn.isDisabled();i++) await p.waitForTimeout(500);
  await addBtn.click();
  await p.waitForTimeout(7000);
  const st=await p.evaluate(()=>({url:location.href, msg:document.body.innerText.replace(/\s+/g,' ').match(/(added|created|error[^.]{0,80}|at least|select a bus)/i)?.[0]||'(none)'}));
  console.log('URL:',st.url,' MSG:',st.msg);
}
await p.screenshot({path:'_e2e/route_result2.png',fullPage:true});
await b.close();
