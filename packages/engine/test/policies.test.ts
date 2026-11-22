import {test} from 'node:test';
import assert from 'node:assert/strict';
import {forfeitWinner,requireStandardSandbox} from '../../../services/api/src/room-policy.ts';
import type {RoomPlayer} from '../../shared/src/index.ts';
const players:RoomPlayer[]=[0,1,0,1].map((team,i)=>({userId:`u${i}`,nickname:`U${i}`,ready:true,online:true,team:team as 0|1,engineerRole:'debug'}));
test('a departed teammate forfeits that team, never the other team',()=>{assert.equal(forfeitWinner(players,['u0']),1);assert.equal(forfeitWinner(players,['u1']),0);assert.equal(forfeitWinner(players,['u0','u1']),'draw');assert.equal(forfeitWinner(players,[]),null);});
test('a user-authored sandbox cannot acquire competition eligibility',()=>{assert.throws(()=>requireStandardSandbox('owned-project',true),/CUSTOM_PROJECT/);assert.equal(requireStandardSandbox('owned-project',false),false);assert.equal(requireStandardSandbox(undefined,true),true);});
