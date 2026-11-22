import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { questionSchema, type QuestionDefinition, type Role, type UserView } from '../../../../packages/shared/src/index.ts';
import type { AppContext } from '../context.ts';
import { httpError } from '../errors.ts';
import { iso } from '../db.ts';

type QuestionRow = {
  id: string; owner_id: string; prompt: string; kind: QuestionDefinition['kind']; definition: QuestionDefinition | string;
  status: 'draft' | 'published' | 'disabled'; global_published: number | boolean; class_id: string | null;
  updated_at: string | Date;
};
const teacherAdmin = ['teacher', 'admin'] as Role[];
const route = (app: FastifyInstance, method: 'get' | 'post' | 'put' | 'delete', path: string, handler: (request: FastifyRequest) => Promise<unknown>) =>
  app[method](path, async request => ({ data: await handler(request) }));
const fromJson = <T,>(value: string | T): T => typeof value === 'string' ? JSON.parse(value) as T : value;
const parseParams = (request: FastifyRequest) => z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/) }).parse(request.params);
const parseBody = <T extends z.ZodType>(request: FastifyRequest, schema: T) => schema.parse(request.body) as z.infer<T>;

export function validateQuestionDefinition(value: unknown, id?: string): QuestionDefinition {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  let definition: QuestionDefinition;
  try { definition = questionSchema.parse({ ...raw, ...(id ? { id } : {}) }); }
  catch (error) {
    if (error instanceof ZodError) throw error;
    throw error;
  }
  const optionIds = definition.options.map(option => option.id);
  if (new Set(optionIds).size !== optionIds.length) throw httpError(400, 'INVALID_QUESTION', '选项 ID 必须唯一。');
  if (definition.kind === 'single') {
    if (optionIds.length < 2 || typeof definition.answer !== 'string' || !optionIds.includes(definition.answer)) throw httpError(400, 'INVALID_QUESTION', '单选题必须有至少两个选项，且答案必须是其中一个选项 ID。');
  } else if (definition.kind === 'multiple') {
    if (optionIds.length < 2 || !Array.isArray(definition.answer) || definition.answer.length === 0 || new Set(definition.answer).size !== definition.answer.length || definition.answer.some(id => !optionIds.includes(id))) throw httpError(400, 'INVALID_QUESTION', '多选题答案必须是选项 ID 的非空、不重复子集。');
  } else if (definition.kind === 'number') {
    if (typeof definition.answer !== 'number' || optionIds.length !== 0) throw httpError(400, 'INVALID_QUESTION', '数值题答案必须是数字，且不能包含选项。');
  } else if (typeof definition.answer !== 'string' || !definition.answer.trim() || optionIds.length !== 0) {
    throw httpError(400, 'INVALID_QUESTION', '文本题答案必须是文本，且不能包含选项。');
  }
  if (definition.kind !== 'number' && definition.tolerance !== undefined) throw httpError(400, 'INVALID_QUESTION', '只有数值题可以设置允许误差。');
  return definition;
}

async function rowFor(ctx: AppContext, user: UserView, id: string, write = false): Promise<QuestionRow> {
  const rows = await ctx.db.query<QuestionRow>('SELECT id,owner_id,prompt,kind,definition,status,global_published,class_id,updated_at FROM questions WHERE id=?', [id]);
  const row = rows[0];
  if (!row) throw httpError(404, 'QUESTION_NOT_FOUND', '题目不存在。');
  if (user.role === 'admin' || row.owner_id === user.id) return row;
  if (write || row.status !== 'published') throw httpError(404, 'QUESTION_NOT_FOUND', '题目不存在。');
  if (row.global_published) return row;
  if (row.class_id) {
    await ctx.assertClassAccess(user, row.class_id);
    return row;
  }
  throw httpError(404, 'QUESTION_NOT_FOUND', '题目不存在。');
}

function view(row: QuestionRow) {
  return {
    id: row.id, ownerId: row.owner_id, prompt: row.prompt, kind: row.kind,
    definition: fromJson(row.definition), status: row.status,
    global: Boolean(row.global_published), classId: row.class_id,
    updatedAt: iso(row.updated_at),
  };
}

