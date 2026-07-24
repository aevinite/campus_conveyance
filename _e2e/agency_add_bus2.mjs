import { chromium } from 'playwright';
import path from 'path';
const abs=(f)=>path.resolve('_e2e',f);
const b=await chromium.launch();
const p=await (await b.newContext({storageState:'_e2e/agency_state.json'})).newPage();
await p.goto('http://localhost:3000/agency/add-bus',{waitUntil:'networkidle',timeout:30000});
await p.waitForTimeout(1000);
const set=async(n,v)=>{const el=await p.$(`input[name=${n}]`); if(el) await el.fill(v);};
await set('busNumber','1'); await set('registrationNo','GJ01AB1234'); await set('capacity','40');
await set('busModel','Tata Starbus'); await set('busColor','Yellow');
const rad=await p.$$('input[name=acType]'); if(rad[0]) await rad[0].check().catch(()=>{});
// upload 5 bus photos (first file input)
await p.locator('input[type=file]').first().setInputFiles([abs('bus1.png'),abs('bus2.png'),abs('bus3.png'),abs('bus4.png'),abs('bus5.png')]);
await p.waitForTimeout(1500);
await set('driverName','Demo Driver'); await set('driverPhone','9876500002');
await set('driverLicenseNo','GJ0120210009999'); await set('driverGovtId','1111 2222 3333');
await set('driverExperienceYears','8'); await set('driverDob','1990-05-15'); await set('driverBloodGroup','O+');
await set('driverAddress','5 Depot Lane, Ahmedabad');
// Driver login account dropdown -> Demo Driver
try{
  await p.locator('button:has-text("Not assigned")').first().click();
  await p.waitForTimeout(700);
  const opt=p.getByText(/Demo Driver/i).first();
  if(await opt.count()) await opt.click();
  await p.waitForTimeout(400);
}catch(e){ console.log('driver-dd err',e.message); }
const photoCount=await p.evaluate(()=>{const m=document.body.innerText.match(/(\d+)\s+photos? added/i);return m?m[1]:'?';});
console.log('photos added:',photoCount);
await p.getByRole('button',{name:/^add bus$/i}).click();
await p.waitForTimeout(12000);
const st=await p.evaluate(()=>({url:location.href, txt:document.body.innerText.replace(/\s+/g,' ').match(/(at least 5|required|error[^.]{0,80}|added|success)/i)?.[0]||'(none)'}));
console.log('URL:',st.url); console.log('MSG:',st.txt);
await p.screenshot({path:'_e2e/bus_result2.png',fullPage:true});
await b.close();
