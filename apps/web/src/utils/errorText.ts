export const errorText=(e:unknown)=>e instanceof Error?e.message:'连接失败，请稍后重试。';
