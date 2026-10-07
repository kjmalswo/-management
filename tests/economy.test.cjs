const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const section=id=>html.match(new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`))[1];
const DB=JSON.parse(section('game-db')),ui=section('game-ui'),ctx=vm.createContext({});
new vm.Script(ui);
vm.runInContext(section('game-engine')+';globalThis.C=FootballCore;',ctx);
const C=ctx.C;const moneyInputSource=ui.slice(ui.indexOf('function moneyInputNumber('),ui.indexOf('function contractNumberField('));
const validators=ui.slice(ui.indexOf('function validateDB('),ui.indexOf('function toast('));
const imports=ui.slice(ui.indexOf('function prepareImportedCareer('),ui.indexOf('async function restoreCareer('));
vm.runInContext(`const DEFAULT_DB=${JSON.stringify(DB)};const Core=FootballCore;const t=key=>key;${validators}${imports};globalThis.V={validateDB,validateSave,validateEconomySave,prepareImportedCareer};`,ctx);
const profile={...C.clone(DB.profile.defaults),name:'경제 검증 선수',stats:Object.fromEntries(DB.attributes.map(a=>[a.id,a.initial]))};
const offer=C.startingOffers(DB,profile)[0],base=C.createCareer(DB,profile,offer.route.id,offer.club.id);
const create=(fund=0)=>{const s=C.clone(base);if(fund)C.careerIncome(DB,s,fund,'signingBonus');return s;};
const plain=v=>JSON.parse(JSON.stringify(v));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} ≠ ${b}`);
const days=(db,s,count)=>{s.date=C.dateAdd(s.date,count);C.settleEconomy(db,s);};
const validate=s=>{ctx.V.validateEconomySave(DB,s);return true;};

