import { chromium } from 'playwright';
const routes = ['/agency/register', '/register', '/login', '/driver/login'];
const b = await chromium.launch();
const p = await b.newPage();
for (const r of routes) {
  try {
    const resp = await p.goto('http://localhost:3000'+r, { waitUntil:'networkidle', timeout:30000 });
    await p.waitForTimeout(800);
    const fields = await p.evaluate(() => {
      const out = [];
      document.querySelectorAll('input,select,textarea,button,[role=combobox]').forEach(el => {
        out.push({ tag: el.tagName.toLowerCase(), type: el.type||'', name: el.name||'', ph: el.placeholder||'', txt: (el.innerText||'').trim().slice(0,30) });
      });
      return out;
    });
    console.log('\n==== '+r+' (status '+(resp&&resp.status())+') ====');
    for (const f of fields) console.log(JSON.stringify(f));
  } catch(e) { console.log('\n==== '+r+' ERROR: '+e.message); }
}
await b.close();
