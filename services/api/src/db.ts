import mysql,{type Pool,type PoolConnection,type ResultSetHeader,type RowDataPacket,type ExecuteValues} from 'mysql2/promise';
export interface Database {query<T=Record<string,unknown>>(sql:string,values?:unknown[]):Promise<T[]>;execute(sql:string,values?:unknown[]):Promise<{affectedRows:number}>;transaction<T>(fn:(tx:Database)=>Promise<T>):Promise<T>;}
function sqlValues(values:unknown[]):ExecuteValues[]{return values.map(v=>{if(v===null||typeof v==='string'||typeof v==='number'||typeof v==='bigint'||typeof v==='boolean'||v instanceof Date||v instanceof Uint8Array)return v;throw new TypeError('SQL parameters must be scalars; serialize JSON explicitly');});}
function wrap(connection:Pool|PoolConnection):Database{return{
 async query<T>(sql:string,values:unknown[]=[]){const[rows]=await connection.query<RowDataPacket[]>(sql,values);return rows as T[];},
 async execute(sql:string,values:unknown[]=[]){const[result]=await connection.execute<ResultSetHeader>(sql,sqlValues(values));return{affectedRows:result.affectedRows};},
 async transaction<T>(fn:(tx:Database)=>Promise<T>){if('getConnection'in connection){const tx=await connection.getConnection();try{await tx.beginTransaction();const result=await fn(wrap(tx));await tx.commit();return result;}catch(error){await tx.rollback();throw error;}finally{tx.release();}}return fn(wrap(connection));}
};}
export function connectDatabase(){const pool=mysql.createPool({host:process.env.DB_HOST??'127.0.0.1',port:Number(process.env.DB_PORT??3306),user:process.env.DB_USER??'iot_city',password:process.env.DB_PASSWORD,database:process.env.DB_NAME??'iot_city',connectionLimit:8,timezone:'Z',dateStrings:true,jsonStrings:true,supportBigNumbers:true,bigNumberStrings:false,multipleStatements:false});return{db:wrap(pool),close:()=>pool.end()};}
export function json<T>(value:T|string):T{return typeof value==='string'?JSON.parse(value)as T:value;}
export function iso(value:string|Date):string{return value instanceof Date?value.toISOString():new Date(value.endsWith('Z')?value:value.replace(' ','T')+'Z').toISOString();}
