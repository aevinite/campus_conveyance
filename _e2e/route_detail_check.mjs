import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await (await b.newContext({storageState:'_e2e/student_state.json'})).newPage();
const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
p.on('pageerror',e=>errs.push('PAGEERR: '+e.message.slice(0,160)));
for(let i=1;i<=2;i++){
  await p.goto('http://localhost:3000/student/routes/30f5f518-1dbf-477d-9c65-9312c9d53032',{waitUntil:'networkidle',timeout:30000});
  await p.waitForTimeout(2500);
  const t=await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,200));
  console.log('try'+i+' url:',p.url(),'| text:',t);
}
console.log('CONSOLE_ERRORS:',JSON.stringify(errs.slice(0,6)));
await p.screenshot({path:'_e2e/route_detail_err.png',fullPage:true});
await b.close();
