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

test('all selectors wrap independently and map to real sprite layers or dye channels',()=>{
 const draft={appearance:{}},output={};
 const screen=vm.createContext({DB,draft,document:{getElementById:()=>output}});
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
  assert.equal(output.textContent,field.options.at(-1).name);
  screen.cycleAppearance(field.id,1);
  assert.equal(draft.appearance[field.id],field.options[0].id);
 }
 assert.equal(Object.keys(draft.appearance).length,13);
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
