(() => {
"use strict";

/* ---------- DOM / constants ---------- */
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d", { alpha:false });
const $ = id => document.getElementById(id);
const W = () => canvas.width;
const H = () => canvas.height;
const TAU = Math.PI * 2;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const rand = (a,b) => Math.random()*(b-a)+a;
const pick = a => a[(Math.random()*a.length)|0];

let state = "START", last = 0, dpr = 1, time = 0, audio = null;
let score = 0, highScore = Number(localStorage.getItem("novaStrikeHighScore") || 0);
let level = 1, levelStartScore = 0, nextLevelScore = 350;
let combo = 1, comboKills = 0, bestCombo = 1, comboTimer = 0;
let spawnTimer = 1.8, powerTimer = 12, boss = null, bossIntro = 0;
let shake = 0, flash = 0, damageFlash = 0, slowMo = 1;
let enemies=[], bullets=[], enemyBullets=[], particles=[], powerups=[], texts=[], stars=[], nebulas=[], shootingStars=[];
const keys = {left:false,right:false,fire:false};
const player = {x:.5,y:.86,w:28,h:40,vx:0,speed:.82,health:100,maxHealth:100,fire:0,invuln:0,recoil:0,shield:0,rapid:0,double:0,trail:[]};

/* ---------- responsive canvas ---------- */
function resize(){
  const r = canvas.getBoundingClientRect();
  dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(320, Math.floor(r.width*dpr));
  canvas.height = Math.max(220, Math.floor(r.height*dpr));
  ctx.setTransform(dpr,0,0,dpr,0,0);
  player.x = clamp(player.x, .08, .92);
}
addEventListener("resize",resize,{passive:true});
resize();

/* ---------- background ---------- */
function seedSpace(){
  stars.length=0; nebulas.length=0;
  for(let i=0;i<150;i++) stars.push({x:Math.random(),y:Math.random(),z:Math.random(),tw:rand(0,TAU),size:rand(.4,1.7)});
  for(let i=0;i<5;i++) nebulas.push({x:rand(-.1,1.1),y:rand(.1,.9),r:rand(.15,.35),a:rand(.025,.075),h:pick([190,265,320])});
}
seedSpace();

function drawBackground(dt){
  const w=W()/dpr,h=H()/dpr;
  const g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,"#02040b");g.addColorStop(.55,"#070817");g.addColorStop(1,"#02030a");
  ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
  for(const n of nebulas){
    const x=(n.x*w + Math.sin(time*.00004+n.y*7)*25)%w, y=n.y*h;
    const rg=ctx.createRadialGradient(x,y,0,x,y,n.r*Math.max(w,h));
    rg.addColorStop(0,`hsla(${n.h},80%,60%,${n.a})`);rg.addColorStop(1,"transparent");
    ctx.fillStyle=rg;ctx.fillRect(0,0,w,h);
  }
  for(const s of stars){
    s.y += dt*(.008+s.z*.035);
    if(s.y>1.03){s.y=-.02;s.x=Math.random()}
    const x=(s.x + Math.sin(time*.00015+s.z*5)*.012)*w;
    const y=s.y*h, tw=.45+.55*Math.sin(time*.002+s.tw);
    ctx.globalAlpha=tw*(.35+.65*s.z);
    ctx.fillStyle=s.z>.72?"#bdeeff":"#7890b8";
    ctx.beginPath();ctx.arc(x,y,s.size*(.6+s.z),0,TAU);ctx.fill();
  }
  ctx.globalAlpha=1;
  if(Math.random()<dt*.035) shootingStars.push({x:rand(.1,.9),y:rand(.05,.6),v:rand(.4,.9),life:1});
  for(let i=shootingStars.length-1;i>=0;i--){
    const s=shootingStars[i];s.x+=s.v*dt;s.y+=s.v*.34*dt;s.life-=dt*1.5;
    ctx.strokeStyle=`rgba(160,225,255,${s.life*.45})`;ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(s.x*w,s.y*h);ctx.lineTo((s.x-.09)*w,(s.y-.03)*h);ctx.stroke();
    if(s.life<=0)shootingStars.splice(i,1);
  }
}

/* ---------- audio ---------- */
function initAudio(){
  if(audio) return;
  const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
  audio=new AC();
}
function tone(freq,dur=.08,type="sine",gain=.035,slide=0){
  if(!audio)return;
  if(audio.state==="suspended")audio.resume();
  const o=audio.createOscillator(), g=audio.createGain(), now=audio.currentTime;
  o.type=type;o.frequency.setValueAtTime(freq,now);o.frequency.exponentialRampToValueAtTime(Math.max(40,freq+slide),now+dur);
  g.gain.setValueAtTime(.0001,now);g.gain.exponentialRampToValueAtTime(gain,now+.008);g.gain.exponentialRampToValueAtTime(.0001,now+dur);
  o.connect(g);g.connect(audio.destination);o.start(now);o.stop(now+dur+.02);
}
function noise(dur=.1,gain=.035){
  if(!audio)return;
  const b=audio.createBuffer(1,audio.sampleRate*dur,audio.sampleRate),d=b.getChannelData(0);
  for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2);
  const s=audio.createBufferSource(),g=audio.createGain(),now=audio.currentTime;s.buffer=b;g.gain.value=gain;s.connect(g);g.connect(audio.destination);s.start(now);
}
const SFX={
 shoot:()=>tone(620,.055,"square",.018,260),
 hit:()=>tone(180,.06,"triangle",.025,-70),
 boom:()=>{tone(90,.22,"sawtooth",.045,-60);noise(.16,.025)},
 power:()=>{tone(420,.08,"sine",.035,260);setTimeout(()=>tone(760,.12,"sine",.025,300),45)},
 level:()=>{tone(330,.1,"sine",.03,120);setTimeout(()=>tone(520,.13,"sine",.03,180),80)},
 combo:()=>tone(980,.12,"square",.025,250),
 boss:()=>{tone(70,.45,"sawtooth",.05,-35);setTimeout(()=>tone(120,.35,"square",.03,90),120)},
 damage:()=>noise(.12,.04),
 gameover:()=>{tone(180,.25,"sawtooth",.04,-90);setTimeout(()=>tone(80,.4,"sine",.03,-25),180)}
};

