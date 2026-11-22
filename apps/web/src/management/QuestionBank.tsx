import { useEffect, useMemo, useState } from 'react';
import { withBase } from '../utils/basePath';
import { BookOpenCheck, Copy, LoaderCircle, Plus, Save, Search, Shield, Trash2 } from 'lucide-react';
import type { ClassView, QuestionDefinition, UserView } from '../../../../packages/shared/src/index.ts';
import { questionSchema } from '../../../../packages/shared/src/index.ts';
import { blankQuestion, QuestionFields } from './QuestionFields';
import { instantiateQuestion, questionTemplates } from './question-templates';

type QuestionRow = { id: string; ownerId: string; prompt: string; kind: QuestionDefinition['kind']; status: 'draft' | 'published' | 'disabled'; global: boolean; classId: string | null; updatedAt: string };
type FullQuestion = QuestionRow & { definition: QuestionDefinition };
type ApiResult<T> = { data: T };
const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(withBase(path), { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => null) as ApiResult<T> & { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(body?.error?.message ?? `请求失败 (${response.status})`);
  return body && 'data' in body ? body.data : body as T;
};
const send = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const uid = () => globalThis.crypto?.randomUUID?.() ?? `q_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const kindName: Record<QuestionDefinition['kind'], string> = { single: '单选', multiple: '多选', number: '数值', text: '文本' };

export default function QuestionBank({ user, classes, setError }: { user: UserView; classes: ClassView[]; setError: (message: string) => void }) {
  const [scope, setScope] = useState<'mine' | 'available'>('mine');
  const [rows, setRows] = useState<QuestionRow[]>([]);
  const [current, setCurrent] = useState<FullQuestion | null>(null);
  const [draft, setDraft] = useState<QuestionDefinition | null>(null);
  const [filter, setFilter] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [busy, setBusy] = useState(false);
  const canGlobalPublish = user.role === 'admin';
  const filtered = useMemo(() => rows.filter(q => q.prompt.toLocaleLowerCase().includes(filter.toLocaleLowerCase())), [rows, filter]);
  const editable = !current || current.ownerId === user.id;
  const reload = async (nextScope = scope) => { setRows(await api<QuestionRow[]>(`/api/questions?scope=${nextScope}`)); };
  useEffect(() => { setBusy(true); reload().catch(e => setError(e.message)).finally(() => setBusy(false)); }, [scope]);
  const work = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const open = async (id: string) => work(async () => { const item = await api<FullQuestion>(`/api/questions/${encodeURIComponent(id)}`); setCurrent(item); setDraft(item.definition); });
  const create = () => { setCurrent(null); setDraft(blankQuestion(uid())); setError(''); };
  const save = () => work(async () => {
    if (!draft) return;
    const validation = questionSchema.safeParse(draft);
    if (!validation.success) throw new Error(`题目校验失败：${validation.error.issues.slice(0, 3).map(issue => issue.message).join('；')}`);
    if (current) await api(`/api/questions/${encodeURIComponent(current.id)}`, send('PUT', { definition: draft }));
    else { const created = await api<FullQuestion>('/api/questions', send('POST', { definition: draft })); setCurrent(created); setDraft(created.definition); }
    await reload();
    if (current) await open(current.id);
  });
  const copyQuestion = (id: string) => work(async () => { const copy = await api<FullQuestion>(`/api/questions/${encodeURIComponent(id)}/copy`, send('POST')); await reload(); setScope('mine'); setCurrent(copy); setDraft(copy.definition); });
  const publish = (global: boolean) => work(async () => {
    if (!current) throw new Error('先保存题目，再发布。');
    if (!global && !selectedClass) throw new Error('请选择目标班级。');
    const item = await api<FullQuestion>(`/api/questions/${encodeURIComponent(current.id)}/publish`, send('POST', global ? { global: true } : { classId: selectedClass }));
    setCurrent(item); setDraft(item.definition); await reload();
  });
  const disable = () => work(async () => {
    if (!current || !window.confirm('停用后题目不会出现在可用题库中。已复制进关卡的题目不受影响。确定停用？')) return;
    await api(`/api/questions/${encodeURIComponent(current.id)}`, send('DELETE')); setCurrent(null); setDraft(null); await reload();
  });
  const makeTemplate = (index: number) => work(async () => {
    const definition = instantiateQuestion(questionTemplates[index]!.definition, uid());
    const created = await api<FullQuestion>('/api/questions', send('POST', { definition }));
    await reload(); setCurrent(created); setDraft(created.definition);
  });

  return <div className="mg-question-bank">
    <aside className="mg-question-library"><div className="mg-library-head"><div><span className="mg-eyebrow">QUESTION BANK</span><h3>题目目录</h3></div><button className="mg-icon-button" onClick={create} aria-label="新建题目"><Plus size={18} /></button></div>
      <div className="mg-question-scope"><button className={scope === 'mine' ? 'active' : ''} onClick={() => setScope('mine')}>我的题目</button><button className={scope === 'available' ? 'active' : ''} onClick={() => setScope('available')}>可用题库</button></div>
      <div className="mg-search"><Search size={15} /><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="搜索题干" /></div>
      <div className="mg-question-list">{filtered.map(row => <button key={row.id} className={`mg-question-item ${current?.id === row.id ? 'selected' : ''}`} onClick={() => open(row.id)}><span className={`mg-status-dot ${row.status}`} /><span><strong>{row.prompt}</strong><small>{kindName[row.kind]} · {row.status === 'published' ? row.global ? '全局发布' : '班级发布' : row.status === 'disabled' ? '已停用' : '草稿'}</small></span></button>)}{!busy && filtered.length === 0 && <p className="mg-muted">{scope === 'mine' ? '还没有题目，或创建一题开始。' : '当前没有可用题目。'}</p>}</div>
      {scope === 'mine' && <div className="mg-template-list"><strong>专业模板 · 20 题</strong><p>模板涵盖网络、嵌入式、控制、安全与数据治理；选择后会新建可编辑草稿。</p>{questionTemplates.map((template, index) => <button key={template.title} onClick={() => makeTemplate(index)} disabled={busy}><span>{String(index + 1).padStart(2, '0')}</span>{template.title}<Plus size={13} /></button>)}</div>}
    </aside>
    <section className="mg-question-editor"><div className="mg-question-editor-head"><div><span className="mg-eyebrow">QUESTION DESIGN</span><h2>{current ? current.status === 'published' ? '查看或复制题目' : '编辑题目' : draft ? '新建题目草稿' : '选择或创建题目'}</h2><p>{current ? `${kindName[current.kind]} · ${current.global ? '全局发布' : current.classId ? '班级发布' : current.status}` : '题库题目不会自动变成学生成绩。保存到关卡后才会成为关卡的一部分。'}</p></div><div className="mg-editor-actions">{scope === 'available' && current && current.ownerId !== user.id && <button className="mg-button mg-button-primary" onClick={() => copyQuestion(current.id)} disabled={busy}><Copy size={14} />复制到我的题库</button>}{draft && editable && <button className="mg-button mg-button-primary" onClick={save} disabled={busy}><Save size={14} />保存草稿</button>}</div></div>
      {busy && <div className="mg-loading"><LoaderCircle className="mg-spin" />正在读取或保存…</div>}
      {!draft && !busy && <div className="mg-question-welcome"><BookOpenCheck size={32} /><h3>让知识点可检查、可解释</h3><p>选择目录题目，或用 20 道专业模板新建题目。正确答案与解析仅在教师和管理员的管理接口中可见。</p><button className="mg-button mg-button-primary" onClick={create}><Plus size={14} />创建题目</button></div>}
      {draft && <><fieldset disabled={!editable} className="mg-question-fields-readonly"><QuestionFields value={draft} prefix="bank" onChange={setDraft} /></fieldset>{current && current.ownerId === user.id && <div className="mg-question-publish"><label className="mg-field"><span>发布到班级</span><select value={selectedClass} onChange={e => setSelectedClass(e.target.value)}><option value="">选择班级</option>{classes.map(cls => <option key={cls.id} value={cls.id}>{cls.name}</option>)}</select></label><button className="mg-button" onClick={() => publish(false)} disabled={busy || !selectedClass}>发布到班级</button>{canGlobalPublish && <button className="mg-button mg-button-primary" onClick={() => publish(true)} disabled={busy}><Shield size={14} />全局发布</button>}<button className="mg-button mg-button-danger" onClick={disable} disabled={busy}><Trash2 size={14} />停用</button><small>修改已发布题目会创建可编辑草稿；已发布关卡中嵌入的题目副本不随题库修改。</small></div>}</>}
    </section>
  </div>;
}
