import {test} from 'node:test';
import assert from 'node:assert/strict';
import {levels} from '../../content/src/index.ts';
import {generateChallenge,createState,applyCommand} from '../src/index.ts';
import {levelSchema} from '../../shared/src/index.ts';
test('seeded challenges execute certified solutions across every current authored template',()=>{
  const variations=new Set<string>();
  for(const source of levels)for(let seed=1;seed<=8;seed++){
    const generated=generateChallenge([source],'random',seed,1);levelSchema.parse(generated);
    let state=createState(generated,seed);
    for(const [i,action]of generated.solution.entries()){const result=applyCommand(generated,state,{...action,id:`generated-test-${i}`,revision:state.revision});assert.equal(result.accepted,true,`${source.id} seed ${seed}`);state=result.state;if(state.phase==='completed')break;}
    assert.equal(state.phase,'completed',`${source.id} seed ${seed}`);
    variations.add(JSON.stringify(generated.devices.map(d=>d.parameters)));
  }
  assert.ok(variations.size>levels.length,'generator varies initial engineering parameters as well as template identity');
});
