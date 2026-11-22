import type {GameState} from '../../shared/src/index.ts';
const n=(v:unknown,f=0)=>typeof v==='number'&&Number.isFinite(v)?v:f;
export function observeUrban(s:GameState):void {
  if(s.environment.parkingCapacity!==undefined){
    s.environment.availableSpots=Math.max(0,n(s.environment.parkingCapacity)-n(s.environment.parkingOccupied));
  }
}
export function urbanActuator(s:GameState,effect:unknown,duty:number):void {
  if(duty<=0)return;
  if(effect==='barrier'&&n(s.environment.waitingVehicles)>0&&n(s.environment.parkingOccupied)<n(s.environment.parkingCapacity)){
    s.environment.parkingOccupied=n(s.environment.parkingOccupied)+1;
    s.environment.waitingVehicles=n(s.environment.waitingVehicles)-1;
    s.environment.admittedVehicles=n(s.environment.admittedVehicles)+1;
  }
  if(effect==='trafficSignal')s.environment.traffic=Math.max(0,n(s.environment.traffic)-duty);
}
