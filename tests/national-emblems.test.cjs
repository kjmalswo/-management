const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),section=id=>html.match(new RegExp('<script id="'+id+'"[^>]*>([\\s\\S]*?)<\\/script>'))[1],DB=JSON.parse(section('game-db')),catalog=JSON.parse(section('national-emblem-assets')),clubs=JSON.parse(section('club-emblem-assets')),manifest=JSON.parse(fs.readFileSync(path.join(root,'assets/national-emblems/manifest.json'),'utf8'));
const gitHash=b=>crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
test('every supported national team has an offline emblem and a country flag fallback',()=>{
 assert.equal(manifest.teams.length,114);assert.equal(catalog.width,clubs.width);assert.equal(catalog.height,clubs.height);
 for(const team of DB.nationalTeams){assert.ok(catalog.teams[team.id],team.id);assert.ok(catalog.flags[team.country],team.country);}
 for(const team of manifest.teams)for(const [record,asset] of [[team,catalog.teams[team.id]],[team.flag,catalog.flags[team.country]]]){const bytes=fs.readFileSync(path.join(root,record.path));assert.equal(gitHash(bytes),record.sha);assert.equal(Buffer.from(asset.src.split(',')[1],'base64').compare(bytes),0);assert.ok(record.transparentPixels>0);}
});
test('all 228 image files have the same lossless dimensions and alpha channel',()=>{
 for(const team of manifest.teams)for(const record of [team,team.flag]){const bytes=fs.readFileSync(path.join(root,record.path));assert.equal(bytes.toString('ascii',8,12),'WEBP');let header;
  for(let p=12;p+8<bytes.length;){const type=bytes.toString('ascii',p,p+4),size=bytes.readUInt32LE(p+4);if(type==='VP8L'){assert.equal(bytes[p+8],0x2f);header=bytes.readUInt32LE(p+9);break;}p+=8+size+(size%2);}
  assert.notEqual(header,undefined);assert.equal((header&0x3fff)+1,139);assert.equal(((header>>>14)&0x3fff)+1,181);assert.equal((header>>>28)&1,1);
 }
});
test('the shared renderer uses association emblems, missing-emblem flags, away kits and club inheritance',()=>{
 const ui=section('game-ui'),resolver=ui.slice(ui.indexOf('function clubEmblem('),ui.indexOf('const crest=club=>')),context=vm.createContext({DB,NATIONAL_EMBLEM_ASSETS:catalog,CLUB_EMBLEM_ASSETS:clubs,idx:()=>({clubs:Object.fromEntries(DB.clubs.map(c=>[c.id,c]))})});vm.runInContext(resolver+';globalThis.resolve=clubEmblem;',context);
 for(const team of DB.nationalTeams){assert.equal(context.resolve(team),catalog.teams[team.id]);assert.equal(context.resolve({...team,color:team.secondaryColor}),catalog.teams[team.id]);}
 const korean=DB.nationalTeams.find(t=>t.country==='KR'),saved=catalog.teams[korean.id];delete catalog.teams[korean.id];assert.equal(context.resolve(korean),catalog.flags.KR);catalog.teams[korean.id]=saved;
 for(const club of DB.clubs)assert.ok(context.resolve(club),club.id);
});
test('association assets take precedence where national-kit symbols differ',()=>{
 for(const [code,source] of [['CH','Swiss_Football_Association'],['TR','Turkish_Football_Federation'],['VN','Vietnam_Football_Federation'],['PL','Polish_Football_Association'],['HU','Hungarian_Football_Federation'],['ID','aseanfootball.org']])assert.ok(manifest.teams.find(t=>t.country===code).sourceURL.includes(source));
});

test('bundled club marks match the normalized files and their manifest hashes',()=>{
 const records=JSON.parse(fs.readFileSync(path.join(root,'assets/club-emblems/manifest.json'),'utf8')).clubs;
 for(const record of records){
  const bytes=fs.readFileSync(path.join(root,record.path));
  const [type,payload]=clubs.clubs[record.id].src.split(/,(.*)/s);
  const bundled=type.endsWith(';base64')?Buffer.from(payload,'base64'):Buffer.from(decodeURIComponent(payload));
  assert.equal(bundled.compare(bytes),0,record.id);
  assert.equal(gitHash(bytes),record.sha,record.id);
 }
});

test('every competition resolves to a club-sized offline mark and the next match shows the opponent',()=>{
 const ui=section('game-ui'),assets=JSON.parse(section('competition-emblem-assets'));
 for(const competition of [...DB.leagues,...DB.nationalCompetitions]){
  const src=assets.logos[assets.aliases[competition.id]||competition.id];
  const data=Buffer.from(src.split(',')[1],'base64');
  assert.equal(data.toString('ascii',12,16),'VP8L',competition.id);
  const dimensions=data.readUInt32LE(21);
  assert.equal((dimensions&0x3fff)+1,clubs.width);
  assert.equal(((dimensions>>>14)&0x3fff)+1,clubs.height);
  assert.equal((dimensions>>>28)&1,1,competition.id);
 }
 assert.equal(assets.aliases['post-fr12'],'fr-1');
 assert.equal(assets.aliases['post-fr23'],'fr-ligue2');
 const teams={home:{name:'홈팀'},away:{name:'원정팀'}};
 const view=vm.createContext({COMPETITION_EMBLEMS:assets,CLUB_EMBLEM_ASSETS:clubs,h:String,t:()=>'',idx:()=>({clubs:teams}),clubEmblem:()=>clubs.clubs['en1-0'],state:{player:{club:'home'},nations:{team:'away'}}});
 vm.runInContext(ui.slice(ui.indexOf('function crestImage('),ui.indexOf('function entityLink(')),view);
 vm.runInContext(ui.slice(ui.indexOf('function competitionCrest('),ui.indexOf('function fixtureCard(')),view);
 const fixture={home:'home',away:'away'},competition=DB.leagues.find(c=>c.id==='ucl');
 const badge=view.nextMatchBadge(fixture,competition);
 assert.match(badge,/title="원정팀"/);
 assert.equal(badge.match(/class="crest crest-image"/g).length,2);
 assert.equal(badge.match(/width="139" height="181"/g).length,2);
 assert.doesNotMatch(badge,/\bstyle=/);
 assert.match(view.nextMatchBadge({...fixture,national:true},competition),/title="홈팀"/);
 assert.equal(view.nextMatchBadge(null,null),'');
});
