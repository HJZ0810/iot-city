import type {GameState,LevelDefinition,DeviceState} from '../../shared/src/index.ts';
import {evaluate} from './predicates.ts';
import {reachable,usableLink,topicMatches,pathReliability} from './network.ts';
import {i2cConflict,embeddedObserve,embeddedTick,drivenDuty} from './embedded.ts';
import {observeBridges} from './bridge.ts';
import {observeUrban,urbanActuator} from './urban.ts';
import {observeTelemetry,telemetryTick} from './telemetry.ts';
const n=(v:unknown,f=0)=>typeof v==='number'&&Number.isFinite(v)?v:f;
const clamp=(v:number,min:number,max:number)=>Math.min(max,Math.max(min,v));
const round=(v:number)=>Math.round(v*10000)/10000;
function recover(d:DeviceState,s:GameState){
 d.faults=d.faults.filter(f=>{switch(f){case'offline':return !d.enabled||d.parameters.online===false;case'uncalibrated':return Math.abs(n(d.parameters.rawBias)+n(d.parameters.offset))>.1;case'noise':return n(d.parameters.noiseFilter)<.7;case'aliasing':return n(d.parameters.sampleRate)<=2*n(d.parameters.signalFrequency);case'unauthorized':return d.parameters.authenticated!==true;case'unencrypted':return d.parameters.encrypted!==true;case'address-conflict':return i2cConflict(s,d);case'baud-mismatch':return s.links.some(l=>l.kind==='bus'&&(l.from===d.id||l.to===d.id)&&s.devices[l.from===d.id?l.to:l.from]?.parameters.baudRate!==d.parameters.baudRate);case'interference':return s.links.some(l=>l.kind==='wireless'&&(l.from===d.id||l.to===d.id)&&!usableLink(l,s));default:return true;}});
 d.status=!d.installed||!d.enabled||d.parameters.online===false?'offline':d.faults.length?'fault':'online';
}
export function observe(level:LevelDefinition,s:GameState):void{
 observeUrban(s);
 let sampleValid=1,energy=0;
 for(const def of level.devices){const d=s.devices[def.id]!;recover(d,s);if(def.kind==='sensor'&&!(d.parameters.sleep===true&&s.tick>0&&s.tick%Math.max(1,n(d.parameters.sampleInterval,1))!==0)){
  const truth=n(s.environment[String(d.parameters.metric??'temperature')]),filter=clamp(n(d.parameters.noiseFilter),0,1),noise=d.faults.includes('noise')?Math.sin((s.seed%997)*.1+s.tick*2.17)*(1-filter)*3:0;
  let reading=(truth+n(d.parameters.rawBias)+n(d.parameters.offset)+noise)*n(d.parameters.scale,1);
  if(typeof d.parameters.bits==='number'){const bits=clamp(d.parameters.bits,1,24),full=n(d.parameters.fullScale,100),code=clamp(Math.round(reading/full*(2**bits-1)),0,2**bits-1);s.environment[`adcCode_${d.id}`]=code;reading=code/(2**bits-1)*full;}
  d.reading=round(reading);if(d.parameters.signalFrequency!==undefined&&n(d.parameters.sampleRate)<=2*n(d.parameters.signalFrequency))sampleValid=0;
 }else if(def.kind==='sensor'){}else if(def.kind==='power')d.reading=round(n(d.parameters.voltage)*n(d.parameters.current));else if(def.kind==='rfid')d.reading=d.parameters.tag===d.parameters.expectedTag&&d.parameters.authorized===true?1:0;else d.reading=n(d.parameters.duty,typeof d.parameters.state==='boolean'&&d.parameters.state?100:0);
 energy+=d.enabled&&d.installed?n(d.parameters.consumption,def.kind==='actuator'&&d.parameters.state?4:.1)*(d.parameters.sleep===true?.1:1):0;
 }
 observeBridges(s);
 const active=Object.values(s.devices).filter(d=>d.installed&&d.enabled&&d.parameters.online!==false),gateways=level.devices.filter(d=>d.kind==='gateway'||d.kind==='cloud').map(d=>d.id);
 s.environment.onlineDevices=active.filter(d=>d.status==='online').length;s.environment.reachableDevices=active.filter(d=>gateways.some(g=>g!==d.id&&reachable(s,d.id,g))).length;s.environment.energy=round(energy);s.environment.sampleValid=sampleValid;s.environment.faultCount=active.reduce((v,d)=>v+d.faults.length,0);
 const valid=s.links.filter(l=>usableLink(l,s)),loss=s.links.length?1-valid.reduce((v,l)=>v+l.quality,0)/s.links.length:0,pubs=active.filter(d=>typeof d.parameters.topic==='string'&&(d.parameters.bridgeEnabled===undefined||s.environment[`bridgeReady_${d.id}`]===1)),subs=active.filter(d=>typeof d.parameters.subscription==='string');let deliveryRate=0,retained=0,wills=n(s.environment.willMessages),duplicates=0;
 for(const p of pubs)for(const q of subs){if(p.id===q.id||!topicMatches(String(p.parameters.topic),String(q.parameters.subscription))||p.parameters.authenticated===false||q.parameters.authenticated===false||p.parameters.acl==='deny'||q.parameters.acl==='deny')continue;const quality=pathReliability(s,p.id,q.id),qos=n(p.parameters.qos),attempts=qos>0?Math.max(1,Math.min(20,n(p.parameters.retries,1)+1)):1;deliveryRate=Math.max(deliveryRate,1-(1-quality)**attempts);if(qos===1&&quality>0&&quality<1&&attempts>1)duplicates=1;}
 for(const p of Object.values(s.devices))if(typeof p.parameters.topic==='string'){
  const online=p.installed&&p.enabled&&p.parameters.online!==false,flag=`online:${p.id}`;if(online&&!s.flags.includes(flag))s.flags.push(flag);if(!online&&s.flags.includes(flag)){s.flags=s.flags.filter(f=>f!==flag);if(p.parameters.will===true)wills++;}
 }
 for(const flag of s.flags.filter(f=>f.startsWith('retained:'))){const topic=JSON.parse(flag.slice(9))as string;if(subs.some(q=>q.parameters.authenticated!==false&&topicMatches(topic,String(q.parameters.subscription))))retained++;}
 s.environment.deliveryRate=round(deliveryRate);s.environment.delivery=deliveryRate>=.9?1:0;s.environment.duplicateMessages=duplicates;s.environment.retainedMessages=retained;s.environment.willMessages=wills;s.environment.packetLoss=round(loss);embeddedObserve(s);observeTelemetry(s);
}
export function simulateTick(level:LevelDefinition,s:GameState):void{
 s.tick++;embeddedTick(s);observe(level,s);for(const r of s.rules)if(r.when.every(p=>evaluate(p,s))){const d=s.devices[r.target];if(d&&d.installed&&d.enabled){d.parameters[r.parameter]=r.value;const flag=`rule-fired:${r.id}`;if(!s.flags.includes(flag))s.flags.push(flag);}}
 s.environment.alarm=0;
 for(const def of level.devices){const d=s.devices[def.id]!;if(def.kind!=='actuator'||!d.installed||!d.enabled||d.faults.includes('hardware')||d.parameters.state!==true)continue;
  const drivers=s.links.map(l=>l.from===d.id?l.to:l.to===d.id?l.from:null).filter((x):x is string=>x!==null).map(x=>s.devices[x]!);if(drivers.some(x=>x.parameters.gpioMode==='input'))continue;
  const duty=drivenDuty(s,d);urbanActuator(s,d.parameters.effect,duty);switch(d.parameters.effect){case'pump':case'valve':s.environment.moisture=round(clamp(n(s.environment.moisture)+2*duty,0,100));break;case'fan':s.environment.temperature=round(n(s.environment.temperature,25)-.6*duty);s.environment.humidity=round(clamp(n(s.environment.humidity,50)-.3*duty,0,100));break;case'heater':s.environment.temperature=round(n(s.environment.temperature,25)+.8*duty);break;case'light':s.environment.light=round(n(s.environment.light)+10*duty);break;case'motor':s.environment.vibration=round(2*duty);break;case'alarm':s.environment.alarm=1;break;}
 }for(const d of Object.values(s.devices))if(d.installed&&d.enabled&&d.parameters.online!==false&&d.parameters.retain===true&&typeof d.parameters.topic==='string'){const flag='retained:'+JSON.stringify(d.parameters.topic);if(!s.flags.includes(flag))s.flags.push(flag);}observe(level,s);telemetryTick(level,s);
}
