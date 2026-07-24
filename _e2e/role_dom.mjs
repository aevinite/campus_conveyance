import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await (await b.newContext()).newPage();
await p.goto('http://localhost:3000/register',{waitUntil:'networkidle',timeout:30000});
await p.waitForTimeout(900);
const info=await p.evaluate(()=>{
  const full=document.body.innerText.replace(/\s+/g,' ');
  const hasParent=/parent/i.test(full);
  // elements literally showing Student or Parent
  const cards=[...document.querySelectorAll('button,label,div,a')].filter(e=>/^(student|parent)$/i.test((e.innerText||'').trim())).map(e=>({tag:e.tagName.toLowerCase(),txt:e.innerText.trim(),cls:(e.className||'').toString().slice(0,30)}));
  return {hasParent, cards, snippet: full.slice(0,300)};
});
console.log('hasParentText:',info.hasParent);
console.log('CARDS:',JSON.stringify(info.cards));
console.log('SNIPPET:',info.snippet);
await b.close();
