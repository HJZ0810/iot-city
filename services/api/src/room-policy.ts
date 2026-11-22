import type {RoomPlayer} from '../../../packages/shared/src/index.ts';
export function forfeitWinner(players:RoomPlayer[],expired:string[]):0|1|'draw'|null{const teams=new Set(players.filter(p=>expired.includes(p.userId)).map(p=>p.team));if(!teams.size)return null;if(teams.size===2)return'draw';return teams.has(0)?1:0;}
export function requireStandardSandbox(projectId:string|undefined,challenge:boolean|undefined){if(projectId&&challenge)throw new Error('CUSTOM_PROJECT_CANNOT_COMPETE');return Boolean(challenge&&!projectId);}
