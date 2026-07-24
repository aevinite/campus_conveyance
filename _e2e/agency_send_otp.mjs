import { chromium } from 'playwright';
const EMAIL = 'infinite.storage13013+agency@gmail.com';
const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
await p.goto('http://localhost:3000/agency/register', { waitUntil:'networkidle', timeout:30000 });
await p.fill('input[name=email]', EMAIL);
// click the Verify button
await p.getByRole('button', { name: /verify/i }).click();
await p.waitForTimeout(4000);
// capture visible text + any new inputs (OTP field)
const state = await p.evaluate(() => {
  const inputs = [...document.querySelectorAll('input')].map(el=>({name:el.name,type:el.type,ph:el.placeholder,maxlen:el.maxLength}));
  const body = document.body.innerText.replace(/\s+/g,' ').slice(0,600);
  return { inputs, body };
});
console.log('EMAIL USED:', EMAIL);
console.log('INPUTS:', JSON.stringify(state.inputs));
console.log('PAGE TEXT:', state.body);
await p.screenshot({ path:'_e2e/agency_otp.png', fullPage:true });
await b.close();
