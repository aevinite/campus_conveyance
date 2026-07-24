import { chromium } from 'playwright';
import fs from 'fs';
const EMAIL='infinite.storage13013+agency3@gmail.com', PW='DemoPass123!';
const R='_e2e/agency_result.txt';
const log=(m)=>{fs.appendFileSync(R, m+'\n');};
const b=await chromium.launch();
const p=await (await b.newContext()).newPage();
try{
  await p.goto('http://localhost:3000/agency/register',{waitUntil:'networkidle',timeout:30000});
  await p.fill('input[name=email]', EMAIL);
  const verify=p.getByRole('button',{name:/^verify$/i});
  await verify.waitFor({state:'visible',timeout:15000});
  for(let i=0;i<30 && await verify.isDisabled();i++){await p.waitForTimeout(500);}
  await verify.click();
  await p.waitForSelector('input[placeholder="6-digit code"]',{timeout:25000});
  log('OTP_SENT to '+EMAIL);
  let code=null;
  for(let i=0;i<360;i++){ if(fs.existsSync('_e2e/otp.txt')){const c=fs.readFileSync('_e2e/otp.txt','utf8').trim(); if(/^\d{6}$/.test(c)){code=c;break;}} await p.waitForTimeout(2000);}
  if(!code){log('NO_OTP_RECEIVED');await b.close();process.exit(1);}
  log('Got OTP '+code);
  await p.fill('input[placeholder="6-digit code"]', code);
  await p.getByRole('button',{name:/confirm code/i}).click();
  await p.waitForTimeout(4000);
  log('verified='+await p.evaluate(()=>document.body.innerText.toLowerCase().includes('verified')));
  const set=async(n,v)=>{const el=await p.$(`input[name=${n}]`); if(el)await el.fill(v);};
  await set('name','Demo Transit Co'); await set('contactPerson','Demo Owner'); await set('password',PW);
  await set('phone','9876500001'); await set('legalName','Demo Transit Private Limited');
  await set('registrationNo','U60200GJ2024PTC000001'); await set('gstNumber','24ABCDE1234F1Z5');
  await set('panNumber','ABCDE1234F'); await set('registeredAddress','1 Demo Road, Ahmedabad');
  // vehicle type first (checkbox, always present once unlocked)
  const cb=await p.$$('input[name=vehicleTypes]'); if(cb[0]) await cb[0].check().catch(()=>{});
  // college combobox
  await p.getByRole('button',{name:/search and select colleges/i}).click();
  await p.waitForTimeout(900);
  await p.keyboard.type('LJ'); await p.waitForTimeout(1400);
  const cand=p.getByText(/LJ University/i).first();
  if(await cand.count()){ await cand.click(); log('COLLEGE_CLICKED: LJ University'); }
  else {
    const vis=await p.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>e.offsetParent&&/University|School/i.test(e.textContent||'')&&e.children.length===0).map(e=>({tag:e.tagName.toLowerCase(),role:e.getAttribute('role')||'',txt:(e.textContent||'').trim().slice(0,30)})).slice(0,20));
    log('NO_CAND popover visible: '+JSON.stringify(vis));
  }
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  await p.screenshot({path:'_e2e/agency_filled.png',fullPage:true});
  await p.getByRole('button',{name:/submit application/i}).click();
  await p.waitForTimeout(6000);
  const after=await p.evaluate(()=>({url:location.href,txt:document.body.innerText.replace(/\s+/g,' ').slice(0,600)}));
  log('AFTER_SUBMIT_URL: '+after.url); log('AFTER_SUBMIT_TEXT: '+after.txt);
  await p.screenshot({path:'_e2e/agency_submitted.png',fullPage:true});
  log('DONE');
}catch(e){log('ERROR: '+e.message);}
await b.close();
