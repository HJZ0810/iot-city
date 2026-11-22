import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import websocket from '@fastify/websocket';
import serveStatic from '@fastify/static';
import {access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ZodError} from 'zod';
import {connectDatabase} from './db.ts';
import {createAuth} from './auth.ts';
import {bootstrap,migrate,createCatalog} from './catalog.ts';
import {createGame} from './game.ts';
import {createRooms} from './rooms.ts';
import {registerAnalytics} from './analytics.ts';
import {registerManagementRoutes} from './management/index.ts';
import {registerConfig} from './config.ts';
import {registerQuestionRoutes} from './questions/index.ts';
import {registerHardware} from './hardware/index.ts';
import {createBoardService,registerBoardRoutes} from './board/index.ts';
import {createSqlBoardStore} from './board/store.ts';
import {levels,chapters,boardLevels} from '../../../packages/content/src/index.ts';
import {httpError} from './errors.ts';
import type {AppContext} from './context.ts';
export async function buildApp(){
 const app=Fastify({logger:{level:process.env.LOG_LEVEL??'info',redact:['req.headers.cookie','req.headers.authorization','res.headers["set-cookie"]','password','token']},bodyLimit:1048576,trustProxy:'127.0.0.1'});
 const{db,close}=connectDatabase();
 await app.register(cookie);await app.register(rateLimit,{max:process.env.NODE_ENV==='test'?10000:900,timeWindow:'1 minute'});await app.register(helmet,{contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:','blob:'],connectSrc:["'self'"],mediaSrc:["'self'",'blob:'],workerSrc:["'self'",'blob:'],objectSrc:["'none'"],frameAncestors:["'none'"]}}});await app.register(websocket,{options:{maxPayload:65536}});
 const origin=process.env.PUBLIC_ORIGIN??`http://127.0.0.1:${process.env.PORT??3220}`;
 app.addHook('onRequest',async req=>{if((!['GET','HEAD','OPTIONS'].includes(req.method)||req.url==='/ws')&&((req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site'))throw httpError(403,'ORIGIN_FORBIDDEN','请求来源不被允许。');});
 app.setErrorHandler((error,req,reply)=>{if(error instanceof ZodError){void reply.code(400).send({error:{code:'INVALID_INPUT',message:'输入不符合要求。',details:error.issues.map(i=>({path:i.path,message:i.message}))}});return;}const e=error as Error&{statusCode?:number;code?:string;details?:unknown};const status=e.statusCode&&e.statusCode>=400&&e.statusCode<600?e.statusCode:500;if(status>=500)req.log.error({code:e.code,message:e.message},'request failed');void reply.code(status).send({error:{code:status<500?e.code??'REQUEST_FAILED':'INTERNAL_ERROR',message:status<500?e.message:'服务暂时不可用，请稍后重试。',...(e.details?{details:e.details}:{})}});});
 await migrate(db);await bootstrap(db,{levels,chapters});const auth=createAuth(db),catalog=createCatalog(db);let count=()=>0;const base={db,requireUser:auth.requireUser,requireRole:auth.requireRole,...catalog,getRoomCount:()=>count()};const game=createGame(base,levels),ctx:AppContext={...base,createSession:game.createSession};await auth.registerRoutes(app);await game.registerRoutes(app);await registerAnalytics(app,ctx);await registerManagementRoutes(app,ctx);const rooms=await createRooms(app,ctx,levels);count=rooms.count;
 await registerConfig(app,ctx);
 await registerQuestionRoutes(app,ctx);
 const board=createBoardService(boardLevels,createSqlBoardStore(db));
 await registerHardware(app,ctx,game,undefined,board);
 await registerBoardRoutes(app,ctx,board);
 app.get('/api/health',async(_req,reply)=>{try{await db.query('SELECT 1 AS healthy');return{data:{status:'ok',version:process.env.APP_VERSION??'0.1.0',database:'ok',authoredLevels:levels.length,targetLevels:60}};}catch{return reply.code(503).send({data:{status:'degraded',database:'unavailable'}});}});
 const web=resolve(process.env.WEB_ROOT??'dist/web');try{await access(resolve(web,'index.html'));await app.register(serveStatic,{root:web,wildcard:false});app.setNotFoundHandler(async(req,reply)=>{if(req.url.startsWith('/api/')||req.url==='/ws')return reply.code(404).send({error:{code:'NOT_FOUND',message:'接口不存在。'}});if(/\.[a-z0-9]{1,8}(?:\?|$)/i.test(req.url))return reply.code(404).send({error:{code:'ASSET_NOT_FOUND',message:'资源不存在。'}});return reply.sendFile('index.html');});}catch{app.log.warn('Web build is absent; API only.');}
 app.addHook('onClose',async()=>close());return app;
}
if(process.env.IOT_NO_LISTEN!=='1'){const app=await buildApp();await app.listen({host:process.env.HOST??'127.0.0.1',port:Number(process.env.PORT??3220)});for(const signal of['SIGINT','SIGTERM']as const)process.on(signal,()=>{void app.close().then(()=>process.exit(0));});}
