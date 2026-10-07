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
const C=ctx.C;
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
 const db=C.clone(DB);db.economyRules.vacancyChance=0;const s=create(300000),earned=s.player.earned;days(db,s,29);
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
 const s=create(300000);s.player.reputation=DB.rules.scale;C.buyAsset(DB,s,'apartment');C.investMoney(DB,s,'deposit',1000);C.foundBrand(DB,s,'streetwear','저장 브랜드','online');C.signCommercial(DB,s,'local-boots','light');days(DB,s,10);
 const saved={schema:DB.meta.schema,db:C.clone(DB),state:s},loaded=ctx.V.prepareImportedCareer(saved);assert.deepEqual(plain(loaded.state.economy),plain(s.economy));
 for(const mutate of [e=>e.cash=-1,e=>e.cash+=100,e=>e.assets[0].definition='missing',e=>e.investments.push(C.clone(e.investments[0])),e=>e.brands[0].lastValued='2026-02-31',e=>e.contracts[0].terms.cancelShare=2]){const broken=C.clone(saved);mutate(broken.state.economy);assert.throws(()=>ctx.V.prepareImportedCareer(broken),/economy/);}
 const removed=C.clone(DB);removed.economyRules.assets=removed.economyRules.assets.filter(a=>a.id!=='apartment');assert.throws(()=>ctx.V.validateDB(removed,s),/economy/);
});
test('finance pages render holdings inside their menus and escape custom brand names',()=>{
 const s=create(300000);s.player.reputation=DB.rules.scale;C.buyAsset(DB,s,'apartment');C.investMoney(DB,s,'deposit',1000);C.foundBrand(DB,s,'streetwear','<img onerror=bad>','online');
 const viewCtx=vm.createContext({DB,C,state:s,document:{addEventListener(){}},FormData});
 vm.runInContext(`const Core=C;const h=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const t=(k,v={})=>String(DB.ui.labels[k]||k).replace(/\\{(\\w+)\\}/g,(_,x)=>v[x]??'');const n=x=>String(x);const money=x=>String(x);const badge=x=>'<span>'+h(x)+'</span>';const btn=(l,a,d='')=>'<button data-action="'+a+'" '+d+'>'+h(l)+'</button>';const detail=(l,v)=>'<p>'+h(l)+': '+h(v)+'</p>';const kpi=detail;${ui.slice(ui.indexOf('function financeButton('),ui.indexOf('let sectionVisits='))};globalThis.views={financesView,commercialView,investmentsView,assetsView,brandsView,lifestyleView};`,viewCtx);
 for(const fn of Object.values(viewCtx.views))assert.ok(fn().length>100);
 assert.ok(viewCtx.views.assetsView().includes(DB.economyRules.assets[0].name));assert.ok(viewCtx.views.assetsView().includes('data-operation="asset-use"'));assert.ok(!viewCtx.views.financesView().includes('data-operation="asset-use"'));assert.ok(viewCtx.views.brandsView().includes('&lt;img onerror=bad&gt;'));assert.ok(!viewCtx.views.brandsView().includes('<img onerror=bad>'));
});
