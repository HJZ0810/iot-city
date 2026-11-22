import { levels } from '../packages/content/src/index.ts';
for (const level of levels) console.log(`${level.number}\t${level.title}\t${level.knowledge.join(' / ')}`);
