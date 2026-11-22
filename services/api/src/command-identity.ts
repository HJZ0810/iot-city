import {isDeepStrictEqual} from 'node:util';
import type {GameCommand} from '../../../packages/shared/src/index.ts';

// MySQL JSON storage normalizes object key order. Identity is structural.
export function sameCommand(stored:GameCommand, received:GameCommand):boolean {
  return isDeepStrictEqual(stored, received);
}
