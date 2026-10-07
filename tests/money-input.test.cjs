const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),section=id=>html.match(new RegExp('<script id="'+id+'"[^>]*>([\\s\\S]*?)<\\/script>'))[1],DB=JSON.parse(section('game-db')),ui=section('game-ui');new vm.Script(ui);
const handlers=[],preferences={currency:'EUR'},context=vm.createContext({DB,preferences,h:v=>String(v),t:(key,values={})=>DB.ui.labels[key].replace(/\{(\w+)\}/g,(_,k)=>values[k]??''),currencyRate:()=>DB.settings.currencies.find(c=>c.id===preferences.currency).rate,document:{addEventListener(type,fn){if(type==='input')handlers.push(fn);}}});
vm.runInContext(ui.slice(ui.indexOf('function moneyInputNumber('),ui.indexOf('function negotiation('))+';globalThis.api={moneyInputNumber,formatMoneyInput,moneyNumberInput,validateMoneyInput,contractNumberField};',context);const A=context.api;
function input(value,start=value.length){return {value,selectionStart:start,selectionEnd:start,dataset:{moneyMin:'0',moneyMax:'18000000000'},validity:{valid:true},matches:q=>q==='[data-money-input]',setCustomValidity(message){this.error=message;this.validity.valid=!message;},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},closest:()=>null};}
test('money input grouping preserves decimal amounts, pasted separators and cursor positions',()=>{
 for(const [value,formatted] of [['2500000000','2,500,000,000'],['18000000000','18,000,000,000'],['1234.50','1,234.50'],['1,234,567','1,234,567'],['',''],['-1234','-1,234'],['1234.','1,234.']])assert.equal(A.formatMoneyInput(value),formatted);
 assert.equal(A.moneyInputNumber('2,500,000,000'),2500000000);assert.equal(A.moneyInputNumber('1,234.50'),1234.5);for(const bad of ['','abc','10abc','1.2.3','1e3'])assert.ok(Number.isNaN(A.moneyInputNumber(bad)));
 const end=input('1234');handlers[0]({target:end});assert.equal(end.value,'1,234');assert.equal(end.selectionStart,5);
 const middle=input('12345',3);handlers[0]({target:middle});assert.equal(middle.value,'12,345');assert.equal(middle.value.slice(0,middle.selectionStart).replaceAll(',',''),'123');
 const composing=input('1234');handlers[0]({target:composing,isComposing:true});assert.equal(composing.value,'1234');
});
test('money inputs retain minimum maximum required and numeric checks',()=>{
 const field=input('99');field.dataset.moneyMin='100';assert.equal(A.validateMoneyInput(field),false);field.value='100';assert.equal(A.validateMoneyInput(field),true);field.value='18,000,000,001';assert.equal(A.validateMoneyInput(field),false);field.value='bad';assert.equal(A.validateMoneyInput(field),false);field.value='';A.validateMoneyInput(field);assert.equal(field.error,'');
 field.value='110';field.dataset.moneyMin=String(100*1.1);assert.equal(A.validateMoneyInput(field),true);assert.ok(A.moneyNumberInput('amount',1000,100,2000).includes('value="1,000"'));assert.ok(A.moneyNumberInput('amount',1000,100,2000).includes('required'));
});
test('all contract money fields use grouping in every currency and stay synchronized with sliders',()=>{
 const moneyFields=DB.dealFields.filter(f=>f.type==='money'),d={terms:Object.fromEntries(DB.dealFields.map(f=>[f.id,1000])),buyer:{maxWeekly:5000}};
 for(const unit of DB.settings.currencies){preferences.currency=unit.id;for(const f of moneyFields){const markup=A.contractNumberField(f,d);assert.ok(markup.includes('data-money-input'));assert.ok(markup.includes('value="'+A.formatMoneyInput(Number((1000*unit.rate).toFixed(DB.settings.moneyInputDigits)))+'"'));}}
 const numeric=DB.dealFields.find(f=>f.type==='number');if(numeric)assert.ok(!A.contractNumberField(numeric,d).includes('data-money-input'));
 const amount=input('123456'),slider={max:'1000',value:'0'},form={elements:{namedItem:()=>amount},querySelector:()=>slider};amount.name='weekly';amount.closest=()=>form;for(const fn of handlers)fn({target:amount});assert.equal(amount.value,'123,456');assert.equal(slider.value,'123456');assert.equal(slider.max,'123456');
 const range={dataset:{contractRange:'weekly'},value:'5000',matches:()=>false,closest:()=>form};for(const fn of handlers)fn({target:range});assert.equal(amount.value,'5,000');assert.equal(amount.error,'');
 assert.ok(ui.includes("moneyInputNumber(form.get(f.id))/currencyRate()"));assert.ok(ui.includes('validateMoneyInputs(event.target)'));assert.ok(ui.includes('validateMoneyInputs(form)'));
});