/* ---------- particles / feedback ---------- */
function burst(x,y,count,color,size=2,force=1){
  for(let i=0;i<count;i++){const a=Math.random()*TAU,s=rand(.3,1.6)*force;particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:rand(.25,.7),max:.7,size:rand(.5,size),color,drag:.97})}
}
function ring(x,y,color,maxR=35){particles.push({ring:true,x,y,r:2,maxR,life:.45,max:.45,color})}
function textPop(x,y,t,color="#fff"){texts.push({x,y,t,color,life:1,vy:-22})}
function addShake(n){shake=Math.max(shake,n)}
function damage(n){
  if(player.invuln>0 || player.shield>0)return;
  player.health=clamp(player.health-n,0,100);player.invuln=.65;damageFlash=.35;addShake(7);SFX.damage();burst(player.x*W()/dpr,player.y*H()/dpr,12,"#ff5577",2,1.5);
  combo=1;comboKills=0;comboTimer=0;if(player.health<=0)endGame();
}

/* ---------- player ---------- */
function fire(){
  if(player.fire>0 || state!=="PLAYING")return;
  const rapid=player.rapid>0;player.fire=rapid?.115:.25;player.recoil=.08;
  const x=player.x*W()/dpr,y=player.y*H()/dpr-24;
  bullets.push({x,y,v:rapid?-920:-840,life:1.5,r:rapid?2.2:2.7,rapid});
  burst(x,y+5,4,rapid?"#ffd35c":"#8ffbff",1.5,1);
  SFX.shoot();
}
function updatePlayer(dt){
  const dir=(keys.right?1:0)-(keys.left?1:0);
  player.vx += (dir*player.speed-player.vx)*Math.min(1,dt*12);
  player.x=clamp(player.x+player.vx*dt,.055,.945);
  player.fire=Math.max(0,player.fire-dt);player.invuln=Math.max(0,player.invuln-dt);player.recoil=Math.max(0,player.recoil-dt);
  player.shield=Math.max(0,player.shield-dt);player.rapid=Math.max(0,player.rapid-dt);player.double=Math.max(0,player.double-dt);
  if(keys.fire)fire();
  const px=player.x*W()/dpr,py=player.y*H()/dpr;
  if(Math.random()<dt*35)particles.push({x:px+rand(-7,7),y:py+18,vx:rand(-.6,.6),vy:rand(2,5),life:.35,max:.35,size:rand(.7,1.8),color:"#63d9ff",drag:1});
}