test('daily football earnings become spendable cash without reducing cumulative earnings',()=>{
 const s=create(),w=s.player.contract.weekly;C.advanceTrainingDays(DB,s,C.dateAdd(s.date,7),false);
 near(s.player.earned,w);near(s.economy.cash,w);assert.equal(s.economy.ledger.length,1);
 C.careerIncome(DB,s,100,'appearanceBonus');C.careerIncome(DB,s,75,'goalBonus');C.careerIncome(DB,s,500,'signingBonus');C.careerIncome(DB,s,90,'loyaltyBonus');
 near(s.economy.cash,w+765);near(s.player.earned,w+765);assert.ok(ctx.V.validateSave({schema:DB.meta.schema,db:DB,state:s}));
});
test('commercial obligations use signing-date deadlines, exclusivity and one payment per period',()=>{
 const s=create(1000);s.player.reputation=DB.rules.scale;days(DB,s,7);
 const c=C.signCommercial(DB,s,'local-boots','light');assert.ok(c);assert.equal(C.signCommercial(DB,s,'pro-boots','balanced'),false);
 assert.equal(C.commercialDelivery(DB,s,c.id),true);assert.equal(C.commercialDelivery(DB,s,c.id),false);
 days(DB,s,29);assert.equal(s.economy.ledger.filter(x=>x.type==='commercialPayment').length,0);
 days(DB,s,1);const payments=s.economy.ledger.filter(x=>x.type==='commercialPayment');assert.equal(payments.length,1);near(payments[0].amount,c.terms.payment);assert.equal(c.delivered,false);assert.equal(c.nextDue,C.dateAdd(c.start,60));
 const snapshot=JSON.stringify(s.economy);C.settleEconomy(DB,s);assert.equal(JSON.stringify(s.economy),snapshot);assert.ok(validate(s));
 const before=s.economy.cash,fee=C.commercialCancelFee(DB,s,c.id);assert.ok(C.cancelCommercial(DB,s,c.id));near(s.economy.cash,before-fee);assert.equal(s.economy.contractHistory[0].status,'cancelled');assert.ok(validate(s));
});
test('advertising pays only after delivery and repeated missed duties terminate sponsorships',()=>{
 const s=create(10000);s.player.reputation=DB.rules.scale;const ad=C.signCommercial(DB,s,'tech-ad','balanced'),sponsor=C.signCommercial(DB,s,'local-boots','balanced');
 assert.ok(ad&&sponsor);days(DB,s,30);assert.equal(s.economy.contractHistory.find(c=>c.id===ad.id).status,'completed');assert.equal(s.economy.ledger.filter(x=>x.type==='commercialPayment').length,0);
 days(DB,s,60);assert.equal(s.economy.contractHistory.find(c=>c.id===sponsor.id).status,'terminated');assert.equal(s.economy.contracts.length,0);assert.ok(validate(s));
});
test('assets debit full purchase cost, have prorated rent/upkeep and one occupied home',()=>{
 const db=C.clone(DB);db.economyRules.vacancyChance=0;const s=create(DB.economyRules.assets.find(a=>a.id==='apartment').price*3),earned=s.player.earned;days(db,s,29);
 const a=C.buyAsset(db,s,'apartment'),b=C.buyAsset(db,s,'apartment');assert.ok(a&&b);assert.ok(C.assetUse(db,s,a.id,'personal'));
 const before=s.economy.cash;days(db,s,1);near(before-s.economy.cash,DB.economyRules.lifestyles[0].spending+DB.economyRules.lifestyles[0].rent*29/30+120*2/30-450/30);
 assert.ok(C.assetUse(db,s,b.id,'personal'));assert.equal(a.use,'rental');assert.equal(b.use,'personal');assert.equal(s.player.earned,earned);
 const cash=s.economy.cash,value=a.value*(1-db.economyRules.assetSaleFee);assert.ok(C.sellAsset(db,s,a.id));near(s.economy.cash,cash+value);assert.ok(validate(s));
});
test('investment additions earn only future returns, loss and partial redemption include fees',()=>{
 const db=C.clone(DB),d=db.economyRules.investments.find(x=>x.id==='index');d.growth=-.09;d.volatility=0;d.dividend=0;const s=create(10000);
 assert.ok(C.investMoney(db,s,d.id,1000));days(db,s,29);const old=s.economy.investments[0].value;
 assert.ok(C.investMoney(db,s,d.id,1000));days(db,s,1);const a=s.economy.investments[0];near(a.value,(old+1000)*Math.pow(1+d.growth,1/db.economyRules.periodDays));assert.ok(a.value<a.basis);
 const cash=s.economy.cash,proceeds=a.value*.5*(1-d.fee),basis=a.basis;assert.ok(C.redeemInvestment(db,s,d.id,.5));near(s.economy.cash,cash+proceeds);near(a.basis,basis*.5);
 const snapshot=JSON.stringify(s.economy);assert.equal(C.investMoney(db,s,d.id,NaN),false);assert.equal(C.redeemInvestment(db,s,d.id,2),false);assert.equal(JSON.stringify(s.economy),snapshot);assert.ok(validate(s));
});
test('brand income and losses accrue only for operating days, sale settles outstanding costs',()=>{
 const s=create(100000);s.player.reputation=DB.rules.scale;days(DB,s,29);const b=C.foundBrand(DB,s,'streetwear','선수 브랜드','online');assert.ok(b);days(DB,s,1);assert.ok(b.lastRevenue>0&&b.lastRevenue<b.equity*.01);assert.ok(b.profit>0);
 const capital=b.equity;assert.ok(C.brandAction(DB,s,b.id,'expand'));assert.ok(b.equity>capital);assert.ok(C.brandAction(DB,s,b.id,'marketing'));assert.equal(C.brandAction(DB,s,b.id,'marketing'),false);
 days(DB,s,2);const expected=s.economy.cash+b.pendingRevenue-b.pendingCost+b.equity*DB.economyRules.brandSaleShare;assert.ok(C.brandAction(DB,s,b.id,'sell'));near(s.economy.cash,expected);assert.equal(s.economy.brands.length,0);assert.ok(validate(s));
 const loss=create(30000);loss.player.reputation=0;const cafe=C.foundBrand(DB,loss,'coffee','저수요 카페','flagship');days(DB,loss,15);assert.ok(cafe.pendingCost>cafe.pendingRevenue);const before=loss.economy.cash;const proceeds=cafe.equity*DB.economyRules.brandSaleShare+cafe.pendingRevenue-cafe.pendingCost;assert.ok(C.brandAction(DB,loss,cafe.id,'sell'));near(loss.economy.cash,before+proceeds);
});
test('living costs follow actual choices and unpaid bills are repaid by the next income',()=>{
 const simple=DB.economyRules.lifestyles.find(d=>d.id==='simple'),star=DB.economyRules.lifestyles.find(d=>d.id==='star'),simpleCost=simple.rent+simple.spending;const s=create();days(DB,s,30);near(s.economy.arrears,simpleCost);assert.equal(C.investMoney(DB,s,'deposit',100),false);C.careerIncome(DB,s,simpleCost+320,'salary');near(s.economy.arrears,0);near(s.economy.cash,320);assert.ok(validate(s));
 const changed=create(simpleCost+star.rent+star.spending);days(DB,changed,15);C.lifestyleChange(DB,changed,'star');days(DB,changed,15);near(changed.economy.spent,simpleCost/2+(star.rent+star.spending)/2);assert.ok(validate(changed));
});
test('legacy migration preserves player, fixtures and custom DB rules and credits earnings once',()=>{
 const s=create(12345),old=C.clone(DB);delete s.economy;delete old.economyRules;old.economyRules=undefined;old.ui.tabs=old.ui.tabs.filter(t=>!DB.ui.navigationGroups.find(g=>g.id==='economy').views.includes(t.id));old.ui.navigationGroups=old.ui.navigationGroups.filter(g=>g.id!=='economy');old.scoutingRules.minRating=6.43;
 const before=JSON.stringify({player:s.player,fixtures:s.fixtures,date:s.date}),loaded=ctx.V.prepareImportedCareer({schema:DB.meta.schema,db:old,state:s});assert.equal(JSON.stringify({player:loaded.state.player,fixtures:loaded.state.fixtures,date:loaded.state.date}),before);near(loaded.state.economy.cash,12345);assert.equal(loaded.db.scoutingRules.minRating,6.43);assert.ok(loaded.db.ui.navigationGroups.some(g=>g.id==='economy'));
 const again=ctx.V.prepareImportedCareer(loaded);assert.deepEqual(plain(again.state.economy),plain(loaded.state.economy));assert.equal(s.economy,undefined);
});
test('economic saves round-trip and reject broken balances, references, dates and duplicates',()=>{
 const s=create(DB.economyRules.assets.find(a=>a.id==='apartment').price*3);s.player.reputation=DB.rules.scale;C.buyAsset(DB,s,'apartment');C.investMoney(DB,s,'deposit',1000);C.foundBrand(DB,s,'streetwear','저장 브랜드','online');C.signCommercial(DB,s,'local-boots','light');days(DB,s,10);
 const saved={schema:DB.meta.schema,db:C.clone(DB),state:s},loaded=ctx.V.prepareImportedCareer(saved);assert.deepEqual(plain(loaded.state.economy),plain(s.economy));
 for(const mutate of [e=>e.cash=-1,e=>e.cash+=100,e=>e.assets[0].definition='missing',e=>e.investments.push(C.clone(e.investments[0])),e=>e.brands[0].lastValued='2026-02-31',e=>e.contracts[0].terms.cancelShare=2]){const broken=C.clone(saved);mutate(broken.state.economy);assert.throws(()=>ctx.V.prepareImportedCareer(broken),/economy/);}
 const removed=C.clone(DB);removed.economyRules.assets=removed.economyRules.assets.filter(a=>a.id!=='apartment');assert.throws(()=>ctx.V.validateDB(removed,s),/economy/);
});
test('finance pages render holdings inside their menus and escape custom brand names',()=>{
 const s=create(DB.economyRules.assets.find(a=>a.id==='apartment').price*3);s.player.reputation=DB.rules.scale;C.buyAsset(DB,s,'apartment');C.investMoney(DB,s,'deposit',1000);C.foundBrand(DB,s,'streetwear','<img onerror=bad>','online');
 const viewCtx=vm.createContext({DB,C,state:s,preferences:{currency:'EUR'},currencyRate:()=>1,document:{addEventListener(){}},FormData});
 vm.runInContext(`const Core=C;const h=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const t=(k,v={})=>String(DB.ui.labels[k]||k).replace(/\\{(\\w+)\\}/g,(_,x)=>v[x]??'');const n=x=>String(x);const money=x=>String(x);const badge=x=>'<span>'+h(x)+'</span>';const btn=(l,a,d='')=>'<button data-action="'+a+'" '+d+'>'+h(l)+'</button>';const detail=(l,v)=>'<p>'+h(l)+': '+h(v)+'</p>';const kpi=detail;${moneyInputSource}${ui.slice(ui.indexOf('function financeButton('),ui.indexOf('let sectionVisits='))};globalThis.views={financesView,commercialView,investmentsView,assetsView,brandsView,lifestyleView};`,viewCtx);
 for(const fn of Object.values(viewCtx.views))assert.ok(fn().length>100);
 assert.ok(viewCtx.views.assetsView().includes(DB.economyRules.assets[0].name));assert.ok(viewCtx.views.assetsView().includes('data-operation="asset-use"'));assert.ok(!viewCtx.views.financesView().includes('data-operation="asset-use"'));assert.ok(viewCtx.views.brandsView().includes('&lt;img onerror=bad&gt;'));assert.ok(!viewCtx.views.brandsView().includes('<img onerror=bad>'));
});
test('real product prices include purchase fees across dates and migrate only default prices',()=>{
 const s=create(3000000),totals={'daily-car':211200,supercar:249800,watch:9800,yacht:1895000};
 for(const [id,total] of Object.entries(totals)){
  near(C.assetPrice(DB,s,id)*(1+DB.economyRules.assetPurchaseFee),total);const cash=s.economy.cash,a=C.buyAsset(DB,s,id);assert.ok(a);near(cash-s.economy.cash,total);near(a.basis,total);near(a.value,total/(1+DB.economyRules.assetPurchaseFee));
 }
 const savedAtPurchase=C.clone(s);days(DB,s,60);for(const [id,total] of Object.entries(totals))near(C.assetPrice(DB,s,id)*(1+DB.economyRules.assetPurchaseFee),total);assert.ok(s.economy.assets.find(a=>a.definition==='daily-car').value<211200/(1+DB.economyRules.assetPurchaseFee));assert.ok(validate(s));
 const old=C.clone(DB);delete old.economyRules.assetPriceReferences;delete old.economyRules.catalogUpgrade.assetPrices;for(const d of old.economyRules.assets)if(totals[d.id]){d.price=DB.economyRules.catalogUpgrade.assetPrices[d.id];delete d.priceIncludesPurchaseFee;}
 old.economyRules.assets.find(d=>d.id==='watch').price=7777;old.ui.labels.investmentFeeHint=DB.economyRules.catalogUpgrade.previousLabels.investmentFeeHint;const before=JSON.stringify(savedAtPurchase.economy),loaded=ctx.V.prepareImportedCareer({schema:DB.meta.schema,db:old,state:savedAtPurchase});assert.equal(JSON.stringify(loaded.state.economy),before);assert.equal(loaded.db.ui.labels.investmentFeeHint,DB.ui.labels.investmentFeeHint);assert.equal(loaded.db.economyRules.assets.find(d=>d.id==='watch').price,7777);assert.equal(loaded.db.economyRules.assets.find(d=>d.id==='watch').priceIncludesPurchaseFee,undefined);near(C.assetPrice(loaded.db,s,'yacht')*(1+loaded.db.economyRules.assetPurchaseFee),totals.yacht);
 const again=ctx.V.prepareImportedCareer(loaded);assert.deepEqual(plain(again),plain(loaded));
});
test('investment forms accept selected EUR USD KRW amounts and debit the same base amount plus fee',()=>{
 const s=create(10000),events={},preferences={currency:'EUR'};
 class InputData{constructor(form){this.form=form;}get(key){return this.form.values[key];}}
 const viewCtx=vm.createContext({DB,C,state:s,preferences,storageLoading:false,matchLoading:false,calendarLoading:false,document:{addEventListener(type,fn){events[type]=fn;}},FormData:InputData,currencyRate:()=>DB.settings.currencies.find(c=>c.id===preferences.currency).rate});
 vm.runInContext(`const Core=C;const h=x=>String(x??'');const t=(k,v={})=>String(DB.ui.labels[k]||k).replace(/\\{(\\w+)\\}/g,(_,x)=>v[x]??'');const n=x=>String(x);const money=x=>String(x);const badge=h;const btn=h;const detail=(l,v)=>l+': '+v;const persist=()=>{};const render=()=>{};const toast=()=>{};${moneyInputSource}${ui.slice(ui.indexOf('function financeButton('),ui.indexOf('let sectionVisits='))};globalThis.views={investmentsView,investmentAmountInBase,formatMoneyInput};`,viewCtx);
 const d=DB.economyRules.investments[0];
 for(const unit of DB.settings.currencies){
  preferences.currency=unit.id;const markup=viewCtx.views.investmentsView();assert.ok(markup.includes('data-currency="'+unit.id+'"'));assert.ok(markup.includes('min="'+Number((d.minimum*unit.rate).toPrecision(15))+'"'));assert.ok(markup.includes('max="'+Number((DB.economyRules.maxTransaction*unit.rate).toPrecision(15))+'"'));assert.ok(markup.includes('value="'+viewCtx.views.formatMoneyInput(Number((d.minimum*unit.rate).toPrecision(15)))+'"'));assert.ok(markup.includes('data-money-input'));
  const form={dataset:{financeForm:'invest',id:d.id,currency:unit.id},values:{amount:viewCtx.views.formatMoneyInput(500*unit.rate)},querySelectorAll:()=>[],reportValidity:()=>true};near(viewCtx.views.investmentAmountInBase(form,form.values.amount),500);assert.equal(viewCtx.views.investmentAmountInBase(form,Number((d.minimum*unit.rate).toPrecision(15))),d.minimum);const cash=s.economy.cash,held=s.economy.investments.find(a=>a.definition===d.id)?.value||0;
  events.submit({target:{closest:()=>form},preventDefault(){}});near(cash-s.economy.cash,500*(1+d.fee));near(s.economy.investments.find(a=>a.definition===d.id).value-held,500);
  assert.equal(C.investMoney(DB,s,d.id,viewCtx.views.investmentAmountInBase(form,(d.minimum-1)*unit.rate)),false);assert.equal(C.investMoney(DB,s,d.id,viewCtx.views.investmentAmountInBase(form,(DB.economyRules.maxTransaction+1)*unit.rate)),false);
 }
 assert.ok(Number.isNaN(viewCtx.views.investmentAmountInBase({dataset:{currency:'invalid'}},100)));assert.ok(ui.includes("Core.investMoney(DB,state,id,investmentAmountInBase(form,fields.get('amount')))"));assert.ok(validate(s));
});
test('property totals match 25 and 180 hundred-million KRW and old property and commercial defaults migrate safely',()=>{
 const s=create(20000000),rate=DB.settings.currencies.find(c=>c.id==='KRW').rate;
 for(const [id,krw] of [['apartment',2500000000],['villa',18000000000]]){const total=C.assetPrice(DB,s,id)*(1+DB.economyRules.assetPurchaseFee);assert.ok(Math.abs(total*rate-krw)<.01);const before=s.economy.cash,a=C.buyAsset(DB,s,id);assert.ok(a);near(before-s.economy.cash,total);near(a.basis,total);}
 const old=C.clone(DB);for(const id of ['apartment','villa']){const d=old.economyRules.assets.find(d=>d.id===id);d.price=DB.economyRules.catalogUpgrade.assetPrices[id];delete d.priceIncludesPurchaseFee;delete old.economyRules.catalogUpgrade.assetPrices[id];delete old.economyRules.assetPriceReferences[id];}
 for(const d of old.economyRules.commercial){d.name=DB.economyRules.catalogUpgrade.commercialNames[d.id];d.description=DB.economyRules.catalogUpgrade.commercialDescriptions[d.id];}delete old.economyRules.catalogUpgrade.commercialNames;delete old.economyRules.catalogUpgrade.commercialDescriptions;old.economyRules.commercial.find(d=>d.id==='nutrition').name='개인 후원사';const before=JSON.stringify(s.economy),loaded=ctx.V.prepareImportedCareer({schema:DB.meta.schema,db:old,state:s});assert.equal(JSON.stringify(loaded.state.economy),before);assert.equal(loaded.db.economyRules.commercial.find(d=>d.id==='nutrition').name,'개인 후원사');assert.equal(loaded.db.economyRules.commercial.find(d=>d.id==='elite-boots').name,'나이키');assert.equal(loaded.db.economyRules.assets.find(d=>d.id==='villa').priceIncludesPurchaseFee,true);assert.ok(Math.abs(C.assetPrice(loaded.db,s,'apartment')*(1+DB.economyRules.assetPurchaseFee)*rate-2500000000)<.01);
 const bad=C.clone(loaded);bad.state.inbox.push({id:'bad-retention',date:s.date,subject:'제안',body:'제안',read:false,action:'renewal',retentionUntil:s.date,retentionTerms:{weekly:NaN}});assert.throws(()=>ctx.V.prepareImportedCareer(bad));
});
