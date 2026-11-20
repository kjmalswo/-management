const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const section=id=>html.match(new RegExp('<script id="'+id+'"[^>]*>([\\s\\S]*?)</script>'))[1];
const DB=JSON.parse(section('game-db')),art=JSON.parse(section('player-art')),ui=section('game-ui');
const views=ui.slice(ui.indexOf('let playerArtReady;'),ui.indexOf('function renderProfile()'));
const fields=DB.profile.appearance.fields;
const t=(key,values={})=>(DB.ui.labels[key]||key).replace(/\{(\w+)\}/g,(_,name)=>values[name]??'');
const optionMarkup=(field,index)=>`${field.options[index].name} <span class="appearance-count">(${index+1}/${field.options.length})</span>`;

test('all selectors wrap independently and map to real sprite layers or dye channels',()=>{
 const draft={appearance:{}},output={};
 const screen=vm.createContext({DB,draft,t,h:String,document:{getElementById:()=>output}});
 vm.runInContext(views+'\nrefreshPlayerPortrait=()=>{};',screen);
 const png=fs.readFileSync(path.join(__dirname,'../assets/player/appearance.png'));
 assert.equal(art.src,'data:image/png;base64,'+png.toString('base64'));
 for(const field of fields){
  assert.equal(screen.appearanceOption(field,{}).id,field.options[0].id);
  for(const option of field.options){
   if(option.colors)option.colors.forEach((color,i)=>assert.ok(art.inks[field.id+i]&&/^[a-f0-9]{6}$/i.test(color)));
   else if(option.tile){
    const [x,y,w,h]=art.tiles[option.tile];
    assert.ok(x>=0&&y>=0&&x+w<=png.readUInt32BE(16)&&y+h<=png.readUInt32BE(20));
   }
  }
  screen.cycleAppearance(field.id,-1);
  assert.equal(output.innerHTML,optionMarkup(field,field.options.length-1));
  screen.cycleAppearance(field.id,1);
  assert.equal(draft.appearance[field.id],field.options[0].id);
  assert.equal(output.innerHTML,optionMarkup(field,0));
 }
 assert.equal(Object.keys(draft.appearance).length,13);
});

test('the appearance die follows the selectors and rolls every option with one portrait refresh',()=>{
 const draft={...DB.profile.defaults,appearance:{}},outputs=new Map();
 const btn=(label,action,attributes)=>`<button data-action="${action}" ${attributes}>${label}</button>`;
 let refreshes=0;
 const screen=vm.createContext({DB,draft,t,h:String,btn,profileField:()=>'',refresh:()=>refreshes++,document:{getElementById(id){
  if(!outputs.has(id))outputs.set(id,{});
  return outputs.get(id);
 }}});
 vm.runInContext(views+'\nMath.random=()=>0.99;refreshPlayerPortrait=refresh;',screen);
 const editor=screen.appearanceEditor();
 const roll='data-action="appearance-random"';
 assert.equal(editor.split(roll).length,2);
 assert.ok(editor.indexOf(roll)>editor.lastIndexOf('</output>'));
 for(const field of fields)assert.ok(editor.includes(optionMarkup(field,0)));
 screen.randomizeAppearance();
 assert.equal(refreshes,1);
 for(const field of fields){
  assert.equal(draft.appearance[field.id],field.options.at(-1).id);
  assert.equal(outputs.get('appearance-'+field.id).innerHTML,optionMarkup(field,field.options.length-1));
 }
 const {appearance,...profile}=draft;
 assert.deepEqual(profile,DB.profile.defaults);
});

