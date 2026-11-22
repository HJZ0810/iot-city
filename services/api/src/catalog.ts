import {createHash,randomUUID} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {levelSchema,type LevelDefinition,type ChapterView,type UserView} from '../../../packages/shared/src/index.ts';
import type {Database} from './db.ts';
import {json} from './db.ts';
import {hashPassword,passwordSchema} from './auth.ts';
import {httpError} from './errors.ts';
export interface Catalog {levels:LevelDefinition[];chapters:ChapterView[];}
function canonical(value:unknown):string{if(Array.isArray(value))return'['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return'{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';return JSON.stringify(value);}
export async function migrate(db:Database){
 await db.execute('CREATE TABLE IF NOT EXISTS schema_migrations(id VARCHAR(100) PRIMARY KEY,checksum CHAR(64) NOT NULL,applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))');
 const dir=resolve(process.env.MIGRATIONS_DIR??'migrations');for(const name of(await readdir(dir)).filter(n=>/^\d+_[a-z0-9_]+\.sql$/.test(n)).sort()){
  const text=await readFile(resolve(dir,name),'utf8'),checksum=createHash('sha256').update(text).digest('hex'),rows=await db.query<{checksum:string}>('SELECT checksum FROM schema_migrations WHERE id=?',[name]);
  if(rows[0]){if(rows[0].checksum!==checksum)throw new Error(`Applied migration changed: ${name}`);continue;}
  for(const sql of text.split(';').map(x=>x.trim()).filter(Boolean))await db.execute(sql);
  await db.execute('INSERT INTO schema_migrations(id,checksum) VALUES(?,?)',[name,checksum]);
 }
}
export async function bootstrap(db:Database,catalog:Catalog){
 const admins=await db.query<{count:number}>("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND disabled=0");
 if(!admins[0]?.count){const password=passwordSchema.parse(process.env.ADMIN_PASSWORD),username=process.env.ADMIN_USERNAME??'admin';if(!/^[a-zA-Z0-9_]{3,32}$/.test(username))throw new Error('Invalid ADMIN_USERNAME');await db.execute("INSERT INTO users(id,username,nickname,password_hash,role) VALUES(?,?,?,?,'admin')",[randomUUID(),username,'系统管理员',await hashPassword(password)]);}
 await db.execute("INSERT IGNORE INTO seasons(id,name,active) VALUES('season-1','创始赛季',1)");
 const settings:Record<string,unknown>={dailyRefreshHour:0,eventRetentionDays:180,seasonId:'season-1',maxRoomPlayers:4};for(const[id,value]of Object.entries(settings))await db.execute('INSERT IGNORE INTO settings(id,value) VALUES(?,?)',[id,JSON.stringify(value)]);
 for(const chapter of catalog.chapters)await db.execute('INSERT INTO chapters(id,title,definition) VALUES(?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),definition=VALUES(definition)',[chapter.id,chapter.title,JSON.stringify(chapter)]);
 for(const source of catalog.levels){const level=levelSchema.parse(source);await db.transaction(async tx=>{
  const existing=await tx.query<{current_version:number;owner_id:string|null}>('SELECT current_version,owner_id FROM levels WHERE id=? FOR UPDATE',[level.id]);
  if(existing[0]?.owner_id)throw new Error('Seed ID collides with user content');
  const old=await tx.query<{definition:LevelDefinition}>('SELECT definition FROM level_versions WHERE level_id=? AND version=?',[level.id,level.version]);
  if(old[0]&&canonical(json(old[0].definition))!==canonical(level))throw new Error(`Seed content changed without version bump: ${level.id}`);
  if(!existing[0])await tx.execute("INSERT INTO levels(id,owner_id,number,chapter,title,status,current_version,global_published) VALUES(?,NULL,?,?,?,'published',?,1)",[level.id,level.number,level.chapter,level.title,level.version]);
  if(!old[0])await tx.execute('INSERT INTO level_versions(level_id,version,definition,created_by) VALUES(?,?,?,NULL)',[level.id,level.version,JSON.stringify(level)]);
  if(existing[0]&&existing[0].current_version<level.version)await tx.execute("UPDATE levels SET current_version=?,title=?,status='published' WHERE id=?",[level.version,level.title,level.id]);
  for(const tag of level.knowledge){const tagId=createHash('sha256').update(tag).digest('hex').slice(0,32);await tx.execute('INSERT IGNORE INTO knowledge_points(id,name) VALUES(?,?)',[tagId,tag]);await tx.execute('INSERT IGNORE INTO level_knowledge(level_id,knowledge_id) VALUES(?,?)',[level.id,tagId]);}
 });}
}
export function createCatalog(db:Database){
 async function assertClassAccess(user:UserView,id:string,write=false){if(user.role==='admin')return;const rows=await db.query<{teacher_id:string}>('SELECT teacher_id FROM classes WHERE id=?',[id]);if(!rows[0])throw httpError(404,'CLASS_NOT_FOUND','班级不存在。');if(rows[0].teacher_id===user.id&&user.role==='teacher')return;if(!write){const member=await db.query('SELECT user_id FROM class_members WHERE class_id=? AND user_id=?',[id,user.id]);if(member[0])return;}throw httpError(403,'CLASS_FORBIDDEN','没有访问这个班级的权限。');}
 async function getLevel(id:string,version?:number,user?:UserView):Promise<LevelDefinition>{const rows=await db.query<{definition:LevelDefinition;owner_id:string|null;status:string;global_published:number;class_id:string|null}>('SELECT v.definition,l.owner_id,l.status,l.global_published,l.class_id FROM levels l JOIN level_versions v ON v.level_id=l.id AND v.version=COALESCE(?,l.current_version) WHERE l.id=?',[version??null,id]);const row=rows[0];if(!row)throw httpError(404,'LEVEL_NOT_FOUND','关卡不存在。');if(user&&user.role!=='admin'&&row.owner_id!==user.id){if(row.status!=='published')throw httpError(403,'CONTENT_PRIVATE','关卡尚未发布。');if(!row.global_published){if(!row.class_id)throw httpError(403,'CONTENT_PRIVATE','关卡未向你开放。');await assertClassAccess(user,row.class_id);}}return levelSchema.parse(json(row.definition));}
 async function audit(actorId:string,action:string,targetId:string,details:unknown={}){await db.execute('INSERT INTO audit_logs(id,actor_id,action,target_id,details) VALUES(?,?,?,?,?)',[randomUUID(),actorId,action,targetId,JSON.stringify(details)]);}
 return{assertClassAccess,getLevel,audit};
}
