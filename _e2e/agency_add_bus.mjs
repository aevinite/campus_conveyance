import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await (await b.newContext({storageState:'_e2e/agency_state.json'})).newPage();
await p.goto('http://localhost:3000/agency/add-bus',{waitUntil:'networkidle',timeout:30000});
await p.waitForTimeout(1000);
const set=async(n,v)=>{const el=await p.$(`input[name=${n}]`); if(el) await el.fill(v);};
await set('busNumber','1'); await set('registrationNo','GJ01AB1234'); await set('capacity','40');
await set('busModel','Tata Starbus'); await set('busColor','Yellow');
// AC radio (first)
const rad=await p.$$('input[name=acType]'); if(rad[0]) await rad[0].check().catch(()=>{});
// driver text section (link by email to existing driver)
await set('driverName','Demo Driver'); await set('driverPhone','9876500002');
await set('driverLicenseNo','GJ0120210009999'); await set('driverGovtId','1111 2222 3333');
await set('driverAltPhone','9876500003'); await set('driverExperienceYears','8');
await set('driverDob','1990-05-15'); await set('driverBloodGroup','O+');
await set('driverEmail','infinite.storage13013+driver@gmail.com');
await set('driverAddress','5 Depot Lane, Ahmedabad');
await p.screenshot({path:'_e2e/bus_form.png',fullPage:true});
await p.getByRole('button',{name:/^add bus$/i}).click();
await p.waitForTimeout(6000);
const st=await p.evaluate(()=>({url:location.href, txt:document.body.innerText.replace(/\s+/g,' ')}));
const msg=st.txt.match(/(added|created|success|error[^.]{0,90}|required[^.]{0,90}|invalid[^.]{0,90}|already[^.]{0,90})/i);
console.log('URL:',st.url); console.log('MSG:',msg?msg[0]:'(none)');
await p.screenshot({path:'_e2e/bus_result.png',fullPage:true});
await b.close();
