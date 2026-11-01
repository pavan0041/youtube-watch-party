import React, { useEffect, useRef, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const WS = API.replace(/^http/, 'ws');
function extractVideoId(value) {
  const s = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try { const u = new URL(s); if (u.hostname.includes('youtu.be')) return u.pathname.slice(1,12); return u.searchParams.get('v'); } catch { return null; }
}

export default function App() {
  const [username,setUsername] = useState('');
  const [roomCode,setRoomCode] = useState('');
  const [room,setRoom] = useState(null);
  const [me,setMe] = useState(null);
  const [participants,setParticipants] = useState([]);
  const [videoInput,setVideoInput] = useState('');
  const [message,setMessage] = useState('Create a room or join with a code to get started.');
  const [requests,setRequests] = useState([]);
  const playerRef = useRef(null);
  const wsRef = useRef(null);
  const lastPlayerTimeRef = useRef(0);
  const roomRef = useRef(room);
  const meRef = useRef(me);
  const canControl = me?.role === 'Host' || me?.role === 'Moderator';

  useEffect(()=>{ roomRef.current=room; },[room]);
  useEffect(()=>{ meRef.current=me; },[me]);

  useEffect(()=>{
    const invitedCode = new URLSearchParams(window.location.search).get('room');
    if (invitedCode) setRoomCode(invitedCode.toUpperCase());
  }, []);

  useEffect(()=>{
    if (!room || !me) return;
    let socket = new WebSocket(`${WS}/ws/${room.roomCode}?user_id=${me.userId}`);
    wsRef.current=socket;
    socket.onmessage = (event)=>{
      const data=JSON.parse(event.data);
      if(data.type==='sync_state'){
        setRoom(r=>({...r,videoId:data.videoId,isPlaying:data.isPlaying,currentTime:data.currentTime}));
        if(playerRef.current && playerRef.current.getVideoData?.().video_id !== data.videoId) playerRef.current.loadVideoById(data.videoId, data.currentTime || 0);
        else if(playerRef.current){
          const diff=Math.abs((playerRef.current.getCurrentTime?.()||0)-(data.currentTime||0));
          if(diff>1.5) { playerRef.current.seekTo(data.currentTime||0,true); lastPlayerTimeRef.current=data.currentTime||0; }
          if(data.isPlaying) playerRef.current.playVideo(); else playerRef.current.pauseVideo();
        }
      }
      if(data.type==='participants_updated') setParticipants(data.participants);
      if(data.type==='participant_removed' && data.userId===meRef.current?.userId){ setMessage('You were removed from this room.'); setRoom(null); setMe(null); }
      if(data.type==='error') setMessage(data.message);
      if(data.type==='control_request') setRequests(r=>[...r,{...data,id:Date.now()}]);
    };
    socket.onopen=()=>setMessage('Connected to watch party.');
    socket.onerror=()=>setMessage('WebSocket connection error. Check that the backend is running.');
    socket.onclose=()=>{};
    return ()=>{socket.close();};
  },[room?.roomCode,me?.userId]);

  useEffect(()=>{
    if(!room) return;
    const load=()=>{
      if(!window.YT || !window.YT.Player) return;
      if(playerRef.current?.destroy) { try{playerRef.current.destroy();}catch{} }
      playerRef.current=new window.YT.Player('youtube-player',{
        height:'100%',width:'100%',videoId:room.videoId,
        playerVars:{playsinline:1,rel:0},
        events:{onReady:(e)=>{ if(roomRef.current?.isPlaying)e.target.playVideo(); },
          onStateChange:(e)=>{ if(!canControl)return; if(e.data===1)send({type:'play'}); if(e.data===2)send({type:'pause'}); }}
      });
    };
    if(window.YT?.Player) load();
    else {
      const old=window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady=()=>{old?.();load();};
      if(!document.querySelector('script[data-yt-api]')){const s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';s.dataset.ytApi='1';document.head.appendChild(s);}
    }
    return ()=>{try{playerRef.current?.destroy?.();}catch{} playerRef.current=null;};
  },[room?.roomCode]);

  useEffect(()=>{
    if(!room || !canControl) return;
    const timer=setInterval(()=>{
      if(!playerRef.current?.getCurrentTime) return;
      const now=playerRef.current.getCurrentTime();
      const previous=lastPlayerTimeRef.current;
      // Detect manual scrubbing in the YouTube controls and broadcast it.
      if(previous>0 && Math.abs(now-previous)>2.5) send({type:'seek',time:now});
      else send({type:'time_update',time:now});
      lastPlayerTimeRef.current=now;
    },1000);
    return ()=>clearInterval(timer);
  },[room?.roomCode,canControl]);

  function send(payload){if(wsRef.current?.readyState===WebSocket.OPEN)wsRef.current.send(JSON.stringify(payload));}
  async function createRoom(){
    if(!username.trim())return setMessage('Enter your name first.');
    try{const r=await fetch(`${API}/api/rooms`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username})});const d=await r.json();if(!r.ok)throw Error(d.detail||'Could not create room');enter(d);}
    catch(e){setMessage(e.message);}
  }
  async function joinRoom(){
    if(!username.trim()||!roomCode.trim())return setMessage('Enter your name and room code.');
    try{const r=await fetch(`${API}/api/rooms/${roomCode.trim().toUpperCase()}/join`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username})});const d=await r.json();if(!r.ok)throw Error(d.detail||'Could not join room');enter(d);}
    catch(e){setMessage(e.message);}
  }
  async function enter(data){
    const r=await fetch(`${API}/api/rooms/${data.roomCode}`);const state=await r.json();
    setMe(data);setRoom({...state,roomCode:data.roomCode});setRoomCode(data.roomCode);setParticipants(state.participants||[]);setMessage('Opening your watch party…');
  }
  function changeVideo(){
    const id=extractVideoId(videoInput);
    if(!id)return setMessage('Enter a valid YouTube URL or 11-character video ID.');
    send({type:'change_video',videoId:id});setVideoInput('');
  }
  function seek(e){send({type:'seek',time:Number(e.target.value)});}
  function leave(){wsRef.current?.close();setRoom(null);setMe(null);setParticipants([]);setRequests([]);}
  const host=me?.role==='Host';

  if(!room||!me) return <main className="landing"><div className="brand"><span className="brand-icon">▶</span> WatchTogether</div><section className="hero"><div className="eyebrow">YOUR PEOPLE. YOUR VIDEO. ONE ROOM.</div><h1>Watch together,<br/><em>wherever you are.</em></h1><p>Create a private room, invite your friends, and enjoy YouTube in perfect sync.</p><div className="join-card"><label>Your display name</label><input value={username} onChange={e=>setUsername(e.target.value)} placeholder="e.g. Alex" maxLength="40"/><button className="primary" onClick={createRoom}>＋ Create a new room</button><div className="or"><span/>OR JOIN AN EXISTING ROOM<span/></div><div className="join-row"><input value={roomCode} onChange={e=>setRoomCode(e.target.value.toUpperCase())} placeholder="ENTER ROOM CODE" maxLength="12"/><button onClick={joinRoom}>Join room ↗</button></div></div><div className="status">{message}</div></section><footer>BUILT FOR SHARED MOMENTS · POWERED BY YOUTUBE</footer></main>;

  return <main className="app"><header className="topbar"><div className="brand"><span className="brand-icon">▶</span> WatchTogether</div><div className="room-pill">ROOM <b>{room.roomCode}</b><button title="Copy invite link" onClick={()=>{navigator.clipboard?.writeText(location.href);setMessage('Room link copied. Share it with friends.')}}>▢</button></div><button className="leave" onClick={leave}>Leave room</button></header>
    <div className="workspace"><section className="main-panel"><div className="room-heading"><div><div className="eyebrow">LIVE WATCH PARTY</div><h2>Movie night, together.</h2></div><span className="live"><i/> LIVE ROOM</span></div>
      <div className="player-wrap"><div id="youtube-player"></div></div>
      <div className="video-tools">{canControl?<><input value={videoInput} onChange={e=>setVideoInput(e.target.value)} placeholder="Paste a YouTube video URL…"/><button className="primary" onClick={changeVideo}>Load video</button></>:<span className="muted">Only Host and Moderators can change the video.</span>}</div>
      <div className="playback"><button disabled={!canControl} onClick={()=>send({type:'seek',time:Math.max(0,(playerRef.current?.getCurrentTime?.()||0)-10)})}>−10s</button><button className="play-button" disabled={!canControl} onClick={()=>send({type:room.isPlaying?'pause':'play'})}>{room.isPlaying?'Ⅱ':'▶'}</button><button disabled={!canControl} onClick={()=>send({type:'seek',time:(playerRef.current?.getCurrentTime?.()||0)+10})}>+10s</button><span>{canControl?'Playback controls enabled':'Watching as '+me.role}</span></div>
      <div className="notice">{message}</div>
      {requests.length>0&&host&&<div className="request-box"><b>Participant requests</b>{requests.map(r=><div key={r.id}>{r.username} requested: {r.action} <button onClick={()=>{send({type:'approve_request',request:r});setRequests(x=>x.filter(a=>a.id!==r.id));}}>Acknowledge</button></div>)}</div>}
    </section>
    <aside className="sidebar"><div className="side-title"><div><h3>In this room</h3><small>{participants.length} participant{participants.length===1?'':'s'}</small></div><span className="count">{participants.length}</span></div>
      <div className="people">{participants.map(p=><div className="person" key={p.userId}><div className="avatar">{p.username.slice(0,1).toUpperCase()}</div><div className="person-info"><b>{p.username}{p.userId===me.userId?' (You)':''}</b><small>{p.role}</small></div>{p.role==='Host'?<span className="crown">♛</span>:null}
      {host&&p.userId!==me.userId&&<div className="person-actions"><select value={p.role} onChange={e=>send({type:'assign_role',userId:p.userId,role:e.target.value})}><option>Participant</option><option>Moderator</option></select><button title="Remove participant" onClick={()=>send({type:'remove_participant',userId:p.userId})}>×</button></div>}</div>)}</div>
      <div className="role-note"><b>Your role: {me.role}</b><p>{canControl?'You can control playback for everyone.': 'You are in watch-only mode. Ask the Host for Moderator access.'}</p>{!canControl&&<button onClick={()=>send({type:'request_control',action:'Moderator access'})}>Request Moderator access</button>}</div>
      <button className="invite" onClick={()=>{navigator.clipboard?.writeText(`${location.origin}${location.pathname}?room=${room.roomCode}`);setMessage('Invite link copied! Share it with friends.')}}>＋ Copy invite link</button>
    </aside></div>
    <footer className="app-footer">WATCH TOGETHER · MAKE IT A MOMENT</footer>
  </main>;
}
