import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sameCommand} from '../../../services/api/src/command-identity.ts';
import type {GameCommand} from '../../shared/src/index.ts';

test('retry identity survives MySQL JSON object key normalization',()=>{
  const sent:GameCommand={id:'retry-test',revision:1,type:'configure',target:'sensor',payload:{key:'offset',value:2}};
  const stored:GameCommand={type:'configure',id:'retry-test',target:'sensor',payload:{value:2,key:'offset'},revision:1};
  assert.equal(sameCommand(stored,sent),true);
  assert.equal(sameCommand(stored,{...sent,payload:{key:'offset',value:3}}),false);
  assert.equal(sameCommand(stored,{...sent,revision:2}),false);
});
