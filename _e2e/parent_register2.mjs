import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await (await b.newContext()).newPage();
await p.goto('http://localhost:3000/register',{waitUntil:'networkidle',timeout:30000});
await p.waitForTimeout(900);
// open role dropdown
await p.getByRole('button',{name:'Student'}).click();
await p.waitForTimeout(700);
// select Parent option
let ok=false;
for(const loc of [p.getByRole('option',{name:/parent/i}), p.getByText(/^parent$/i)]){
  if(await loc.count()){ try{ await loc.first().click(); ok=true; break; }catch{} }
}
await p.waitForTimeout(500);
const role=await p.evaluate(()=>document.querySelector('input[name=role]')?.value);
console.log('picked Parent:',ok,' role field=',role);
if(role!=='PARENT'){ console.log('ROLE_NOT_SET, aborting'); await b.close(); process.exit(1); }
await p.fill('input[name=fullName]','Demo Parent');
await p.fill('input[name=email]','infinite.storage13013+parent2@gmail.com');
await p.fill('input[name=password]','DemoPass123!');
await p.getByRole('button',{name:/create account/i}).click();
await p.waitForTimeout(6000);
const st=await p.evaluate(()=>({url:location.href, txt:document.body.innerText.replace(/\s+/g,' ').slice(0,200)}));
console.log('URL:',st.url); console.log('TXT:',st.txt);
await b.close();
