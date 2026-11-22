import type { ChapterView, LevelDefinition } from '../../shared/src/index.ts';
import { levelSchema } from '../../shared/src/index.ts';
import { chapter01 } from './chapter01.ts';
import { chapter02 } from './chapter02.ts';
import { chapter03 } from './chapter03.ts';
import { chapter04 } from './chapter04.ts';
import { chapter05 } from './chapter05.ts';
import { chapter06 } from './chapter06.ts';
import { chapter07 } from './chapter07.ts';
import { chapter08 } from './chapter08.ts';
import { chapter09 } from './chapter09.ts';
import { chapter10 } from './chapter10.ts';
import { questionBank } from './questions.ts';

// Each file owns one chapter's content. Empty chapter modules mark work not yet authored.
export const levels: LevelDefinition[] = [...chapter01,...chapter02,...chapter03,...chapter04,...chapter05,...chapter06,...chapter07,...chapter08,...chapter09,...chapter10].sort((a,b)=>a.number-b.number);
// 题库单独维护在 questions.ts（逐关手写），在这里挂到关卡上，避免十份章节文件里散落题目
for (const level of levels) {
  const bank = questionBank[level.id];
  if (bank?.length) level.questions = bank;
}
for (const level of levels) levelSchema.parse(level);

export const chapters: ChapterView[] = [
 {id:1,title:'物联初启',subtitle:'智慧城市、基础感知与物联网架构',color:'#22d3ee',story:'东门的访客卡无法打开闸门。一次门禁排障让巡检队发现城市终端接连失联，异常读数正从街区边缘汇聚。'},
 {id:2,title:'传感迷局',subtitle:'传感器及数据采集',color:'#a3e635',story:'探头的读数与真实环境并不一致。校准、滤波与采样质量将决定城市能否相信自己的感官。'},
 {id:3,title:'万物互联',subtitle:'无线通信与网络组建',color:'#38bdf8',story:'孤立终端需要重新组网。你将为城市设备规划路径，让数据在复杂链路中找到出口。'},
 {id:4,title:'协议迷城',subtitle:'数据传输与应用协议',color:'#818cf8',story:'链路恢复后，消息仍可能丢失或被错误订阅。逐层检查协议语义，找回城市运行的上下文。'},
 {id:5,title:'嵌入式核心',subtitle:'微控制器与硬件控制',color:'#f59e0b',story:'感知与网络最终要落到真实硬件控制边界。GPIO、总线与低功耗设计会决定设备能否安全执行。'},
 {id:6,title:'智慧家居',subtitle:'设备联动与智能控制',color:'#fb7185',story:'城市异常延伸到楼宇系统。边缘规则、访问权限与多子系统联动将接受检验。'},
 {id:7,title:'智慧农业',subtitle:'农业物联网系统',color:'#84cc16',story:'旱情和风暴同时影响农场。传感、控制和网络需要围绕作物状态形成可靠闭环。'},
 {id:8,title:'智慧城市',subtitle:'城市级物联网应用',color:'#06b6d4',story:'停车、照明、交通与能源数据交织成城市脉搏，局部异常开始影响整片区域。'},
 {id:9,title:'工业与云端',subtitle:'工业物联网、平台和安全',color:'#c084fc',story:'工业现场与云端之间出现新的信任边界，缓存、身份和隔离策略决定系统韧性。'},
 {id:10,title:'万物危机',subtitle:'高难度综合工程挑战',color:'#f43f5e',story:'多个城市域同时告警。巡检队必须协作分析故障、维持冗余并恢复关键服务。'},
];
export function getLevel(id:string):LevelDefinition|undefined{return levels.find(level=>level.id===id);}

/* 板端轨道（B 轨）：结构校验在 board.ts 内完成，与 A 轨互不影响。 */
export { boardLevels, boardChapters, getBoardLevel } from './board.ts';
