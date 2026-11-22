import type { QuestionDefinition } from '../../../../packages/shared/src/index.ts';

export function blankQuestion(id: string): QuestionDefinition {
  return { id, kind: 'single', prompt: '', options: [{ id: 'a', label: '' }, { id: 'b', label: '' }], answer: 'a', explanation: '', knowledge: [''], points: 5 };
}

export function QuestionFields({ value, onChange, prefix = 'question' }: { value: QuestionDefinition; onChange: (next: QuestionDefinition) => void; prefix?: string }) {
  const patch = (next: Partial<QuestionDefinition>) => onChange({ ...value, ...next });
  const answerIds = Array.isArray(value.answer) ? value.answer : [];
  const setKind = (kind: QuestionDefinition['kind']) => {
    const options = kind === 'single' || kind === 'multiple' ? value.options.length >= 2 ? value.options : [{ id: 'a', label: '选项 A' }, { id: 'b', label: '选项 B' }] : [];
    const answer: QuestionDefinition['answer'] = kind === 'multiple' ? [options[0]!.id] : kind === 'single' ? options[0]!.id : kind === 'number' ? 0 : '';
    patch({ kind, options, answer, ...(kind !== 'number' ? { tolerance: undefined } : {}) });
  };
  return <div className="mg-question-fields">
    <label className="mg-field"><span>题目内容</span><textarea rows={3} maxLength={2000} value={value.prompt} onChange={e => patch({ prompt: e.target.value })} /></label>
    <div className="mg-question-meta">
      <label className="mg-field"><span>题型</span><select value={value.kind} onChange={e => setKind(e.target.value as QuestionDefinition['kind'])}><option value="single">单选</option><option value="multiple">多选</option><option value="number">数值</option><option value="text">文本</option></select></label>
      <label className="mg-field"><span>分值</span><input type="number" min={1} max={1000} value={value.points} onChange={e => patch({ points: Number(e.target.value) })} /></label>
      <label className="mg-field"><span>知识点（逗号分隔）</span><input value={value.knowledge.join(', ')} onChange={e => patch({ knowledge: e.target.value.split(',').map(x => x.trim()).slice(0, 12) })} /></label>
    </div>
    {(value.kind === 'single' || value.kind === 'multiple') && <fieldset className="mg-question-options"><legend>选项与正确答案</legend>{value.options.map((option, index) => <div className="mg-question-option" key={`${option.id}-${index}`}>
      {value.kind === 'single' ? <input aria-label={`选项 ${index + 1} 为正确答案`} type="radio" name={`${prefix}-${value.id}`} checked={value.answer === option.id} onChange={() => patch({ answer: option.id })} /> : <input aria-label={`选项 ${index + 1} 为正确答案`} type="checkbox" checked={answerIds.includes(option.id)} onChange={e => patch({ answer: e.target.checked ? [...answerIds, option.id] : answerIds.filter(id => id !== option.id) })} />}
      <input aria-label={`选项 ${index + 1} ID`} value={option.id} maxLength={80} onChange={e => { const nextId = e.target.value; const options = value.options.map((item, i) => i === index ? { ...item, id: nextId } : item); const answer = Array.isArray(value.answer) ? value.answer.map(id => id === option.id ? nextId : id) : value.answer === option.id ? nextId : value.answer; patch({ options, answer }); }} />
      <input aria-label={`选项 ${index + 1} 内容`} value={option.label} maxLength={500} onChange={e => patch({ options: value.options.map((item, i) => i === index ? { ...item, label: e.target.value } : item) })} />
      <button type="button" className="mg-icon-button" aria-label="删除选项" disabled={value.options.length <= 2} onClick={() => { const options = value.options.filter((_, i) => i !== index); let answer = value.answer; if (Array.isArray(answer)) answer = answer.filter(id => id !== option.id); else if (answer === option.id) answer = options[0]!.id; patch({ options, answer }); }}>×</button>
    </div>)}<button type="button" className="mg-text-button" disabled={value.options.length >= 20} onClick={() => { const nextId = `option_${value.options.length + 1}`; patch({ options: [...value.options, { id: nextId, label: `新选项 ${value.options.length + 1}` }] }); }}>+ 添加选项</button></fieldset>}
    {value.kind === 'number' && <div className="mg-question-answer"><label className="mg-field"><span>标准数值答案</span><input type="number" step="any" value={typeof value.answer === 'number' ? value.answer : 0} onChange={e => patch({ answer: Number(e.target.value) })} /></label><label className="mg-field"><span>允许误差（可选）</span><input type="number" min={0} step="any" value={value.tolerance ?? ''} onChange={e => patch({ tolerance: e.target.value === '' ? undefined : Number(e.target.value) })} /></label></div>}
    {value.kind === 'text' && <label className="mg-field"><span>标准文本答案</span><textarea rows={2} maxLength={300} value={typeof value.answer === 'string' ? value.answer : ''} onChange={e => patch({ answer: e.target.value })} /></label>}
    <label className="mg-field"><span>答案解析</span><textarea rows={3} maxLength={2000} value={value.explanation} onChange={e => patch({ explanation: e.target.value })} /></label>
  </div>;
}
