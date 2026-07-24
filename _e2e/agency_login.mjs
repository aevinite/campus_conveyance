import { chromium } from 'playwright';
import fs from 'fs';
const b=await chromium.launch();
const ctx=await b.newContext();
const p=await ctx.newPage();
await p.goto('http://localhost:3000/agency/login',{waitUntil:'networkidle',timeout:30000});
await p.fill('input[name=email]','infinite.storage13013+agency3@gmail.com');
await p.fill('input[name=password]','DemoPass123!');
await p.getByRole('button',{name:/login|sign in/i}).click();
await p.waitForTimeout(6000);
const st=await p.evaluate(()=>({url:location.href, txt:document.body.innerText.replace(/\s+/g,' ').slice(0,300)}));
console.log('URL:',st.url);
console.log('TXT:',st.txt);
if(!st.url.includes('/agency/login')){ await ctx.storageState({path:'_e2e/agency_state.json'}); console.log('LOGIN_OK, state saved'); }
else console.log('LOGIN_FAILED (still on login)');
await b.close();
