import { chromium } from 'playwright';
const b=await chromium.launch();
let chunk=false;
const p=await (await b.newContext({storageState:'_e2e/parent_state.json'})).newPage();
p.on('pageerror',e=>{if(/ChunkLoadError/i.test(e.message))chunk=true;});
await p.goto('http://localhost:3000/parent',{waitUntil:'networkidle',timeout:30000});
await p.waitForTimeout(3000);
const st=await p.evaluate(()=>({
  err:/Something went wrong/i.test(document.body.innerText),
  hasMap: !!document.querySelector('.leaflet-container, [class*=leaflet]'),
  txt:document.body.innerText.replace(/\s+/g,' ').slice(0,600)
}));
console.log('page error:',st.err,' chunk404:',chunk,' hasMapEl:',st.hasMap);
console.log('TXT:',st.txt);
await p.screenshot({path:'_e2e/parent_dashboard.png',fullPage:true});
await b.close();
