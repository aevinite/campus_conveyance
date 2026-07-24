import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await (await b.newContext()).newPage();
await p.goto('http://localhost:3000/register',{waitUntil:'networkidle',timeout:30000});
await p.waitForTimeout(900);
// pick Parent role — the role selector shows a button (default Student). Find & click Parent.
try{
  const roleBtn=p.getByRole('button',{name:/^student$/i}).first();
  if(await roleBtn.count()){ await roleBtn.click(); await p.waitForTimeout(500);
    const parent=p.getByText(/^parent$/i).first(); if(await parent.count()) await parent.click(); }
}catch(e){ console.log('role pick err',e.message); }
await p.fill('input[name=fullName]','Demo Parent');
await p.fill('input[name=email]','infinite.storage13013+parent@gmail.com');
await p.fill('input[name=password]','DemoPass123!');
const roleVal=await p.evaluate(()=>document.querySelector('input[name=role]')?.value);
console.log('role field value:', roleVal);
await p.getByRole('button',{name:/create account/i}).click();
await p.waitForTimeout(6000);
const st=await p.evaluate(()=>({url:location.href, txt:document.body.innerText.replace(/\s+/g,' ').slice(0,240)}));
console.log('URL:',st.url); console.log('TXT:',st.txt);
await b.close();
