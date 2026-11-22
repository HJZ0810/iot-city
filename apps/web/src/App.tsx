import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDown, CircuitBoard, ArrowLeft, ArrowRight, AudioLines, Bell, BookOpen, Boxes, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Cpu, Gauge, Globe2, GraduationCap, Layers3, LogOut, Menu, MessageCircle, Pause, Play, Plus, Radio, RefreshCw, Save, Search, Settings2, ShieldAlert, Signal, Sparkles, Trophy, UserRound, Wifi, X, Zap } from 'lucide-react';
import type { ChapterView, ControlRule, DeviceState, GameCommand, GameMode, PublicLevel, ProgressView, RoomView, ServerMessage, SessionView, UserView } from '../../../packages/shared/src/index';
import { apiClient } from './api';
import { AuthView } from './pages/AuthPage';
import { CityView } from './pages/CityPage';
import { MapView } from './pages/MapPage';
import { GameView } from './pages/GamePage';
import { ReportsView } from './pages/ReportsPage';
import { LeaderboardView } from './pages/LeaderboardPage';
import { SandboxView } from './pages/SandboxPage';
import { CoopView } from './pages/CoopPage';
import { TerminalView } from './pages/TerminalPage';
import { ProfileView } from './pages/ProfilePage';
import type { Page, CommandSubmission } from './types';
import { errorText } from './utils/errorText';
import { EmptyState } from './components/EmptyState';
import { useRoomSocket } from './components/useRoomSocket';
import type { PublicConfigView } from './api';

const ManagementApp=lazy(()=>import('./management/ManagementApp'));

const navItems:[Page,string,typeof Globe2][]=[['city','城市中枢',Globe2],['map','章节地图',Layers3],['reports','学习记录',Activity],['leaderboard','排行榜',Trophy],['sandbox','沙盒工程',Boxes],['coop','协作空间',Wifi],['terminal','我的终端',CircuitBoard],['management','教学管理',GraduationCap]];


type RoomSession={room:RoomView;level:PublicLevel};


function roomSession(room:RoomView,level:PublicLevel,userId:string):SessionView|null{const player=room.players.find(p=>p.userId===userId);const team=room.mode==='coop'?'0':String(player?.team??0);const state=room.states[team];if(!state)return null;return{id:room.id,mode:room.mode,level,state,elapsedSeconds:room.startedAt?Math.max(0,Math.floor((Date.now()-new Date(room.startedAt).getTime())/1000)):0,updatedAt:new Date().toISOString()}}


