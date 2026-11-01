import os, re, secrets, string
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import select
from database import Base, engine, get_db, SessionLocal
from models import Room, Member

Base.metadata.create_all(bind=engine)
app = FastAPI(title="YouTube Watch Party API", version="1.0.0")
origins = [x.strip() for x in os.getenv("FRONTEND_ORIGIN", "http://localhost:5173").split(",")]
app.add_middleware(CORSMiddleware, allow_origins=origins + ["http://127.0.0.1:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

class CreateRoom(BaseModel):
    username: str = Field(min_length=1, max_length=40)

class JoinRoom(BaseModel):
    username: str = Field(min_length=1, max_length=40)

class ConnectionManager:
    def __init__(self):
        self.rooms: dict[str, list[WebSocket]] = {}
    async def connect(self, code, ws):
        await ws.accept()
        self.rooms.setdefault(code, []).append(ws)
    def disconnect(self, code, ws):
        if code in self.rooms and ws in self.rooms[code]:
            self.rooms[code].remove(ws)
            if not self.rooms[code]:
                del self.rooms[code]
    async def broadcast(self, code, message):
        for ws in list(self.rooms.get(code, [])):
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect(code, ws)

manager = ConnectionManager()

def make_code():
    return "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))

def member_payload(m):
    return {"userId": m.id, "username": m.username, "role": m.role}

def room_state(db, room):
    members = db.scalars(select(Member).where(Member.room_id == room.id)).all()
    return {"type": "sync_state", "videoId": room.video_id, "isPlaying": room.is_playing,
            "currentTime": room.current_time, "participants": [member_payload(m) for m in members]}

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/api/rooms")
def create_room(payload: CreateRoom, db: Session = Depends(get_db)):
    code = make_code()
    while db.scalar(select(Room).where(Room.code == code)):
        code = make_code()
    room = Room(code=code)
    db.add(room); db.flush()
    host = Member(room_id=room.id, username=payload.username.strip(), role="Host")
    db.add(host); db.commit(); db.refresh(room); db.refresh(host)
    return {"roomCode": room.code, "userId": host.id, "role": host.role, "username": host.username}

@app.post("/api/rooms/{code}/join")
def join_room(code: str, payload: JoinRoom, db: Session = Depends(get_db)):
    room = db.scalar(select(Room).where(Room.code == code.upper()))
    if not room:
        raise HTTPException(404, "Room not found")
    username = payload.username.strip()
    if not username:
        raise HTTPException(400, "Username is required")
    member = Member(room_id=room.id, username=username, role="Participant")
    db.add(member); db.commit(); db.refresh(member)
    return {"roomCode": room.code, "userId": member.id, "role": member.role, "username": member.username}

@app.get("/api/rooms/{code}")
def get_room(code: str, db: Session = Depends(get_db)):
    room = db.scalar(select(Room).where(Room.code == code.upper()))
    if not room: raise HTTPException(404, "Room not found")
    return room_state(db, room)

@app.websocket("/ws/{code}")
async def websocket_endpoint(ws: WebSocket, code: str, user_id: str):
    db = SessionLocal()
    room = db.scalar(select(Room).where(Room.code == code.upper()))
    member = db.get(Member, user_id)
    if not room or not member or member.room_id != room.id:
        await ws.close(code=1008); db.close(); return
    await manager.connect(code.upper(), ws)
    await ws.send_json(room_state(db, room))
    await manager.broadcast(code.upper(), {"type":"participants_updated", "participants":[member_payload(m) for m in db.scalars(select(Member).where(Member.room_id == room.id)).all()]})
    try:
        while True:
            data = await ws.receive_json()
            event = data.get("type")
            # Refresh membership/role from DB for every privileged action.
            member = db.get(Member, user_id)
            if not member: 
                await ws.send_json({"type":"error","message":"You are no longer in this room."}); continue
            role = member.role
            if event in ("play", "pause", "seek", "change_video"):
                if role not in ("Host", "Moderator"):
                    await ws.send_json({"type":"error","message":"Only the Host or Moderator can control playback."}); continue
                if event == "play": room.is_playing = True
                elif event == "pause": room.is_playing = False
                elif event == "seek": room.current_time = max(0, float(data.get("time", 0)))
                elif event == "change_video":
                    video_id = str(data.get("videoId", ""))
                    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
                        await ws.send_json({"type":"error","message":"Please provide a valid 11-character YouTube video ID."}); continue
                    room.video_id = video_id; room.current_time = 0; room.is_playing = False
                db.commit()
                await manager.broadcast(code.upper(), {"type":"sync_state","videoId":room.video_id,"isPlaying":room.is_playing,"currentTime":room.current_time})
            elif event == "time_update":
                if role in ("Host", "Moderator"):
                    room.current_time = max(0, float(data.get("time", 0))); db.commit()
            elif event == "assign_role":
                if role != "Host":
                    await ws.send_json({"type":"error","message":"Only the Host can assign roles."}); continue
                target = db.get(Member, str(data.get("userId", "")))
                new_role = data.get("role")
                if not target or target.room_id != room.id or target.role == "Host" or new_role not in ("Participant", "Moderator"):
                    await ws.send_json({"type":"error","message":"Invalid role assignment."}); continue
                target.role = new_role; db.commit()
                members = [member_payload(m) for m in db.scalars(select(Member).where(Member.room_id == room.id)).all()]
                await manager.broadcast(code.upper(), {"type":"participants_updated","participants":members})
            elif event == "remove_participant":
                if role != "Host":
                    await ws.send_json({"type":"error","message":"Only the Host can remove participants."}); continue
                target = db.get(Member, str(data.get("userId", "")))
                if not target or target.room_id != room.id or target.role == "Host": continue
                removed_id = target.id
                db.delete(target); db.commit()
                await manager.broadcast(code.upper(), {"type":"participant_removed","userId":removed_id})
                members = [member_payload(m) for m in db.scalars(select(Member).where(Member.room_id == room.id)).all()]
                await manager.broadcast(code.upper(), {"type":"participants_updated","participants":members})
            elif event == "request_control":
                if role == "Participant":
                    await manager.broadcast(code.upper(), {"type":"control_request","userId":user_id,"username":member.username,"action":str(data.get("action",""))})
            elif event == "approve_request":
                if role == "Host":
                    await manager.broadcast(code.upper(), {"type":"request_approved","request":data.get("request")})
    except WebSocketDisconnect:
        manager.disconnect(code.upper(), ws)
        member = db.get(Member, user_id)
        if member:
            members = [member_payload(m) for m in db.scalars(select(Member).where(Member.room_id == room.id)).all()]
            await manager.broadcast(code.upper(), {"type":"participants_updated","participants":members})
    finally:
        db.close()
