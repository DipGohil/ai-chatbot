import os

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from cache import redis_client
from database import SessionLocal
from models import ChatHistory, Conversation, Session

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "ollama")
OLLAMA_PORT = os.getenv("OLLAMA_PORT", "11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "phi3:mini")
OLLAMA_TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT", "600"))
MAX_MESSAGE_CHARS = int(os.getenv("MAX_MESSAGE_CHARS", "800"))
MAX_HISTORY_CHARS = int(os.getenv("MAX_HISTORY_CHARS", "4000"))
OLLAMA_BASE_URL = f"http://{OLLAMA_HOST}:{OLLAMA_PORT}"

app = FastAPI(title="AI Chatbot Platform")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    session_id: str
    prompt: str


def build_prompt(messages, prompt: str) -> str:
    lines = []
    for msg in messages:
        text = (msg.message or "")[:MAX_MESSAGE_CHARS]
        lines.append(f"{msg.role}: {text}")
    lines.append(f"user: {prompt[:MAX_MESSAGE_CHARS]}")
    history = "\n".join(lines)
    if len(history) > MAX_HISTORY_CHARS:
        history = history[-MAX_HISTORY_CHARS:]
    return history

@app.get("/")
def home():
    return {
        "message": "AI Chatbot Platform API is running",
        "status": "ok",
    }

@app.get("/models")
def models():

    response = requests.get(f"{OLLAMA_BASE_URL}/api/tags")

    return response.json()

@app.post("/chat")
def chat(data: ChatRequest):

    # Check Redis Cache
    cache_key = (
        f"{data.session_id}:"
        f"{data.prompt}"
    )

    cached_answer = redis_client.get(cache_key)

    if cached_answer:
        return {
            "source": "redis",
            "answer": cached_answer
        }

    db = SessionLocal()

    try:
        existing_session = (
            db.query(Session)
            .filter(
                Session.session_id == data.session_id
            )
            .first()
        )

        if not existing_session:
            db.add(
                Session(
                    session_id=data.session_id,
                    title=data.prompt[:50]
                )
            )

        messages = (
            db.query(Conversation)
            .filter(
                Conversation.session_id == data.session_id
            )
            .order_by(
                Conversation.id.desc()
            )
            .limit(10)
            .all()
        )

        messages.reverse()
        history = build_prompt(messages, data.prompt)

        db.add(
            Conversation(
                session_id=data.session_id,
                role="user",
                message=data.prompt
            )
        )

        try:
            response = requests.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": history,
                    "stream": False,
                    "options": {
                        "num_predict": 512,
                    },
                },
                timeout=OLLAMA_TIMEOUT,
            )
            response.raise_for_status()
        except requests.Timeout as exc:
            db.rollback()
            raise HTTPException(
                status_code=504,
                detail=(
                    "Ollama took too long to respond. "
                    "Try a shorter message or start a new chat."
                ),
            ) from exc
        except requests.RequestException as exc:
            db.rollback()
            raise HTTPException(
                status_code=502,
                detail=f"Ollama request failed: {exc}",
            ) from exc

        result = response.json()
        answer = result.get("response", "").strip()
        if not answer:
            db.rollback()
            raise HTTPException(
                status_code=502,
                detail="Ollama returned an empty response.",
            )

        db.add(
            Conversation(
                session_id=data.session_id,
                role="assistant",
                message=answer
            )
        )

        redis_client.set(
            cache_key,
            answer,
            ex=3600
        )

        db.add(
            ChatHistory(
                question=data.prompt,
                answer=answer
            )
        )

        db.commit()

        return {
            "source": "ollama",
            "model": result.get("model", OLLAMA_MODEL),
            "answer": answer
        }
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Chat failed: {exc}",
        ) from exc
    finally:
        db.close()

@app.get("/history")
def history():

    db = SessionLocal()

    chats = db.query(ChatHistory).all()

    return [
        {
            "id": chat.id,
            "question": chat.question,
            "answer": chat.answer
        }
        for chat in chats
    ]

@app.get("/memory/{session_id}")
def memory(session_id: str):

    db = SessionLocal()

    chats = (
        db.query(Conversation)
        .filter(Conversation.session_id == session_id)
        .order_by(Conversation.id.asc())
        .all()
    )

    return [
        {
            "role": chat.role,
            "message": chat.message
        }
        for chat in chats
    ]

@app.get("/sessions")
def sessions():

    db = SessionLocal()

    sessions = db.query(Session).order_by(Session.id.desc()).all()

    return [
        {
            "session_id": s.session_id,
            "title": s.title
        }
        for s in sessions
    ]

@app.delete("/session/{session_id}")
def delete_session(session_id: str):

    db = SessionLocal()

    db.query(
        Conversation
    ).filter(
        Conversation.session_id == session_id
    ).delete()

    db.query(
        Session
    ).filter(
        Session.session_id == session_id
    ).delete()

    db.commit()

    return {
        "message": f"{session_id} deleted"
    }
