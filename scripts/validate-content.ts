import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {levels,chapters} from '../packages/content/src/index.ts';
import {levelSchema} from '../packages/shared/src/index.ts';
import {createState,applyCommand,replay,evaluate} from '../packages/engine/src/index.ts';
const report=[];
for(const level of levels){
 levelSchema.parse(level);let state=createState(level,42);assert.ok(!level.tasks[0]!.all.every(p=>evaluate(p,state)),`${level.id}: initial task already met`);
 const commands=level.solution.map((a,i)=>({...a,id:`content-verification-${i}`,revision:i}));
 for(const c of commands){const result=applyCommand(level,state,c);assert.equal(result.accepted,true,`${level.id} ${c.type}: ${result.message}`);state=result.state;}
 assert.equal(state.phase,'completed',`${level.id}: ${state.completedTasks.join(',')}`);assert.deepEqual(replay(level,42,commands),state,`${level.id}: replay`);
 let failure=createState(level,42);assert.equal(level.failureCase[0]?.type,'start',`${level.id}: failure must start`);for(const[i,a]of level.failureCase.entries()){const result=applyCommand(level,failure,{...a,id:`failure-verification-${i}`,revision:failure.revision});assert.equal(result.accepted,true,`${level.id} failure action rejected`);failure=result.state;}assert.notEqual(failure.phase,'completed',`${level.id}: failure passes`);
 for(const d of level.devices)for(const[k,p]of Object.entries(d.parameters))if(p.type==='select')assert.ok(p.options?.length,`${level.id}/${d.id}/${k}: empty select`);
 report.push({id:level.id,title:level.title,chapter:level.chapter,tasks:level.tasks.length,solutionActions:commands.length,score:state.score,failurePhase:failure.phase,replay:'identical',hash:createHash('sha256').update(JSON.stringify(level)).digest('hex')});
}
assert.equal(new Set(levels.map(l=>l.id)).size,levels.length);assert.equal(chapters.length,10);
await mkdir('audit',{recursive:true});await writeFile('audit/content-acceptance.json',JSON.stringify({at:new Date().toISOString(),count:levels.length,target:60,report},null,2));console.log(JSON.stringify({valid:report.length,target:60,actualFailedPaths:report.filter(r=>r.failurePhase==='failed').length,chapters:chapters.length}));