test('the national page renders the player in their own national home kit',async()=>{
 const player={...DB.profile.defaults,freeAgent:true};
 const team=DB.nationalTeams.find(team=>team.country===player.country);
 const other=DB.nationalTeams.find(candidate=>candidate.id!==team.id);
 const nations={team:team.id,teams:{[team.id]:team,[other.id]:other},squads:{},tournaments:{},history:[],callups:[],honours:[]};
 const canvas={dataset:{view:'full'},isConnected:true,setAttribute(){}};
 const empty=()=>'';
 const Core={nationalAssessment:()=>({reason:'nationalWatch'}),nationalOnDuty:()=>false,nationalPlayerIndex:()=>new Map(),totals:()=>({}),nationalSquadView:()=>({players:[]})};
 let kit;
 const screen=vm.createContext({DB,state:{player,nations},Core,t,h:String,n:String,crest:empty,shirt:empty,
  detail:empty,badge:empty,btn:empty,progress:empty,historyItems:empty,otherTeamId:other.id,
  document:{querySelector:()=>canvas},captureKit:(_canvas,_art,_choices,_player,kitTeam)=>{kit=kitTeam;},
 });
 const nationalView=ui.slice(ui.indexOf('let nationalTeamSelection='),ui.indexOf('function nationalTournamentView('));
 vm.runInContext(views+nationalView+'\nplayerArtReady=Promise.resolve({});paintPlayerPortrait=captureKit;',screen);
 const markup=screen.nations();
 assert.ok(markup.includes('data-view="full" data-national-kit="'+team.id+'"'));
 canvas.dataset.nationalKit=team.id;
 screen.refreshPlayerPortrait();
 await Promise.resolve();
 assert.equal(kit,team);
 vm.runInContext('nationalTeamSelection=otherTeamId;',screen);
 assert.doesNotMatch(screen.nations(),/data-national-kit/);
});

test('body proportions share a baseline and face view draws only the selected facial layers',()=>{
 const screen=vm.createContext({DB,Core:{clamp:(v,min,max)=>Math.max(min,Math.min(v,max))},clubPalette:c=>({main:c.color,trim:c.secondaryColor})});
 vm.runInContext(views,screen);
 const choices=Object.fromEntries(fields.map(f=>[f.id,f.options.at(-1)]));
 function draw(player,view,club){
  const layers=[],pixels={data:new Uint8ClampedArray([221,230,243,255])};
  const ctx={drawImage:(_, ...coords)=>layers.push(coords),getImageData:()=>pixels,putImageData(){}};
  const canvas={dataset:{view},getContext:()=>ctx};
  screen.paintPlayerPortrait(canvas,art,choices,player,club);
  for(const [, , , ,x,y,w,h] of layers)assert.ok(x>=0&&y>=0&&x+w<=canvas.width&&y+h<=canvas.height);
  return {layers,color:Array.from(pixels.data)};
 }
 const base=draw(DB.profile.defaults,'full'),short=draw({height:155,weight:74},'full'),tall=draw({height:205,weight:74},'full');
 const light=draw({height:180,weight:50},'full'),heavy=draw({height:180,weight:110},'full');
 const body=frame=>frame.layers[0].slice(4);
 assert.ok(body(short)[3]<body(base)[3]&&body(base)[3]<body(tall)[3]);
 assert.ok(body(light)[2]<body(base)[2]&&body(base)[2]<body(heavy)[2]);
 assert.equal(body(short)[1]+body(short)[3],body(tall)[1]+body(tall)[3]);
 assert.deepEqual(base.layers.slice(0,3).map(layer=>layer.slice(0,4)),[art.tiles.athlete,art.tiles.long,art.tiles.loose]);
 assert.deepEqual(base.color,[221,230,243,255]);
 const club={color:'#2168ac',secondaryColor:'#ffcd52'};
 assert.deepEqual(draw(DB.profile.defaults,'full',club).color,[33,104,172,255]);
 const face=draw(DB.profile.defaults,'face',club);
 assert.deepEqual(face.layers.map(layer=>layer.slice(0,4)),['face','eyes','eyebrows','nose','mouth','haircut'].map(key=>art.tiles[choices[key].tile]));
 assert.deepEqual(face.layers.map(layer=>layer.slice(0,4)),base.layers.slice(3).map(layer=>layer.slice(0,4)));
});