export default function App(){
 const [user,setUser]=useState<UserView|null>(null),[authBusy,setAuthBusy]=useState(true),[page,setPage]=useState<Page>('city'),[chapters,setChapters]=useState<ChapterView[]>([]),[levels,setLevels]=useState<PublicLevel[]>([]),[progress,setProgress]=useState<ProgressView|null>(null),[session,setSession]=useState<SessionView|null>(null),[activeRoomGame,setActiveRoomGame]=useState<RoomSession|null>(null),[notice,setNotice]=useState(''),[loading,setLoading]=useState(false),[menuOpen,setMenuOpen]=useState(false),[sound,setSound]=useState(false),[lowFx,setLowFx]=useState(false),[apiOnline,setApiOnline]=useState(false),[config,setConfig]=useState<PublicConfigView|null>(null);
 const activeRoomRef=useRef<RoomSession|null>(null);activeRoomRef.current=activeRoomGame;
 const handleRoomMessage=useCallback((message:ServerMessage)=>{if(message.type!=='room'&&message.type!=='ack')return;const current=activeRoomRef.current;if(!current||message.room.id!==current.room.id||!user)return;const next={...current,room:message.room};activeRoomRef.current=next;setActiveRoomGame(next);const updated=roomSession(message.room,current.level,user.id);if(updated)setSession(updated)},[user]);
 const roomSocket=useRoomSocket({roomId:activeRoomGame?.room.id??null,userId:user?.id??null,onMessage:handleRoomMessage,onNotice:setNotice});
 const closeRoomGame=useCallback(()=>{roomSocket.close();activeRoomRef.current=null;setActiveRoomGame(null)},[roomSocket.close]);
 const refresh=useCallback(async()=>{try{const [c,l,p]=await Promise.all([apiClient.chapters(),apiClient.levels(),apiClient.progress()]);setChapters(c);setLevels(l);setProgress(p);setApiOnline(true)}catch(e){setApiOnline(false);throw e}},[]);
 useEffect(()=>{apiClient.me().then(async u=>{setUser(u);apiClient.config().then(setConfig).catch(()=>{});try{await refresh()}catch(e){setNotice(errorText(e))}}).catch(e=>{if((e as Error&{status?:number}).status!==401)setNotice('城市服务暂时不可用：'+errorText(e))}).finally(()=>setAuthBusy(false))},[refresh]);
 const submitRoomCommand=useCallback(async(command:GameCommand):Promise<CommandSubmission>=>{const active=activeRoomRef.current;if(!active||active.room.status!=='playing')throw new Error('当前房间不在进行状态。');const message=await roomSocket.send(command);const latest=activeRoomRef.current;if(!latest)throw new Error('房间已退出。');const current=roomSession(latest.room,latest.level,user!.id);if(!current)throw new Error('房间尚未返回当前队伍状态。');return{session:current,message}},[roomSocket.send,user]);
 const enterRoomGame=async(room:RoomView)=>{closeRoomGame();setLoading(true);try{const level=await apiClient.level(room.levelId);const bundle={room,level};activeRoomRef.current=bundle;setActiveRoomGame(bundle);const current=roomSession(room,level,user!.id);if(current)setSession(current);else setNotice('等待服务器初始化本队工程状态…');setPage('game')}catch(e){setNotice(errorText(e))}finally{setLoading(false)}};
 const openSession=async(mode:GameMode,levelId?:string,projectId?:string)=>{closeRoomGame();setLoading(true);try{let current=await apiClient.createSession(mode,levelId,projectId);if(current.mode!==mode){setNotice('服务器返回的模式与请求不同，请刷新后再试。');return;}setSession(current);setPage('game');setNotice('');}catch(e){setNotice(errorText(e))}finally{setLoading(false)}};
 const signout=async()=>{closeRoomGame();await apiClient.logout().catch(()=>{});setUser(null);setSession(null);setPage('city')};
 const title=page==='city'?'城市中枢':page==='map'?'主线章节':page==='game'?(session?.level.title??'正在连接') :page==='reports'?'学习记录':page==='leaderboard'?'城市榜单':page==='sandbox'?'自由沙盒':page==='coop'?'联机大厅':page==='terminal'?'我的终端':page==='management'?'教学管理':'个人档案';
 if(authBusy)return <main className="boot"><div className="brand-mark"><Cpu size={24}/></div><span className="eyebrow">NEXUS CITY / CONNECTION</span><p>正在同步城市档案…</p></main>;
 if(!user)return <AuthView onSuccess={async u=>{setUser(u);try{await refresh()}catch(e){setNotice(errorText(e))}}} notice={notice}/>;
 return <div className={`app-shell ${lowFx?'low-fx':''}`}>
  <aside className={`sidebar ${menuOpen?'sidebar-open':''}`}><div className="brand"><div className="brand-mark"><Cpu size={21}/></div><div><b>万物之城</b><small>NEXUS CITY <i>•</i> LEARNING WORLD</small></div><button className="icon-btn mobile-close" onClick={()=>setMenuOpen(false)} aria-label="关闭菜单"><X/></button></div><div className="city-label"><span className={`status-dot ${apiOnline?'':'offline'}`}/>{apiOnline?'城市网络在线':'等待服务连接'}<span className="city-latency">{apiOnline?'已同步':'离线'}</span></div><div className="nav-label">探索</div><nav>{navItems.filter(([id])=>id!=="management"||user.role!=="student").map(([id,label,Icon])=><button key={id} className={`nav-item ${page===id?'active':''}`} onClick={()=>{if(activeRoomRef.current){closeRoomGame();setSession(null)}setPage(id);setMenuOpen(false)}}><Icon size={17}/><span>{label}</span>{id==='coop'&&<span className="nav-live"/>}</button>)}</nav><div className="side-divider"/><div className="nav-label">快捷入口</div><button className="nav-item" onClick={()=>{if(activeRoomRef.current){closeRoomGame();setSession(null)}setPage('map')}}><BookOpen size={17}/><span>继续主线任务</span><ChevronRight className="nav-chev" size={15}/></button><button className="nav-item" onClick={()=>openSession('daily')}><Sparkles size={17}/><span>每日挑战</span></button><div className="side-spacer"/><div className="season-card"><div className="season-top"><span>当前赛季</span><span className="season-tag">{config?.season.id??'S01'}</span></div><b>{config?.season.name??'城市复苏计划'}</b><div className="season-track"><span style={{width:`${Math.min(100,(progress?.completed.length??0)*4)}%`}}/></div><small>{progress?.completed.length??'—'} / {levels.length||'—'} 关完成</small></div><button className="profile-mini" onClick={()=>{if(activeRoomRef.current){closeRoomGame();setSession(null)}setPage('profile')}}><div className="avatar">{user.nickname.slice(0,1)}</div><div className="profile-mini-text"><b>{user.nickname}</b><small>{user.role==='student'?'学生':user.role==='teacher'?'教师':'管理员'} · 城市居民</small></div><ChevronDown size={16}/></button></aside>
  {menuOpen&&<button className="scrim" onClick={()=>setMenuOpen(false)} aria-label="关闭侧栏"/>}
  <main className="main-area"><header className="topbar"><button className="icon-btn mobile-menu" onClick={()=>setMenuOpen(true)} aria-label="打开菜单"><Menu/></button><div className="breadcrumbs"><span>万物之城</span><ChevronRight size={14}/><b>{title}</b></div><div className="top-actions"><span className="clock"><span className={`status-dot ${apiOnline?'':'offline'}`}/> {apiOnline?'SERVER SYNC':'SERVICE OFFLINE'}</span><button className="icon-btn" aria-label="通知" onClick={()=>setNotice('目前没有新的城市通知。')}><Bell size={18}/></button><button className="icon-btn" aria-label="帮助" onClick={()=>setNotice('操作将发送至服务器验证；关卡完成和成绩均由服务器结算。')}><CircleHelp size={18}/></button></div></header>
   <div className="page-content">{notice&&<div className="notice"><ShieldAlert size={16}/><span>{notice}</span><button onClick={()=>setNotice('')} aria-label="关闭消息"><X size={15}/></button></div>}
    {page==='game'?<GameView session={session} setSession={setSession} submitCommand={activeRoomGame?submitRoomCommand:undefined} room={activeRoomGame?.room??null} user={user} onExit={()=>{const wasRoom=Boolean(activeRoomRef.current);closeRoomGame();setSession(null);if(wasRoom)setPage('city');else{setPage('map');refresh().catch(()=>{})}}} setNotice={setNotice} lowFx={lowFx} connectionStatus={roomSocket.status} onReconnect={roomSocket.reconnect}/>:
    page==='city'?<CityView user={user} progress={progress} levels={levels} loading={loading} onContinue={()=>{const active=progress?.activeSessions[0];if(active){closeRoomGame();apiClient.session(active.id).then(s=>{setSession(s);setPage('game')}).catch(e=>setNotice(errorText(e)))}else setPage('map')}} onMode={openSession} setPage={setPage}/>:
    page==='map'?<MapView chapters={chapters} levels={levels} progress={progress} onPlay={id=>openSession('story',id)} loading={loading}/>:
    page==='reports'?<ReportsView progress={progress} setNotice={setNotice}/>:
    page==='leaderboard'?<LeaderboardView setNotice={setNotice} config={config}/>:
    page==='sandbox'?<SandboxView levels={levels} openSession={openSession} setNotice={setNotice}/>:
    page==='coop'?<CoopView user={user} setNotice={setNotice} onStartGame={enterRoomGame} config={config}/>:
    page==='terminal'?<TerminalView user={user} setNotice={setNotice}/>:
    page==='management'?<Suspense fallback={<EmptyState title="正在载入教学管理" detail="管理界面按需载入。"/>}><ManagementApp user={user} onExit={()=>setPage('city')}/></Suspense>:
    <ProfileView user={user} onUpdate={setUser} onLogout={signout} sound={sound} setSound={setSound} lowFx={lowFx} setLowFx={setLowFx}/>}
   </div></main></div>
}