/* ---------- ship rendering ---------- */
function drawPlayer(){
  const w=W()/dpr,h=H()/dpr,x=player.x*w,y=player.y*h-(player.recoil?3:0);
  ctx.save();ctx.translate(x,y);
  const flick=.7+.3*Math.sin(time*.03);
  ctx.globalAlpha=player.invuln>0?(.5+.5*Math.sin(time*.05)):1;
  ctx.shadowBlur=20;ctx.shadowColor="#43e9ff";
  ctx.fillStyle="#58efff";ctx.beginPath();ctx.moveTo(-8,14);ctx.lineTo(-3,29+flick*7);ctx.lineTo(0,19);ctx.lineTo(3,29+flick*7);ctx.lineTo(8,14);ctx.closePath();ctx.fill();
  ctx.shadowBlur=0;
  ctx.fillStyle="#101b31";ctx.strokeStyle="#a8faff";ctx.lineWidth=1.2;
  ctx.beginPath();ctx.moveTo(0,-26);ctx.lineTo(10,-5);ctx.lineTo(22,8);ctx.lineTo(10,12);ctx.lineTo(5,24);ctx.lineTo(0,17);ctx.lineTo(-5,24);ctx.lineTo(-10,12);ctx.lineTo(-22,8);ctx.lineTo(-10,-5);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle="#162a4b";ctx.strokeStyle="#b1eaff";
  ctx.beginPath();ctx.moveTo(0,-20);ctx.lineTo(7,-4);ctx.lineTo(0,7);ctx.lineTo(-7,-4);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle="#ff5fbd";ctx.shadowBlur=10;ctx.shadowColor="#ff5fbd";ctx.beginPath();ctx.arc(0,10,4,0,TAU);ctx.fill();
  ctx.shadowBlur=0;ctx.strokeStyle="#62f6ff";ctx.beginPath();ctx.moveTo(-10,2);ctx.lineTo(-19,8);ctx.moveTo(10,2);ctx.lineTo(19,8);ctx.stroke();
  if(player.shield>0){ctx.globalAlpha=.22+.12*Math.sin(time*.02);ctx.strokeStyle="#62f6ff";ctx.lineWidth=2;ctx.shadowBlur=18;ctx.shadowColor="#62f6ff";ctx.beginPath();ctx.ellipse(0,2,30,38,0,0,TAU);ctx.stroke()}
  ctx.restore();
}

/* ---------- bullets ---------- */
function updateBullets(dt){
  for(let i=bullets.length-1;i>=0;i--){const b=bullets[i];b.y+=b.v*dt;b.life-=dt;
    if(b.life<=0||b.y<-30){bullets.splice(i,1);continue}
    const trail=particles.find(()=>false);
  }
  for(let i=enemyBullets.length-1;i>=0;i--){const b=enemyBullets[i];b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;
    if(b.life<=0||b.y>H()/dpr+30||b.x<-30||b.x>W()/dpr+30){enemyBullets.splice(i,1);continue}
    const px=player.x*W()/dpr,py=player.y*H()/dpr;
    if(Math.hypot(b.x-px,b.y-py)<18){enemyBullets.splice(i,1);damage(b.damage||10);burst(b.x,b.y,6,"#ff8b7d",1.5)}
  }
}
function drawBullets(){
  for(const b of bullets){ctx.save();ctx.strokeStyle=b.rapid?"#ffd35c":"#70f8ff";ctx.lineWidth=b.r;ctx.shadowBlur=12;ctx.shadowColor=ctx.strokeStyle;ctx.beginPath();ctx.moveTo(b.x,b.y+12);ctx.lineTo(b.x,b.y-12);ctx.stroke();ctx.restore()}
  for(const b of enemyBullets){ctx.save();ctx.fillStyle="#ff637e";ctx.shadowBlur=10;ctx.shadowColor="#ff637e";ctx.beginPath();ctx.arc(b.x,b.y,3.5,0,TAU);ctx.fill();ctx.restore()}
}

