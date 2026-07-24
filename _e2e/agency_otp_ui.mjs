import { chromium } from 'playwright';
const EMAIL = 'infinite.storage13013+agency@gmail.com';
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
await p.goto('http://localhost:3000/agency/register', { waitUntil:'networkidle', timeout:30000 });
await p.fill('input[name=email]', EMAIL);
await p.getByRole('button', { name: /verify/i }).click();
await p.waitForTimeout(9000); // let the send resolve + OTP UI render
const state = await p.evaluate(() => {
  const inputs=[...document.querySelectorAll('input')].filter(e=>e.type!=='hidden').map(e=>({name:e.name,type:e.type,ph:e.placeholder,maxlen:e.maxLength,inputmode:e.inputMode}));
  const buttons=[...document.querySelectorAll('button')].map(e=>({txt:(e.innerText||'').trim().slice(0,30),disabled:e.disabled}));
  const body=document.body.innerText.replace(/\s+/g,' ').slice(0,500);
  return {inputs,buttons,body};
});
console.log('INPUTS:',JSON.stringify(state.inputs,null,0));
console.log('BUTTONS:',JSON.stringify(state.buttons));
console.log('TEXT:',state.body);
await b.close();
