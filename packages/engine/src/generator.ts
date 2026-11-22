import type {LevelDefinition,GameMode} from '../../shared/src/index.ts';
import {createState,applyCommand} from './index.ts';
import {evaluate} from './predicates.ts';
export function seeded(seed:number):()=>number{let x=seed>>>0;return()=>{x+=0x6D2B79F5;let t=Math.imul(x^(x>>>15),1|x);t^=t+Math.imul(t^(t>>>7),61|t);return((t^(t>>>14))>>>0)/4294967296;};}
export function generateChallenge(levels:LevelDefinition[],mode:GameMode,seed:number,round:number):LevelDefinition{
 if(!levels.length)throw new Error('No verified challenge templates');const random=seeded((seed^(Math.max(1,round)*2654435761))>>>0),ceiling=mode==='endless'?Math.min(5,1+Math.floor(Math.max(0,round-1)/3)):5,pool=levels.filter(l=>l.difficulty<=ceiling),source=(pool.length?pool:levels)[Math.floor(random()*(pool.length||levels.length))]!,level=structuredClone(source);
 level.id=`generated-${mode}-${seed>>>0}-${Math.max(1,round)}`;level.title=`${mode==='daily'?'每日信号':mode==='endless'?`无尽 · 第${round}轮`:'工程挑战'} · ${source.title}`;level.briefing=`调度编号 ${seed>>>0} / ${round}。${source.briefing}`;
 // Rigid translation keeps distances and certified solutions valid.
 const x=Math.floor(random()*5)-2,z=Math.floor(random()*5)-2;for(const d of level.devices){d.position[0]=Math.max(-100,Math.min(100,d.position[0]+x));d.position[2]=Math.max(-100,Math.min(100,d.position[2]+z));}for(const a of level.solution)if(a.type==='move'&&Array.isArray(a.payload.position)){const p=a.payload.position as number[];a.payload.position=[p[0]!+x,p[1],p[2]!+z];}
 // Vary actual starting faults/parameters, keeping only candidates whose authored
 // solution and negative path have been executed successfully by the pure engine.
 let candidate=structuredClone(level);
 for(const action of candidate.solution)if(action.type==='configure'){
  const def=candidate.devices.find(d=>d.id===action.target),key=String(action.payload.key),p=def?.parameters[key];if(!p)continue;
  let value=p.value;
  if(p.type==='number'&&p.min!==undefined&&p.max!==undefined&&p.max>p.min){const step=p.step??1,steps=Math.floor((p.max-p.min)/step);value=Math.round((p.min+Math.floor(random()*(steps+1))*step)*10000)/10000;}
  else if(p.type==='select'&&p.options?.length)value=p.options[Math.floor(random()*p.options.length)]!;
  else if(p.type==='boolean')value=!Boolean(action.payload.value);
  if(value!==action.payload.value)p.value=value;
 }
 if(!certified(candidate,seed))candidate=level;
 if(!certified(candidate,seed))throw new Error(`Unsolvable challenge template: ${source.id}`);
 if(mode==='timed')candidate.timeLimitSeconds=Math.max(90,Math.round(source.estimatedMinutes*60*.7));return candidate;
}
function certified(level:LevelDefinition,seed:number):boolean{
 let state=createState(level,seed);if(level.tasks[0]!.all.every(p=>evaluate(p,state)))return false;
 for(const [i,action]of level.solution.entries()){const result=applyCommand(level,state,{...action,id:`generator-check-${i}`,revision:state.revision});if(!result.accepted)return false;state=result.state;if(state.phase==='completed')break;}
 if(state.phase!=='completed')return false;
 state=createState(level,seed);for(const [i,action]of level.failureCase.entries()){state=applyCommand(level,state,{...action,id:`generator-negative-${i}`,revision:state.revision}).state;if(state.phase==='completed')return false;}
 return true;
}
