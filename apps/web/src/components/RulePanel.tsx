import {useMemo,useState} from 'react';
import {Plus,Trash2,Settings2,ArrowDown,Pencil} from 'lucide-react';
import type {ControlRule,GameCommand,Predicate,Scalar,SessionView} from '../../../../packages/shared/src/index';

type Props={session:SessionView;state:SessionView['state']|undefined;busy:boolean;send:(type:GameCommand['type'],target?:string,payload?:Record<string,unknown>)=>Promise<void>};
type Condition={source:Predicate['source'];target:string;key:string;op:Predicate['op'];value:string;valueType:'number'|'boolean'|'text'};
const blank=(session:SessionView):Condition=>({source:'reading',target:session.level.devices.find(d=>d.kind==='sensor')?.id??session.level.devices[0]!.id,key:'',op:'lt',value:'30',valueType:'number'});
const sourceLabels:Partial<Record<Predicate['source'],string>>={reading:'设备读数',metric:'环境与仿真指标',parameter:'设备参数',reachable:'网络可达',connected:'直接连通',installed:'设备已安装',enabled:'设备已启用',fault:'故障标记',flag:'仿真标记',ticks:'仿真时间'};
const opLabels:Record<Predicate['op'],string>={eq:'等于',ne:'不等于',gt:'大于',gte:'大于等于',lt:'小于',lte:'小于等于',includes:'包含',exists:'存在',absent:'不存在'};
function scalar(value:string,type:Condition['valueType']):Scalar{return type==='number'?Number(value):type==='boolean'?value==='true':value;}

