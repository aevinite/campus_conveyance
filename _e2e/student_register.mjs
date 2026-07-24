import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await (await b.newContext()).newPage();
await p.goto('http://localhost:3000/register',{waitUntil:'networkidle',timeout:30000});
await p.waitForTimeout(800);
await p.fill('input[name=fullName]','Demo Student');
await p.fill('input[name=email]','infinite.storage13013+student@gmail.com');
await p.fill('input[name=password]','DemoPass123!');
// ensure Student role selected (default shows "Student" button)
try{ const s=p.getByRole('button',{name:/^student$/i}); if(await s.count()) await s.first().click(); }catch{}
await p.getByRole('button',{name:/create account/i}).click();
await p.waitForTimeout(6000);
const st=await p.evaluate(()=>({url:location.href, txt:document.body.innerText.replace(/\s+/g,' ').slice(0,300)}));
console.log('URL:',st.url); console.log('TXT:',st.txt);
await p.screenshot({path:'_e2e/student_register.png',fullPage:true});
await b.close();
