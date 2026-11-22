import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../src/index.ts';
import {simulateTick,observe} from '../src/simulation.ts';
import {reachable} from '../src/network.ts';
import {calibration} from './fixture.ts';
test('edge buffers are bounded and reconnect flushes samples exactly once',()=>{
 const s=createState(calibration,1),probe=s.devices.probe!,sink=s.devices.gateway!;
 Object.assign(probe.parameters,{offset:-7,bufferEnabled:true,bufferLimit:2,sinkDevice:sink.id,topic:'factory/temperature',historyWindow:4});
 Object.assign(sink.parameters,{subscription:'factory/+',online:false});
 for(let i=0;i<3;i++)simulateTick(calibration,s);
 assert.equal(s.environment.buffered_probe,2);assert.equal(s.environment.droppedSamples_probe,1);assert.equal(s.environment.deliveredSamples_probe,0);
 sink.parameters.online=true;simulateTick(calibration,s);
 assert.equal(s.environment.buffered_probe,0);assert.equal(s.environment.replayed_probe,2);assert.equal(s.environment.deliveredSamples_probe,3);assert.equal(s.environment.lastDelivered_probe,25);
 simulateTick(calibration,s);assert.equal(s.environment.replayed_probe,2);assert.equal(s.environment.deliveredSamples_probe,4);
});
test('sliding window records history and clears a transient anomaly after stable samples',()=>{
 const s=createState(calibration,1),probe=s.devices.probe!;
 Object.assign(probe.parameters,{offset:-7,historyWindow:3,anomalyThreshold:5});
 simulateTick(calibration,s);s.environment.temperature=40;simulateTick(calibration,s);assert.equal(s.environment.anomaly_probe,1);assert.equal(s.environment.trend_probe,15);
 for(let i=0;i<3;i++)simulateTick(calibration,s);
 assert.equal(s.environment.anomaly_probe,0);assert.equal(s.environment.sampleCount_probe,3);assert.equal(s.environment.windowMean_probe,40);
});
test('zones require an explicit firewall route and protected links require encryption',()=>{
 const s=createState(calibration,1),probe=s.devices.probe!,gateway=s.devices.gateway!;
 probe.parameters.zone='ot';gateway.parameters.zone='it';assert.equal(reachable(s,probe.id,gateway.id),false);
 Object.assign(gateway.parameters,{firewallEnabled:true,routeToZone:'ot',acl:'allow'});assert.equal(reachable(s,probe.id,gateway.id),true);
 gateway.parameters.encryptionRequired=true;assert.equal(reachable(s,probe.id,gateway.id),false);
 probe.parameters.encrypted=true;assert.equal(reachable(s,probe.id,gateway.id),true);
 gateway.parameters.acl='deny';assert.equal(reachable(s,probe.id,gateway.id),false);
});
test('sleeping probe keeps its last sample until its configured sample interval',()=>{
 const s=createState(calibration,1),probe=s.devices.probe!;Object.assign(probe.parameters,{offset:-7,sleep:true,sampleInterval:3});observe(calibration,s);
 s.environment.temperature=40;simulateTick(calibration,s);assert.equal(probe.reading,25);simulateTick(calibration,s);assert.equal(probe.reading,25);simulateTick(calibration,s);assert.equal(probe.reading,40);
});
