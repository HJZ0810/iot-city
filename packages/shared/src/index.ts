import { z } from 'zod';

export const modes = ['story','endless','timed','sandbox','random','daily','boss','coop','pvp'] as const;
export type GameMode = typeof modes[number];
export const roles = ['student','teacher','admin'] as const;
export type Role = typeof roles[number];
export const modeNames: Record<GameMode,string> = { story:'剧情闯关',endless:'无尽挑战',timed:'限时挑战',sandbox:'自由沙盒',random:'随机事件',daily:'每日挑战',boss:'综合 Boss',coop:'多人协作',pvp:'工程竞技' };
export type Scalar = string | number | boolean;
const scalar = z.union([z.string().max(300),z.number().finite(),z.boolean()]);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const point = z.tuple([z.number().min(-100).max(100),z.number().min(-100).max(100),z.number().min(-100).max(100)]);
export const deviceKinds = ['sensor','actuator','controller','gateway','radio','rfid','router','cloud','power','terminal'] as const;
export const parameterSchema = z.object({ label:z.string().min(1).max(80),type:z.enum(['number','boolean','select','text']),value:scalar,min:z.number().optional(),max:z.number().optional(),step:z.number().positive().optional(),options:z.array(z.union([z.string(),z.number()])).max(40).optional(),unit:z.string().max(20).optional(),description:z.string().max(300).optional() }).strict();
export type ParameterDefinition = z.infer<typeof parameterSchema>;
export const deviceSchema = z.object({ id,kind:z.enum(deviceKinds),label:z.string().min(1).max(100),model:z.string().max(100),position:point,installed:z.boolean(),enabled:z.boolean(),parameters:z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/),parameterSchema),faults:z.array(z.string().max(60)).max(12),description:z.string().max(600),role:z.enum(roles).optional(),engineerRole:z.enum(['sensor','network','embedded','debug']).optional() }).strict();
export type DeviceDefinition = z.infer<typeof deviceSchema>;
export const linkSchema = z.object({ from:id,to:id,kind:z.enum(['wire','wireless','bus','network']),quality:z.number().min(0).max(1).default(1) }).strict();
export type Link = z.infer<typeof linkSchema>;
export const predicateSchema = z.object({ source:z.enum(['parameter','reading','metric','installed','enabled','connected','reachable','inspected','flag','inventory','fault','rule','task','dialog','ticks']),target:z.string().max(80).optional(),key:z.string().max(80).optional(),op:z.enum(['eq','ne','gt','gte','lt','lte','includes','absent','exists']),value:scalar.optional() }).strict();
export type Predicate = z.infer<typeof predicateSchema>;
export const taskSchema = z.object({id,label:z.string().min(1).max(140),description:z.string().min(1).max(1200),knowledge:z.array(z.string().min(1).max(80)).min(1).max(12),requires:z.array(id).max(20),all:z.array(predicateSchema).min(1).max(30),hint:z.string().min(1).max(600),feedback:z.string().min(1).max(600),points:z.number().int().min(1).max(1000)}).strict();
export type TaskDefinition = z.infer<typeof taskSchema>;
export const ruleSchema = z.object({id,when:z.array(predicateSchema).min(1).max(8),target:id,parameter:z.string().max(50),value:scalar}).strict();
export type ControlRule = z.infer<typeof ruleSchema>;
export const questionSchema=z.object({id,kind:z.enum(['single','multiple','number','text']),prompt:z.string().min(5).max(2000),options:z.array(z.object({id,label:z.string().min(1).max(500)}).strict()).max(20).default([]),answer:z.union([scalar,z.array(z.string().max(80)).max(20)]),explanation:z.string().min(10).max(2000),knowledge:z.array(z.string().max(80)).min(1).max(12),points:z.number().int().min(1).max(1000),tolerance:z.number().nonnegative().max(1000).optional()}).strict().superRefine((q,ctx)=>{const ids=new Set(q.options.map(o=>o.id));if(ids.size!==q.options.length)ctx.addIssue({code:'custom',message:'选项ID重复',path:['options']});if(q.kind==='single'&&(typeof q.answer!=='string'||!ids.has(q.answer)||ids.size<2))ctx.addIssue({code:'custom',message:'单选答案必须是有效选项',path:['answer']});if(q.kind==='multiple'&&(!Array.isArray(q.answer)||!q.answer.length||new Set(q.answer).size!==q.answer.length||q.answer.some(a=>!ids.has(a))))ctx.addIssue({code:'custom',message:'多选答案必须是有效且不重复的选项',path:['answer']});if(q.kind==='number'&&typeof q.answer!=='number')ctx.addIssue({code:'custom',message:'数值题答案必须是数字',path:['answer']});if(q.kind==='text'&&(typeof q.answer!=='string'||!q.answer.trim()))ctx.addIssue({code:'custom',message:'文本题答案不能为空',path:['answer']});});
export type QuestionDefinition=z.infer<typeof questionSchema>;
export type PublicQuestion=Omit<QuestionDefinition,'answer'|'explanation'>;
export const commandTypes = ['start','pause','resume','inspect','dialog','collect','use','install','remove','connect','disconnect','configure','move','rule','remove-rule','simulate','hint','answer','fault'] as const;
export const commandSchema = z.object({id:z.string().min(8).max(100),revision:z.number().int().nonnegative(),type:z.enum(commandTypes),target:z.string().max(80).optional(),payload:z.record(z.string().max(80),z.unknown()).default({})}).strict();
export type GameCommand = z.infer<typeof commandSchema>;
export const solutionActionSchema = commandSchema.omit({id:true,revision:true});
export type SolutionAction = z.infer<typeof solutionActionSchema>;
export const levelSchema = z.object({
 id,number:z.number().int().min(1).max(10000),chapter:z.number().int().min(1).max(100),version:z.number().int().positive(),title:z.string().min(2).max(100),subtitle:z.string().min(2).max(180),
 scene:z.enum(['city','lab','greenhouse','home','factory','datacenter','traffic','power','network','crisis']),dimension:z.enum(['3d','2.5d','2d']),difficulty:z.number().int().min(1).max(5),estimatedMinutes:z.number().int().min(1).max(120),
 briefing:z.string().min(30).max(4000),ending:z.string().min(20).max(3000),knowledge:z.array(z.string().min(1).max(80)).min(1).max(20),
 npc:z.object({name:z.string().min(1).max(50),role:z.string().min(1).max(80),lines:z.array(z.string().min(1).max(800)).min(1).max(12)}).strict(),
 devices:z.array(deviceSchema).min(1).max(64),links:z.array(linkSchema).max(128),environment:z.record(z.string().max(50),z.number().finite()),inventory:z.array(z.object({id,label:z.string().max(80),description:z.string().max(400)}).strict()).max(30),
 tasks:z.array(taskSchema).min(2).max(24),rules:z.array(ruleSchema).max(24),failures:z.array(z.object({all:z.array(predicateSchema).min(1).max(10),message:z.string().min(1).max(600)}).strict()).max(12),
 explanation:z.string().min(40).max(5000),references:z.array(z.object({title:z.string().max(200),url:z.string().url()}).strict()).min(1).max(10),
 solution:z.array(solutionActionSchema).min(3).max(100),failureCase:z.array(solutionActionSchema).max(20),timeLimitSeconds:z.number().int().min(60).max(7200).optional(),questions:z.array(questionSchema).max(30).optional()
}).strict().superRefine((level,ctx)=>{
 const devices=new Set(level.devices.map(d=>d.id));
 if(devices.size!==level.devices.length) ctx.addIssue({code:'custom',message:'设备ID重复',path:['devices']});
 const tasks=new Set(level.tasks.map(t=>t.id));
 if(tasks.size!==level.tasks.length)ctx.addIssue({code:'custom',message:'任务ID重复',path:['tasks']});
 for(const [i,link]of level.links.entries())if(!devices.has(link.from)||!devices.has(link.to)||link.from===link.to)ctx.addIssue({code:'custom',message:'连接端点无效',path:['links',i]});
 const visited=new Set<string>();
 for(const [i,task]of level.tasks.entries()){if(task.requires.some(r=>!visited.has(r)))ctx.addIssue({code:'custom',message:'任务依赖必须引用前置任务',path:['tasks',i,'requires']});visited.add(task.id);}
 for(const [i,rule]of level.rules.entries())if(!devices.has(rule.target))ctx.addIssue({code:'custom',message:'规则设备不存在',path:['rules',i]});
});
export type LevelDefinition = z.infer<typeof levelSchema>;
export type PublicLevel = Omit<LevelDefinition,'solution'|'failureCase'|'questions'>&{questions?:PublicQuestion[]};
export function publicLevel(level:LevelDefinition):PublicLevel{const{solution:_,failureCase:__,questions,...view}=level;return{...view,...(questions?{questions:questions.map(({answer:___,explanation:____,...q})=>q)}:{})};}
export interface DeviceState { id:string;installed:boolean;enabled:boolean;parameters:Record<string,Scalar>;faults:string[];position:[number,number,number];reading:number;status:'online'|'offline'|'fault'; }
export interface TelemetryState {history:number[];buffer:number[];delivered:number;replayed:number;dropped:number;lastValue?:number;}
export interface GameState { levelId:string;levelVersion:number;seed:number;revision:number;phase:'briefing'|'running'|'paused'|'completed'|'failed';tick:number;devices:Record<string,DeviceState>;links:Link[];environment:Record<string,number>;rules:ControlRule[];inventory:string[];inspected:string[];dialogs:string[];flags:string[];completedTasks:string[];hints:string[];errors:number;actions:number;feedback:string[];score:number;telemetry?:Record<string,TelemetryState>; }
export interface EngineResult {state:GameState;accepted:boolean;message:string;completedNow:string[];}
export interface UserView {id:string;username:string;nickname:string;role:Role;createdAt:string;}
export interface SessionView {id:string;mode:GameMode;level:PublicLevel;state:GameState;elapsedSeconds:number;updatedAt:string;}
export interface EventView {id:string;sequence:number;command:GameCommand;accepted:boolean;message:string;createdAt:string;state?:GameState;}
export interface AttemptResult {sessionId:string;userId:string;mode:GameMode;levelId:string;score:number;stars:number;elapsedSeconds:number;completedAt:string;}
export interface ProgressView {completed:string[];unlockedChapter:number;results:AttemptResult[];activeSessions:Array<{id:string;title:string;mode:GameMode;updatedAt:string}>;achievements:Array<{id:string;title:string;description:string}>;}
export interface LeaderboardEntry {rank:number;id:string;name:string;score:number;wins?:number;attempts:number;team:boolean;}
export interface ChapterView {id:number;title:string;subtitle:string;color:string;story:string;}
export interface ClassView {id:string;name:string;code:string;teacherId:string;memberCount:number;createdAt:string;}
export interface AssignmentView {id:string;classId:string;levelId:string;title:string;mode:GameMode;dueAt:string|null;createdAt:string;}
export interface RoomPlayer {userId:string;nickname:string;ready:boolean;online:boolean;team:0|1;engineerRole:'sensor'|'network'|'embedded'|'debug';}
export interface RoomView {id:string;code:string;hostId:string;mode:'coop'|'pvp';status:'waiting'|'playing'|'finished';levelId:string;maxPlayers:number;players:RoomPlayer[];states:Record<string,GameState>;revision:number;startedAt:string|null;winner:0|1|'draw'|null;message:string;}
export interface ApiError {error:{code:string;message:string;details?:unknown};}
export interface ApiResponse<T>{data:T;}
export type ClientMessage = {type:'join';roomId:string}|{type:'command';roomId:string;command:GameCommand}|{type:'ping'};
export type ServerMessage = {type:'room';room:RoomView}|{type:'ack';commandId:string;accepted:boolean;message:string;room:RoomView}|{type:'error';code:string;message:string}|{type:'pong';serverTime:number};
export * from './hardware.ts';
export * from './board.ts';
