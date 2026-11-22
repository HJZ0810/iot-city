import { levels } from '../packages/content/src/index.ts';
import { createState, applyCommand } from '../packages/engine/src/index.ts';

let checked = 0, failed = 0;
for (const level of levels) {
  const answers = level.questions ?? [];
  if (!answers.length) continue;
  let state = createState(level, 7);
  state = applyCommand(level, state, { type: 'start', id: 'start-0001', revision: state.revision, payload: {} }).state;
  for (const question of answers) {
    const before = state.score;
    const outcome = applyCommand(level, state, { type: 'answer', id: `ans-${question.id}`, revision: state.revision, target: question.id, payload: { answer: question.answer } });
    state = outcome.state;
    const accepted = state.flags.includes(`answered:${question.id}`);
    checked += 1;
    if (!accepted) { failed += 1; console.log('FAIL', level.id, question.id, outcome.message); }
    else if (!outcome.message || outcome.message.length < 10) { failed += 1; console.log('NO-EXPLANATION', level.id, question.id); }
    // 再答一次应该被判为已完成
    const again = applyCommand(level, state, { type: 'answer', id: `ans2-${question.id}`, revision: state.revision, target: question.id, payload: { answer: question.answer } });
    if (!/已经完成/.test(again.message ?? '')) { failed += 1; console.log('REPEAT', level.id, question.id, again.message); }
  }
}
console.log(JSON.stringify({ checked, failed }));
