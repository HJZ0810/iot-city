import type {GameState,Link} from '../../shared/src/index.ts';
import {i2cConflict} from './embedded.ts';
export function usableLink(l:Link,s:GameState):boolean{
 const a=s.devices[l.from],b=s.devices[l.to];if(!a||!b||!a.installed||!b.installed||!a.enabled||!b.enabled||a.parameters.online===false||b.parameters.online===false||l.quality<=0||a.faults.includes('hardware')||b.faults.includes('hardware'))return false;

 if(a.parameters.zone!==undefined&&b.parameters.zone!==undefined&&a.parameters.zone!==b.parameters.zone){const permitted=(a.parameters.firewallEnabled===true&&a.parameters.routeToZone===b.parameters.zone&&a.parameters.acl!=='deny')||(b.parameters.firewallEnabled===true&&b.parameters.routeToZone===a.parameters.zone&&b.parameters.acl!=='deny');if(!permitted)return false;}
 if((a.parameters.encryptionRequired===true||b.parameters.encryptionRequired===true)&&(a.parameters.encrypted!==true||b.parameters.encrypted!==true))return false; if(l.kind==='wireless'){
  if(a.parameters.channel!==undefined&&b.parameters.channel!==undefined&&a.parameters.channel!==b.parameters.channel)return false;
  const distance=Math.hypot(a.position[0]-b.position[0],a.position[1]-b.position[1],a.position[2]-b.position[2]);
  if(distance>Math.min(Number(a.parameters.range??100),Number(b.parameters.range??100)))return false;
  if(a.parameters.ssid!==undefined&&b.parameters.ssid!==undefined&&a.parameters.ssid!==b.parameters.ssid)return false;
  const pa=String(a.parameters.protocol??'').toLowerCase(),pb=String(b.parameters.protocol??'').toLowerCase();
  if(['zigbee','ble','lora','nbiot'].includes(pa)||['zigbee','ble','lora','nbiot'].includes(pb)){
   if(pa!==pb)return false;
   if(pa==='zigbee'){
    if(!['coordinator','router','end'].includes(String(a.parameters.role))||!['coordinator','router','end'].includes(String(b.parameters.role))||a.parameters.role==='end'&&b.parameters.role==='end'||a.parameters.panId!==b.parameters.panId)return false;
    const coordinators=Object.values(s.devices).filter(d=>d.installed&&d.enabled&&d.parameters.online!==false&&String(d.parameters.protocol).toLowerCase()==='zigbee'&&d.parameters.role==='coordinator'&&d.parameters.channel===a.parameters.channel&&d.parameters.panId===a.parameters.panId);if(coordinators.length!==1)return false;
   }
   if(pa==='ble'&&(a.parameters.pairedWith!==b.id||b.parameters.pairedWith!==a.id||a.parameters.pairingKey===undefined||a.parameters.pairingKey!==b.parameters.pairingKey||a.parameters.authenticated!==true||b.parameters.authenticated!==true))return false;
   if(pa==='lora'&&['frequency','spreadingFactor','bandwidth'].some(k=>a.parameters[k]===undefined||a.parameters[k]!==b.parameters[k]))return false;
   if(pa==='nbiot'&&(a.parameters.authenticated!==true||b.parameters.authenticated!==true||a.parameters.apn===undefined||a.parameters.apn!==b.parameters.apn))return false;
  }
 }
 if(l.kind==='bus'&&(a.parameters.bus==='i2c'&&i2cConflict(s,a)||b.parameters.bus==='i2c'&&i2cConflict(s,b)))return false;
 return !(l.kind==='bus'&&a.parameters.bus==='uart'&&b.parameters.bus==='uart'&&a.parameters.baudRate!==b.parameters.baudRate);
}
export function reachable(s:GameState,from:string,to:string):boolean{
 if(!Object.hasOwn(s.devices,from)||!Object.hasOwn(s.devices,to))return false;
 if(!s.devices[from]!.installed||!s.devices[from]!.enabled||!s.devices[to]!.installed||!s.devices[to]!.enabled)return false;
 const queue=[from],seen=new Set([from]);for(let i=0;i<queue.length;i++){const current=queue[i]!;if(current===to)return true;const node=s.devices[current]!;if(current!==from&&String(node.parameters.protocol).toLowerCase()==='zigbee'&&node.parameters.role==='end')continue;for(const l of s.links){if(!usableLink(l,s))continue;const next=l.from===current?l.to:l.to===current?l.from:null;if(next&&!seen.has(next)){seen.add(next);queue.push(next);}}}return false;
}
export function topicMatches(topic:string,subscription:string):boolean{const t=topic.split('/'),s=subscription.split('/');for(let i=0;i<s.length;i++){if(s[i]==='#')return i===s.length-1;if(i>=t.length||s[i]!=='+'&&s[i]!==t[i])return false;}return t.length===s.length;}
export function pathReliability(s:GameState,from:string,to:string):number{
 if(!Object.hasOwn(s.devices,from)||!Object.hasOwn(s.devices,to))return 0;const best=new Map([[from,1]]),done=new Set<string>();for(let i=0;i<Object.keys(s.devices).length;i++){const next=[...best].filter(([id])=>!done.has(id)).sort((a,b)=>b[1]-a[1])[0];if(!next)return 0;const[current,quality]=next;if(current===to)return quality;done.add(current);const d=s.devices[current]!;if(current!==from&&String(d.parameters.protocol).toLowerCase()==='zigbee'&&d.parameters.role==='end')continue;for(const link of s.links){if(!usableLink(link,s))continue;const other=link.from===current?link.to:link.to===current?link.from:null;if(other){const q=quality*link.quality;if(q>(best.get(other)??0))best.set(other,q);}}}return best.get(to)??0;
}
