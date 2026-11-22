import type {GameState,Predicate,Scalar} from '../../shared/src/index.ts';
import {reachable,usableLink} from './network.ts';
export function evaluate(p:Predicate,s:GameState):boolean{
 const d=p.target&&Object.hasOwn(s.devices,p.target)?s.devices[p.target]:undefined;let a:Scalar|string[]|undefined;
 switch(p.source){
 case'parameter':if(!d||!p.key||!Object.hasOwn(d.parameters,p.key))return false;a=d.parameters[p.key];break;
 case'reading':if(!d)return false;a=d.reading;break;
 case'metric':if(!p.key||!Object.hasOwn(s.environment,p.key))return false;a=s.environment[p.key];break;
 case'installed':if(!d)return false;a=d.installed;break;
 case'enabled':if(!d)return false;a=d.enabled;break;
 case'connected':if(!d||!p.key||!Object.hasOwn(s.devices,p.key))return false;a=s.links.some(l=>((l.from===p.target&&l.to===p.key)||(l.to===p.target&&l.from===p.key))&&usableLink(l,s));break;
 case'reachable':if(!d||!p.key||!Object.hasOwn(s.devices,p.key))return false;a=reachable(s,p.target!,p.key);break;
 case'inspected':if(!d)return false;a=p.value===undefined?s.inspected.includes(p.target!):s.inspected;break;
 case'flag':a=p.value===undefined?s.flags.includes(p.target??p.key??''):s.flags;break;
 case'inventory':a=p.value===undefined?s.inventory.includes(p.target??''):s.inventory;break;
 case'fault':if(!d)return false;a=p.value===undefined?d.faults.includes(p.key??''):d.faults;break;
 case'rule':{const rule=s.rules.find(r=>r.id===p.target);if(p.key){if(!rule||p.key!==`${rule.target}.${rule.parameter}`)return false;a=rule.value;}else a=Boolean(rule);break;}
 case'task':a=s.completedTasks.includes(p.target??'');break;
 case'dialog':a=p.value===undefined?s.dialogs.includes(p.target??p.key??''):s.dialogs;break;
 case'ticks':a=s.tick;break;
 default:return false;
 }if(a===undefined)return false;
 switch(p.op){case'eq':return a===p.value;case'ne':return a!==p.value;case'gt':return typeof a==='number'&&typeof p.value==='number'&&a>p.value;case'gte':return typeof a==='number'&&typeof p.value==='number'&&a>=p.value;case'lt':return typeof a==='number'&&typeof p.value==='number'&&a<p.value;case'lte':return typeof a==='number'&&typeof p.value==='number'&&a<=p.value;case'includes':return Array.isArray(a)&&typeof p.value==='string'&&a.includes(p.value);case'exists':return Array.isArray(a)?a.length>0:typeof a==='boolean'?a:true;case'absent':return Array.isArray(a)?a.length===0:a===false;default:return false;}
}
