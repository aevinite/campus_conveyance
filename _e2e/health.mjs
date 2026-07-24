import { chromium } from 'playwright';
const b=await chromium.launch();
const targets=[
  ['student','_e2e/student_state.json',['/student','/student/bookings','/student/schools','/student/profile']],
  ['driver','_e2e/driver_state.json',['/driver','/driver/riders','/driver/live','/driver/buses','/driver/profile']],
  ['agency','_e2e/agency_state.json',['/agency','/agency/buses','/agency/routes','/agency/drivers','/agency/bookings','/agency/account']],
];
for(const [role,state,pages] of targets){
  const p=await (await b.newContext({storageState:state})).newPage();
  for(const path of pages){
    let chunk=false; const h=(m)=>{const t=m.text?m.text():''+m; if(/ChunkLoadError|Failed to load chunk/i.test(t))chunk=true;};
    p.on('console',h); p.on('pageerror',h);
    try{
      await p.goto('http://localhost:3000'+path,{waitUntil:'networkidle',timeout:30000});
      await p.waitForTimeout(1800);
      const txt=await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
      const err=/Something went wrong|unexpected error/i.test(txt);
      console.log(`${role} ${path} => ${err?'ERROR':'OK'}${chunk?' [chunk404]':''}`);
    }catch(e){ console.log(`${role} ${path} => NAV_ERR ${e.message.slice(0,40)}`); }
    p.removeListener('console',h); p.removeListener('pageerror',h);
  }
  await p.close();
}
await b.close();
