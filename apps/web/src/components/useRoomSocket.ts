import { useCallback, useEffect, useRef, useState } from 'react';
import { withBase } from '../utils/basePath';
import type { GameCommand, ServerMessage } from '../../../../packages/shared/src/index';

export type RoomConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';
type PendingCommand = {
  command: GameCommand;
  resolve: (message: string) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  sent: boolean;
};

export function useRoomSocket({roomId,userId,onMessage,onNotice}:{roomId:string|null;userId:string|null;onMessage:(message:ServerMessage)=>void;onNotice:(message:string)=>void}) {
  const [status,setStatus]=useState<RoomConnectionStatus>('idle');
  const [attempt,setAttempt]=useState(0);
  const socketRef=useRef<WebSocket|null>(null);
  const statusRef=useRef<RoomConnectionStatus>('idle');
  const pendingRef=useRef(new Map<string,PendingCommand>());
  statusRef.current=status;

  const settleAll=useCallback((reason:string)=>{
    for(const pending of pendingRef.current.values()){
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    pendingRef.current.clear();
  },[]);

  const reconnect=useCallback(()=>{
    settleAll('实时连接正在重建。此前未确认的操作没有自动重发，请先检查房间 REV 再手动重试。');
    setStatus('connecting');
    setAttempt(value=>value+1);
  },[settleAll]);

  const close=useCallback((reason='已离开房间现场。')=>{
    settleAll(reason);
    const socket=socketRef.current;
    socketRef.current=null;
    if(socket&&socket.readyState< WebSocket.CLOSING)socket.close();
    setStatus('idle');
  },[settleAll]);

  const send=useCallback((command:GameCommand):Promise<string>=>new Promise((resolve,reject)=>{
    if(!roomId){reject(new Error('当前没有活动房间。'));return;}
    if(statusRef.current==='disconnected'){
      reject(new Error('房间实时连接已断开，请先重连后再提交。'));
      return;
    }
    const timeout=setTimeout(()=>{
      const pending=pendingRef.current.get(command.id);
      if(!pending)return;
      pendingRef.current.delete(command.id);
      reject(new Error('10 秒内未收到服务器确认。请先检查房间状态和 REV，再手动重试；系统不会自动重复发送命令。'));
    },10000);
    const pending:PendingCommand={command,resolve,reject,timeout,sent:false};
    pendingRef.current.set(command.id,pending);
    const socket=socketRef.current;
    if(socket?.readyState===WebSocket.OPEN){
      try{
        socket.send(JSON.stringify({type:'command',roomId,command}));
        pending.sent=true;
      }catch{
        pendingRef.current.delete(command.id);
        clearTimeout(timeout);
        reject(new Error('房间命令发送失败，请检查连接后再试。'));
      }
    }else if(socket&&socket.readyState!==WebSocket.CONNECTING){
      pendingRef.current.delete(command.id);
      clearTimeout(timeout);
      reject(new Error('房间实时连接已关闭，请重连后再提交。'));
    }
  }),[roomId]);

  useEffect(()=>{
    if(!roomId||!userId){setStatus('idle');return;}
    const socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}${withBase('/ws')}`);
    socketRef.current=socket;
    statusRef.current='connecting';
    setStatus('connecting');
    const failPending=(reason:string)=>{
      for(const pending of pendingRef.current.values()){
        clearTimeout(pending.timeout);
        pending.reject(new Error(reason));
      }
      pendingRef.current.clear();
    };
    const sendPending=(pending:PendingCommand)=>{
      if(pending.sent||socket.readyState!==WebSocket.OPEN)return;
      try{
        socket.send(JSON.stringify({type:'command',roomId,command:pending.command}));
        pending.sent=true;
      }catch{
        pendingRef.current.delete(pending.command.id);
        clearTimeout(pending.timeout);
        pending.reject(new Error('房间命令发送失败，请检查连接后再试。'));
      }
    };
    socket.onopen=()=>{
      if(socketRef.current!==socket)return;
      statusRef.current='connected';
      setStatus('connected');
      socket.send(JSON.stringify({type:'join',roomId}));
      for(const pending of pendingRef.current.values())sendPending(pending);
    };
    socket.onmessage=event=>{
      if(socketRef.current!==socket)return;
      try{
        const message=JSON.parse(event.data) as ServerMessage;
        onMessage(message);
        if(message.type==='ack'){
          const pending=pendingRef.current.get(message.commandId);
          if(!pending)return;
          pendingRef.current.delete(message.commandId);
          clearTimeout(pending.timeout);
          if(message.accepted)pending.resolve(message.message);
          else pending.reject(new Error(message.message));
        }else if(message.type==='error'){
          statusRef.current='disconnected';
          setStatus('disconnected');
          failPending(message.message);
          onNotice(message.message);
        }
      }catch{
        const reason='收到无法识别的实时房间消息。';
        statusRef.current='disconnected';
        setStatus('disconnected');
        failPending(reason);
        onNotice(reason);
      }
    };
    socket.onerror=()=>{
      if(socketRef.current!==socket)return;
      const reason='房间实时连接中断。未确认的操作已停止等待，请重连并检查服务端 REV。';
      statusRef.current='disconnected';
      setStatus('disconnected');
      failPending(reason);
      onNotice(reason);
    };
    socket.onclose=()=>{
      if(socketRef.current!==socket)return;
      socketRef.current=null;
      const reason='房间实时连接已关闭。未确认的操作已停止等待，请重连并检查服务端 REV。';
      statusRef.current='disconnected';
      setStatus('disconnected');
      failPending(reason);
    };
    return()=>{
      if(socketRef.current===socket){
        socketRef.current=null;
        failPending('房间连接已关闭，未确认的操作没有自动重发。');
      }
      if(socket.readyState<WebSocket.CLOSING)socket.close();
    };
  },[roomId,userId,attempt,onMessage,onNotice]);

  return {status,send,reconnect,close};
}
