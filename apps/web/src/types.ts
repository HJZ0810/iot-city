import type { AttemptResult, SessionView } from '../../../packages/shared/src/index';
export type Page='city'|'map'|'game'|'reports'|'leaderboard'|'sandbox'|'coop'|'terminal'|'profile'|'management';
export type CommandSubmission={session:SessionView;resultRecord?:AttemptResult|null;message?:string};
