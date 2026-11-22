import type {DeviceState,GameState} from '../../shared/src/index.ts';

const num=(value:unknown,fallback=0)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
export function busPeers(s:GameState,id:string):DeviceState[] {
  const ids=new Set([id]),queue=[id];
  for(let i=0;i<queue.length;i++)for(const link of s.links){
    if(link.kind!=='bus')continue;
    const next=link.from===queue[i]?link.to:link.to===queue[i]?link.from:undefined;
    if(next&&!ids.has(next)&&s.devices[next]?.installed){ids.add(next);queue.push(next);}
  }
  return [...ids].map(key=>s.devices[key]!).filter(d=>d?.installed&&d.enabled&&d.parameters.online!==false);
}
export function i2cConflict(s:GameState,d:DeviceState):boolean {
  return d.parameters.bus==='i2c'&&d.parameters.address!==undefined&&busPeers(s,d.id).some(peer=>peer.id!==d.id&&peer.parameters.bus==='i2c'&&peer.parameters.address===d.parameters.address);
}
export function controllerAlive(d:DeviceState):boolean {
  return d.installed&&d.enabled&&d.parameters.online!==false&&!d.faults.includes('hardware')&&!d.faults.includes('watchdog-reset');
}
export function embeddedObserve(s:GameState):void {
  for(const d of Object.values(s.devices)){
    if(d.parameters.bus==='i2c')s.environment[`i2cReady_${d.id}`]=!i2cConflict(s,d)&&controllerAlive(d)?1:0;
    if(d.parameters.gpioMode!==undefined)s.environment[`gpioOutput_${d.id}`]=controllerAlive(d)&&d.parameters.gpioMode==='output'&&d.parameters.gpioValue!==false?1:0;
    if(d.parameters.watchdogEnabled!==undefined)s.environment[`controllerAlive_${d.id}`]=controllerAlive(d)?1:0;
    if(d.parameters.sleep!==undefined){
      const interval=Math.max(1,num(d.parameters.sampleInterval,1));
      s.environment[`sampleAge_${d.id}`]=d.parameters.sleep===true?s.tick%interval:0;
    }
  }
}
export function embeddedTick(s:GameState):void {
  for(const d of Object.values(s.devices))if(d.installed&&d.enabled&&d.parameters.watchdogEnabled!==undefined){
    const timeout=Math.max(1,num(d.parameters.watchdogTimeout,3));
    const unhealthy=d.parameters.firmwareHealthy===false;
    if(d.parameters.watchdogEnabled===true&&unhealthy&&s.tick%timeout===0){
      if(!d.faults.includes('watchdog-reset'))d.faults.push('watchdog-reset');
      const key=`resetCount_${d.id}`;s.environment[key]=num(s.environment[key])+1;
    }else if(!unhealthy)d.faults=d.faults.filter(f=>f!=='watchdog-reset');
  }
}
export function drivenDuty(s:GameState,d:DeviceState):number {
  const drivers=s.links.filter(l=>l.kind==='wire'&&(l.from===d.id||l.to===d.id)).map(l=>s.devices[l.from===d.id?l.to:l.from]!).filter(Boolean);
  if(drivers.some(driver=>!controllerAlive(driver)||driver.parameters.gpioMode==='input'||driver.parameters.gpioValue===false))return 0;
  if(d.parameters.pwmDriven===true){
    const pwm=drivers.find(driver=>driver.parameters.pwmEnabled===true&&num(driver.parameters.pwmFrequency)>0);
    return pwm?Math.max(0,Math.min(100,num(pwm.parameters.pwmDuty)))/100:0;
  }
  return Math.max(0,Math.min(100,num(d.parameters.duty,100)))/100;
}
