import type {GameState} from '../../shared/src/index.ts';
import {reachable,topicMatches} from './network.ts';

// An explicit teaching adapter: source reading -> linear numeric mapping -> MQTT topic.
// It does not execute protocol stacks or arbitrary transformation scripts.
export function observeBridges(s:GameState):void {
  for(const gateway of Object.values(s.devices))if(gateway.parameters.bridgeEnabled!==undefined){
    const p=gateway.parameters,source=s.devices[String(p.sourceDevice??'')];
    const ready=Boolean(p.bridgeEnabled===true&&source&&source.status==='online'&&gateway.status==='online'&&reachable(s,source.id,gateway.id)&&source.parameters.protocol===p.inputProtocol&&typeof source.parameters.topic==='string'&&typeof p.subscription==='string'&&topicMatches(source.parameters.topic,p.subscription)&&p.outputProtocol==='mqtt'&&typeof p.topic==='string'&&typeof p.mappingScale==='number'&&typeof p.mappingOffset==='number');
    s.environment[`bridgeReady_${gateway.id}`]=ready?1:0;
    s.environment[`mappedValue_${gateway.id}`]=ready?source!.reading*Number(p.mappingScale)+Number(p.mappingOffset):0;
    s.environment[`bridgeDelivered_${gateway.id}`]=ready&&Object.values(s.devices).some(d=>d.id!==gateway.id&&d.status==='online'&&d.parameters.authenticated!==false&&d.parameters.acl!=='deny'&&typeof d.parameters.subscription==='string'&&topicMatches(String(p.topic),d.parameters.subscription)&&reachable(s,gateway.id,d.id))?1:0;
  }
}
