import os

import requests
from fastapi import FastAPI
from pydantic import BaseModel

from cache import redis_client
from database import SessionLocal
from models import ChatHistory, Conversation, Session

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "ollama")
OLLAMA_PORT = os.getenv("OLLAMA_PORT", "11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "phi3:mini")
OLLAMA_BASE_URL = f"http://{OLLAMA_HOST}:{OLLAMA_PORT}"

app = FastAPI()

class ChatRequest(BaseModel):
    session_id: str
    prompt: str

@app.get("/")
def home():
    return {"message": "Hell yeah! docker project is running bruhh"}

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

    # Database Session
    db = SessionLocal()

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

    # Load Previous Messages
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

    # Build Context
    history = ""

    for msg in messages:
        history += (
            f"{msg.role}: "
            f"{msg.message}\n"
        )

    history += f"user: {data.prompt}"
    
    # Save User Message
    db.add(
        Conversation(
            session_id=data.session_id,
            role="user",
            message=data.prompt
        )
    )

    # Call Ollama
    response = requests.post(
        f"{OLLAMA_BASE_URL}/api/generate",
        json={
            "model": OLLAMA_MODEL,
            "prompt": history,
            "stream": False,
        },
    )

    result = response.json()

    answer = result["response"]

    # Save Assistant Message
    db.add(
        Conversation(
            session_id=data.session_id,
            role="assistant",
            message=answer
        )
    )

    # Save Cache
    redis_client.set(
        cache_key,
        answer,
        ex=3600     # Cache expires after 1 hour
    )

    # Save Chat History
    chat = ChatHistory(
        question=data.prompt,
        answer=answer
    )

    db.add(chat)

    # Commit Everything
    db.commit()

    return {
        "source": "ollama",
        "model": result["model"],
        "answer": answer
    }

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

    chats = db.query(
        Conversation
    ).filter(
        Conversation.session_id == session_id
    ).all()

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

    sessions = db.query(
        Session
    ).all()

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
