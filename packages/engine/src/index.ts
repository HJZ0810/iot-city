import type {LevelDefinition,GameState,GameCommand,EngineResult,ControlRule,ParameterDefinition,Scalar} from '../../shared/src/index.ts';
import {evaluate} from './predicates.ts';
import {observe,simulateTick} from './simulation.ts';
export {evaluate} from './predicates.ts';
export {generateChallenge} from './generator.ts';
const own=(o:object,k:string)=>Object.prototype.hasOwnProperty.call(o,k);
const unsafe=(k:string)=>['__proto__','prototype','constructor'].includes(k);
export function createState(level:LevelDefinition,seed:number):GameState{
 const state:GameState={levelId:level.id,levelVersion:level.version,seed:seed>>>0,revision:0,phase:'briefing',tick:0,devices:Object.fromEntries(level.devices.map(d=>[d.id,{id:d.id,installed:d.installed,enabled:d.enabled,parameters:Object.fromEntries(Object.entries(d.parameters).map(([k,p])=>[k,p.value])),faults:[...d.faults],position:[...d.position],reading:0,status:'offline'}])),links:structuredClone(level.links),environment:{...level.environment},rules:structuredClone(level.rules),inventory:[],inspected:[],dialogs:[],flags:[],completedTasks:[],hints:[],errors:0,actions:0,feedback:[],score:0};observe(level,state);return state;
}
function validParameter(def:ParameterDefinition|undefined,v:unknown):v is Scalar{
 if(!def)return false;if(def.type==='number')return typeof v==='number'&&Number.isFinite(v)&&(def.min===undefined||v>=def.min)&&(def.max===undefined||v<=def.max);if(def.type==='boolean')return typeof v==='boolean';if(def.type==='select')return(typeof v==='string'||typeof v==='number')&&(def.options?.includes(v)??false);return typeof v==='string'&&v.length<=200;
}
function validRule(level:LevelDefinition,value:unknown):value is ControlRule{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const r=value as ControlRule;if(typeof r.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(r.id)||!Array.isArray(r.when)||r.when.length<1||r.when.length>8||typeof r.parameter!=='string'||unsafe(r.parameter))return false;
 const d=level.devices.find(d=>d.id===r.target);if(!d||!own(d.parameters,r.parameter)||!validParameter(d.parameters[r.parameter],r.value))return false;
 const sources=['parameter','reading','metric','installed','enabled','connected','reachable','inspected','flag','inventory','fault','rule','task','dialog','ticks'],ops=['eq','ne','gt','gte','lt','lte','includes','absent','exists'];return r.when.every(p=>p&&typeof p==='object'&&sources.includes(p.source)&&ops.includes(p.op)&&(!p.key||!unsafe(p.key))&&(!p.target||!unsafe(p.target))&&Object.keys(p).every(k=>['source','target','key','op','value'].includes(k)));
}
export function applyCommand(level:LevelDefinition,input:GameState,c:GameCommand):EngineResult{
 if(c.revision!==input.revision)return{state:structuredClone(input),accepted:false,message:'进度版本已更新，请读取服务器存档后重试。',completedNow:[]};
 const s=structuredClone(input);let message='操作已记录。';const completedNow:string[]=[];
 const reject=(reason:string):EngineResult=>{const next=structuredClone(input);next.errors++;next.revision++;next.feedback=[...next.feedback.slice(-9),reason];return{state:next,accepted:false,message:reason,completedNow:[]};};
 if(input.levelId!==level.id||input.levelVersion!==level.version)return reject('关卡版本与存档不匹配。');if(input.phase==='completed'||input.phase==='failed')return reject('本次任务已结束，请查看结算或重开。');
 const p=c.payload??{},target=typeof c.target==='string'&&!unsafe(c.target)?c.target:undefined,d=target&&own(s.devices,target)?s.devices[target]:undefined,def=target?level.devices.find(x=>x.id===target):undefined;
 if(s.phase==='paused'&&c.type!=='resume')return reject('任务已暂停，请先继续。');if(s.phase==='briefing'&&!['start','dialog'].includes(c.type))return reject('请先阅读简报并开始任务。');
 switch(c.type){
 case'start':if(s.phase!=='briefing')return reject('任务已开始。');s.phase='running';message='任务开始，设备操作将实时保存。';break;
 case'pause':if(s.phase!=='running')return reject('当前不能暂停。');s.phase='paused';message='任务已暂停并保存。';break;
 case'resume':if(s.phase!=='paused')return reject('当前任务未暂停。');s.phase='running';message='已恢复服务器存档。';break;
 case'inspect':if(!d||!def)return reject('找不到可检查的设备。');if(!s.inspected.includes(d.id))s.inspected.push(d.id);message=`${def.label}：${def.description} 当前状态：${d.status}；读数 ${d.reading}。`;break;
 case'dialog':{const i=Number(p.index??0);if(target!=='npc'||!Number.isInteger(i)||i<0||i>=level.npc.lines.length)return reject('这段对话不存在。');const key=`npc:${i}`;if(!s.dialogs.includes(key))s.dialogs.push(key);message=level.npc.lines[i]!;break;}
 case'collect':if(!target||!level.inventory.some(i=>i.id===target))return reject('找不到该物品。');if(s.inventory.includes(target)||s.flags.includes(`used:${target}`))return reject('物品已经领取。');s.inventory.push(target);message='物品已放入背包。';break;
 case'use':{const item=String(p.itemId??'');if(!d||!s.inventory.includes(item))return reject('缺少可使用的物品或目标。');s.inventory=s.inventory.filter(i=>i!==item);s.flags.push(`used:${item}`);if(item.includes('repair'))d.faults=d.faults.filter(f=>!['hardware','damaged','stuck'].includes(f));s.flags.push(`used:${item}:${d.id}`);message='道具已使用，请重新验证设备。';break;}
 case'install':if(!d)return reject('设备不存在。');d.installed=true;d.enabled=true;message='设备已安装并接通电源。';break;
 case'remove':if(!d)return reject('设备不存在。');d.installed=false;d.enabled=false;s.links=s.links.filter(l=>l.from!==d.id&&l.to!==d.id);message='设备已拆卸，连接已断开。';break;
 case'connect':case'disconnect':{const to=typeof p.to==='string'&&!unsafe(p.to)&&own(s.devices,p.to)?s.devices[p.to]:undefined,kind=String(p.kind??'wire');if(!d||!to||d.id===to.id||!d.installed||!to.installed||!['wire','wireless','bus','network'].includes(kind))return reject('连接需要两个不同的已安装设备与有效链路类型。');const found=(l:{from:string;to:string;kind:string})=>((l.from===d.id&&l.to===to.id)||(l.to===d.id&&l.from===to.id))&&l.kind===kind;if(c.type==='connect'){if(s.links.some(found))return reject('这条连接已经存在。');if(s.links.length>=128)return reject('连接数量达到上限。');s.links.push({from:d.id,to:to.id,kind:kind as 'wire',quality:1});}else s.links=s.links.filter(l=>!found(l));message=c.type==='connect'?'链路已建立，请检查通信条件。':'链路已断开。';break;}
 case'configure':{const key=typeof p.key==='string'?p.key:'';if(!d||!def||unsafe(key)||!own(def.parameters,key)||!validParameter(def.parameters[key],p.value))return reject('参数不存在、类型不符或超出允许范围。');d.parameters[key]=p.value;message=`${def.label}的${def.parameters[key]!.label}已设为 ${String(p.value)}。`;break;}
 case'move':{const pos=p.position;if(!d||!Array.isArray(pos)||pos.length!==3||!pos.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=100))return reject('设备位置无效。');d.position=[pos[0],pos[1],pos[2]];message='设备位置已更新，无线距离会影响连通性。';break;}
 case'rule':{const rule=p.rule;if(!validRule(level,rule))return reject('规则无效，只能引用受支持的条件和设备参数。');if(s.rules.length>=24&&!s.rules.some(r=>r.id===rule.id))return reject('规则数量达到上限。');s.rules=[...s.rules.filter(r=>r.id!==rule.id),structuredClone(rule)];message='安全控制规则已保存，运行仿真后生效。';break;}
 case'remove-rule':s.rules=s.rules.filter(r=>r.id!==target);message='规则已移除。';break;
 case'simulate':{const ticks=Number(p.ticks??1);if(!Number.isInteger(ticks)||ticks<1||ticks>60)return reject('单次仿真应为1–60秒。');for(let i=0;i<ticks;i++){simulateTick(level,s);const f=level.failures.find(f=>f.all.every(c=>evaluate(c,s)));if(f){s.phase='failed';message=f.message;break;}}if(s.phase!=='failed')message=`仿真已运行 ${ticks} 秒，请检查设备和环境反馈。`;break;}
 case'hint':{const t=level.tasks.find(t=>t.id===target);if(!t)return reject('任务不存在。');if(!s.hints.includes(t.id))s.hints.push(t.id);message=t.hint;break;}
 case'answer':{const q=level.questions?.find(q=>q.id===target);if(!q)return reject('题目不存在。');const flag=`answered:${q.id}`;if(s.flags.includes(flag)){message='这道题已经完成。';break;}let correct=false;if(q.kind==='single')correct=typeof p.answer==='string'&&p.answer===q.answer;else if(q.kind==='multiple')correct=Array.isArray(p.answer)&&Array.isArray(q.answer)&&p.answer.every(v=>typeof v==='string')&&new Set(p.answer).size===p.answer.length&&JSON.stringify([...p.answer].sort())===JSON.stringify([...q.answer].sort());else if(q.kind==='number')correct=typeof p.answer==='number'&&Number.isFinite(p.answer)&&typeof q.answer==='number'&&Math.abs(p.answer-q.answer)<=(q.tolerance??0);else if(q.kind==='text')correct=typeof p.answer==='string'&&typeof q.answer==='string'&&p.answer.length<=500&&p.answer.normalize('NFKC').trim().toLowerCase()===q.answer.normalize('NFKC').trim().toLowerCase();if(!correct)return reject('答案尚不正确，请结合设备现象与知识提示重新分析。');s.flags.push(flag);message=q.explanation;break;}
 default:return reject('不支持的操作类型。');
 }
 observe(level,s);s.actions++;s.revision++;
 if(s.phase==='running')for(const t of level.tasks){if(s.completedTasks.includes(t.id)||!t.requires.every(r=>s.completedTasks.includes(r)))continue;if(t.all.every(p=>evaluate(p,s))){s.completedTasks.push(t.id);completedNow.push(t.id);message=t.feedback;}}
 if(s.phase==='running'&&s.completedTasks.length===level.tasks.length){s.phase='completed';s.score=Math.max(0,1000-s.hints.length*60-s.errors*15-Math.max(0,s.actions-level.solution.length-5)*2);message=level.ending;}
 s.feedback=[...s.feedback.slice(-9),message];return{state:s,accepted:true,message,completedNow};
}
export function replay(level:LevelDefinition,seed:number,commands:GameCommand[]):GameState{return commands.reduce((s,c)=>applyCommand(level,s,c).state,createState(level,seed));}
