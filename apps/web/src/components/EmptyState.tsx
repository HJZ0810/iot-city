import React from 'react';
import { Radio } from 'lucide-react';

export function EmptyState({title,detail}:{title:string;detail:string}){return <div className="empty-state"><div className="empty-orbit"><Radio size={22}/></div><h3>{title}</h3><p>{detail}</p></div>}