/* ---------- enemies ---------- */
const TYPES={
 drone:{hp:24,speed:115,score:10,color:"#61f6ff",r:15,kind:"drone"},
 striker:{hp:32,speed:175,score:25,color:"#ff63b9",r:17,kind:"striker"},
 cruiser:{hp:75,speed:75,score:50,color:"#a88bff",r:25,kind:"cruiser"},
 tank:{hp:140,speed:48,score:90,color:"#ff9b61",r:32,kind:"tank"}
};
function chooseEnemy(){
  const r=Math.random();
  if(level<2)return "drone";
  if(level<3)return r<.72?"drone":"striker";
  if(level<4)return r<.55?"drone":r<.78?"striker":"cruiser";
  return r<.4?"drone":r<.62?"striker":r<.85?"cruiser":"tank";
}
function spawnEnemy(){
  if(boss||enemies.length >= Math.min(4,1+Math.floor((level-1)/2)))return;
  const k=chooseEnemy(),t=TYPES[k];
  enemies.push({kind:k,x:rand(.1,.9),y:-.08,hp:t.hp*(1+(level-1)*.07),max:t.hp*(1+(level-1)*.07),vx:rand(-.25,.25),phase:rand(0,TAU),age:0,shoot:rand(1.8,4),r:t.r,score:t.score,color:t.color,flash:0});
}
function updateEnemies(dt){
  const w=W()/dpr,h=H()/dpr;
  for(let i=enemies.length-1;i>=0;i--){
    const e=enemies[i];e.age+=dt;e.flash=Math.max(0,e.flash-dt);e.shoot-=dt;
    const px=player.x, wave=Math.sin(e.age*(e.kind==="striker"?3.2:1.4)+e.phase);
    if(e.kind==="drone"){e.x+=wave*.035*dt;e.y+=dt*(TYPES.drone.speed+level*3)/h}
    else if(e.kind==="striker"){e.x+=wave*.13*dt;e.y+=dt*(TYPES.striker.speed+level*4)/h}
    else if(e.kind==="cruiser"){e.x+=(player.x-e.x)*dt*.035;e.y+=dt*(TYPES.cruiser.speed+level*2)/h}
    else{e.x+=Math.sin(e.age*.7+e.phase)*.035*dt;e.y+=dt*(TYPES.tank.speed+level)/h}
    e.x=clamp(e.x,.06,.94);
    if((e.kind==="cruiser"||e.kind==="tank")&&e.shoot<=0){enemyFire(e);e.shoot=rand(2.5,4.3)}
    if(e.y>1.1){enemies.splice(i,1);damage(e.kind==="tank"?20:12);continue}
    const ex=e.x*w,ey=e.y*h,playerX=player.x*w,playerY=player.y*h;
    if(Math.hypot(ex-playerX,ey-playerY)<e.r+15){enemies.splice(i,1);damage(e.kind==="tank"?28:18);burst(ex,ey,16,e.color,2,1.5)}
  }
}
function enemyFire(e){
  const w=W()/dpr,h=H()/dpr,ex=e.x*w,ey=e.y*h,px=player.x*w,py=player.y*h;
  const a=Math.atan2(py-ey,px-ex),speed=220+level*8;
  enemyBullets.push({x:ex,y:ey,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,life:5,damage:e.kind==="tank"?15:10});
}
function drawEnemy(e){
  const w=W()/dpr,h=H()/dpr,x=e.x*w,y=e.y*h;
  ctx.save();ctx.translate(x,y);ctx.rotate(e.kind==="striker"?Math.sin(e.age*2)*.12:0);
  ctx.shadowBlur=14;ctx.shadowColor=e.color;ctx.strokeStyle=e.flash>0?"#fff":e.color;ctx.fillStyle="rgba(5,12,28,.92)";ctx.lineWidth=1.5;
  ctx.beginPath();
  if(e.kind==="drone"){ctx.moveTo(0,-14);ctx.lineTo(14,-3);ctx.lineTo(9,12);ctx.lineTo(0,7);ctx.lineTo(-9,12);ctx.lineTo(-14,-3);ctx.closePath()}
  if(e.kind==="striker"){ctx.moveTo(0,-18);ctx.lineTo(7,-4);ctx.lineTo(21,5);ctx.lineTo(5,9);ctx.lineTo(0,18);ctx.lineTo(-5,9);ctx.lineTo(-21,5);ctx.lineTo(-7,-4);ctx.closePath()}
  if(e.kind==="cruiser"){ctx.moveTo(-24,-7);ctx.lineTo(-10,-17);ctx.lineTo(16,-13);ctx.lineTo(25,0);ctx.lineTo(13,14);ctx.lineTo(-12,17);ctx.lineTo(-25,7);ctx.closePath()}
  if(e.kind==="tank"){ctx.moveTo(-27,-15);ctx.lineTo(-14,-27);ctx.lineTo(14,-27);ctx.lineTo(27,-15);ctx.lineTo(24,18);ctx.lineTo(9,28);ctx.lineTo(-9,28);ctx.lineTo(-24,18);ctx.closePath()}
  ctx.fill();ctx.stroke();ctx.shadowBlur=0;
  ctx.fillStyle=e.color;ctx.globalAlpha=.75;
  if(e.kind==="drone"){ctx.fillRect(-3,-5,6,12)}
  else if(e.kind==="striker"){ctx.beginPath();ctx.arc(0,0,4,0,TAU);ctx.fill()}
  else{ctx.beginPath();ctx.arc(0,0,e.kind==="tank"?8:6,0,TAU);ctx.fill()}
  ctx.globalAlpha=1;
  if(e.hp<e.max){ctx.fillStyle="rgba(255,255,255,.12)";ctx.fillRect(-e.r,-e.r-7,e.r*2,2);ctx.fillStyle=e.color;ctx.fillRect(-e.r,-e.r-7,e.r*2*(e.hp/e.max),2)}
  ctx.restore();
}

