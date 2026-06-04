import os
import threading

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
MAX_MESSAGE_CHARS = int(os.getenv("MAX_MESSAGE_CHARS", "600"))
MAX_HISTORY_CHARS = int(os.getenv("MAX_HISTORY_CHARS", "3000"))
MAX_CONTEXT_MESSAGES = int(os.getenv("MAX_CONTEXT_MESSAGES", "6"))
MAX_NUM_PREDICT = int(os.getenv("MAX_NUM_PREDICT", "256"))
OLLAMA_BASE_URL = f"http://{OLLAMA_HOST}:{OLLAMA_PORT}"
OLLAMA_KEEP_ALIVE_ACTIVE = os.getenv("OLLAMA_KEEP_ALIVE_ACTIVE", "-1")

ollama_lock = threading.Lock()


def parse_keep_alive(value: str):
    if value == "-1":
        return -1
    if value.isdigit():
        return int(value)
    return value

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
    model: str | None = None


class ModelActivateRequest(BaseModel):
    model: str


def resolve_model(requested: str | None) -> str:
    if requested and requested.strip():
        return requested.strip()
    return OLLAMA_MODEL


def get_running_models() -> list[str]:
    try:
        response = requests.get(
            f"{OLLAMA_BASE_URL}/api/ps",
            timeout=15,
        )
        response.raise_for_status()
        data = response.json()
        names = []
        for item in data.get("models", []):
            name = item.get("name") or item.get("model")
            if name:
                names.append(name)
        return names
    except requests.RequestException:
        return []


def unload_model(model_name: str) -> None:
    response = requests.post(
        f"{OLLAMA_BASE_URL}/api/generate",
        json={"model": model_name, "keep_alive": 0},
        timeout=120,
    )
    response.raise_for_status()


def warmup_model(model_name: str) -> None:
    response = requests.post(
        f"{OLLAMA_BASE_URL}/api/generate",
        json={
            "model": model_name,
            "prompt": "hi",
            "stream": False,
            "keep_alive": parse_keep_alive(OLLAMA_KEEP_ALIVE_ACTIVE),
            "options": {"num_predict": 1},
        },
        timeout=OLLAMA_TIMEOUT,
    )
    response.raise_for_status()


def activate_ollama_model(model_name: str) -> dict:
    installed = {m["name"] for m in fetch_ollama_models()}
    if model_name not in installed:
        raise HTTPException(
            status_code=404,
            detail=f"Model '{model_name}' is not installed. Run: ollama pull {model_name}",
        )

    running = get_running_models()
    if model_name in running and len(running) == 1:
        return {
            "active": model_name,
            "unloaded": [],
            "running": running,
        }

    unloaded = []
    for loaded in running:
        if loaded != model_name:
            try:
                unload_model(loaded)
                unloaded.append(loaded)
            except requests.RequestException as exc:
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to unload '{loaded}': {exc}",
                ) from exc

    if model_name not in get_running_models():
        try:
            warmup_model(model_name)
        except requests.RequestException as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to load '{model_name}': {exc}",
            ) from exc

    running = get_running_models()
    return {
        "active": model_name,
        "unloaded": unloaded,
        "running": running,
    }


def ensure_model_ready(model_name: str) -> None:
    """Keep only the requested model loaded before inference."""
    running = get_running_models()
    if model_name in running:
        for other in running:
            if other != model_name:
                unload_model(other)
        return

    activate_ollama_model(model_name)


def fetch_ollama_models() -> list[dict]:
    response = requests.get(
        f"{OLLAMA_BASE_URL}/api/tags",
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    return [
        {
            "name": item["name"],
            "size": item.get("size"),
            "modified_at": item.get("modified_at"),
        }
        for item in data.get("models", [])
    ]


def build_chat_messages(conversation_messages, prompt: str) -> list[dict]:
    ollama_messages = []
    total_chars = 0

    for msg in conversation_messages:
        content = (msg.message or "")[:MAX_MESSAGE_CHARS]
        entry = {"role": msg.role, "content": content}
        total_chars += len(content)
        if total_chars > MAX_HISTORY_CHARS:
            break
        ollama_messages.append(entry)

    ollama_messages.append(
        {"role": "user", "content": prompt[:MAX_MESSAGE_CHARS]}
    )
    return ollama_messages


def call_ollama_chat(model: str, messages: list[dict]) -> dict:
    response = requests.post(
        f"{OLLAMA_BASE_URL}/api/chat",
        json={
            "model": model,
            "messages": messages,
            "stream": False,
            "keep_alive": parse_keep_alive(OLLAMA_KEEP_ALIVE_ACTIVE),
            "options": {
                "num_predict": MAX_NUM_PREDICT,
                "temperature": 0.7,
            },
        },
        timeout=OLLAMA_TIMEOUT,
    )
    response.raise_for_status()
    return response.json()

@app.get("/")
def home():
    return {
        "message": "AI Chatbot Platform API is running",
        "status": "ok",
    }

@app.get("/models")
def models():
    try:
        model_list = fetch_ollama_models()
        running = get_running_models()
        active = running[0] if running else None
        return {
            "models": model_list,
            "default": OLLAMA_MODEL,
            "count": len(model_list),
            "active": active,
            "running": running,
        }
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to list Ollama models: {exc}",
        ) from exc


@app.post("/models/activate")
def models_activate(data: ModelActivateRequest):
    model_name = data.model.strip()
    if not model_name:
        raise HTTPException(status_code=400, detail="Model name is required.")
    with ollama_lock:
        return activate_ollama_model(model_name)

@app.post("/chat")
def chat(data: ChatRequest):
    model = resolve_model(data.model)

    cache_key = f"{data.session_id}:{model}:{data.prompt}"

    cached_answer = redis_client.get(cache_key)

    if cached_answer:
        return {
            "source": "redis",
            "model": model,
            "answer": cached_answer,
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

        history_rows = (
            db.query(Conversation)
            .filter(
                Conversation.session_id == data.session_id
            )
            .order_by(
                Conversation.id.desc()
            )
            .limit(MAX_CONTEXT_MESSAGES)
            .all()
        )

        history_rows.reverse()
        ollama_messages = build_chat_messages(history_rows, data.prompt)

        db.add(
            Conversation(
                session_id=data.session_id,
                role="user",
                message=data.prompt
            )
        )

        try:
            with ollama_lock:
                ensure_model_ready(model)
                result = call_ollama_chat(model, ollama_messages)
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

        answer = (
            result.get("message", {}).get("content", "")
            or result.get("response", "")
        ).strip()
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
            "model": result.get("model", model),
            "answer": answer,
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
