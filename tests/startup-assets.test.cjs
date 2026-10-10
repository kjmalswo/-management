const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),section=id=>html.match(new RegExp('<script id="'+id+'"[^>]*>([\\s\\S]*?)<\\/script>'))[1];
test('single-file deployment stays below the Cloudflare static asset limit',()=>assert.ok(Buffer.byteLength(html)<25*1024*1024));
test('startup reaches the profile screen with the embedded cover and small favicon',async()=>{
 const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{id,textContent:'',innerHTML:'',content:'width=device-width, initial-scale=1',style:{setProperty(){}},dataset:{},addEventListener(){},querySelectorAll(){return []},querySelector(){return null}});return elements.get(id);};
 for(const id of ['game-db','club-emblem-assets','branding-assets','national-emblem-assets']){if(html.includes('<script id="'+id+'"'))element(id).textContent=section(id);}
 for(const id of ['app','modal-root','save-input'])element(id);
 const document={getElementById:id=>elements.get(id)||null,querySelector:sel=>sel==='meta[name="viewport"]'?element('viewport'):null,querySelectorAll:()=>[],addEventListener(){},documentElement:element('html'),body:element('body'),visibilityState:'visible'};
 const window={addEventListener(){},matchMedia:()=>({matches:false}),screen:{width:1920,height:1080},scrollTo(){}};
 const context=vm.createContext({document,window,localStorage:{getItem:()=>null,setItem(){},removeItem(){}},crypto:require('node:crypto').webcrypto,navigator:{maxTouchPoints:0,userAgent:'startup regression'},location:{protocol:'file:',href:'file:///index.html'},MutationObserver:class{observe(){}disconnect(){}},ResizeObserver:class{observe(){}disconnect(){}},matchMedia:window.matchMedia,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},queueMicrotask,URL,Intl,TextEncoder,TextDecoder,Blob,Response,CompressionStream,DecompressionStream,AbortController});
 vm.runInContext(section('game-engine')+'\n'+section('game-ui').replace('startAppUpdateChecks();bootGame();','startAppUpdateChecks();globalThis.bootPromise=bootGame();'),context);
 assert.match(element('app').innerHTML,/class="logo title-logo title-logo-loading"/);
 await context.bootPromise;
 assert.match(element('app').innerHTML,/id="profile-form"/);assert.match(element('app').innerHTML,/<img src="data:image\/webp;base64,/);assert.doesNotMatch(element('app').innerHTML,/match-loading/);
 assert.match(element('app').innerHTML,/class="logo title-logo"/);assert.match(element('app').innerHTML,/alt="Football Career 27"/);assert.doesNotMatch(element('app').innerHTML,/logo-mark/);
 assert.match(html,/<title>Football Career 27 — 축구선수 커리어<\/title>/);
 const icon=html.match(/<link rel="icon"[^>]*href="data:image\/png;base64,([^"]+)"/);assert.ok(icon);const bytes=Buffer.from(icon[1],'base64');assert.equal(bytes.readUInt32BE(16),64);assert.equal(bytes.readUInt32BE(20),64);
});
