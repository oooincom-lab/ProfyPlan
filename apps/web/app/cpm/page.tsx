/**
 * CPM Network Graph — точная копия network_graph.html (Вариант 2: дни на связях + Старт/Финиш)
 * При загрузке рендерит демо-граф (12 узлов: Старт, 10 операций, Финиш).
 * API-загрузка проектов — опционально.
 */
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getProjects, runCPM, login, logout, getBOMTree, explodeAndSaveBOM, uploadBOM } from '@/lib/api';
import type { BOMNode } from '@/lib/api';
import ExcelImportWizard from '@/components/ExcelImportWizard';
import GanttChart from '@/components/CpmGanttChart';

// ── Типы ──
interface Op {
  id: string; num: number | string; name: string;
  dur: number; unit: string; es: number; ef: number;
  ls: number; lf: number; tf: number; crit: number;
}
type Mode = 'absolute' | 'relative';
type Layout = Record<string, [number, number]>;

// ── Константы ──
let NODE_R = 26, MIN_NODE_GAP = 60, REL_SCALE = 500;
const PROJECT_START = new Date(2026, 6, 29);

// ── Демо-данные (точь-в-точь из network_graph.html) ──
const DEMO_OPS: Op[] = [
  { id:"S", num:'S', name:"Старт", dur:0, unit:'d', es:0, ef:0, ls:0, lf:0, tf:0, crit:1 },
  { id:"1", num:1, name:"Подготовка инструмента", dur:4, unit:'h', es:0, ef:0.1667, ls:0, lf:0.1667, tf:0, crit:1 },
  { id:"2", num:2, name:"Закупка компонентов", dur:8, unit:'h', es:0.1667, ef:0.5, ls:0.1667, lf:0.5, tf:0, crit:1 },
  { id:"3", num:3, name:"Монтаж SMD", dur:8, unit:'h', es:0.5, ef:0.8333, ls:0.5, lf:0.8333, tf:0, crit:1 },
  { id:"4", num:4, name:"Пайка волной", dur:6, unit:'h', es:0.8333, ef:1.0833, ls:0.8333, lf:1.0833, tf:0, crit:1 },
  { id:"5", num:5, name:"Контроль AOI", dur:15, unit:'m', es:1.0833, ef:1.0938, ls:1.0833, lf:1.0938, tf:0, crit:1 },
  { id:"6", num:6, name:"Функциональный тест", dur:3, unit:'h', es:1.0938, ef:1.2188, ls:1.0938, lf:1.2188, tf:0, crit:1 },
  { id:"7", num:7, name:"Термотренировка", dur:12, unit:'h', es:1.2188, ef:1.7188, ls:1.2188, lf:1.7188, tf:0, crit:1 },
  { id:"8", num:8, name:"Калибровка датчиков", dur:1, unit:'h', es:1.2188, ef:1.2604, ls:1.7188, lf:1.7604, tf:0.5, crit:0 },
  { id:"9", num:9, name:"Выходной контроль", dur:30, unit:'m', es:1.7188, ef:1.7396, ls:1.7188, lf:1.7396, tf:0, crit:1 },
  { id:"10",num:10,name:"Маркировка и упаковка", dur:1, unit:'h', es:1.7396, ef:1.7813, ls:1.7396, lf:1.7813, tf:0, crit:1 },
  { id:"F", num:'F', name:"Финиш", dur:0, unit:'d', es:1.7813, ef:1.7813, ls:1.7813, lf:1.7813, tf:0, crit:1 },
];

const DEMO_DEPS: [string, string][] = [
  ["S","1"],["1","2"],["2","3"],["3","4"],["4","5"],["5","6"],
  ["6","7"],["7","9"],["9","10"],["10","F"],
  ["3","8"],["8","9"]
];

// ── Выходные и праздники 2026 ──
const HOLIDAYS_2026 = new Set([
  '2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05','2026-01-06','2026-01-07','2026-01-08',
  '2026-02-23','2026-03-08','2026-05-01','2026-05-09','2026-06-12','2026-11-04'
]);
function isWeekend(d:Date){return d.getDay()===0||d.getDay()===6;}
function isHoliday(d:Date){var s=d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);return HOLIDAYS_2026.has(s);}

// ── Единицы измерения ──
const UNITS:Record<string,string>={s:'сек',m:'мин',h:'ч',d:'дн',w:'нед',mo:'мес',y:'год'};
function toDays(dur:number,unit:string){if(unit==='h')return dur/24;if(unit==='m')return dur/1440;if(unit==='s')return dur/86400;return dur;}
function fmtDur(dur:number,unit:string,dispUnit:string){
  if(!unit)unit='d';if(dur<=0)return '-';
  var td=toDays(dur,unit);
  if(dispUnit==='m')return Math.ceil(td*1440)+' '+UNITS.m;
  if(dispUnit==='h')return Math.ceil(td*24)+' '+UNITS.h;
  return Math.ceil(td)+' '+UNITS.d;
}

// ── Вспомогательные ──
function getNodeR(scale:number){
  var r = NODE_R * (0.72 / Math.max(scale, 0.35));
  return Math.min(Math.max(r, 22), 40);
}
function addDays(d:Date,days:number){var r=new Date(d);r.setDate(r.getDate()+days);return r;}
function fmt(d:Date){return (d.getDate()<10?'0':'')+d.getDate()+'.'+(d.getMonth()<9?'0':'')+(d.getMonth()+1);}