export function RulePanel({session,state,busy,send}:Props){
 const devices=session.level.devices;
 const suggested=useMemo(()=>session.level.tasks.flatMap(task=>task.all.flatMap(p=>p.source==='rule'&&p.target?[{id:p.target,key:p.key,value:p.value}]:p.source==='flag'&&p.target?.startsWith('rule-fired:')?[{id:p.target.slice(11),key:undefined,value:undefined}]:[])).filter((item,i,all)=>all.findIndex(other=>other.id===item.id)===i),[session.level]);
 const [id,setId]=useState(suggested[0]?.id??'control-1');
 const [conditions,setConditions]=useState<Condition[]>([blank(session)]);
 const [target,setTarget]=useState(devices.find(d=>d.kind==='actuator')?.id??devices[0]!.id);
 const targetDef=devices.find(d=>d.id===target)??devices[0]!;
 const [key,setKey]=useState('state');
 const activeKey=Object.hasOwn(targetDef.parameters,key)?key:Object.keys(targetDef.parameters)[0]??'';
 const parameter=targetDef.parameters[activeKey];
 const [actionValue,setActionValue]=useState('true');
 const [error,setError]=useState('');
 const update=(index:number,patch:Partial<Condition>)=>setConditions(rows=>rows.map((row,i)=>i===index?{...row,...patch}:row));
 const chooseSuggestion=(item:typeof suggested[number])=>{setId(item.id);if(item.key){const dot=item.key.indexOf('.');const nextTarget=item.key.slice(0,dot),nextKey=item.key.slice(dot+1);if(devices.some(d=>d.id===nextTarget)){setTarget(nextTarget);setKey(nextKey);if(item.value!==undefined)setActionValue(String(item.value));}}};
 const edit=(rule:ControlRule)=>{setId(rule.id);setTarget(rule.target);setKey(rule.parameter);setActionValue(String(rule.value));setConditions(rule.when.map(p=>({source:p.source,target:p.target??'',key:p.key??'',op:p.op,value:String(p.value??''),valueType:typeof p.value==='number'?'number':typeof p.value==='boolean'?'boolean':'text'})));setError('');};
 const save=async()=>{
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id)){setError('规则编号请使用字母、数字、下划线或短横线，最多80个字符。');return;}
  const when:Predicate[]=conditions.map(row=>({source:row.source,...(row.target?{target:row.target}:{}),...(row.key?{key:row.key}:{}),op:row.op,...(!['exists','absent'].includes(row.op)?{value:scalar(row.value,row.valueType)}:{})}));
  const value:Scalar=parameter?.type==='number'?Number(actionValue):parameter?.type==='boolean'?actionValue==='true':parameter?.type==='select'?(parameter.options?.find(option=>String(option)===actionValue)??actionValue):actionValue;
  if(when.some(p=>typeof p.value==='number'&&!Number.isFinite(p.value))||typeof value==='number'&&!Number.isFinite(value)){setError('数值条件或动作必须填写有效数字。');return;}
  if(!parameter){setError('请选择可写入的设备参数。');return;}
  setError('');await send('rule',undefined,{rule:{id,when,target,parameter:activeKey,value}});
 };
 return <div className="rules-panel"><div className="rules-intro"><span className="objective-glyph"><Settings2 size={16}/></span><div><b>自动控制规则</b><small>所有条件同时成立时执行动作；规则按显示顺序在服务器仿真 tick 中运行。</small></div></div>
  {!!suggested.length&&<div className="rule-suggestions"><small>当前工程要求的规则编号</small>{suggested.map(item=><button key={item.id} onClick={()=>chooseSuggestion(item)} className={item.id===id?'active':''}>{item.id}</button>)}</div>}
  <div className="rule-builder"><label>规则编号<input value={id} onChange={e=>setId(e.target.value)} maxLength={80}/></label>
  {conditions.map((condition,index)=>{
   const device=devices.find(d=>d.id===condition.target);
   const needsDevice=['reading','parameter','reachable','connected','installed','enabled','fault'].includes(condition.source);
   return <fieldset className="rule-condition" key={index}><legend>条件 {index+1} · 同时满足</legend>
    <label>条件来源<select value={condition.source} onChange={e=>{const source=e.target.value as Predicate['source'];update(index,{source,target:['metric','ticks'].includes(source)?'':device?.id??devices[0]!.id,key:source==='metric'?Object.keys(state?.environment??{})[0]??'':source==='parameter'?Object.keys(device?.parameters??{})[0]??'':'',valueType:['reachable','connected','installed','enabled'].includes(source)?'boolean':'number',value:['reachable','connected','installed','enabled'].includes(source)?'true':'30'});}}>{Object.entries(sourceLabels).map(([source,label])=><option value={source} key={source}>{label}</option>)}</select></label>
    {needsDevice&&<label>来源设备<select value={condition.target} onChange={e=>update(index,{target:e.target.value,key:''})}>{devices.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select></label>}
    {condition.source==='metric'&&<label>环境指标<select value={condition.key} onChange={e=>update(index,{key:e.target.value})}><option value="">选择指标</option>{Object.keys(state?.environment??session.level.environment).sort().map(k=><option key={k} value={k}>{k} = {state?.environment[k]}</option>)}</select></label>}
    {condition.source==='parameter'&&<label>读取参数<select value={condition.key} onChange={e=>{const p=device?.parameters[e.target.value];update(index,{key:e.target.value,valueType:p?.type==='number'?'number':p?.type==='boolean'?'boolean':'text',value:String(p?.value??'')});}}><option value="">选择参数</option>{Object.entries(device?.parameters??{}).map(([k,p])=><option key={k} value={k}>{p.label}</option>)}</select></label>}
    {['reachable','connected'].includes(condition.source)&&<label>另一设备<select value={condition.key} onChange={e=>update(index,{key:e.target.value})}><option value="">选择设备</option>{devices.filter(d=>d.id!==condition.target).map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select></label>}
    {condition.source==='flag'&&<label>标记编号<input value={condition.target} onChange={e=>update(index,{target:e.target.value})}/></label>}
    {condition.source==='fault'&&<label>故障名称<input value={condition.key} onChange={e=>update(index,{key:e.target.value})} list="rule-faults"/><datalist id="rule-faults">{device?.faults.map(f=><option key={f} value={f}/>)}</datalist></label>}
    <label>比较方式<select value={condition.op} onChange={e=>update(index,{op:e.target.value as Predicate['op']})}>{Object.entries(opLabels).filter(([op])=>op!=='includes').map(([op,label])=><option value={op} key={op}>{label}</option>)}</select></label>
    {!['exists','absent'].includes(condition.op)&&<><label>值类型<select value={condition.valueType} onChange={e=>update(index,{valueType:e.target.value as Condition['valueType'],value:e.target.value==='boolean'?'true':e.target.value==='number'?'0':''})}><option value="number">数字</option><option value="boolean">开关 / 布尔</option><option value="text">文本</option></select></label><label>比较值{condition.valueType==='boolean'?<select value={condition.value} onChange={e=>update(index,{value:e.target.value})}><option value="true">true / 是</option><option value="false">false / 否</option></select>:<input type={condition.valueType==='number'?'number':'text'} step="any" value={condition.value} onChange={e=>update(index,{value:e.target.value})}/>}</label></>}
    {conditions.length>1&&<button className="button button-small button-outline" onClick={()=>setConditions(rows=>rows.filter((_,i)=>i!==index))}><Trash2 size={13}/>删除条件</button>}
   </fieldset>;
  })}
  <button className="button button-small button-outline" disabled={conditions.length>=8} onClick={()=>setConditions(rows=>[...rows,blank(session)])}><Plus size={13}/>添加“并且”条件</button><div className="rule-arrow"><ArrowDown size={15}/>触发动作</div>
  <label>控制设备<select value={target} onChange={e=>{setTarget(e.target.value);const next=devices.find(d=>d.id===e.target.value);const first=Object.entries(next?.parameters??{})[0];setKey(first?.[0]??'');setActionValue(String(first?.[1].value??''));}}>{devices.filter(d=>Object.keys(d.parameters).length>0).map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
  <label>写入参数<select value={activeKey} onChange={e=>{setKey(e.target.value);setActionValue(String(targetDef.parameters[e.target.value]?.value??''));}}>{Object.entries(targetDef.parameters).map(([k,p])=><option key={k} value={k}>{p.label}</option>)}</select></label>
  <label>设置为{parameter?.type==='boolean'?<select value={actionValue} onChange={e=>setActionValue(e.target.value)}><option value="true">true / 开启</option><option value="false">false / 关闭</option></select>:parameter?.type==='select'?<select value={actionValue} onChange={e=>setActionValue(e.target.value)}>{parameter.options?.map(option=><option key={String(option)} value={String(option)}>{String(option)}</option>)}</select>:<input type={parameter?.type==='number'?'number':'text'} min={parameter?.min} max={parameter?.max} step={parameter?.step??'any'} value={actionValue} onChange={e=>setActionValue(e.target.value)}/>}</label>
  {error&&<p role="alert" className="rule-validation">{error}</p>}<button className="button button-primary" onClick={()=>void save()} disabled={busy}><Plus size={14}/>{state?.rules.some(rule=>rule.id===id)?'更新规则':'添加规则'}</button></div>
  <div className="installed-rules"><b>已安装规则 <span>{state?.rules.length??0}</span></b>{state?.rules.length?state.rules.map(rule=><div className="installed-rule" key={rule.id}><div><small>{rule.id}</small><p>{rule.when.map(p=>`${p.source} ${p.target??p.key??''} ${opLabels[p.op]} ${String(p.value??'')}`).join(' 并且 ')}</p><p>{rule.target}.{rule.parameter} ← {String(rule.value)}</p></div><button className="icon-btn" aria-label={`编辑规则${rule.id}`} onClick={()=>edit(rule)} disabled={busy}><Pencil size={13}/></button><button className="icon-btn" aria-label={`移除规则${rule.id}`} onClick={()=>void send('remove-rule',rule.id)} disabled={busy}><Trash2 size={13}/></button></div>):<p className="no-rules">添加后运行仿真，观察设备和环境变化。</p>}</div>
 </div>;
}