/* ---------- boss ---------- */
function spawnBoss(){
  boss={x:.5,y:-.22,hp:900+level*100,max:900+level*100,age:0,shoot:2.1,phase:0,flash:0};
  bossIntro=2.6;SFX.boss();centerMessage("⚠ BOSS INBOUND ⚠", "#ff6f98",2.4);addShake(4);
}
function updateBoss(dt){
  if(!boss)return;
  boss.age+=dt;boss.flash=Math.max(0,boss.flash-dt);
  if(bossIntro>0){bossIntro-=dt;boss.y+=(.22-boss.y)*dt*1.7;return}
  boss.x=.5+Math.sin(boss.age*.55)*.32;
  boss.shoot-=dt;
  if(boss.shoot<=0){boss.shoot=1.65;bossAttack()}
  const bx=boss.x*W()/dpr,by=boss.y*H()/dpr,px=player.x*W()/dpr,py=player.y*H()/dpr;
  for(let i=bullets.length-1;i>=0;i--){const b=bullets[i];if(Math.hypot(b.x-bx,b.y-by)<55){bullets.splice(i,1);boss.hp-=player.double>0?16:8;boss.flash=.06;burst(b.x,b.y,4,"#b8faff",1);SFX.hit();if(boss.hp<=0){defeatBoss();return}}}
}
function bossAttack(){
  const w=W()/dpr,h=H()/dpr,bx=boss.x*w,by=boss.y*h,px=player.x*w,py=player.y*h,a=Math.atan2(py-by,px-bx);
  for(let i=-1;i<=1;i++){const aa=a+i*.22;enemyBullets.push({x:bx,y:by+35,vx:Math.cos(aa)*245,vy:Math.sin(aa)*245,life:5,damage:12})}
  burst(bx,by+30,8,"#ff5577",2,1)
}
function defeatBoss(){
  const bx=boss.x*W()/dpr,by=boss.y*H()/dpr;
  for(let i=0;i<5;i++)setTimeout(()=>{burst(bx+rand(-40,40),by+rand(-25,25),28,pick(["#ff5577","#ffd36a","#a78bff","#63f6ff"]),3,2);ring(bx,by,"#ff9bb5",100+i*25);},i*90);
  score+=500*level;boss=null;SFX.boom();addShake(16);slowMo=.45;setTimeout(()=>slowMo=1,650);
  levelStartScore=score;level++;nextLevelScore=score+350+level*90;SFX.level();centerMessage("BOSS DOWN", "#7ff9ff",1.8);
}