// ── Layout: BFS + force-directed (spreadLayersVertical) ──
function spreadLayersVertical(layout:Layout, ops:Op[], deps:[string,string][], sprMode:number, om:Record<string,Op>){
  var ROW_MIN_Y=100,ROW_MAX_Y=580;
  var waveAmp=[40,72,120][sprMode];
  var fanSpread=[0.4,0.8,1.4][sprMode];
  var relaxIter=[6,12,20][sprMode];
  var sepDist=[NODE_R*2.2,NODE_R*3.5,NODE_R*5][sprMode];
  var yCenter=340;

  var allIds=Object.keys(layout);
  var adj:Record<string,{in:string[],out:string[]}>={};
  for(var i=0;i<allIds.length;i++)adj[allIds[i]]={in:[],out:[]};
  for(var i=0;i<deps.length;i++){
    var a=deps[i][0],b=deps[i][1];if(!adj[a]||!adj[b])continue;
    adj[a].out.push(b);adj[b].in.push(a);
  }

  // BFS from roots
  var visited:Record<string,boolean>={},queue:string[]=[],roots:string[]=[];
  for(var i=0;i<allIds.length;i++)if(allIds[i]==='S'||adj[allIds[i]].in.length===0){roots.push(allIds[i]);visited[allIds[i]]=true;}
  for(var i=0;i<roots.length;i++)layout[roots[i]][1]=yCenter-((i-(roots.length-1)/2)*waveAmp*0.5);
  for(var i=0;i<roots.length;i++)queue.push(roots[i]);

  while(queue.length>0){
    var id=queue.shift()!,kids=adj[id].out;
    if(kids.length===0)continue;
    var py=layout[id][1];
    for(var i=0;i<kids.length;i++){
      var kid=kids[i];if(visited[kid])continue;
      var targetY=py+((i-(kids.length-1)/2))*waveAmp*fanSpread;
      var pCount=0;
      for(var jj=0;jj<adj[kid].in.length;jj++){var p=adj[kid].in[jj];if(visited[p]&&layout[p]){targetY=(pCount===0?layout[p][1]:(targetY+layout[p][1])/2);pCount++;}}
      targetY=Math.max(ROW_MIN_Y+NODE_R+10,Math.min(ROW_MAX_Y-NODE_R-10,targetY));
      layout[kid][1]=targetY;
      visited[kid]=true;queue.push(kid);
    }
  }

  // Force-directed relaxation
  for(var iter=0;iter<relaxIter;iter++){
    for(var i=0;i<allIds.length;i++){
      var a2=allIds[i],pa=layout[a2];if(!pa)continue;
      var isLeaf=adj[a2].in.length+adj[a2].out.length<=2;
      var isCrit=(om[a2]&&om[a2].crit);
      var pushMult=isCrit?0.2:(isLeaf?5:0.5);
      for(var j=i+1;j<allIds.length;j++){
        var b=allIds[j],pb=layout[b];if(!pb)continue;
        var dx=Math.abs(pa[0]-pb[0]);
        var maxDX=NODE_R*(7+sprMode*3);if(dx>maxDX)continue;
        var dy=pa[1]-pb[1];
        var minDY=sepDist;
        if(dx<NODE_R*2)minDY*=1.5;
        if(Math.abs(dy)<minDY){
          var nudge=(minDY-Math.abs(dy)+1)/2*pushMult;
          var newY=pa[1]+nudge*Math.sign(dy||1);
          var crosses=false;
          if(!isLeaf||dx>NODE_R*3){
          for(var kk=0;kk<deps.length;kk++){
            var da=deps[kk][0],db=deps[kk][1];if(da===a2||db===a2||da===b||db===b)continue;
            if(!layout[da]||!layout[db])continue;
            var pda=layout[da],pdb=layout[db];
            var exMin=Math.min(pda[0],pdb[0]),exMax=Math.max(pda[0],pdb[0]);
            if(pa[0]>=exMin-NODE_R&&pa[0]<=exMax+NODE_R){
              var eyCenter=(pda[1]+pdb[1])/2;
              if(Math.abs(newY-eyCenter)<sepDist*0.35){crosses=true;break;}
            }
          }}
          if(!crosses){pa[1]=newY;}
          pa[1]=Math.max(ROW_MIN_Y+NODE_R+10,Math.min(ROW_MAX_Y-NODE_R-10,pa[1]));
        }
      }
      if(!isCrit&&isLeaf){
        var targetEdge=pa[1]<yCenter?ROW_MIN_Y+NODE_R+10:ROW_MAX_Y-NODE_R-10;
        pa[1]+=(targetEdge-pa[1])*([0.06,0.12,0.20][sprMode]);
        pa[1]=Math.max(ROW_MIN_Y+NODE_R+10,Math.min(ROW_MAX_Y-NODE_R-10,pa[1]));
      }
    }
  }
  // Final: title/reserve overlap
  var TITLE_PAD=NODE_R+14,RESERVE_PAD=NODE_R+16;
  for(var iter2=0;iter2<6;iter2++){
    for(var i=0;i<allIds.length;i++){
      var aa=allIds[i],ppa=layout[aa];if(!ppa)continue;
      for(var j=i+1;j<allIds.length;j++){
        var bb=allIds[j],ppb=layout[bb];if(!ppb)continue;
        var dxx=Math.abs(ppa[0]-ppb[0]);
        if(dxx>NODE_R*4)continue;
        var tY1=ppa[1]-TITLE_PAD,tY2=ppb[1]-TITLE_PAD;
        var rY1=ppa[1]+RESERVE_PAD,rY2=ppb[1]+RESERVE_PAD;
        var nudge2=0;
        if(Math.abs(tY1-tY2)<12)nudge2=(12-Math.abs(tY1-tY2))*(ppa[1]>ppb[1]?1:-1);
        else if(Math.abs(rY1-rY2)<10)nudge2=(10-Math.abs(rY1-rY2))*(ppa[1]>ppb[1]?1:-1);
        if(nudge2!==0){ppa[1]+=nudge2/2;ppb[1]-=nudge2/2;}
      }
    }
  }
}

function buildAbsoluteLayout(ops:Op[],deps:[string,string][],sprMode:number){
  var layers:Record<number,string[]>={};
  for(var i=0;i<ops.length;i++){var k=ops[i].es;if(!layers[k])layers[k]=[];layers[k].push(ops[i].id);}
  var layerOrder=Object.keys(layers).map(Number).sort(function(a,b){return a-b;});
  var layout:Layout={};
  for(var li=0;li<layerOrder.length;li++){
    var lx=30+li*150,ids=layers[layerOrder[li]];
    var startY=340-((ids.length-1)*NODE_R*3.2)/2;
    for(var i=0;i<ids.length;i++)layout[ids[i]]=[lx,startY+i*NODE_R*3.2];
  }
  var om:Record<string,Op>={};for(var i=0;i<ops.length;i++)om[ops[i].id]=ops[i];
  spreadLayersVertical(layout,ops,deps,sprMode,om);
  return layout;
}

function buildRelativeLayout(ops:Op[],deps:[string,string][],sprMode:number){
  var layout:Layout={},layers:Record<number,string[]>={};
  for(var i=0;i<ops.length;i++){var k=ops[i].es;if(!layers[k])layers[k]=[];layers[k].push(ops[i].id);}
  var layerOrder=Object.keys(layers).map(Number).sort(function(a,b){return a-b;});
  for(var li=0;li<layerOrder.length;li++){
    var es=layerOrder[li],lx=30+es*REL_SCALE,ids=layers[es];
    var startY=340-((ids.length-1)*NODE_R*3.2)/2;
    for(var i=0;i<ids.length;i++)layout[ids[i]]=[lx,startY+i*NODE_R*3.2];
  }
  for(var li=1;li<layerOrder.length;li++){
    var prevEs=layerOrder[li-1],curEs=layerOrder[li];
    var prevX=layout[layers[prevEs][0]][0],curX=layout[layers[curEs][0]][0];
    if(curX-prevX<MIN_NODE_GAP){var delta=MIN_NODE_GAP-(curX-prevX);for(var i=0;i<layers[curEs].length;i++)layout[layers[curEs][i]][0]+=delta;}
  }
  var om:Record<string,Op>={};for(var i=0;i<ops.length;i++)om[ops[i].id]=ops[i];
  spreadLayersVertical(layout,ops,deps,sprMode,om);
  return layout;
}

function cloneLayout(src:Layout):Layout{var o:Layout={};for(var k in src)o[k]=[src[k][0],src[k][1]];return o;}

