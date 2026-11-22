import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {hash,verify,Algorithm} from '@node-rs/argon2';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {z} from 'zod';
import type {} from '@fastify/cookie';
import type {UserView,Role} from '../../../packages/shared/src/index.ts';
import type {Database} from './db.ts';
import {iso} from './db.ts';
import {httpError} from './errors.ts';
export const passwordSchema=z.string().min(8).max(72).refine(p=>Buffer.byteLength(p,'utf8')<=72,'密码最多72字节');
export const credentials=z.object({username:z.string().trim().regex(/^[a-zA-Z0-9_]{3,32}$/),password:passwordSchema}).strict();
export const hashPassword=(password:string)=>hash(password,{algorithm:Algorithm.Argon2id,memoryCost:19456,timeCost:2,parallelism:1});
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
export const userView=(row:{id:string;username:string;nickname:string;role:Role;created_at:string}):UserView=>({id:row.id,username:row.username,nickname:row.nickname,role:row.role,createdAt:iso(row.created_at)});
export function createAuth(db:Database){
 async function requireUser(req:FastifyRequest):Promise<UserView>{const token=req.cookies.iot_session;if(!token||!/^[a-f0-9]{64}$/.test(token))throw httpError(401,'UNAUTHENTICATED','请先登录。');const rows=await db.query<{id:string;username:string;nickname:string;role:Role;created_at:string}>('SELECT u.id,u.username,u.nickname,u.role,u.created_at FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>UTC_TIMESTAMP(3) AND u.disabled=0',[digest(token)]);if(!rows[0])throw httpError(401,'SESSION_EXPIRED','登录已过期，请重新登录。');return userView(rows[0]);}
 async function requireRole(req:FastifyRequest,allowed:Role[]){const user=await requireUser(req);if(!allowed.includes(user.role))throw httpError(403,'FORBIDDEN','没有执行该操作的权限。');return user;}
 async function setSession(userId:string,reply:FastifyReply){const token=randomBytes(32).toString('hex');await db.execute('INSERT INTO auth_sessions(id,user_id,expires_at) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 7 DAY))',[digest(token),userId]);reply.setCookie('iot_session',token,{path:'/',httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',maxAge:604800});}
 async function registerRoutes(app:FastifyInstance){
  app.post('/api/auth/register',{config:{rateLimit:{max:process.env.NODE_ENV==='test'?200:30,timeWindow:'1 minute'}}},async(req,reply)=>{const body=credentials.extend({nickname:z.string().trim().min(1).max(40).optional()}).parse(req.body);const id=randomUUID(),password=await hashPassword(body.password);try{await db.execute('INSERT INTO users(id,username,nickname,password_hash,role) VALUES(?,?,?,?,?)',[id,body.username,body.nickname??body.username,password,'student']);}catch(error){if((error as{code?:string}).code==='ER_DUP_ENTRY')throw httpError(409,'USERNAME_TAKEN','该用户名已被使用。');throw error;}await setSession(id,reply);const rows=await db.query<{id:string;username:string;nickname:string;role:Role;created_at:string}>('SELECT id,username,nickname,role,created_at FROM users WHERE id=?',[id]);return{data:userView(rows[0]!)};});
  app.post('/api/auth/login',{config:{rateLimit:{max:process.env.NODE_ENV==='test'?400:60,timeWindow:'1 minute'}}},async(req,reply)=>{const body=credentials.parse(req.body);const rows=await db.query<{id:string;username:string;nickname:string;role:Role;created_at:string;password_hash:string;disabled:number}>('SELECT id,username,nickname,role,created_at,password_hash,disabled FROM users WHERE username=?',[body.username]);const row=rows[0];if(!row||row.disabled||!await verify(row.password_hash,body.password))throw httpError(401,'INVALID_CREDENTIALS','用户名或密码不正确。');await setSession(row.id,reply);return{data:userView(row)};});
  app.post('/api/auth/logout',async(req,reply)=>{if(req.cookies.iot_session)await db.execute('DELETE FROM auth_sessions WHERE id=?',[digest(req.cookies.iot_session)]);reply.clearCookie('iot_session',{path:'/'});return{data:{ok:true}};});
  app.get('/api/auth/me',async req=>({data:await requireUser(req)}));
  app.patch('/api/auth/me',async req=>{const user=await requireUser(req),body=z.object({nickname:z.string().trim().min(1).max(40)}).strict().parse(req.body);await db.execute('UPDATE users SET nickname=? WHERE id=?',[body.nickname,user.id]);return{data:{...user,nickname:body.nickname}};});
 }
 return{requireUser,requireRole,registerRoutes};
}
