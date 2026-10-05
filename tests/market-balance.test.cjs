const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const section=id=>html.match(new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`))[1];
const DB=JSON.parse(section('game-db')),ctx=vm.createContext({});
vm.runInContext(section('game-engine')+';globalThis.C=FootballCore;',ctx);const C=ctx.C;
function previousDatabase(){const db=C.clone(DB);for(const [group,values] of Object.entries(DB.balanceRules.previous))Object.assign(group.split('.').reduce((p,key)=>p[key],db),values);delete db.balanceRules;db.meta.version='19.1.3';return db;}
function experiencedCareer(){
 const p={...C.clone(DB.profile.defaults),name:'Market regression',country:'EN',position:'ST',secondaryPosition:'LW',tertiaryPosition:'RW',stats:Object.fromEntries(DB.attributes.map(a=>[a.id,77]))};
 const s=C.createCareer(DB,p,'domestic','en1-2');s.season=4;s.date='2029-08-10';s.seasonStart='2029-08-01';s.player.age=21;s.player.reputation=70;s.player.traits.potential=86;s.player.trust=80;
 s.player.contract.expiresSeason=7;s.player.lastClubChangeDate='2028-01-01';s.player.history=[];
 for(const a of DB.attributes){s.player.development.birth[a.id]=88;s.player.development.caps[a.id]=88;}
 for(let i=0;i<20;i++)s.player.history.push({id:'market-proof:'+i,date:C.dateAdd(s.date,-90-i*7),club:s.player.club,season:3,stats:{...C.createStats(DB),minutes:90,rating:6.7,goals:i%2,shots:4,onTarget:2,xg:.4},appearance:'starter'});
 for(const club of Object.values(s.world.clubs))club.finance=60000000;
 return s;
}
test('a proven player retains affordable automatic offer candidates later in a career',()=>{
 const s=experiencedCareer(),old=previousDatabase(),clubs=Object.values(C.indexes(DB,s).clubs);
 const before=clubs.map(c=>C.scoutingCandidate(old,s,c)).filter(Boolean),after=clubs.map(c=>C.scoutingCandidate(DB,s,c)).filter(Boolean);
 assert.equal(before.length,0);assert.ok(after.length>=3,`eligible buyers: ${after.length}`);
 for(const c of after){assert.ok(c.weight>0);assert.notEqual(c.club,s.player.club);assert.ok(!DB.clubs.find(x=>x.id===c.club).parent);}
 let cycles=0;while(cycles++<20&&s.offers.length<DB.scoutingRules.windowMaxOffers){C.refreshOffers(DB,s);if(!s.marketReview)break;s.date=s.marketReview.date;}
 assert.ok(s.offers.length>0);assert.ok(s.offers.length<=DB.scoutingRules.windowMaxOffers);
 console.log(`Career candidates ${before.length} -> ${after.length}; delivered ${s.offers.length} offers with the existing window limit.`);
});
test('offseason evidence survives while inexperienced players and repeat contacts remain gated',()=>{
 const s=experiencedCareer(),target=DB.clubs.find(c=>c.id==='en1-1');
 for(const npc of s.world.rosters[target.id])for(const a of DB.attributes)npc.stats[a.id]=70;
 s.world.clubs[target.id].quality=75;
 for(const h of s.player.history)h.date=C.dateAdd(s.date,-210);
 assert.equal(C.scoutingCandidate(previousDatabase(),s,C.indexes(DB,s).clubs[target.id]),null);
 assert.ok(C.scoutingCandidate(DB,s,C.indexes(DB,s).clubs[target.id]));
 s.automaticOfferHistory[target.id]={date:C.dateAdd(s.date,-30)};assert.equal(C.scoutingCandidate(DB,s,C.indexes(DB,s).clubs[target.id]),null);
 delete s.automaticOfferHistory[target.id];s.player.history.length=0;assert.equal(C.scoutingCandidate(DB,s,C.indexes(DB,s).clubs[target.id]),null);
});
test('saved default coefficients upgrade without altering custom values or career records',()=>{
 const db=previousDatabase(),s=experiencedCareer(),snapshot=JSON.stringify({stats:s.player.stats,history:s.player.history,contract:s.player.contract});
 db.scoutingRules.minRating=6.42;const updated=C.upgradeDatabase(DB,db);
 assert.equal(updated.scoutingRules.minRating,6.42);assert.equal(updated.offerRules.financeFeeShare,DB.offerRules.financeFeeShare);assert.equal(updated.engine.shot.finishingWeight,DB.engine.shot.finishingWeight);assert.equal(updated.growthRules.trainingMultiplier,DB.growthRules.trainingMultiplier);
 const first=JSON.stringify(updated);C.upgradeDatabase(DB,updated);assert.equal(JSON.stringify(updated),first);
 assert.equal(JSON.stringify({stats:s.player.stats,history:s.player.history,contract:s.player.contract}),snapshot);
});
test('mental advantages stay useful with less amplification of match execution',()=>{
 const s=experiencedCareer(),p=s.player,person={...p,id:'player'};
 for(const id of ['composure','decisions','intelligence','pressure','mental'])p.traits[id]=85;
 p.stats.shooting=65;person.stats=p.stats;const old=previousDatabase(),before=C.effective(old,person,'shooting',s,45),after=C.effective(DB,person,'shooting',s,45);
 assert.ok(after.skill<before.skill);assert.ok(after.skill>p.stats.shooting);assert.ok(after.skill/before.skill>.9,'execution should change modestly');
});