// ── КОМПОНЕНТ ──
export default function CPMPage(){
  // State
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string|null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [label, setLabel] = useState('PCB-1421 · CPM');
  const [viewMode, setViewMode] = useState<Mode>('absolute');
  const [critOnly, setCritOnly] = useState(false);
  const [cpDur, setCpDur] = useState('~1.8');
  const [cpCount, setCpCount] = useState(9);
  const [canvasState, setCanvasState] = useState('');
  const [scalePercent, setScalePercent] = useState(70);
  // Sliders
  const [displayUnit, setDisplayUnit] = useState('d'); // m, h, d
  const [sprMode, setSprMode] = useState(1); // 0=сдерж, 1=оптим, 2=агрес
  const [fontScale, setFontScale] = useState(1.0); // 1.0 or 1.5
  // Excel import wizard
  const [showExcelWizard, setShowExcelWizard] = useState(false);
  const [chartView, setChartView] = useState<'network'|'gantt'>('network');
  const [ganttOps, setGanttOps] = useState<any[]>([]);
  const [ganttDeps, setGanttDeps] = useState<any[]>([]);

  // BOM panel
  const [bomPanel, setBomPanel] = useState(false);
  const [bomNodes, setBomNodes] = useState<BOMNode[]>([]);
  const [bomLoading, setBomLoading] = useState(false);
  const [bomExploding, setBomExploding] = useState(false);
  const [bomMsg, setBomMsg] = useState<string|null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Mutable refs
  const opsRef = useRef(DEMO_OPS);
  const depsRef = useRef(DEMO_DEPS);
  const omRef = useRef<Record<string,Op>>({});
  const posRef = useRef<Layout>({});
  const absLayoutRef = useRef<Layout>({});
  const relLayoutRef = useRef<Layout>({});

  const scaleRef = useRef(0.7);
  const oxRef = useRef(0);
  const oyRef = useRef(0);
  const dragRef = useRef<{id:string;p0:[number,number];m0:[number,number]}|null>(null);
  const panRef = useRef<{active:boolean;sx:number;sy:number;ox:number;oy:number}>({active:false,sx:0,sy:0,ox:0,oy:0});
  const critOnlyRef = useRef(false);
  const viewModeRef = useRef<Mode>('absolute');
  const hoverIdRef = useRef<string|null>(null);
  const displayUnitRef = useRef('d');
  const sprModeRef = useRef(1);
  const fontScaleRef = useRef(1.0);
  const relScaleRef = useRef(500);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  // Sync
  useEffect(()=>{critOnlyRef.current=critOnly;},[critOnly]);
  useEffect(()=>{viewModeRef.current=viewMode;},[viewMode]);
  useEffect(()=>{displayUnitRef.current=displayUnit;},[displayUnit]);
  useEffect(()=>{sprModeRef.current=sprMode;},[sprMode]);
  useEffect(()=>{fontScaleRef.current=fontScale;},[fontScale]);

  function fitToScreen(){
    var W=window.innerWidth,H=window.innerHeight-53;
    scaleRef.current=(W*0.82)/1500;
    if(scaleRef.current<0.22)scaleRef.current=0.22;
    if(scaleRef.current>1.5)scaleRef.current=1.5;
    oxRef.current=(W/scaleRef.current-1500)/2;
    oyRef.current=(H/scaleRef.current-460)/2-20;
    if(oyRef.current<-40)oyRef.current=-40;
    setScalePercent(Math.round(scaleRef.current*100));
  }

  function setupLayout(ops:Op[],deps:[string,string][]){
    var om:Record<string,Op>={};for(var i=0;i<ops.length;i++)om[ops[i].id]=ops[i];
    omRef.current=om;
    absLayoutRef.current=buildAbsoluteLayout(ops,deps,sprModeRef.current);
    relLayoutRef.current=buildRelativeLayout(ops,deps,sprModeRef.current);
    posRef.current=cloneLayout(viewModeRef.current==='absolute'?absLayoutRef.current:relLayoutRef.current);
    fitToScreen();
  }

  // Init demo
  useEffect(()=>{
    setupLayout(DEMO_OPS,DEMO_DEPS);
    getProjects().then((res:any)=>{
      var items=Array.isArray(res.items||res)?(res.items||res):[];
      setProjects(items);
    }).catch(()=>{});
  },[]);

  // Draw
  const draw = useCallback(()=>{
    var c=canvasRef.current,wrap=wrapRef.current;
    if(!c||!wrap)return;
    var ctx=c.getContext('2d')!;
    var W=wrap.clientWidth,H=wrap.clientHeight;
    c.width=W*devicePixelRatio;c.height=H*devicePixelRatio;
    c.style.width=W+'px';c.style.height=H+'px';
    ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
    ctx.fillStyle='#0A1628';ctx.fillRect(0,0,W,H);

    var ops=opsRef.current,deps=depsRef.current,om=omRef.current,
      pos=posRef.current,scale=scaleRef.current,ox=oxRef.current,oy=oyRef.current,
      viewMode=viewModeRef.current,critOnly=critOnlyRef.current,
      dispUnit=displayUnitRef.current,fs=fontScaleRef.current,
      rScale=relScaleRef.current;

    function sx(wx:number){return(wx+ox)*scale;}
    function sy(wy:number){return(wy+oy)*scale;}

    // Timeline grid (relative only)
    if(viewMode==='relative'){
      var totalDays=Math.ceil(ops.reduce(function(m,o){return Math.max(m,o.ef);},0));
      var startX=30,endX=startX+totalDays*rScale;
      var unitPx=rScale*scale;
      var lStep:number,gStep:number;
      if(dispUnit==='m'){
        var mp=unitPx/1440;
        if(mp>120)lStep=1/1440;else if(mp>60)lStep=5/1440;else if(mp>25)lStep=15/1440;else if(mp>12)lStep=30/1440;else if(mp>6)lStep=1/24;else lStep=2/24;
        if(mp>60)gStep=1/1440;else if(mp>25)gStep=5/1440;else if(mp>8)gStep=15/1440;else gStep=1/24;
      }else if(dispUnit==='h'){
        var hp=unitPx/24;
        if(hp>150)lStep=1/24;else if(hp>70)lStep=2/24;else if(hp>30)lStep=4/24;else if(hp>15)lStep=6/24;else lStep=1;
        if(hp>60)gStep=1/24;else if(hp>20)gStep=2/24;else gStep=4/24;
      }else{
        var dp=unitPx;
        if(dp>120)lStep=1;else if(dp>60)lStep=2;else if(dp>30)lStep=4;else if(dp>12)lStep=7;else lStep=14;
        if(dp>60)gStep=1;else if(dp>20)gStep=2;else if(dp>8)gStep=7;else gStep=14;
      }
      var sgStep=gStep/4;if(gStep<1/24)sgStep=0;
      var fullStartD=Math.floor(Math.min(0,(-ox)/rScale)/Math.max(gStep,1e-9))*Math.max(gStep,1e-9);
      var fullEndD=Math.ceil(Math.max(totalDays,((W/scale)-ox)/rScale)/Math.max(gStep,1e-9))*Math.max(gStep,1e-9);

      // Weekend/holiday strips
      for(var d=0;d<totalDays;d++){
        var date=addDays(PROJECT_START,d);
        if(isWeekend(date)||isHoliday(date)){
          var x1=sx(startX+d*rScale),x2=sx(startX+(d+1)*rScale);
          if(x2<0||x1>W)continue;
          ctx.fillStyle='rgba(239,68,68,0.04)';
          ctx.fillRect(Math.max(0,x1),0,Math.min(W,x2-x1),H);
        }
      }
      // Sub-grid
      if(sgStep>0)for(var d2=fullStartD;d2<=fullEndD;d2+=sgStep){
        var gx2=sx(startX+d2*rScale);if(gx2<-50||gx2>W+50)continue;
        ctx.beginPath();ctx.moveTo(gx2,0);ctx.lineTo(gx2,H);
        ctx.strokeStyle='rgba(60,90,130,0.12)';ctx.lineWidth=0.3;ctx.stroke();
      }
      // Grid
      for(var d3=fullStartD;d3<=fullEndD;d3+=gStep){
        var gx3=sx(startX+d3*rScale);if(gx3<-50||gx3>W+50)continue;
        ctx.beginPath();ctx.moveTo(gx3,0);ctx.lineTo(gx3,H);
        ctx.strokeStyle='rgba(60,90,130,0.45)';ctx.lineWidth=0.6;ctx.stroke();
      }

      // Time-scale bar — full width
      var barY=34,barH=22;
      ctx.fillStyle='rgba(15,30,54,0.7)';ctx.beginPath();ctx.roundRect(0,barY,W,barH,6);ctx.fill();
      ctx.beginPath();ctx.moveTo(0,barY+barH/2);ctx.lineTo(W,barY+barH/2);
      ctx.strokeStyle='rgba(96,165,250,0.35)';ctx.lineWidth=1;ctx.stroke();

      // Context labels above time bar
      var ctxRows:{step:number;fmt:string;fs:number}[];
      if(dispUnit==='m')ctxRows=[{step:1/24,fmt:'h',fs:10},{step:1,fmt:'d',fs:9},{step:30,fmt:'mo',fs:9},{step:365,fmt:'y',fs:9}];
      else if(dispUnit==='h')ctxRows=[{step:1,fmt:'d',fs:10},{step:30,fmt:'mo',fs:9},{step:365,fmt:'y',fs:9}];
      else ctxRows=[{step:30,fmt:'mo',fs:10},{step:365,fmt:'y',fs:9}];
      var MNctx=['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
      for(var ci=0;ci<ctxRows.length;ci++){
        var cs=ctxRows[ci].step,cY=barY-4-(ci+1)*13;
        var prevCX=-999;
        for(var dd2=fullStartD;dd2<=fullEndD;dd2+=cs){
          var gx4=sx(startX+dd2*rScale);if(gx4<-20||gx4>W+20)continue;
          var ddd=Math.floor(dd2),dt=addDays(PROJECT_START,ddd),cl='';
          if(ctxRows[ci].fmt==='h'){var thh2=Math.floor(dd2*24)%24;cl=('0'+thh2).slice(-2)+':00';}
          else if(ctxRows[ci].fmt==='d')cl=fmt(dt);
          else if(ctxRows[ci].fmt==='mo')cl=MNctx[dt.getMonth()];
          else cl=''+dt.getFullYear();
          var cfsz=Math.round(ctxRows[ci].fs*scale*fs);if(cfsz<7)cfsz=7;if(cfsz>13)cfsz=13;
          ctx.fillStyle='rgba(90,112,144,0.55)';ctx.font=cfsz+'px "IBM Plex Mono",monospace';
          ctx.textAlign='center';ctx.textBaseline='top';
          var lw=ctx.measureText(cl).width;
          if(gx4-lw/2>prevCX){ctx.fillText(cl,gx4,cY);prevCX=gx4+lw/2;}
        }
      }
      // Labels
      var prevLR=-999;
      for(var dd3=fullStartD;dd3<=fullEndD;dd3+=lStep){
        var gx5=sx(startX+dd3*rScale);if(gx5<-20||gx5>W+20)continue;
        ctx.beginPath();ctx.moveTo(gx5,barY+3);ctx.lineTo(gx5,barY+barH-3);
        ctx.strokeStyle='rgba(90,112,144,0.5)';ctx.lineWidth=0.8;ctx.stroke();
        if(dd3<0||dd3>totalDays)continue;
        var tlabel:string,isTime=false;
        if(dispUnit==='m'){isTime=true;
          var th=dd3*24*60,tm=Math.round(th%60),thh=Math.floor(th/60)%24;
          if(tm===60){thh++;tm=0;}tlabel=(thh<10?'0':'')+thh+':'+(tm<10?'0':'')+tm;
        }else if(dispUnit==='h'){isTime=true;
          var th2=dd3*24,hh=Math.round(th2)%24;tlabel=(hh<10?'0':'')+hh+':00';
        }else{
          var ddd2=Math.floor(dd3);tlabel=fmt(addDays(PROJECT_START,ddd2));
        }
        var fsz2=Math.round((isTime?11:10)*scale*fs);
        if(fsz2<7)fsz2=7;if(fsz2>14*fs)fsz2=14*fs;
        ctx.fillStyle=isTime?'rgba(96,165,250,0.8)':'#B0C4DE';
        ctx.font=(isTime?'bold ':'')+fsz2+'px "IBM Plex Mono",monospace';
        ctx.textAlign='center';ctx.textBaseline='top';
        var lw2=ctx.measureText(tlabel).width;
        if(gx5-lw2/2>prevLR){ctx.fillText(tlabel,gx5,barY+barH+4);prevLR=gx5+lw2/2;}
      }
    }

    // Visible nodes
    var vis=critOnly?ops.filter(function(o:Op){return o.crit;}):ops;
    var vs:Record<string,boolean>={};for(var i=0;i<vis.length;i++)vs[vis[i].id]=true;

    // Position S and F relative to neighbors
    if(pos['S']&&ops[1]&&pos[ops[1].id]){var refPos=pos[ops[1].id];pos['S']=[refPos[0]-NODE_R*2.8,refPos[1]];}
    if(pos['F']&&ops[ops.length-2]&&pos[ops[ops.length-2].id]){var refPos2=pos[ops[ops.length-2].id];pos['F']=[refPos2[0]+NODE_R*2.8,refPos2[1]];}

    // Edges
    for(var i=0;i<deps.length;i++){
      var a=deps[i][0],b=deps[i][1];if(!vs[a]||!vs[b])continue;
      var fa=om[a],fb=om[b],pa=pos[a],pb=pos[b];
      if(!pa||!pb)continue;
      var ang=Math.atan2(pb[1]-pa[1],pb[0]-pa[0]),nr=getNodeR(scale);
      var ax=pa[0]+Math.cos(ang)*nr,ay=pa[1]+Math.sin(ang)*nr;
      var bx=pb[0]-Math.cos(ang)*nr,by=pb[1]-Math.sin(ang)*nr;
      var both=(fa&&fb)?(fa.crit&&fb.crit):false;
      ctx.beginPath();ctx.moveTo(sx(ax),sy(ay));ctx.lineTo(sx(bx),sy(by));
      ctx.strokeStyle=both?'rgba(239,68,68,0.35)':'rgba(96,165,250,0.30)';
      ctx.lineWidth=both?1.8:1.2;ctx.stroke();
      // Arrowhead
      var ang2=Math.atan2(sy(by)-sy(ay),sx(bx)-sx(ax)),hl=8;
      ctx.beginPath();ctx.moveTo(sx(bx),sy(by));
      ctx.lineTo(sx(bx)-hl*Math.cos(ang2-0.45),sy(by)-hl*Math.sin(ang2-0.45));
      ctx.lineTo(sx(bx)-hl*Math.cos(ang2+0.45),sy(by)-hl*Math.sin(ang2+0.45));ctx.closePath();
      ctx.fillStyle=both?'rgba(239,68,68,0.45)':'rgba(96,165,250,0.4)';ctx.fill();
      // Duration label on edge midpoint
      if(fa&&fa.dur>0){
        var midX=(ax+bx)/2,midY=(ay+by)/2,perpAng=ang+Math.PI/2;
        var loff=10,mx2=midX+Math.cos(perpAng)*loff,my2=midY+Math.sin(perpAng)*loff;
        ctx.save();
        var lbl=fmtDur(fa.dur,fa.unit,dispUnit);
        ctx.font='bold '+Math.round(10*scale*fs)+'px "IBM Plex Mono",monospace';
        ctx.textAlign='center';ctx.textBaseline='middle';
        var txtW=ctx.measureText(lbl).width+8,txtH=Math.round(10*scale)+6;
        ctx.globalAlpha=0.75;ctx.fillStyle=both?'rgba(10,22,40,0.6)':'#0A1628';
        ctx.beginPath();ctx.roundRect(sx(mx2)-txtW/2,sy(my2)-txtH/2,txtW,txtH,3);ctx.fill();
        ctx.globalAlpha=1;ctx.fillStyle=both?'rgba(239,68,68,1)':'rgba(176,196,222,0.9)';
        ctx.fillText(lbl,sx(mx2),sy(my2));
        ctx.restore();
      }
    }

    // Nodes
    for(var i=0;i<vis.length;i++){
      var o=vis[i],p=pos[o.id];
      if(!p)continue;
      var cx=sx(p[0]),cy=sy(p[1]),nr=getNodeR(scale),r=nr*scale;
      // Start diamond
      if(o.id==='S'){
        var hs=r+8;ctx.beginPath();ctx.moveTo(cx,cy-hs);ctx.lineTo(cx+hs*0.75,cy);ctx.lineTo(cx,cy+hs);ctx.lineTo(cx-hs*0.75,cy);ctx.closePath();
        ctx.fillStyle='rgba(16,185,129,0.15)';ctx.fill();
        ctx.strokeStyle='rgba(16,185,129,0.6)';ctx.lineWidth=2;ctx.stroke();
        ctx.fillStyle='#10B981';ctx.font='bold '+Math.round(13*scale*fs)+'px "IBM Plex Mono",monospace';
        ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('S',cx,cy);
        ctx.fillStyle='rgba(16,185,129,0.7)';ctx.font=Math.round(9*scale*fs)+'px Inter,system-ui';ctx.textBaseline='bottom';
        ctx.fillText(o.name,cx,cy-hs-4);continue;
      }
      // Finish square
      if(o.id==='F'){
        var ss=r*1.0;ctx.beginPath();ctx.rect(cx-ss,cy-ss,ss*2,ss*2);
        ctx.fillStyle='rgba(139,92,246,0.15)';ctx.fill();
        ctx.strokeStyle='rgba(139,92,246,0.6)';ctx.lineWidth=2;ctx.stroke();
        ctx.fillStyle='#8B5CF6';ctx.font='bold '+Math.round(12*scale*fs)+'px "IBM Plex Mono",monospace';
        ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('F',cx,cy);
        ctx.fillStyle='rgba(139,92,246,0.7)';ctx.font=Math.round(9*scale*fs)+'px Inter,system-ui';ctx.textBaseline='bottom';
        ctx.fillText(o.name,cx,cy-ss-4);continue;
      }
      // Regular node
      ctx.beginPath();ctx.arc(cx,cy,r+3,0,2*Math.PI);
      ctx.fillStyle=o.crit?'rgba(239,68,68,0.06)':'rgba(59,130,246,0.03)';ctx.fill();
      ctx.beginPath();ctx.arc(cx,cy,r,0,2*Math.PI);
      ctx.fillStyle=o.crit?'rgba(239,68,68,0.08)':'rgba(96,165,250,0.08)';ctx.fill();
      ctx.strokeStyle=o.crit?'rgba(239,68,68,0.5)':'rgba(96,165,250,0.55)';ctx.lineWidth=o.crit?2:1.5;ctx.stroke();
      // Number — centered, no duration inside
      ctx.fillStyle='#E8EEF5';ctx.font='bold '+Math.round(12*scale*fs)+'px "IBM Plex Mono",monospace';
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(o.num),cx,cy);
      // Name above
      ctx.fillStyle=o.crit?'#E8EEF5':'rgba(176,196,222,0.7)';
      ctx.font=Math.round(10*scale*fs)+'px Inter,system-ui';ctx.textBaseline='bottom';
      var sn=o.name;if(sn.length>16)sn=sn.slice(0,15)+'\u2026';ctx.fillText(sn,cx,cy-r-6);
      // Reserve below — only for non-critical
      if(!o.crit&&o.tf>0){
        ctx.fillStyle='#F59E0B';ctx.font=Math.round(9*scale*fs)+'px "IBM Plex Mono",monospace';
        ctx.textBaseline='top';ctx.fillText('+'+o.tf,cx,cy+r+4);
      }
    }
  },[]);

  // Initial draw
  useEffect(()=>{var t=setTimeout(()=>draw(),50);return ()=>clearTimeout(t);},[draw]);

  // Resize
  useEffect(()=>{var r=()=>{fitToScreen();draw();};window.addEventListener('resize',r);return ()=>window.removeEventListener('resize',r);},[draw]);

  // Switch mode
  var switchMode=useCallback((mode:Mode)=>{
    if(mode===viewModeRef.current)return;
    viewModeRef.current=mode;setViewMode(mode);
    absLayoutRef.current=buildAbsoluteLayout(opsRef.current,depsRef.current,sprModeRef.current);
    relLayoutRef.current=buildRelativeLayout(opsRef.current,depsRef.current,sprModeRef.current);
    posRef.current=cloneLayout(mode==='absolute'?absLayoutRef.current:relLayoutRef.current);
    fitToScreen();draw();
  },[draw]);

  // Reset
  var resetView=useCallback(()=>{
    absLayoutRef.current=buildAbsoluteLayout(opsRef.current,depsRef.current,sprModeRef.current);
    relLayoutRef.current=buildRelativeLayout(opsRef.current,depsRef.current,sprModeRef.current);
    posRef.current=cloneLayout(viewModeRef.current==='absolute'?absLayoutRef.current:relLayoutRef.current);
    fitToScreen();draw();
  },[draw]);

  // Toggle crit only
  var toggleCritOnly=useCallback(()=>{var v=!critOnlyRef.current;critOnlyRef.current=v;setCritOnly(v);draw();},[draw]);

  // Unit change
  var changeUnit=useCallback((v:number)=>{
    var names=['m','h','d'];var labels=['мин','час','дни'];
    var nu=names[v];displayUnitRef.current=nu;setDisplayUnit(nu);
    if(nu==='m')REL_SCALE=1200;else if(nu==='h')REL_SCALE=500;else REL_SCALE=500;
    relScaleRef.current=REL_SCALE;
    absLayoutRef.current=buildAbsoluteLayout(opsRef.current,depsRef.current,sprModeRef.current);
    relLayoutRef.current=buildRelativeLayout(opsRef.current,depsRef.current,sprModeRef.current);
    posRef.current=cloneLayout(viewModeRef.current==='absolute'?absLayoutRef.current:relLayoutRef.current);
    fitToScreen();draw();
  },[draw]);

  // Spread change
  var changeSpr=useCallback((v:number)=>{
    sprModeRef.current=v;setSprMode(v);
    absLayoutRef.current=buildAbsoluteLayout(opsRef.current,depsRef.current,v);
    relLayoutRef.current=buildRelativeLayout(opsRef.current,depsRef.current,v);
    posRef.current=cloneLayout(viewModeRef.current==='absolute'?absLayoutRef.current:relLayoutRef.current);
    fitToScreen();draw();
  },[draw]);

  // Font change
  var changeFont=useCallback((v:number)=>{
    var fs2=1+v*0.5;fontScaleRef.current=fs2;setFontScale(fs2);draw();
  },[draw]);

  // ── BOM handlers ──
  var loadBOMTree=useCallback(async (pid:string)=>{
    setBomLoading(true);setBomMsg(null);
    try{
      var tree=await getBOMTree(pid) as any;
      setBomNodes(tree.nodes||[]);
      if((tree.nodes||[]).length===0)setBomMsg('BOM-дерево пусто.');
    }catch(e:any){setBomMsg('Ошибка: '+e.message);setBomNodes([]);}
    finally{setBomLoading(false);}
  },[]);

  var handleBOMUpload=useCallback(async (pid:string,file:File)=>{
    setBomLoading(true);setBomMsg(null);
    try{
      var result=await uploadBOM(pid,file);
      setBomMsg('Загружено: '+result.imported+' узлов.'+(result.errors.length>0?' Ошибки: '+result.errors.join('; '):''));
      if(result.imported>0)await loadBOMTree(pid);
    }catch(e:any){setBomMsg('Ошибка загрузки: '+e.message);}
    finally{setBomLoading(false);}
  },[]);

  var handleExplodeAndSave=useCallback(async (pid:string)=>{
    setBomExploding(true);setBomMsg(null);
    try{
      var r=await explodeAndSaveBOM(pid);
      setBomMsg('Создано '+r.created_operations+' операций, '+r.created_dependencies+' связей.'+(r.warnings.length>0?' ⚠ '+r.warnings.length+' предупрежд.'+r.warnings.slice(0,2).join(' | '):''));
      // Reload CPM after explosion
      await loadProject(pid);
    }catch(e:any){setBomMsg('Ошибка: '+e.message);}
    finally{setBomExploding(false);}
  },[]);

  // Save defaults
  var saveDefaults=useCallback(()=>{
    if(typeof localStorage==='undefined')return;
    localStorage.setItem('pp-network-defaults',JSON.stringify({unit:displayUnitRef.current,spr:sprModeRef.current,mode:viewModeRef.current,fs:fontScaleRef.current}));
  },[]);

  // Hit test (accounts for S diamond and F square)
  function hit(cx:number,cy:number,mx:number,my:number,id:string,scale:number){
    var nr=getNodeR(scale);
    if(id==='S'){var hs2=nr+8;var ndx=Math.abs(mx-cx)/(hs2*0.75),ndy=Math.abs(my-cy)/hs2;return ndx+ndy<=1;}
    if(id==='F'){var ss2=nr*1.0;return mx>=cx-ss2*scale&&mx<=cx+ss2*scale&&my>=cy-ss2*scale&&my<=cy+ss2*scale;}
    var rr=(nr*scale);return(mx-cx)*(mx-cx)+(my-cy)*(my-cy)<=rr*rr;
  }

  // Mouse handlers
  var onMouseDown=useCallback((e:React.MouseEvent)=>{
    var wrap2=wrapRef.current;if(!wrap2)return;
    var rect=wrap2.getBoundingClientRect();
    var mx=e.clientX-rect.left,my=e.clientY-rect.top;
    var pos=posRef.current,scale=scaleRef.current,ox=oxRef.current,oy=oyRef.current;
    var vis2=critOnlyRef.current?opsRef.current.filter(function(o:Op){return o.crit;}):opsRef.current;
    function sx2(wx:number){return(wx+ox)*scale;}function sy2(wy:number){return(wy+oy)*scale;}
    for(var i=0;i<vis2.length;i++){
      var o=vis2[i],p=pos[o.id];if(!p)continue;
      var cx=sx2(p[0]),cy=sy2(p[1]);
      if(hit(cx,cy,mx,my,o.id,scale)){dragRef.current={id:o.id,p0:[p[0],p[1]],m0:[mx,my]};setCanvasState('dragging');return;}
    }
    panRef.current={active:true,sx:mx,sy:my,ox:ox,oy:oy};setCanvasState('panning');
  },[]);

  var onMouseMove=useCallback((e:React.MouseEvent)=>{
    var wrap2=wrapRef.current,tip=tipRef.current;if(!wrap2||!tip)return;
    var rect=wrap2.getBoundingClientRect();
    var mx=e.clientX-rect.left,my=e.clientY-rect.top;
    var pos=posRef.current,scale=scaleRef.current,ox=oxRef.current,oy=oyRef.current,pan=panRef.current,drag=dragRef.current;
    function sx2(wx:number){return(wx+ox)*scale;}function sy2(wy:number){return(wy+oy)*scale;}

    if(drag){
      var dx2=(mx-drag.m0[0])/scale,dy2=(my-drag.m0[1])/scale;
      pos[drag.id]=[drag.p0[0]+dx2,drag.p0[1]+dy2];draw();return;
    }
    if(pan.active){
      oxRef.current=pan.ox+(mx-pan.sx)/scale;oyRef.current=pan.oy+(my-pan.sy)/scale;draw();
    }

    var vis2=critOnlyRef.current?opsRef.current.filter(function(o:Op){return o.crit;}):opsRef.current;
    var found:Op|null=null;
    for(var i=0;i<vis2.length;i++){var o=vis2[i],cx=sx2(pos[o.id][0]),cy=sy2(pos[o.id][1]);if(hit(cx,cy,mx,my,o.id,scale)){found=o;break;}}
    if(found&&found.id!==hoverIdRef.current){
      hoverIdRef.current=found.id;
      tip.innerHTML='<div class="tooltip-title">\u2116'+found.num+' \u00b7 '+found.name+'</div>'
        +'<div class="tooltip-row">Длительность <b>'+fmtDur(found.dur,found.unit,displayUnitRef.current)+'</b></div>'
        +'<div class="tooltip-row">ES <b>день '+found.es+'</b></div><div class="tooltip-row">EF <b>день '+found.ef+'</b></div>'
        +'<div class="tooltip-row">LS <b>день '+found.ls+'</b></div><div class="tooltip-row">LF <b>день '+found.lf+'</b></div>'
        +'<div class="tooltip-row">Полный резерв <b style="color:'+(found.crit?'var(--danger)':'var(--success)')+'">'+found.tf+' дн.</b></div>'
        +'<div class="tooltip-row" style="margin-top:4px;color:'+(found.crit?'var(--danger)':'var(--fg-4)')+';">'+(found.crit?'⚠ Критический путь':'С резервом')+'</div>';
      tip.classList.add('on');
    }else if(!found&&hoverIdRef.current!==null){hoverIdRef.current=null;tip.classList.remove('on');}
    if(found){
      var nr=getNodeR(scale),r=nr*scale;
      var fcx=sx2(pos[found.id][0]),fcy=sy2(pos[found.id][1]);
      tip.style.left=Math.min(fcx+r+14,window.innerWidth-280)+'px';tip.style.top=Math.max(4,fcy-80)+'px';
    }
  },[draw]);

  var onMouseUp=useCallback(()=>{dragRef.current=null;panRef.current.active=false;setCanvasState('');},[]);

  // Wheel zoom
  var onWheel=useCallback((e:React.WheelEvent)=>{
    e.preventDefault();
    scaleRef.current=Math.max(0.15,Math.min(2.5,scaleRef.current*(e.deltaY<0?1.08:0.92)));
    setScalePercent(Math.round(scaleRef.current*100));
    draw();
  },[draw]);

  // Load API project
  var loadProject=useCallback(async (pid:string)=>{
    setSelectedId(pid);setLoading(true);setError(null);
    try{
      await login('planner@demo.ru','demo123');
      var cpm=await runCPM(pid);
      console.log('[CPM] API response:',cpm);
      var nodes=cpm.nodes||[];
      var edges=(cpm as any).edges||(cpm as any).dependencies||[];
      if(!nodes.length)throw new Error('Нет операций в проекте');
      // Map API nodes
      var apiOps:Op[]=nodes.map(function(n:any,i:number){
        var dur=n.duration||n.dur||0;
        var unit=n.duration_unit||n.unit||'d';
        return {
          id:n.id||String(i+1),num:n.number||n.num||i+1,
          name:n.name||'Операция '+(i+1),dur:dur,unit:unit,
          es:n.early_start||n.es||0,ef:n.early_finish||n.ef||dur,
          ls:n.late_start||n.ls||0,lf:n.late_finish||n.lf||dur,
          tf:n.total_float||n.tf||0,crit:n.critical||n.crit||0
        };
      });
      // Add S and F
      var totalEf=apiOps.reduce(function(m:number,o:Op){return Math.max(m,o.ef);},0);
      apiOps.unshift({id:'S',num:'S',name:'Старт',dur:0,unit:'d',es:0,ef:0,ls:0,lf:0,tf:0,crit:1});
      apiOps.push({id:'F',num:'F',name:'Финиш',dur:0,unit:'d',es:totalEf,ef:totalEf,ls:totalEf,lf:totalEf,tf:0,crit:1});
      // Map edges
      var apiDeps:[string,string][]=edges.map(function(e:any){return [e.from||e.predecessor_id||e.source,e.to||e.successor_id||e.target];});
      if(!apiDeps.length){
        // Fallback: link S→first, F←last, and linear chain
        var realOps=apiOps.slice(1,-1);
        apiDeps.push(['S',realOps[0].id]);
        for(var i=0;i<realOps.length-1;i++)apiDeps.push([realOps[i].id,realOps[i+1].id]);
        apiDeps.push([realOps[realOps.length-1].id,'F']);
      }

      var critCount=apiOps.filter(function(o:Op){return o.crit;}).length;
      var totalDur=apiOps.filter(function(o:Op){return o.crit;}).reduce(function(m:number,o:Op){return m+o.dur;},0);
      opsRef.current=apiOps;depsRef.current=apiDeps;
      setLabel((cpm as any).project_name||'Проект'+' · CPM');
      setCpDur('~'+Math.round(totalDur*10)/10);
      setCpCount(critCount);
      setupLayout(apiOps,apiDeps);
      draw();
    }catch(e:any){console.error('[CPM] Load error:',e);setError(e.message||String(e));}
    finally{setLoading(false);}
  },[draw]);

  // Load Gantt data when project changes
  const loadGanttData = useCallback(async (pid: string) => {
    try {
      const T = localStorage.getItem('token') || '';
      const res = await fetch(`https://profyplan.ru/api/v1/bom/projects/${pid}/export/mrp`, {
        headers: { Authorization: `Bearer ${T}` },
      });
      if (!res.ok) return;
      const d = await res.json();
      setGanttOps(d.operations || []);
      setGanttDeps(d.dependencies || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (selectedId) loadGanttData(selectedId); }, [selectedId, loadGanttData]);

  return(
    <div style={{fontFamily:"'Inter',system-ui,sans-serif",background:'var(--bg)',color:'var(--fg)',overflow:'hidden',height:'100vh'}}>
      {/* TOPBAR */}
      <div className="topbar">
        <div className="topbar-left">
          <h1>Сетевой график</h1>
          <span className="badge">{label}</span>
        </div>
        <div className="mode-tabs">
          {(['absolute','relative'] as Mode[]).map(m=>(
            <button key={m} onClick={()=>switchMode(m)} className={'mode-btn'+(viewMode===m?' active':'')}>{m==='absolute'?'Абсолютный':'Относительный'}</button>
          ))}
        </div>
        <div className="legend">
          <div className="unit-slider">
            <span className="unit-label" style={{fontSize:10,color:'var(--fg-4)'}}>Масштаб:</span>
            <span className="unit-label">мин</span>
            <input type="range" min={0} max={2} value={['m','h','d'].indexOf(displayUnit)} step={1}
              onChange={e=>changeUnit(parseInt(e.target.value))}/>
            <span className="unit-label">дни</span>
            <span className="unit-label" style={{color:'var(--accent-3)',fontWeight:700}}>{{m:'мин',h:'час',d:'дни'}[displayUnit]}</span>
          </div>
          <div className="unit-slider">
            <span className="unit-label" style={{fontSize:10,color:'var(--fg-4)'}}>Разброс:</span>
            <span className="unit-label">сдерж</span>
            <input type="range" min={0} max={2} value={sprMode} step={1}
              onChange={e=>changeSpr(parseInt(e.target.value))}/>
            <span className="unit-label">агрес</span>
            <span className="unit-label" style={{color:'var(--accent-3)',fontWeight:700}}>{['сдерж','оптим','агрес'][sprMode]}</span>
          </div>
          <div className="unit-slider">
            <span className="unit-label" style={{fontSize:10,color:'var(--fg-4)'}}>Шрифт:</span>
            <span className="unit-label">станд</span>
            <input type="range" min={0} max={1} value={fontScale===1.5?1:0} step={1}
              onChange={e=>changeFont(parseInt(e.target.value))}/>
            <span className="unit-label">крупн</span>
            <span className="unit-label" style={{color:'var(--accent-3)',fontWeight:700}}>{fontScale===1.5?'крупн':'станд'}</span>
          </div>
          <div className="legend-item"><div className="legend-dot" style={{borderColor:'var(--danger)',background:'rgba(239,68,68,0.18)',boxShadow:'0 0 8px rgba(239,68,68,0.5)'}}/> Критический</div>
          <div className="legend-item"><div className="legend-dot" style={{borderColor:'var(--accent-3)',background:'rgba(59,130,246,0.08)',boxShadow:'0 0 8px rgba(59,130,246,0.35)'}}/> С резервом</div>
          <button onClick={resetView} className="btn">Сброс</button>
          <button onClick={toggleCritOnly} className={'btn'+(critOnly?' btn-primary':'')}>Только крит. путь</button>
          <button onClick={saveDefaults} className="btn" title="Сохранить текущие настройки по умолчанию" style={{padding:'4px 8px',fontSize:16,lineHeight:1}}>⚙</button>
        </div>
      </div>

      {/* API project catalog + BOM panel */}
      <div style={{position:'absolute',top:53,right:0,zIndex:15}}>
        <div style={{display:'flex',alignItems:'stretch',gap:0}}>
          {/* Project selector */}
          <div style={{display:'flex',gap:8,alignItems:'center',padding:'6px 10px',background:'var(--bg-2)',border:'1px solid var(--border)',borderTop:'none',borderRadius:'0 0 0 8px'}}>
            <select value={selectedId||''} onChange={e=>{var v=e.target.value;if(v)loadProject(v);}}
              style={{padding:'4px 8px',fontSize:11,background:'var(--bg-3)',color:'var(--fg)',border:'1px solid var(--border)',borderRadius:4,fontFamily:'inherit',maxWidth:220}}
              disabled={loading}>
              <option value="">— Демо (PCB-1421) —</option>
              {projects.map((pp:any)=>(
                <option key={pp.id} value={pp.id}>{pp.name||'Проект '+pp.id}</option>
              ))}
            </select>
            <button onClick={()=>{if(selectedId){setBomPanel(!bomPanel);if(!bomPanel)loadBOMTree(selectedId);}}}
              className={'btn'+(bomPanel?' btn-primary':'')}
              disabled={!selectedId}
              title="Каталог BOM">
              📋 BOM
            </button>
            <button onClick={()=>{if(selectedId)setShowExcelWizard(true);}}
              className="btn"
              disabled={!selectedId}
              title="Импорт Excel (Заказы + BOM + Маршруты)"
              style={{background:'var(--accent-3)',color:'#fff',border:'none',marginLeft:4}}>
              📊 Excel
            </button>
            {/* View toggle */}
            <div style={{display:'flex',marginLeft:8,gap:0,border:'1px solid var(--border)',borderRadius:4,overflow:'hidden'}}>
              <button onClick={()=>setChartView('network')}
                style={{padding:'5px 10px',fontSize:11,fontWeight:chartView==='network'?700:400,
                  background:chartView==='network'?'var(--accent-3)':'var(--bg-2)',color:chartView==='network'?'#fff':'var(--fg-4)',
                  border:'none',cursor:'pointer'}}>
                🔗 Сеть
              </button>
              <button onClick={()=>setChartView('gantt')}
                style={{padding:'5px 10px',fontSize:11,fontWeight:chartView==='gantt'?700:400,
                  background:chartView==='gantt'?'var(--accent-3)':'var(--bg-2)',color:chartView==='gantt'?'#fff':'var(--fg-4)',
                  border:'none',cursor:'pointer'}}>
                📅 Ганта
              </button>
            </div>
            {loading&&<span style={{fontSize:11,color:'var(--accent-3)'}}>Загрузка...</span>}
            {error&&(
              <button onClick={()=>setError(null)} style={{fontSize:11,color:'var(--danger)',background:'none',border:'none',cursor:'pointer'}}>{error} ✕</button>
            )}
          </div>
          {/* BOM panel */}
          {bomPanel && selectedId && (
            <div style={{
              background:'var(--bg-2)',border:'1px solid var(--border)',borderTop:'none',borderLeft:'none',
              borderRadius:'0 0 8px 0',padding:'8px 12px',minWidth:300,maxWidth:420,
              maxHeight:'calc(100vh - 100px)',overflowY:'auto',
            }}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                <span style={{fontSize:11,fontWeight:700,color:'var(--fg)'}}>📦 BOM: {projects.find((p:any)=>p.id===selectedId)?.name||'Проект'}</span>
                <button onClick={()=>setBomPanel(false)} style={{background:'none',border:'none',color:'var(--fg-4)',cursor:'pointer',fontSize:14}}>✕</button>
              </div>

              {bomLoading ? <div style={{fontSize:10,color:'var(--fg-4)',padding:'8px 0'}}>Загрузка...</div> :
              bomNodes.length===0 ? <div style={{fontSize:10,color:'var(--fg-4)',padding:'8px 0'}}>
                {bomMsg||'Нет данных. Загрузите BOM-файл.'}
              </div> :
              <div style={{marginBottom:8}}>
                {bomNodes.map(n=>(
                  <div key={n.id} style={{
                    padding:'3px 4px',paddingLeft:8+n.level*16,fontSize:10,color:'var(--fg-3)',
                    borderBottom:'1px solid rgba(30,50,82,0.4)',display:'flex',alignItems:'center',gap:6,
                    whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',
                  }}>
                    <span style={{fontSize:9,color:n.is_make_or_buy==='make'?'var(--accent-3)':'var(--warning)',flexShrink:0}}>
                      {n.is_make_or_buy==='make'?'🔧':'📦'}
                    </span>
                    <span style={{flexShrink:0,fontWeight:600,color:'var(--fg-4)'}}>{(n.path||'').split('.').pop()||'·'}</span>
                    <span title={n.nomenclature_name}>{n.nomenclature_name.length>28?n.nomenclature_name.slice(0,26)+'…':n.nomenclature_name}</span>
                    <span style={{marginLeft:'auto',fontSize:9,color:'var(--fg-4)',flexShrink:0}}>
                      ×{n.quantity_per_parent} {n.unit}
                    </span>
                  </div>
                ))}
              </div>}

              {/* Actions */}
              <div style={{display:'flex',gap:6,marginTop:4}}>
                <label className="btn" style={{cursor:'pointer',fontSize:9,padding:'3px 8px',display:'inline-flex',alignItems:'center',gap:3}}>
                  📤 Загрузить BOM
                  <input type="file" accept=".json" ref={fileRef} style={{display:'none'}}
                    onChange={e=>{var f=e.target.files?.[0];if(f&&selectedId)handleBOMUpload(selectedId,f);}}/>
                </label>
                <button className="btn btn-primary" disabled={bomExploding||bomNodes.length===0}
                  onClick={()=>{if(selectedId)handleExplodeAndSave(selectedId);}}
                  style={{cursor:bomExploding?'wait':'pointer',fontSize:9,padding:'3px 8px',flex:1}}>
                  {bomExploding?'⏳ Генерация...':'⚡ BOM → Процессы'}
                </button>
              </div>
              {bomMsg && (
                <div style={{marginTop:6,fontSize:9,color:bomMsg.startsWith('Создано')||bomMsg.startsWith('Загружено')?'var(--success)':'var(--warning)',lineHeight:1.4}}>
                  {bomMsg}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Excel Import Wizard Modal */}
      {showExcelWizard && selectedId && (
        <ExcelImportWizard
          projectId={selectedId}
          onComplete={() => { if (selectedId) loadProject(selectedId); }}
          onClose={() => setShowExcelWizard(false)}
        />
      )}

      {/* Canvas / Gantt */}
      {chartView === 'gantt' ? (
        <div style={{flex:1,padding:'0 8px 8px',overflow:'hidden'}}>
          <GanttChart
            operations={ganttOps}
            dependencies={ganttDeps}
            projectStart={PROJECT_START}
            title={projects.find((p:any)=>p.id===selectedId)?.name || 'Диаграмма Ганта'}
          />
        </div>
      ) : (
      <>
      <div ref={wrapRef} className={'canvas-wrap'+(canvasState?' '+canvasState:'')}
        onWheel={onWheel} onMouseDown={onMouseDown}
        onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
        <canvas ref={canvasRef} style={{display:'block'}}/>
        <div ref={tipRef} className="tooltip"/>
        <div className="info-panel">
          <strong>Критический путь:</strong> {cpDur} дн. · {cpCount} операций<br/>
          <span style={{color:'var(--fg-4)',marginTop:2,display:'inline-block'}}>
            Drag · Scroll · Режим: {viewMode==='absolute'?'Абсолютный':'Относительный'}
          </span>
        </div>
        <div className="scale-control">
          <button onClick={()=>{scaleRef.current=Math.min(2.5,scaleRef.current*1.15);setScalePercent(Math.round(scaleRef.current*100));draw();}}>+</button>
          <span className="scale-label">{scalePercent}%</span>
          <button onClick={()=>{scaleRef.current=Math.max(0.15,scaleRef.current/1.15);setScalePercent(Math.round(scaleRef.current*100));draw();}}>−</button>
        </div>
      </div>

      <style jsx global>{`
        :root{  --bg:#0A1628;--bg-2:#0F1E36;--bg-3:#162844;
          --fg:#E8EEF5;--fg-2:#B0C4DE;--fg-3:#8FA3BD;--fg-4:#5A7090;
          --border:#1E3252;--accent:#3B82F6;--accent-2:#2563EB;--accent-3:#60A5FA;
          --success:#10B981;--danger:#EF4444;--warning:#F59E0B;
        }
        *{box-sizing:border-box;margin:0;padding:0;}
        .tooltip.on{opacity:1!important;}
        .topbar{padding:12px 20px;background:var(--bg-2);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;z-index:10;position:relative;gap:12px;flex-wrap:wrap;}
        .topbar-left{display:flex;align-items:center;gap:12px;}
        .topbar h1{font-size:16px;font-weight:700;letter-spacing:-0.01em;white-space:nowrap;}
        .badge{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--accent-3);background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.2);padding:2px 8px;border-radius:100px;white-space:nowrap;}
        .mode-tabs{display:flex;gap:0;border-radius:7px;overflow:hidden;border:1px solid var(--border);}
        .mode-btn{padding:4px 10px;font-size:11px;font-weight:600;border:none;cursor:pointer;background:transparent;color:var(--fg-3);font-family:inherit;transition:all 0.12s;white-space:nowrap;}
        .mode-btn:hover{color:var(--fg);}
        .mode-btn.active{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:white;box-shadow:0 2px 8px rgba(59,130,246,0.35);}
        .legend{display:flex;gap:12px;font-size:10px;color:var(--fg-4);align-items:center;}
        .legend-item{display:flex;align-items:center;gap:5px;}
        .legend-dot{width:10px;height:10px;border-radius:50%;border:2px solid;}
        .btn{font-family:inherit;font-size:11px;font-weight:600;padding:4px 10px;border-radius:6px;cursor:pointer;border:1px solid transparent;transition:all 0.12s;background:transparent;color:var(--fg-3);border-color:var(--border);white-space:nowrap;}
        .btn:hover{border-color:var(--accent);color:var(--accent-3);}
        .btn-primary{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:white;border:none;box-shadow:0 2px 8px rgba(59,130,246,0.35);}
        .btn-primary:hover{border-color:transparent;color:white;opacity:0.9;}
        .canvas-wrap{position:relative;width:100%;height:calc(100vh - 53px);overflow:hidden;cursor:grab;}
        .canvas-wrap.panning{cursor:grabbing;}
        .canvas-wrap.dragging{cursor:grabbing;}
        .tooltip{position:absolute;background:var(--bg-3);border:1px solid var(--border);border-radius:10px;padding:14px 18px;pointer-events:none;opacity:0;transition:opacity 0.1s;min-width:240px;color:var(--fg);font-size:13px;z-index:20;box-shadow:0 8px 24px rgba(0,0,0,0.5);}
        .tooltip-title{font-weight:700;font-size:15px;margin-bottom:8px;}
        .tooltip-row{display:flex;justify-content:space-between;padding:2px 0;color:var(--fg-3);font-size:12px;}
        .tooltip-row b{font-family:'IBM Plex Mono',monospace;color:var(--fg);font-weight:600;}
        .info-panel{position:absolute;bottom:16px;left:16px;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:11px;color:var(--fg-3);pointer-events:none;z-index:5;}
        .info-panel strong{color:var(--fg);}
        .unit-slider{display:flex;align-items:center;gap:6px;}
        .unit-slider label{font-size:10px;color:var(--fg-4);font-weight:600;}
        .unit-slider input[type=range]{-webkit-appearance:none;appearance:none;width:80px;height:4px;background:var(--border);border-radius:2px;outline:none;cursor:pointer;}
        .unit-slider input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:var(--accent);border:2px solid var(--bg-2);box-shadow:0 0 6px rgba(59,130,246,0.4);cursor:pointer;}
        .unit-label{font-size:9px;color:var(--fg-3);min-width:28px;text-align:center;}
        .scale-control{position:absolute;bottom:16px;right:16px;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:4px;display:flex;flex-direction:column;gap:2px;z-index:6;}
        .scale-control button{width:28px;height:24px;border:1px solid var(--border);border-radius:4px;background:transparent;color:var(--fg-3);cursor:pointer;font-size:14px;font-family:'IBM Plex Mono',monospace;font-weight:600;line-height:1;transition:all 0.12s;display:flex;align-items:center;justify-content:center;}
        .scale-control button:hover{border-color:var(--accent);color:var(--accent-3);background:rgba(59,130,246,0.08);}
        .scale-label{font-size:9px;color:var(--fg-4);text-align:center;font-family:'IBM Plex Mono',monospace;padding:2px 0;user-select:none;}
      `}</style>
      </>
      )}
    </div>
  );
}
