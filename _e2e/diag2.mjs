import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await (await b.newContext()).newPage();
await p.goto('http://localhost:3000/agency/register',{waitUntil:'networkidle',timeout:30000});
await p.fill('input[name=email]','infinite.storage13013+agency@gmail.com');
const v=p.getByRole('button',{name:/^verify$/i});
for(let i=0;i<20 && await v.isDisabled();i++) await p.waitForTimeout(400);
await v.click();
await p.waitForTimeout(6000);
const st=await p.evaluate(()=>({
  hasOtp: !!document.querySelector('input[placeholder="6-digit code"]'),
  body: document.body.innerText.replace(/\s+/g,' ').slice(0,400)
}));
console.log('hasOtpInput:', st.hasOtp);
console.log('BODY:', st.body);
await b.close();