/* ---------- collisions / score ---------- */
function killEnemy(index){
  const e=enemies[index],x=e.x*W()/dpr,y=e.y*H()/dpr;
  enemies.splice(index,1);const gain=e.score*(player.double>0?2:1);score+=gain;
  comboKills++;comboTimer=3.2;
  const newCombo=comboKills>=15?4:comboKills>=10?3:comboKills>=5?2:1;
  if(newCombo>combo){combo=newCombo;bestCombo=Math.max(bestCombo,combo);SFX.combo();textPop(x,y-10,`COMBO x${combo}`,"#ff73c4")}
  else combo=Math.max(1,newCombo);
  textPop(x,y,`+${gain}`,e.color);burst(x,y,18,e.color,2.8,1.6);ring(x,y,e.color,e.r*2.4);SFX.boom();addShake(e.kind==="tank"?6:2.5);
  if(Math.random()<.06)textPop(x,y-25,"CRITICAL HIT","#fff0a1");
}
function collisions(){
  for(let i=enemies.length-1;i>=0;i--){const e=enemies[i],ex=e.x*W()/dpr,ey=e.y*H()/dpr;
    for(let j=bullets.length-1;j>=0;j--){const b=bullets[j];if(Math.hypot(b.x-ex,b.y-ey)<e.r+7){bullets.splice(j,1);e.hp-=player.double>0?16:8;e.flash=.08;burst(b.x,b.y,4,"#d7fbff",1);SFX.hit();if(e.hp<=0){killEnemy(i)}break}}
  }
}

/* ---------- power-ups ---------- */
function spawnPower(){
  if(powerups.length||boss)return;
  const kind=pick(["rapid","shield","double"]);
  powerups.push({kind,x:rand(.15,.85),y:-.05,vy:55+level*2,age:0});
}
function updatePowerups(dt){
  for(let i=powerups.length-1;i>=0;i--){const p=powerups[i];p.age+=dt;p.y+=p.vy*dt/(H()/dpr);if(p.y>1.08){powerups.splice(i,1);continue}
    const px=player.x*W()/dpr,py=player.y*H()/dpr,x=p.x*W()/dpr,y=p.y*H()/dpr;
    if(Math.hypot(px-x,py-y)<27){powerups.splice(i,1);if(p.kind==="rapid")player.rapid=8;if(p.kind==="shield")player.shield=8;if(p.kind==="double")player.double=10;SFX.power();burst(x,y,22,p.kind==="rapid"?"#ffd35c":p.kind==="shield"?"#62f6ff":"#b6ff83",2.5,1.4);textPop(x,y,p.kind==="rapid"?"RAPID FIRE":p.kind==="shield"?"SHIELD":"DOUBLE SCORE","#fff")}
  }
}
function drawPowerups(){
  const colors={rapid:"#ffd35c",shield:"#62f6ff",double:"#a9ff7d"};
  const labels={rapid:"R",shield:"S",double:"2X"};
  for(const p of powerups){const x=p.x*W()/dpr,y=p.y*H()/dpr,c=colors[p.kind];ctx.save();ctx.translate(x,y);ctx.rotate(p.age*1.8);ctx.shadowBlur=18;ctx.shadowColor=c;ctx.strokeStyle=c;ctx.fillStyle="rgba(8,15,27,.88)";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,-13);ctx.lineTo(13,0);ctx.lineTo(0,13);ctx.lineTo(-13,0);ctx.closePath();ctx.fill();ctx.stroke();ctx.rotate(-p.age*1.8);ctx.fillStyle=c;ctx.font="800 9px system-ui";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(labels[p.kind],0,1);ctx.restore()}
}

/* ---------- progression ---------- */
function progression(dt){
  if(comboTimer>0)comboTimer-=dt;else{combo=1;comboKills=0}
  if(score>=nextLevelScore&&!boss){
    level++;levelStartScore=score;nextLevelScore=score+350+level*110;SFX.level();centerMessage(`LEVEL UP  ${String(level).padStart(2,"0")}`,"#76f7ff",1.5);addShake(5);
    if(level%5===0)setTimeout(()=>spawnBoss(),1100);
  }
  spawnTimer-=dt;if(spawnTimer<=0&&!boss&&bossIntro<=0){spawnEnemy();const base=Math.max(.72,2.25-level*.09);spawnTimer=rand(base*.75,base*1.15)}
  powerTimer-=dt;if(powerTimer<=0&&!boss){spawnPower();powerTimer=rand(15,22)}
}

