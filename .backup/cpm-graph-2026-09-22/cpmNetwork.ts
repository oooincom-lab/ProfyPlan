/**
 * CPM Network Graph тАФ ╤В╨╛╤З╨╜╨░╤П ╨║╨╛╨┐╨╕╤П network_graph.html (╨Т╨░╤А╨╕╨░╨╜╤В 2: ╨┤╨╜╨╕ ╨╜╨░ ╤Б╨▓╤П╨╖╤П╤Е + ╨б╤В╨░╤А╤В/╨д╨╕╨╜╨╕╤И)
 * ╨Я╤А╨╕ ╨╖╨░╨│╤А╤Г╨╖╨║╨╡ ╤А╨╡╨╜╨┤╨╡╤А╨╕╤В ╨┤╨╡╨╝╨╛-╨│╤А╨░╤Д (12 ╤Г╨╖╨╗╨╛╨▓: ╨б╤В╨░╤А╤В, 10 ╨╛╨┐╨╡╤А╨░╤Ж╨╕╨╣, ╨д╨╕╨╜╨╕╤И).
 * API-╨╖╨░╨│╤А╤Г╨╖╨║╨░ ╨┐╤А╨╛╨╡╨║╤В╨╛╨▓ тАФ ╨╛╨┐╤Ж╨╕╨╛╨╜╨░╨╗╤М╨╜╨╛.
 */
'use client';

/* Утверждённая логика графа CPM (Вариант 2: дни на связях).
   Перенесена из страницы /cpm (была удалена 12.09.2026), чтобы вид «Сеть CPM»
   в рабочем столе совпадал с утверждённым графом. */

// ╨Ф╨╡╨╝╨╛-╨▓╤Е╨╛╨┤: ╨╖╨╜╨░╤З╨╡╨╜╨╕╤П ╨┐╨╛ ╤Г╨╝╨╛╨╗╤З╨░╨╜╨╕╤О тАФ ╨▒╨╛╨╡╨▓╤Л╨╡; ╨╗╨╛╨║╨░╨╗╤М╨╜╨╛ ╨┐╨╡╤А╨╡╨╛╨┐╤А╨╡╨┤╨╡╨╗╤П╤О╤В╤Б╤П ╨╛╨║╤А╤Г╨╢╨╡╨╜╨╕╨╡╨╝


// тФАтФА ╨в╨╕╨┐╤Л тФАтФА
export interface Op {
  id: string; num: number | string; name: string;
  dur: number; unit: string; es: number; ef: number;
  ls: number; lf: number; tf: number; crit: number;
}
export type Mode = 'absolute' | 'relative';
export type Layout = Record<string, [number, number]>;

// тФАтФА ╨Ъ╨╛╨╜╤Б╤В╨░╨╜╤В╤Л тФАтФА
let NODE_R = 26, MIN_NODE_GAP = 60, REL_SCALE = 500;
export const PROJECT_START = new Date(2026, 6, 29);

// тФАтФА ╨Ф╨╡╨╝╨╛-╨┤╨░╨╜╨╜╤Л╨╡ (╤В╨╛╤З╤М-╨▓-╤В╨╛╤З╤М ╨╕╨╖ network_graph.html) тФАтФА
export const DEMO_OPS: Op[] = [
  { id:"S", num:'S', name:"╨б╤В╨░╤А╤В", dur:0, unit:'d', es:0, ef:0, ls:0, lf:0, tf:0, crit:1 },
  { id:"1", num:1, name:"╨Я╨╛╨┤╨│╨╛╤В╨╛╨▓╨║╨░ ╨╕╨╜╤Б╤В╤А╤Г╨╝╨╡╨╜╤В╨░", dur:4, unit:'h', es:0, ef:0.1667, ls:0, lf:0.1667, tf:0, crit:1 },
  { id:"2", num:2, name:"╨Ч╨░╨║╤Г╨┐╨║╨░ ╨║╨╛╨╝╨┐╨╛╨╜╨╡╨╜╤В╨╛╨▓", dur:8, unit:'h', es:0.1667, ef:0.5, ls:0.1667, lf:0.5, tf:0, crit:1 },
  { id:"3", num:3, name:"╨Ь╨╛╨╜╤В╨░╨╢ SMD", dur:8, unit:'h', es:0.5, ef:0.8333, ls:0.5, lf:0.8333, tf:0, crit:1 },
  { id:"4", num:4, name:"╨Я╨░╨╣╨║╨░ ╨▓╨╛╨╗╨╜╨╛╨╣", dur:6, unit:'h', es:0.8333, ef:1.0833, ls:0.8333, lf:1.0833, tf:0, crit:1 },
  { id:"5", num:5, name:"╨Ъ╨╛╨╜╤В╤А╨╛╨╗╤М AOI", dur:15, unit:'m', es:1.0833, ef:1.0938, ls:1.0833, lf:1.0938, tf:0, crit:1 },
  { id:"6", num:6, name:"╨д╤Г╨╜╨║╤Ж╨╕╨╛╨╜╨░╨╗╤М╨╜╤Л╨╣ ╤В╨╡╤Б╤В", dur:3, unit:'h', es:1.0938, ef:1.2188, ls:1.0938, lf:1.2188, tf:0, crit:1 },
  { id:"7", num:7, name:"╨в╨╡╤А╨╝╨╛╤В╤А╨╡╨╜╨╕╤А╨╛╨▓╨║╨░", dur:12, unit:'h', es:1.2188, ef:1.7188, ls:1.2188, lf:1.7188, tf:0, crit:1 },
  { id:"8", num:8, name:"╨Ъ╨░╨╗╨╕╨▒╤А╨╛╨▓╨║╨░ ╨┤╨░╤В╤З╨╕╨║╨╛╨▓", dur:1, unit:'h', es:1.2188, ef:1.2604, ls:1.7188, lf:1.7604, tf:0.5, crit:0 },
  { id:"9", num:9, name:"╨Т╤Л╤Е╨╛╨┤╨╜╨╛╨╣ ╨║╨╛╨╜╤В╤А╨╛╨╗╤М", dur:30, unit:'m', es:1.7188, ef:1.7396, ls:1.7188, lf:1.7396, tf:0, crit:1 },
  { id:"10",num:10,name:"╨Ь╨░╤А╨║╨╕╤А╨╛╨▓╨║╨░ ╨╕ ╤Г╨┐╨░╨║╨╛╨▓╨║╨░", dur:1, unit:'h', es:1.7396, ef:1.7813, ls:1.7396, lf:1.7813, tf:0, crit:1 },
  { id:"F", num:'F', name:"╨д╨╕╨╜╨╕╤И", dur:0, unit:'d', es:1.7813, ef:1.7813, ls:1.7813, lf:1.7813, tf:0, crit:1 },
];