export async function registerQuestionRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  route(app, 'get', '/api/questions', async request => {
    const user = await ctx.requireRole(request, teacherAdmin);
    const query = z.object({ scope: z.enum(['mine', 'available']).default('mine') }).parse(request.query);
    let rows: QuestionRow[];
    if (query.scope === 'mine') {
      rows = user.role === 'admin'
        ? await ctx.db.query<QuestionRow>('SELECT id,owner_id,prompt,kind,definition,status,global_published,class_id,updated_at FROM questions WHERE owner_id=? ORDER BY updated_at DESC', [user.id])
        : await ctx.db.query<QuestionRow>('SELECT id,owner_id,prompt,kind,definition,status,global_published,class_id,updated_at FROM questions WHERE owner_id=? ORDER BY updated_at DESC', [user.id]);
    } else if (user.role === 'admin') {
      rows = await ctx.db.query<QuestionRow>("SELECT id,owner_id,prompt,kind,definition,status,global_published,class_id,updated_at FROM questions WHERE owner_id=? OR status='published' ORDER BY updated_at DESC", [user.id]);
    } else {
      rows = await ctx.db.query<QuestionRow>("SELECT DISTINCT q.id,q.owner_id,q.prompt,q.kind,q.definition,q.status,q.global_published,q.class_id,q.updated_at FROM questions q LEFT JOIN classes c ON c.id=q.class_id WHERE q.owner_id=? OR (q.status='published' AND (q.global_published=1 OR c.teacher_id=?)) ORDER BY q.updated_at DESC", [user.id, user.id]);
    }
    return rows.map(row => ({ id: row.id, ownerId: row.owner_id, prompt: row.prompt, kind: row.kind, status: row.status, global: Boolean(row.global_published), classId: row.class_id, updatedAt: iso(row.updated_at) }));
  });

  route(app, 'post', '/api/questions', async request => {
    const user = await ctx.requireRole(request, teacherAdmin);
    const body = parseBody(request, z.object({ definition: z.unknown() }).strict());
    const id = `q-${randomUUID()}`;
    const definition = validateQuestionDefinition(body.definition, id);
    await ctx.db.execute('INSERT INTO questions(id,owner_id,prompt,kind,definition,status) VALUES(?,?,?,?,?,\'draft\')', [id, user.id, definition.prompt, definition.kind, JSON.stringify(definition)]);
    await ctx.audit(user.id, 'question.create', id, { kind: definition.kind });
    const row = (await ctx.db.query<QuestionRow>('SELECT id,owner_id,prompt,kind,definition,status,global_published,class_id,updated_at FROM questions WHERE id=?', [id]))[0]!;
    return view(row);
  });

  route(app, 'get', '/api/questions/:id', async request => {
    const user = await ctx.requireRole(request, teacherAdmin);
    const { id } = parseParams(request);
    return view(await rowFor(ctx, user, id));
  });

  route(app, 'put', '/api/questions/:id', async request => {
    const user = await ctx.requireRole(request, teacherAdmin);
    const { id } = parseParams(request);
    const body = parseBody(request, z.object({ definition: z.unknown() }).strict());
    const existing = await rowFor(ctx, user, id, true);
    if (existing.status === 'disabled') throw httpError(409, 'QUESTION_DISABLED', '已停用题目不能编辑。');
    const definition = validateQuestionDefinition(body.definition, id);
    await ctx.db.execute('UPDATE questions SET prompt=?,kind=?,definition=?,status=\'draft\',global_published=0,class_id=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=?', [definition.prompt, definition.kind, JSON.stringify(definition), id]);
    await ctx.audit(user.id, 'question.edit', id, { kind: definition.kind });
    const row = (await ctx.db.query<QuestionRow>('SELECT id,owner_id,prompt,kind,definition,status,global_published,class_id,updated_at FROM questions WHERE id=?', [id]))[0]!;
    return view(row);
  });

  route(app, 'post', '/api/questions/:id/copy', async request => {
    const user = await ctx.requireRole(request, teacherAdmin);
    const { id: sourceId } = parseParams(request);
    const source = await rowFor(ctx, user, sourceId);
    parseBody(request, z.object({}).strict().optional().default({}));
    const id = `q-${randomUUID()}`;
    const definition = validateQuestionDefinition(fromJson(source.definition), id);
    await ctx.db.execute('INSERT INTO questions(id,owner_id,prompt,kind,definition,status) VALUES(?,?,?,?,?,\'draft\')', [id, user.id, definition.prompt, definition.kind, JSON.stringify(definition)]);
    await ctx.audit(user.id, 'question.copy', id, { sourceId });
    const row = (await ctx.db.query<QuestionRow>('SELECT id,owner_id,prompt,kind,definition,status,global_published,class_id,updated_at FROM questions WHERE id=?', [id]))[0]!;
    return view(row);
  });

  route(app, 'post', '/api/questions/:id/publish', async request => {
    const user = await ctx.requireRole(request, teacherAdmin);
    const { id } = parseParams(request);
    const body = parseBody(request, z.object({ classId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(), global: z.boolean().optional() }).strict());
    const row = await rowFor(ctx, user, id, true);
    if (row.status === 'disabled') throw httpError(409, 'QUESTION_DISABLED', '已停用题目不能发布。');
    if (body.global && user.role !== 'admin') throw httpError(403, 'FORBIDDEN', '全局发布仅管理员可操作。');
    if (body.classId && body.global) throw httpError(400, 'INVALID_PUBLISH_SCOPE', '请选择班级发布或全局发布其中一种范围。');
    if (body.classId) await ctx.assertClassAccess(user, body.classId, true);
    if (!body.classId && !body.global) throw httpError(400, 'PUBLISH_SCOPE_REQUIRED', '请选择班级或全局发布。');
    await ctx.db.execute("UPDATE questions SET status='published',global_published=?,class_id=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?", [body.global ? 1 : 0, body.classId ?? null, id]);
    await ctx.audit(user.id, 'question.publish', id, { classId: body.classId ?? null, global: Boolean(body.global) });
    const updated = (await ctx.db.query<QuestionRow>('SELECT id,owner_id,prompt,kind,definition,status,global_published,class_id,updated_at FROM questions WHERE id=?', [id]))[0]!;
    return view(updated);
  });

  route(app, 'delete', '/api/questions/:id', async request => {
    const user = await ctx.requireRole(request, teacherAdmin);
    const { id } = parseParams(request);
    await rowFor(ctx, user, id, true);
    await ctx.db.execute("UPDATE questions SET status='disabled',global_published=0,class_id=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=?", [id]);
    await ctx.audit(user.id, 'question.disable', id);
    return { ok: true };
  });
}