/* ---------- UI ---------- */
function updateUI(){
  $("score").textContent=String(Math.floor(score)).padStart(6,"0");
  $("highScore").textContent=String(highScore).padStart(6,"0");
  $("startHighScore").textContent=String(highScore).padStart(6,"0");
  $("level").textContent=String(level).padStart(2,"0");
  $("levelProgress").style.width=clamp((score-levelStartScore)/(nextLevelScore-levelStartScore)*100,0,100)+"%";
  $("combo").textContent=`COMBO x${combo}`;$("combo").classList.toggle("hot",combo>=2);
  $("healthText").textContent=`${Math.ceil(player.health)}%`;
  const hb=$("healthBar");hb.style.width=player.health+"%";hb.style.background=player.health<30?"#ff5577":player.health<60?"#ffd35c":"#62f6ff";
  const p=[];if(player.rapid>0)p.push(`RAPID ${Math.ceil(player.rapid)}s`);if(player.shield>0)p.push(`SHIELD ${Math.ceil(player.shield)}s`);if(player.double>0)p.push(`2X ${Math.ceil(player.double)}s`);
  $("powerups").innerHTML=p.map(x=>`<span class="chip">${x}</span>`).join("");
  if(boss){$("bossHud").classList.remove("hidden");$("bossBar").style.width=clamp(boss.hp/boss.max*100,0,100)+"%"}else $("bossHud").classList.add("hidden");
}
let msgTimer=0;
function centerMessage(text,color,dur){const el=$("centerMessage");el.textContent=text;el.style.color=color;el.classList.add("show");msgTimer=dur}
function updateMessage(dt){if(msgTimer>0){msgTimer-=dt;if(msgTimer<=0)$("centerMessage").classList.remove("show")}}
function show(id,on=true){$(id).classList.toggle("hidden",!on)}

/* ---------- particles render ---------- */
function updateParticles(dt){
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;
    if(p.life<=0){particles.splice(i,1);continue}
    if(p.ring){p.r+=(p.maxR-p.r)*dt*7;continue}
    p.x+=p.vx*dt*60;p.y+=p.vy*dt*60;p.vx*=p.drag;p.vy*=p.drag;
  }
  for(let i=texts.length-1;i>=0;i--){const t=texts[i];t.life-=dt;t.y+=t.vy*dt;if(t.life<=0)texts.splice(i,1)}
}
function drawParticles(){
  for(const p of particles){const a=clamp(p.life/(p.max||.7),0,1);ctx.globalAlpha=a;
    if(p.ring){ctx.strokeStyle=p.color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,TAU);ctx.stroke()}
    else{ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,TAU);ctx.fill()}
  }
  ctx.globalAlpha=1;
  for(const t of texts){ctx.globalAlpha=clamp(t.life,0,1);ctx.fillStyle=t.color;ctx.font="800 12px system-ui";ctx.textAlign="center";ctx.shadowBlur=12;ctx.shadowColor=t.color;ctx.fillText(t.t,t.x,t.y);ctx.shadowBlur=0}ctx.globalAlpha=1;
}

/* ---------- lifecycle ---------- */
function resetGame(){
  state="PLAYING";score=0;level=1;levelStartScore=0;nextLevelScore=350;combo=1;comboKills=0;bestCombo=1;
  spawnTimer=1.7;powerTimer=10;boss=null;bossIntro=0;shake=0;flash=0;damageFlash=0;slowMo=1;
  enemies=[];bullets=[];enemyBullets=[];particles=[];powerups=[];texts=[];
  Object.assign(player,{x:.5,y:.86,w:28,h:40,vx:0,speed:.82,health:100,maxHealth:100,fire:0,invuln:0,recoil:0,shield:0,rapid:0,double:0});
  show("startScreen",false);show("pauseScreen",false);show("gameOverScreen",false);show("hud",true);
  initAudio();if(audio)audio.resume();centerMessage("SYSTEMS ONLINE","#6ff8ff",1.1);
}
function pauseGame(){
  if(state==="PLAYING"){state="PAUSED";show("pauseScreen",true)}
  else if(state==="PAUSED"){state="PLAYING";show("pauseScreen",false)}
}
function endGame(){
  if(state==="GAME OVER")return;state="GAME OVER";SFX.gameover();slowMo=.2;setTimeout(()=>slowMo=1,500);addShake(12);
  const isNew=score>highScore;if(isNew){highScore=Math.floor(score);localStorage.setItem("novaStrikeHighScore",highScore)}
  $("finalScore").textContent=String(Math.floor(score)).padStart(6,"0");$("finalLevel").textContent=String(level).padStart(2,"0");$("finalCombo").textContent="x"+bestCombo;
  show("newRecord",isNew);show("gameOverScreen",true);
}
function start(){resetGame()}

