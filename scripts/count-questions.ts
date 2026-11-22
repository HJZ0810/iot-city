import { levels } from '../packages/content/src/index.ts';
const withQ = levels.filter((level) => (level.questions?.length ?? 0) > 0);
const total = levels.reduce((sum, level) => sum + (level.questions?.length ?? 0), 0);
const kinds = levels.flatMap((level) => level.questions ?? []).reduce<Record<string, number>>((acc, q) => { acc[q.kind] = (acc[q.kind] ?? 0) + 1; return acc; }, {});
console.log(JSON.stringify({ levels: levels.length, withQuestions: withQ.length, total, kinds }, null, 1));