export const DEMO_DEPS: [string, string][] = [
  ["S","1"],["1","2"],["2","3"],["3","4"],["4","5"],["5","6"],
  ["6","7"],["7","9"],["9","10"],["10","F"],
  ["3","8"],["8","9"]
];

// тФАтФА ╨Т╤Л╤Е╨╛╨┤╨╜╤Л╨╡ ╨╕ ╨┐╤А╨░╨╖╨┤╨╜╨╕╨║╨╕ 2026 тФАтФА
export const HOLIDAYS_2026 = new Set([
  '2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05','2026-01-06','2026-01-07','2026-01-08',
  '2026-02-23','2026-03-08','2026-05-01','2026-05-09','2026-06-12','2026-11-04'
]);
export function isWeekend(d:Date){return d.getDay()===0||d.getDay()===6;}
export function isHoliday(d:Date){var s=d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);return HOLIDAYS_2026.has(s);}

// тФАтФА ╨Х╨┤╨╕╨╜╨╕╤Ж╤Л ╨╕╨╖╨╝╨╡╤А╨╡╨╜╨╕╤П тФАтФА
export const UNITS:Record<string,string>={s:'╤Б╨╡╨║',m:'╨╝╨╕╨╜',h:'╤З',d:'╨┤╨╜',w:'╨╜╨╡╨┤',mo:'╨╝╨╡╤Б',y:'╨│╨╛╨┤'};
export function toDays(dur:number,unit:string){if(unit==='h')return dur/24;if(unit==='m')return dur/1440;if(unit==='s')return dur/86400;return dur;}
export function fmtDur(dur:number,unit:string,dispUnit:string){
  if(!unit)unit='d';if(dur<=0)return '-';
  var td=toDays(dur,unit);
  if(dispUnit==='m')return Math.ceil(td*1440)+' '+UNITS.m;
  if(dispUnit==='h')return Math.ceil(td*24)+' '+UNITS.h;
  return Math.ceil(td)+' '+UNITS.d;
}

// тФАтФА ╨Т╤Б╨┐╨╛╨╝╨╛╨│╨░╤В╨╡╨╗╤М╨╜╤Л╨╡ тФАтФА
export function getNodeR(scale:number){
  var r = NODE_R * (0.72 / Math.max(scale, 0.35));
  return Math.min(Math.max(r, 22), 40);
}
export function addDays(d:Date,days:number){var r=new Date(d);r.setDate(r.getDate()+days);return r;}
export function fmt(d:Date){return (d.getDate()<10?'0':'')+d.getDate()+'.'+(d.getMonth()<9?'0':'')+(d.getMonth()+1);}

// тФАтФА Layout: BFS + force-directed (spreadLayersVertical) тФАтФА
export function spreadLayersVertical(layout:Layout, ops:Op[], deps:[string,string][], sprMode:number, om:Record<string,Op>){
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

export function buildAbsoluteLayout(ops:Op[],deps:[string,string][],sprMode:number){
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

export function buildRelativeLayout(ops:Op[],deps:[string,string][],sprMode:number){
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

export function cloneLayout(src:Layout):Layout{var o:Layout={};for(var k in src)o[k]=[src[k][0],src[k][1]];return o;}

// тФАтФА ╨Ъ╨Ю╨Ь╨Я╨Ю╨Э╨Х╨Э╨в тФАтФА