/* ---------- input ---------- */
addEventListener("keydown",e=>{
  if(["ArrowLeft","ArrowRight","Space"].includes(e.code))e.preventDefault();
  if(e.code==="KeyA"||e.code==="ArrowLeft")keys.left=true;
  if(e.code==="KeyD"||e.code==="ArrowRight")keys.right=true;
  if(e.code==="Space")keys.fire=true;
  if(e.code==="KeyP")pauseGame();
  if(e.code==="Enter"&&state==="START")start();
});
addEventListener("keyup",e=>{
  if(e.code==="KeyA"||e.code==="ArrowLeft")keys.left=false;
  if(e.code==="KeyD"||e.code==="ArrowRight")keys.right=false;
  if(e.code==="Space")keys.fire=false;
});
document.querySelectorAll(".touch-controls button").forEach(b=>{
  const k=b.dataset.key;
  const on=e=>{e.preventDefault();keys[k]=true;initAudio()};
  const off=e=>{e.preventDefault();keys[k]=false};
  b.addEventListener("touchstart",on,{passive:false});b.addEventListener("touchend",off,{passive:false});b.addEventListener("touchcancel",off,{passive:false});
  b.addEventListener("mousedown",on);b.addEventListener("mouseup",off);b.addEventListener("mouseleave",off);
});
$("launchBtn").onclick=start;$("redeployBtn").onclick=start;$("pauseBtn").onclick=pauseGame;$("resumeBtn").onclick=pauseGame;$("pauseRestartBtn").onclick=start;

/* ---------- main loop ---------- */
function update(dt){
  time+=dt*1000;updateMessage(dt);updateParticles(dt);
  if(state!=="PLAYING")return;
  dt*=slowMo;
  updatePlayer(dt);updateBullets(dt);updateEnemies(dt);updateBoss(dt);updatePowerups(dt);collisions();progression(dt);
  flash=Math.max(0,flash-dt);damageFlash=Math.max(0,damageFlash-dt);shake=Math.max(0,shake-dt*18);
  updateUI();
}
function render(){
  const w=W()/dpr,h=H()/dpr;ctx.save();
  let sx=0,sy=0;if(shake>0){sx=rand(-shake,shake);sy=rand(-shake,shake)}
  ctx.translate(sx,sy);
  drawBackground(1/60);drawPowerups();drawBullets();
  for(const e of enemies)drawEnemy(e);
  if(boss)drawBoss();
  drawParticles();drawPlayer();
  if(damageFlash>0){ctx.fillStyle=`rgba(255,45,75,${damageFlash*.16})`;ctx.fillRect(-sx,-sy,w,h)}
  if(flash>0){ctx.fillStyle=`rgba(190,240,255,${flash*.15})`;ctx.fillRect(-sx,-sy,w,h)}
  ctx.restore();
}
function drawBoss(){
  const w=W()/dpr,h=H()/dpr,x=boss.x*w,y=boss.y*h;ctx.save();ctx.translate(x,y);
  const pulse=1+Math.sin(boss.age*4)*.035;ctx.scale(pulse,pulse);ctx.shadowBlur=25;ctx.shadowColor="#ff5577";
  ctx.fillStyle="#090d1c";ctx.strokeStyle=boss.flash>0?"#fff":"#ff6c8f";ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(0,-52);ctx.lineTo(50,-27);ctx.lineTo(68,4);ctx.lineTo(45,34);ctx.lineTo(17,45);ctx.lineTo(0,32);ctx.lineTo(-17,45);ctx.lineTo(-45,34);ctx.lineTo(-68,4);ctx.lineTo(-50,-27);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.shadowBlur=0;ctx.strokeStyle="#a78bff";ctx.beginPath();ctx.moveTo(-44,-10);ctx.lineTo(-22,8);ctx.lineTo(-10,-34);ctx.moveTo(44,-10);ctx.lineTo(22,8);ctx.lineTo(10,-34);ctx.stroke();
  ctx.fillStyle="#ff5577";ctx.shadowBlur=18;ctx.shadowColor="#ff5577";ctx.beginPath();ctx.arc(0,3,13,0,TAU);ctx.fill();ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(0,3,4,0,TAU);ctx.fill();
  ctx.restore();
}
function loop(ts){
  if(!last)last=ts;const dt=Math.min(.033,(ts-last)/1000);last=ts;update(dt);render();requestAnimationFrame(loop)
}
requestAnimationFrame(loop);
updateUI();
})();
