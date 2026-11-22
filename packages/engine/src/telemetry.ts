import type {GameState,LevelDefinition,TelemetryState} from '../../shared/src/index.ts';
import {reachable,topicMatches} from './network.ts';
const n=(value:unknown,fallback=0)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
const round=(value:number)=>Math.round(value*10000)/10000;
export function observeTelemetry(s:GameState):void {
 for(const d of Object.values(s.devices))if(d.parameters.historyWindow!==undefined||d.parameters.bufferEnabled!==undefined){
  const t=s.telemetry?.[d.id],history=t?.history??[],mean=history.length?history.reduce((a,b)=>a+b,0)/history.length:0,range=history.length?Math.max(...history)-Math.min(...history):0;
  Object.assign(s.environment,{[`sampleCount_${d.id}`]:history.length,[`windowMean_${d.id}`]:round(mean),[`windowRange_${d.id}`]:round(range),[`trend_${d.id}`]:history.length>1?round(history.at(-1)!-history[0]!):0,[`anomaly_${d.id}`]:range>n(d.parameters.anomalyThreshold,5)?1:0,[`buffered_${d.id}`]:t?.buffer.length??0,[`replayed_${d.id}`]:t?.replayed??0,[`deliveredSamples_${d.id}`]:t?.delivered??0,[`lastDelivered_${d.id}`]:t?.lastValue??0,[`droppedSamples_${d.id}`]:t?.dropped??0});
 }
}
export function telemetryTick(level:LevelDefinition,s:GameState):void {
 for(const def of level.devices){const d=s.devices[def.id];if(!d||def.kind!=='sensor'||!d.installed||!d.enabled||d.parameters.online===false||d.parameters.historyWindow===undefined&&d.parameters.bufferEnabled===undefined)continue;
  if(d.parameters.sleep===true&&s.tick%Math.max(1,n(d.parameters.sampleInterval,1))!==0)continue;
  s.telemetry??={};const t:TelemetryState=s.telemetry[d.id]??={history:[],buffer:[],delivered:0,replayed:0,dropped:0};
  const window=Math.max(2,Math.min(120,Math.floor(n(d.parameters.historyWindow,10))));t.history=[...t.history,d.reading].slice(-window);
  if(d.parameters.bufferEnabled===undefined)continue;
  const sink=s.devices[String(d.parameters.sinkDevice??'')],connected=sink&&sink.status==='online'&&d.status==='online'&&d.parameters.authenticated!==false&&d.parameters.acl!=='deny'&&sink.parameters.authenticated!==false&&sink.parameters.acl!=='deny'&&typeof d.parameters.topic==='string'&&typeof sink.parameters.subscription==='string'&&topicMatches(d.parameters.topic,sink.parameters.subscription)&&reachable(s,d.id,sink.id);
  if(connected){t.replayed+=t.buffer.length;t.delivered+=t.buffer.length+1;t.lastValue=d.reading;t.buffer=[];}
  else if(d.parameters.bufferEnabled===true){const limit=Math.max(1,Math.min(120,Math.floor(n(d.parameters.bufferLimit,20))));t.buffer.push(d.reading);if(t.buffer.length>limit){t.dropped+=t.buffer.length-limit;t.buffer=t.buffer.slice(-limit);}}
  else t.dropped++;
 }
 observeTelemetry(s);
}
