import { chromium } from 'playwright';
const b=await chromium.launch();
const ctx=await b.newContext();
const p=await ctx.newPage();
await p.goto('http://localhost:3000/login',{waitUntil:'networkidle',timeout:30000});
await p.fill('input[name=email]','infinite.storage13013+student@gmail.com');
await p.fill('input[name=password]','DemoPass123!');
await p.getByRole('button',{name:/sign in/i}).click();
await p.waitForTimeout(6000);
const st=await p.evaluate(()=>({url:location.href, txt:document.body.innerText.replace(/\s+/g,' ').slice(0,240)}));
console.log('URL:',st.url); console.log('TXT:',st.txt);
if(!st.url.includes('/login')){ await ctx.storageState({path:'_e2e/student_state.json'}); console.log('STUDENT_LOGIN_OK'); }
else console.log('STUDENT_LOGIN_FAILED');
await b.close();
