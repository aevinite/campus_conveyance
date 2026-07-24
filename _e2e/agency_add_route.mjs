import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await (await b.newContext({storageState:'_e2e/agency_state.json'})).newPage();
await p.goto('http://localhost:3000/agency/add-route',{waitUntil:'networkidle',timeout:30000});
await p.waitForTimeout(1500);
const search=p.locator('input[placeholder*="nearby area" i]');
await search.click(); await search.type('Prahlad Nagar Ahmedabad',{delay:50});
await p.waitForTimeout(2500);
// try to click a visible suggestion by text
let added=false;
const cand=p.getByText(/Prahlad Nagar/i);
const n=await cand.count();
for(let i=0;i<n && !added;i++){
  try{ await cand.nth(i).click({timeout:1500});
    await p.waitForTimeout(1500);
    const t=await p.evaluate(()=>document.body.innerText);
    if(!/No pickup stops added yet/i.test(t)){ added=true; }
  }catch{}
}
if(!added){ // keyboard fallback
  await search.focus(); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  const t=await p.evaluate(()=>document.body.innerText); added=!/No pickup stops added yet/i.test(t);
}
console.log('stop added:',added);
// select bus
try{ await p.locator('button:has-text("Select a bus")').click(); await p.waitForTimeout(700);
  const opt=p.getByText(/GJ01AB1234|Bus 1|#1|Tata/i).first();
  if(await opt.count()) await opt.click(); else { await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); }
  await p.waitForTimeout(400);
}catch(e){console.log('bus select err',e.message);}
// prices
const set=async(n,v)=>{const el=await p.$(`input[name=${n}]`); if(el) await el.fill(v);};
await set('priceMonthly','1800'); await set('priceSemester','9000'); await set('priceYearly','16000');
await p.screenshot({path:'_e2e/route_filled.png',fullPage:true});
await p.getByRole('button',{name:/^add route$/i}).click();
await p.waitForTimeout(7000);
const st=await p.evaluate(()=>({url:location.href, msg:document.body.innerText.replace(/\s+/g,' ').match(/(at least one pickup|select a bus|added|created|error[^.]{0,80}|approved service)/i)?.[0]||'(none)'}));
console.log('URL:',st.url); console.log('MSG:',st.msg);
await p.screenshot({path:'_e2e/route_result.png',fullPage:true});
await b.close();
