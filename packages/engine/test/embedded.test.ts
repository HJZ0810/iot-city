import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createState,applyCommand} from '../src/index.ts';
import {calibration} from './fixture.ts';
import {embeddedObserve,embeddedTick,i2cConflict,drivenDuty} from '../src/embedded.ts';

test('GPIO input and a low output suppress the actuator; PWM controls delivered duty',()=>{
  const s=createState(calibration,1),driver=s.devices.gateway!,pump=s.devices.pump!;
  s.links.push({from:'gateway',to:'pump',kind:'wire',quality:1});
  driver.parameters.gpioMode='input';assert.equal(drivenDuty(s,pump),0);
  driver.parameters.gpioMode='output';driver.parameters.gpioValue=false;assert.equal(drivenDuty(s,pump),0);
  driver.parameters.gpioValue=true;pump.parameters.pwmDriven=true;assert.equal(drivenDuty(s,pump),0);
  driver.parameters.pwmEnabled=true;driver.parameters.pwmFrequency=1000;driver.parameters.pwmDuty=35;assert.equal(drivenDuty(s,pump),.35);
  driver.parameters.online=false;assert.equal(drivenDuty(s,pump),0);
});
test('I2C duplicate addresses fail only on the same connected bus',()=>{
  const s=createState(calibration,1),a=s.devices.probe!,b=s.devices.pump!;
  a.parameters.bus=b.parameters.bus='i2c';a.parameters.address=b.parameters.address=72;
  assert.equal(i2cConflict(s,a),false);
  s.links.push({from:a.id,to:b.id,kind:'bus',quality:1});assert.equal(i2cConflict(s,a),true);
  b.parameters.address=73;embeddedObserve(s);assert.equal(s.environment.i2cReady_probe,1);
});
test('unhealthy firmware resets periodically; fixed firmware restores the controller',()=>{
  const s=createState(calibration,1),d=s.devices.gateway!;
  Object.assign(d.parameters,{watchdogEnabled:true,watchdogTimeout:2,firmwareHealthy:false});
  s.tick=2;embeddedTick(s);embeddedObserve(s);assert.equal(s.environment.resetCount_gateway,1);assert.equal(s.environment.controllerAlive_gateway,0);
  d.parameters.firmwareHealthy=true;s.tick++;embeddedTick(s);embeddedObserve(s);assert.equal(s.environment.controllerAlive_gateway,1);assert.equal(s.environment.resetCount_gateway,1);
});
test('sleep reduces consumption while sampling age exposes the latency tradeoff',()=>{
  const level=structuredClone(calibration);level.tasks[1]!.all=[{source:'ticks',op:'gte',value:1000}];
  level.devices[0]!.parameters.sleep={label:'休眠',type:'boolean',value:false};
  level.devices[0]!.parameters.sampleInterval={label:'采样间隔',type:'number',value:5,min:1,max:20};
  const s=createState(level,1);s.phase='running';const awake=s.environment.energy!;
  s.devices.probe!.parameters.sleep=true;
  const r=applyCommand(level,s,{id:'sleep-test-command',revision:0,type:'simulate',payload:{ticks:3}});
  assert.ok(r.state.environment.energy!<awake);assert.equal(r.state.environment.sampleAge_probe,3);
});
