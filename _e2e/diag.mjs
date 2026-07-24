import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await (await b.newContext()).newPage();
await p.goto('http://localhost:3000/agency/register',{waitUntil:'networkidle',timeout:30000});
async function probe(email){
  await p.fill('input[name=email]', email);
  await p.waitForTimeout(1500);
  const st=await p.evaluate(()=>{
    const btn=[...document.querySelectorAll('button')].find(b=>/verify|resend/i.test(b.innerText));
    return {label:btn?btn.innerText.trim():'(none)', disabled:btn?btn.disabled:null,
            err:(document.body.innerText.match(/too many|try again|wait|rate|invalid|error[^.]*/i)||[''])[0]};
  });
  console.log(email,'=>',JSON.stringify(st));
}
await probe('infinite.storage13013+agency@gmail.com');
await probe('infinite.storage13013+agency2@gmail.com');
await b.close();
