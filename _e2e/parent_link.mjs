import { chromium } from 'playwright'; import fs from 'fs';
const CODE=fs.readFileSync('_e2e/linkcode.txt','utf8').trim();
const b=await chromium.launch();
const p=await (await b.newContext({storageState:'_e2e/parent_state.json'})).newPage();
await p.goto('http://localhost:3000/parent',{waitUntil:'networkidle',timeout:30000});
await p.waitForTimeout(1200);
// find the code input (6-digit / text)
const inp=await p.$('input[maxlength="6"], input[inputmode="numeric"], input[type=text]');
if(inp){ await inp.fill(CODE); } else console.log('no code input found');
await p.getByRole('button',{name:/link|redeem|connect|add child/i}).first().click().catch(e=>console.log('btn err',e.message));
await p.waitForTimeout(5000);
const st=await p.evaluate(()=>({url:location.href, txt:document.body.innerText.replace(/\s+/g,' ').slice(0,400)}));
console.log('CODE used:',CODE);
console.log('URL:',st.url); console.log('TXT:',st.txt);
await p.screenshot({path:'_e2e/parent_linked.png',fullPage:true});
await b.close();
