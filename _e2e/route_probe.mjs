import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await (await b.newContext({storageState:'_e2e/agency_state.json'})).newPage();
await p.goto('http://localhost:3000/agency/add-route',{waitUntil:'networkidle',timeout:30000});
await p.waitForTimeout(1500);
const search=p.locator('input[placeholder*="nearby area" i]');
await search.fill('Prahlad Nagar');
await p.waitForTimeout(2500);
const sugg=await p.evaluate(()=>[...document.querySelectorAll('[role=option],li,button')].map(e=>(e.innerText||'').trim()).filter(t=>t&&/nagar|ahmedabad|road|india/i.test(t)).slice(0,8));
console.log('SUGGESTIONS:',JSON.stringify(sugg));
// click first suggestion if any
const first=p.getByText(/Prahlad Nagar/i).first();
if(await first.count()){ await first.click(); await p.waitForTimeout(2000); console.log('clicked suggestion'); }
// after selecting, capture buttons + any "add stop" + stop list text
const after=await p.evaluate(()=>({
  buttons:[...document.querySelectorAll('button')].map(e=>(e.innerText||'').trim()).filter(Boolean).slice(0,20),
  bodySnip: document.body.innerText.replace(/\s+/g,' ').match(/stop[^.]{0,120}/i)?.[0]||'(no stop text)'
}));
console.log('BUTTONS:',JSON.stringify(after.buttons));
console.log('STOP_TEXT:',after.bodySnip);
await p.screenshot({path:'_e2e/route_probe.png',fullPage:true});
await b.close();
