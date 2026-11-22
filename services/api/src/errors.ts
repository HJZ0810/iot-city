export class HttpError extends Error {constructor(public statusCode:number,public code:string,message:string,public details?:unknown){super(message);}}
export function httpError(status:number,code:string,message:string,details?:unknown){return new HttpError(status,code,message,details);}
