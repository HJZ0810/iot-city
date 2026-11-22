import type {FastifyRequest} from 'fastify';
import type {Role,UserView,LevelDefinition,GameMode,SessionView} from '../../../packages/shared/src/index.ts';
import type {Database} from './db.ts';
export interface AppContext {db:Database;requireUser(request:FastifyRequest):Promise<UserView>;requireRole(request:FastifyRequest,allowed:Role[]):Promise<UserView>;assertClassAccess(user:UserView,classId:string,write?:boolean):Promise<void>;audit(actorId:string,action:string,targetId:string,details?:unknown):Promise<void>;getLevel(id:string,version?:number,user?:UserView):Promise<LevelDefinition>;createSession(user:UserView,options:{levelId?:string;mode:GameMode;preview?:boolean;projectId?:string;previousSessionId?:string;challenge?:boolean}):Promise<SessionView>;getRoomCount():number;}
