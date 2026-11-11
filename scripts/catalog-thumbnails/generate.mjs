import { chromium } from 'playwright';
import { mkdtemp, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '../..');
const shadcn = ['Accordion','Alert','Avatar','Badge','Button','Card','Checkbox','Input','Label','Progress','Separator','Skeleton','Slider','Switch','Tabs','Textarea'];
const shadcnVue = shadcn;
const shadcnSvelte = shadcn;
const thaw = ['Avatar','Badge','Button','Card','Checkbox','Divider','Input','Link','MessageBar','ProgressBar','Slider','Spinner','Switch','Tag','Textarea'];
let browserPath = process.env.CHROMIUM_EXECUTABLE;
if (!browserPath && process.platform === 'darwin') {
  const cache = join(process.env.HOME, 'Library/Caches/ms-playwright');
  const browsers = (await readdir(cache).catch(() => [])).filter(name => /^chromium-\d+$/.test(name)).sort((a,b) => Number(b.slice(9)) - Number(a.slice(9)));
  if (browsers[0]) browserPath = join(cache,browsers[0],'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
}
const npm = join(dirname(process.execPath), 'npm');

function run(cmd, args, cwd) {
  return new Promise((ok, fail) => {
    const child = spawn(cmd === 'npm' ? npm : cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', fail);
    child.on('exit', code => code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(' ')} exited ${code}`)));
  });
}
async function serve(cwd) {
  const child = spawn('npm', ['run','dev','--','--host','127.0.0.1'], {cwd,stdio:'ignore'});
  for (let i=0;i<90;i++) {
    try { const r=await fetch('http://127.0.0.1:5173'); if(r.ok) return child; } catch {}
    await delay(500);
  }
  child.kill(); throw new Error('Vite did not start');
}

const scratch = await mkdtemp(join(tmpdir(), 'divina-catalog-'));
const project = join(scratch, 'shadcn');
await mkdir(project, { recursive: true });
let server;
let browser;
try {
  await run('npm',['create','vite@latest','.','--','--template','react-ts','--yes'],project);
  await run('npm',['install'],project);
  await run('npm',['install','tailwindcss','@tailwindcss/vite'],project);
  await run('npm',['install','lucide-react'],project);
  await writeFile(join(project,'src/index.css'), '@import \"tailwindcss\";');
  const tsconfigPath=join(project,'tsconfig.app.json');
  await writeFile(tsconfigPath, JSON.stringify({compilerOptions:{tsBuildInfoFile:'./node_modules/.tmp/tsconfig.app.tsbuildinfo',target:'ES2022',useDefineForClassFields:true,lib:['ES2022','DOM','DOM.Iterable'],module:'ESNext',skipLibCheck:true,moduleResolution:'bundler',allowImportingTsExtensions:true,verbatimModuleSyntax:true,moduleDetection:'force',noEmit:true,jsx:'react-jsx',strict:true,baseUrl:'.',paths:{'@/*':['./src/*']}},include:['src']},null,2));
  await writeFile(join(project,'vite.config.ts'), `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nimport tailwindcss from '@tailwindcss/vite';\nimport { fileURLToPath, URL } from 'node:url';\nexport default defineConfig({plugins:[react(),tailwindcss()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}}});\n`);
  await run('npx',['shadcn@latest','init','--defaults','--yes'],project);
  await run('npx',['shadcn@latest','add',...shadcn.map(n=>n.toLowerCase()),'--yes'],project);
  await writeFile(join(project,'vite.config.ts'), `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nimport tailwindcss from '@tailwindcss/vite';\nimport { fileURLToPath, URL } from 'node:url';\nexport default defineConfig({plugins:[react(),tailwindcss()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}}});\n`);
  const cases = shadcn.map(n => {
    let body;
    if(n==='Accordion') body='<Accordion type="single" collapsible defaultValue="item-1"><AccordionItem value="item-1"><AccordionTrigger>Details</AccordionTrigger><AccordionContent>A short description.</AccordionContent></AccordionItem></Accordion>';
    else if(n==='Alert') body='<Alert><AlertTitle>Heads up</AlertTitle><AlertDescription>Here is a short message.</AlertDescription></Alert>';
    else if(n==='Avatar') body='<Avatar><AvatarFallback>JD</AvatarFallback></Avatar>';
    else if(n==='Badge') body='<Badge>Badge</Badge>';
    else if(n==='Button') body='<Button>Button</Button>';
    else if(n==='Card') body='<Card className="w-72"><CardHeader><CardTitle>Card title</CardTitle><CardDescription>A short description.</CardDescription></CardHeader></Card>';
    else if(n==='Checkbox') body='<div className="flex items-center gap-2"><Checkbox id="check" defaultChecked/><Label htmlFor="check">Accept terms</Label></div>';
    else if(n==='Input') body='<Input placeholder="Email address" className="w-64" />';
    else if(n==='Label') body='<Label>Email address</Label>';
    else if(n==='Progress') body='<Progress value={62} className="w-64" />';
    else if(n==='Separator') body='<div className="w-64 space-y-3"><div>Section title</div><Separator/><div className="text-muted-foreground">Supporting text</div></div>';
    else if(n==='Skeleton') body='<div className="flex items-center gap-4"><Skeleton className="h-12 w-12 rounded-full"/><div className="space-y-2"><Skeleton className="h-4 w-40"/><Skeleton className="h-4 w-28"/></div></div>';
    else if(n==='Slider') body='<Slider defaultValue={[42]} max={100} step={1} className="w-64" />';
    else if(n==='Switch') body='<div className="flex items-center gap-2"><Switch id="airplane" defaultChecked/><Label htmlFor="airplane">Airplane mode</Label></div>';
    else if(n==='Tabs') body='<Tabs defaultValue="account" className="w-72"><TabsList><TabsTrigger value="account">Account</TabsTrigger><TabsTrigger value="settings">Settings</TabsTrigger></TabsList><TabsContent value="account">Account settings.</TabsContent></Tabs>';
    else body='<Textarea placeholder="Type a message..." className="w-64" />';
    return `  <section data-name="${n}" style={{display:name==="${n}"?'block':'none'}}>${body}</section>`;
  }).join('\n');
  const imports = `import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './components/ui/accordion';\nimport { Alert, AlertDescription, AlertTitle } from './components/ui/alert';\nimport { Avatar, AvatarFallback } from './components/ui/avatar';\nimport { Badge } from './components/ui/badge';\nimport { Button } from './components/ui/button';\nimport { Card, CardDescription, CardHeader, CardTitle } from './components/ui/card';\nimport { Checkbox } from './components/ui/checkbox';\nimport { Input } from './components/ui/input';\nimport { Label } from './components/ui/label';\nimport { Progress } from './components/ui/progress';\nimport { Separator } from './components/ui/separator';\nimport { Skeleton } from './components/ui/skeleton';\nimport { Slider } from './components/ui/slider';\nimport { Switch } from './components/ui/switch';\nimport { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';\nimport { Textarea } from './components/ui/textarea';`;
  await writeFile(join(project,'src/App.tsx'), `${imports}\nimport './App.css';\nexport default function App(){const name=new URLSearchParams(location.search).get('name');return <main>{<>${cases}</>}</main>}`);
  await writeFile(join(project,'src/App.css'), 'html,body,#root{margin:0;width:480px;height:240px;background:#f8fafc}main{width:480px;height:240px;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:#f8fafc}section{max-width:100%}');
  await mkdir(join(project,'src'),{recursive:true});
  // shadcn's generated file paths preserve the alias text; move them into the configured Vite source tree.
  await rename(join(project,'@/components'),join(project,'src/components'));
  await rename(join(project,'@/lib'),join(project,'src/lib'));
  await rm(join(project,'@'),{recursive:true,force:true});
  server=await serve(project);
  browser=await chromium.launch({headless:true,...(browserPath?{executablePath:browserPath}:{})});
  const page=await browser.newPage({viewport:{width:480,height:240},deviceScaleFactor:1});
  for(const name of shadcn){await page.goto(`http://127.0.0.1:5173/?name=${name}`);await page.waitForTimeout(150);await page.screenshot({path:join(root,'public/catalog/shadcn',`${name}.webp`),type:'webp',quality:86});}

  const doc=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
  for (const name of thaw) await rm(join(root,'public/catalog/thaw',`${name}.webp`),{force:true});
  const skipped=[];
  await doc.goto('https://thawui.vercel.app/guide/installation');
  for(const name of thaw){
    const label=name==='MessageBar'?'Message Bar':name;
    const exactName=new RegExp(`^${label}$`);
    try {
      const category=doc.locator('.thaw-nav-category-item').filter({hasText:exactName}).first();
      if (await category.count()) {
        await category.click({timeout:10000});
        await doc.waitForTimeout(250);
        await doc.locator('.thaw-nav-sub-item').filter({hasText:exactName}).first().click({timeout:10000});
      } else {
        await doc.locator('.thaw-nav-item').filter({hasText:exactName}).first().click({timeout:10000});
      }
      await doc.waitForTimeout(700);
    } catch {
      skipped.push(name); console.warn(`Skipping Thaw ${name}: docs example not reachable`); continue;
    }
    const demo=doc.locator('.demo-demo__view').first();
    const kebab=name.replace(/[A-Z]/g,(letter,index)=>`${index?'-':''}${letter.toLowerCase()}`);
    const component=demo.locator(`[class*=\"thaw-${kebab}\"]:visible`).first();
    const destination=join(root,'public/catalog/thaw',`${name}.webp`);
    try {
      const image=await component.screenshot({type:'png',timeout:5000});
      await sharp(image).resize(440,180,{fit:'contain',background:'#ffffff'}).extend({top:30,bottom:30,left:20,right:20,background:'#ffffff'}).webp({quality:85}).toFile(destination);
    } catch {
      skipped.push(name); await rm(destination,{force:true}); console.warn(`Skipping Thaw ${name}: no visible rendered example`);
    }
  }
  if (skipped.length) console.warn(`Skipped Thaw thumbnails: ${skipped.join(', ')}`);

  const docsSkipped = { 'shadcn-vue': [], 'shadcn-svelte': [] };
  const docsLibraries = [
    ['shadcn-vue', shadcnVue, 'https://www.shadcn-vue.com/docs/components'],
    ['shadcn-svelte', shadcnSvelte, 'https://shadcn-svelte.com/docs/components'],
  ];
  for (const [library, names, base] of docsLibraries) {
    await mkdir(join(root, 'public/catalog', library), { recursive: true });
    const docsPage = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    for (const name of names) {
      const destination = join(root, 'public/catalog', library, `${name}.webp`);
      await rm(destination, { force: true });
      try {
        const kebab = name.replace(/[A-Z]/g, (letter, index) => `${index ? '-' : ''}${letter.toLowerCase()}`);
        await docsPage.goto(`${base}/${kebab}`, { waitUntil: 'networkidle', timeout: 30000 });
        const preview = docsPage.locator('[data-slot="component-preview"]').first().locator('[data-slot="preview"]').last();
        await preview.waitFor({ state: 'visible', timeout: 10000 });
        const image = await preview.screenshot({ type: 'png', timeout: 10000 });
        await sharp(image).resize(440, 180, { fit: 'contain', background: '#ffffff' }).extend({ top: 30, bottom: 30, left: 20, right: 20, background: '#ffffff' }).webp({ quality: 85 }).toFile(destination);
      } catch {
        docsSkipped[library].push(name);
        await rm(destination, { force: true });
        console.warn(`Skipping ${library} ${name}: docs preview not reachable`);
      }
    }
    await docsPage.close();
  }
  for (const [library, names] of Object.entries(docsSkipped)) {
    if (names.length) console.warn(`Skipped ${library} thumbnails: ${names.join(', ')}`);
  }
  for (const [library, names] of docsLibraries) {
    const files = await readdir(join(root, 'public/catalog', library)).catch(() => []);
    console.log(`${library}: ${files.filter(file => file.endsWith('.webp')).length} thumbnails generated`);
  }
} finally {
  await browser?.close(); server?.kill(); await rm(scratch,{recursive:true,force:true});
}
