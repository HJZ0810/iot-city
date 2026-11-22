import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../src/index.ts';
import {observe} from '../src/simulation.ts';
import {calibration} from './fixture.ts';
import {observeUrban,urbanActuator} from '../src/urban.ts';
test('gateway adapter requires the upstream protocol, topic, live path and downstream subscriber',()=>{
  const s=createState(calibration,1),probe=s.devices.probe!,gateway=s.devices.gateway!,cloud=s.devices.pump!;
  Object.assign(probe.parameters,{protocol:'coap',topic:'river/raw',offset:-7});
  Object.assign(gateway.parameters,{bridgeEnabled:true,sourceDevice:'probe',inputProtocol:'coap',subscription:'river/raw',outputProtocol:'mqtt',topic:'city/river',mappingScale:2,mappingOffset:1});
  cloud.parameters.subscription='city/+';s.links.push({from:gateway.id,to:cloud.id,kind:'network',quality:1});
  observe(calibration,s);assert.equal(s.environment.bridgeDelivered_gateway,1);assert.equal(s.environment.mappedValue_gateway,51);
  gateway.parameters.inputProtocol='http';observe(calibration,s);assert.equal(s.environment.bridgeDelivered_gateway,0);
  gateway.parameters.inputProtocol='coap';s.links=s.links.filter(l=>l.from!=='probe');observe(calibration,s);assert.equal(s.environment.bridgeReady_gateway,0);
  s.links.push({from:'probe',to:'gateway',kind:'network',quality:1});probe.parameters.online=false;observe(calibration,s);assert.equal(s.environment.bridgeReady_gateway,0);
});
test('parking barrier consumes queued arrivals without admitting beyond capacity',()=>{
  const s=createState(calibration,1);Object.assign(s.environment,{parkingCapacity:2,parkingOccupied:1,waitingVehicles:3});
  observeUrban(s);assert.equal(s.environment.availableSpots,1);urbanActuator(s,'barrier',1);urbanActuator(s,'barrier',1);observeUrban(s);
  assert.equal(s.environment.parkingOccupied,2);assert.equal(s.environment.availableSpots,0);assert.equal(s.environment.admittedVehicles,1);assert.equal(s.environment.waitingVehicles,2);
  s.environment.traffic=3;urbanActuator(s,'trafficSignal',.5);assert.equal(s.environment.traffic,2.5);
});
