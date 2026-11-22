import { useState } from 'react';
import type { PublicQuestion } from '../../../../packages/shared/src/index';
import { EmptyState } from './EmptyState';

type AnswerValue=string|string[]|number;

export function QuestionPanel({questions,flags,busy,onSubmit}:{questions:PublicQuestion[];flags:string[];busy:boolean;onSubmit:(questionId:string,answer:AnswerValue)=>void}){
  const [answers,setAnswers]=useState<Record<string,string|string[]>>({});
  const [errors,setErrors]=useState<Record<string,string>>({});
  if(!questions.length)return <EmptyState title="本关没有题目" detail="题库题目由课程内容配置提供。"/>;
  const update=(id:string,value:string|string[])=>setAnswers(current=>({...current,[id]:value}));
  const submit=(event:React.FormEvent<HTMLFormElement>,question:PublicQuestion)=>{
    event.preventDefault();
    const raw=answers[question.id];
    if(question.kind==='multiple'){
      const selected=Array.isArray(raw)?raw:[];
      if(!selected.length){setErrors(current=>({...current,[question.id]:'请选择至少一个选项。'}));return;}
      setErrors(current=>({...current,[question.id]:''}));
      onSubmit(question.id,selected);
      return;
    }
    if(typeof raw!=='string'||raw.trim()===''){setErrors(current=>({...current,[question.id]:'请先填写答案。'}));return;}
    if(question.kind==='number'){
      const numeric=Number(raw);
      if(!Number.isFinite(numeric)){setErrors(current=>({...current,[question.id]:'请输入有效数字。'}));return;}
      setErrors(current=>({...current,[question.id]:''}));
      onSubmit(question.id,numeric);
      return;
    }
    setErrors(current=>({...current,[question.id]:''}));
    onSubmit(question.id,question.kind==='single'?raw:raw.trim());
  };
  return <div className="question-list">{questions.map((question,index)=>{
    const answered=flags.includes(`answered:${question.id}`);
    const selected=Array.isArray(answers[question.id])?answers[question.id] as string[]:[];
    return <form className="question-card" key={question.id} onSubmit={event=>submit(event,question)}>
      <div className="question-heading"><span className="question-index">{String(index+1).padStart(2,'0')}</span><div><b>{question.prompt}</b><small>{question.knowledge.join(' · ')} · {question.points} 分</small></div></div>
      {question.kind==='single'&&<fieldset className="question-options"><legend>选择一个选项</legend>{question.options.map(option=><label key={option.id}><input type="radio" name={`question-${question.id}`} value={option.id} checked={answers[question.id]===option.id} onChange={()=>update(question.id,option.id)} disabled={busy||answered} required/><span>{option.label}</span></label>)}</fieldset>}
      {question.kind==='multiple'&&<fieldset className="question-options"><legend>选择所有适用选项</legend>{question.options.map(option=><label key={option.id}><input type="checkbox" value={option.id} checked={selected.includes(option.id)} onChange={event=>update(question.id,event.target.checked?[...selected,option.id]:selected.filter(id=>id!==option.id))} disabled={busy||answered}/><span>{option.label}</span></label>)}</fieldset>}
      {question.kind==='number'&&<label className="question-free-answer">数值答案<input type="number" step="any" value={typeof answers[question.id]==='string'?answers[question.id] as string:''} onChange={event=>update(question.id,event.target.value)} disabled={busy||answered} required/></label>}
      {question.kind==='text'&&<label className="question-free-answer">文字答案<textarea value={typeof answers[question.id]==='string'?answers[question.id] as string:''} onChange={event=>update(question.id,event.target.value)} disabled={busy||answered} rows={3} required/></label>}
      {errors[question.id]&&<p className="question-error" role="alert">{errors[question.id]}</p>}
      {answered?<p className="question-answered" role="status">服务器已确认答对。</p>:<button className="button button-small button-primary" disabled={busy}>提交答案</button>}
    </form>;
  })}</div>;
}
