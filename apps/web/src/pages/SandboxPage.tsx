import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowRight, Boxes, Cpu, RefreshCw, Trophy, Wrench } from 'lucide-react';
import type { GameMode, PublicLevel } from '../../../../packages/shared/src/index';
import { apiClient } from '../api';
import { EmptyState } from '../components/EmptyState';
import { errorText } from '../utils/errorText';
import '../styles/sandbox.css';

type SavedProject = { id: string; name: string; updatedAt: string };
type OpenSession = (mode: GameMode, levelId?: string, projectId?: string, challenge?: boolean) => void;

export function SandboxView({ levels: _levels, openSession, setNotice }: {
  levels: PublicLevel[];
  openSession: OpenSession;
  setNotice: (message: string) => void;
}) {
  const [projects, setProjects] = useState<SavedProject[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setProjects(await apiClient.sandbox());
    } catch (error) {
      setProjects(null);
      setLoadError(true);
      setNotice(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [setNotice]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  return <div className="subpage sandbox-page">
    <div className="page-heading">
      <div><span className="eyebrow">ENGINEERING SANDBOX</span><h1>把想法放进现场验证。</h1><p>选择有计分的标准挑战，或进入自由工程搭建设备与连接。</p></div>
      <div className="heading-stat"><Boxes size={22} /><span>两种工程模式</span></div>
    </div>

    <section className="sandbox-entry-grid" aria-label="选择沙盒模式">
      <article className="sandbox-entry-card standard">
        <div className="sandbox-entry-art" aria-hidden="true"><div className="sandbox-art-orbit" /><div className="sandbox-art-node node-one" /><div className="sandbox-art-node node-two" /><div className="sandbox-art-node node-three" /><i className="sandbox-art-link link-one" /><i className="sandbox-art-link link-two" /></div>
        <div className="sandbox-entry-content">
          <span className="eyebrow"><Trophy size={12} /> STANDARD CHALLENGE</span>
          <h2>标准挑战</h2>
          <p>按服务端标准规则运行仿真，完成后参与挑战榜单。</p>
          <ul><li><Activity size={13} />挑战结果进入排行榜</li><li><Cpu size={13} />设备与评分由服务端核定</li></ul>
          <button className="button button-primary" onClick={() => openSession('sandbox', undefined, undefined, true)}>开始标准挑战<ArrowRight size={15} /></button>
        </div>
      </article>

      <article className="sandbox-entry-card free">
        <div className="sandbox-entry-art" aria-hidden="true"><div className="sandbox-art-grid" /><div className="sandbox-art-cursor"><Wrench size={20} /></div><span>BUILD · TEST · REPEAT</span></div>
        <div className="sandbox-entry-content">
          <span className="eyebrow"><Wrench size={12} /> OPEN ENGINEERING</span>
          <h2>自由工程</h2>
          <p>从空白设备库开始安装、连线、移动设备，并按需注入故障。</p>
          <ul><li><Boxes size={13} />工程存档跨设备保存</li><li><Activity size={13} />自由实验不计入榜单</li></ul>
          <button className="button button-outline" onClick={() => openSession('sandbox')}>新建自由工程<ArrowRight size={15} /></button>
        </div>
      </article>
    </section>

    <section className="report-section sandbox-projects">
      <div className="section-head">
        <div><span className="eyebrow">YOUR PROJECTS</span><h2>我的自由工程</h2></div>
        <button className="icon-link" onClick={() => void loadProjects()} disabled={loading}><RefreshCw size={14} className={loading ? 'sandbox-refreshing' : ''} />同步存档</button>
      </div>
      <div className="sandbox-project-note"><span className="sandbox-project-note-mark"><Boxes size={14} /></span><p>自由工程状态保存在服务端，可从任意已登录设备继续编辑。</p></div>
      {loading ? <div className="sandbox-project-loading"><RefreshCw size={15} className="sandbox-refreshing" />正在读取工程存档…</div>
        : loadError || projects === null ? <EmptyState title="存档服务暂不可用" detail="稍后可以重新同步；连接失败时不会用本地假数据代替。" />
          : projects.length ? <div className="sandbox-project-list">{projects.map(project => <article className="sandbox-row" key={project.id}>
            <div className="sandbox-project-icon"><Cpu size={17} /></div>
            <div><b>{project.name}</b><small>最近保存 {new Date(project.updatedAt).toLocaleString('zh-CN', { hour12: false })}</small></div>
            <button className="button button-small button-outline" onClick={() => openSession('sandbox', undefined, project.id)}>继续工程<ArrowRight size={14} /></button>
          </article>)}</div> : <EmptyState title="还没有保存的自由工程" detail="进入自由工程后，可以在工程终端保存当前方案。" />}
    </section>
  </div>;
}
