const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),section=id=>html.match(new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`))[1],DB=JSON.parse(section('game-db')),ctx=vm.createContext({});vm.runInContext(section('game-engine')+';globalThis.C=FootballCore;',ctx);const C=ctx.C;
const profile=(position='ST')=>({...C.clone(DB.profile.defaults),position,name:'회귀 확인',stats:Object.fromEntries(DB.attributes.map(a=>[a.id,a.initial]))});
const career=(position='ST')=>C.createCareer(DB,profile(position),'domestic','kr2-0');
test('all supported leagues contain their complete season roster, youth peers and no date double booking',()=>{
  const s=career(),fixtures=Object.values(s.fixtures).flat();
  for(const [league,count] of Object.entries(DB.seasonCatalog.expectedTeams)){
    const teams=DB.clubs.filter(c=>!c.historical&&!c.parent&&c.league===league);assert.equal(teams.length,count);
    for(const parent of teams){const youth=DB.clubs.find(c=>c.parent===parent.id);assert.ok(youth);const own=s.fixtures[youth.league];for(const f of own){const a=C.indexes(DB).clubs[f.home],b=C.indexes(DB).clubs[f.away];assert.ok(a.parent&&b.parent);assert.equal(C.indexes(DB).clubs[a.parent].league,league);assert.equal(C.indexes(DB).clubs[b.parent].league,league);}}
  }
  for(const c of DB.clubs.filter(c=>!c.historical)){const dates=fixtures.filter(f=>f.home===c.id||f.away===c.id).map(f=>f.date).sort();assert.equal(dates.length,new Set(dates).size);for(let i=1;i<dates.length;i++)assert.ok((Date.parse(dates[i])-Date.parse(dates[i-1]))/86400000>=DB.calendarRules.minimumMatchGapDays);}
  for(const competition of DB.leagues.filter(l=>l.kind==='continental'))for(const club of C.competitionMembers(DB,s,competition.id)){const games=s.fixtures[competition.id].filter(f=>f.home===club||f.away===club);assert.equal(games.length,competition.phaseRounds);assert.equal(games.filter(f=>f.home===club).length,competition.phaseRounds/2);assert.equal(new Set(games.map(f=>f.home===club?f.away:f.home)).size,games.length);}
});
test('shooting grows through the actual calendar and fractional gains survive save normalization',()=>{
  const s=career(),before=s.player.stats.shooting;s.training='shooting';
  while(s.date<C.dateAdd(s.seasonStart,28))C.advance(DB,s);
  assert.ok(s.player.development.training.gains.shooting>0);assert.ok(s.player.stats.shooting>before);assert.equal(s.training,'shooting');
  const gain=s.player.development.training.gains.shooting,loaded=C.normalizeCareerSave(DB,C.clone(s));assert.equal(loaded.player.development.training.gains.shooting,gain);
  for(let i=0;i<52;i++)C.grow(DB,s,0,DB.training.find(t=>t.id==='shooting'));
  assert.ok(s.player.development.training.gains.shooting<=DB.trainingRules.seasonAttributeMax);assert.ok(s.player.development.training.total<=DB.trainingRules.seasonTotalMax);
  const old=s.player.stats.shooting;s.player.injury=1;C.grow(DB,s,0,DB.training.find(t=>t.id==='shooting'));assert.equal(s.player.stats.shooting,old);s.player.injury=0;C.grow(DB,s,0,DB.training.find(t=>t.id==='rest'));assert.equal(s.player.stats.shooting,old);
});
test('assist events, player match totals and career totals agree for playmakers and forwards',()=>{
  for(const position of ['ST','CM','RW']){const s=career(position);s.player.trust=s.player.fitness=DB.rules.scale;for(const key of DB.attributes.map(a=>a.id))s.player.stats[key]=85;
    const fixture=C.myFixtures(s)[0],records=[];for(let i=0;i<80;i++){const r=C.simulate(DB,{...fixture,id:'assist-check-'+i},s),events=r.events.filter(e=>e.type==='goalEvent'&&e.assisterId==='player');assert.equal(r.player.assists,events.length);assert.ok(events.every(e=>e.playerId!=='player'));const team=fixture.home===s.player.club?r.home:r.away;assert.equal(team.stats.assists,team.players.reduce((sum,p)=>sum+p.match.assists,0));records.push({stats:r.player,appearance:r.appearance});}
    const totals=C.totals(DB,records);assert.ok(totals.assists>0,position+' assists remain possible');assert.equal(totals.assists,records.reduce((sum,r)=>sum+r.stats.assists,0));assert.ok(totals.keyPasses>=totals.assists);
  }
});
