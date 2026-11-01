# YouTube Watch Party

A real-time YouTube watch-party MVP built with React + Vite, FastAPI, WebSockets and PostgreSQL.

## Features
- Create a room and join with a six-character room code
- Host / Moderator / Participant roles
- Host can promote participants to Moderator and remove participants
- YouTube video playback synchronization (play, pause, seek, change video)
- Server-side permission checks for privileged WebSocket events
- PostgreSQL persistence for rooms and members

## Requirements
- Python 3.10+
- Node.js 18+
- PostgreSQL 14+

## 1. Create the database
Create a PostgreSQL database named `watchparty`. Example using psql:
```sql
CREATE DATABASE watchparty;
```

## 2. Start the backend
```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate
pip install -r requirements.txt
```
Copy `.env.example` to `.env` and update `DATABASE_URL` with your PostgreSQL username/password.
```bash
uvicorn main:app --reload
```
Backend: http://localhost:8000  
API docs: http://localhost:8000/docs

## 3. Start the frontend
Open a second terminal:
```bash
cd frontend
npm install
```
Copy `.env.example` to `.env` (default API URL is localhost:8000), then:
```bash
npm run dev
```
Frontend: http://localhost:5173

## 4. Test with multiple users
1. Open the frontend in two separate browser windows (use an incognito window for the second user).
2. Create a room in the first window.
3. Join the same room code in the second window.
4. Test play, pause, seek and video change as Host.
5. Promote the second user to Moderator, then test controls.
6. Verify that a Participant cannot control playback.

Use a valid YouTube video URL or its 11-character video ID.

## Deployment on Render
Deploy backend and frontend as separate services.

### Backend Web Service
- Root Directory: `backend`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Add environment variable `DATABASE_URL` using your Render PostgreSQL **internal** connection string. Convert `postgres://` to `postgresql+psycopg://` if needed.
- Add `FRONTEND_ORIGIN` with your deployed frontend URL.

### Frontend Static Site
- Root Directory: `frontend`
- Build Command: `npm install && npm run build`
- Publish Directory: `dist`
- Add `VITE_API_URL` with your deployed backend URL, e.g. `https://your-api.onrender.com`.
- After changing frontend environment variables, trigger a new deploy.

Update the backend `FRONTEND_ORIGIN` to the deployed frontend URL and redeploy the backend.

## Architecture
React communicates with FastAPI over HTTP for room creation/joining and over WebSockets for live room events. FastAPI checks the member's role from PostgreSQL before processing playback, role assignment or removal events. The room's video ID and playback state are stored in PostgreSQL. WebSocket broadcasts update all connected clients.

## Current MVP limitations
- Active WebSocket connections are stored in process memory; this MVP is intended for a single backend instance. Redis Pub/Sub is needed for multi-instance scaling.
- Room member records persist; disconnecting does not automatically delete a member.
- There is no login system; a room code plus generated member ID is used for this prototype.
- Participant control requests are broadcast to the Host; approval is an acknowledgement flow, not a queued command execution workflow.
- A YouTube video may restrict embedding; use videos that permit embedding.
- Test on two browsers before sharing the live URL.
