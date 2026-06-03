# AI Chatbot Platform

A Dockerized multi-container AI chatbot with a ChatGPT-style web UI, FastAPI backend, Ollama LLM inference, PostgreSQL persistence, and Redis caching.

## Architecture

| Service    | Role                          | Port  |
|------------|-------------------------------|-------|
| Frontend   | Nginx + static UI (`/api` proxy)| 3000 |
| Backend    | FastAPI API layer             | 8000 |
| Ollama     | Local LLM inference           | 11434 |
| PostgreSQL | Persistent storage              | internal |
| Redis      | Response cache (1h TTL)       | internal |

## Features

- **AI Chat** — Send prompts; FastAPI forwards to Ollama (`phi3:mini` by default)
- **Conversation memory** — Last 10 messages per `session_id` used as context
- **Redis caching** — Instant replies for repeated `session_id:prompt` pairs
- **PostgreSQL** — Sessions, conversations, and chat history persist across restarts
- **Web UI** — Sidebar sessions, new chat, delete, message bubbles, loading state, mobile layout

## Quick Start

1. Clone and configure environment:

   ```bash
   git clone <your-repo-url>
   cd ai-chatbot
   cp .env.example .env
   ```

2. Start all services:

   ```bash
   docker compose up --build
   ```

3. Pull the Ollama model (first run only):

   ```bash
   docker compose exec ollama ollama pull phi3:mini
   ```

4. Open the app:

   - **Web UI:** http://localhost:3000
   - **API:** http://localhost:8000/docs

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_USER` | PostgreSQL username | `admin` |
| `POSTGRES_PASSWORD` | PostgreSQL password | *(required)* |
| `POSTGRES_DB` | Database name | `chatdb` |
| `POSTGRES_HOST` | Host (Docker service) | `postgres` |
| `POSTGRES_PORT` | Port | `5432` |
| `REDIS_HOST` | Redis host | `redis` |
| `REDIS_PORT` | Redis port | `6379` |
| `OLLAMA_HOST` | Ollama host | `ollama` |
| `OLLAMA_PORT` | Ollama port | `11434` |
| `OLLAMA_MODEL` | Default model | `phi3:mini` |

> Never commit `.env` to Git. Use `.env.example` as a template.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check |
| `GET` | `/models` | List Ollama models |
| `POST` | `/chat` | Send message (`session_id`, `prompt`) |
| `GET` | `/history` | All Q&A pairs |
| `GET` | `/memory/{session_id}` | Session messages |
| `GET` | `/sessions` | All sessions |
| `DELETE` | `/session/{session_id}` | Delete session |

The frontend calls these via `/api/*` (proxied to the backend by nginx).

## Project Structure

```
.
├── frontend/
│   ├── public/
│   │   ├── index.html
│   │   ├── css/styles.css
│   │   └── js/          # ES modules (api, store, ui, app)
│   ├── nginx.conf
│   └── Dockerfile
├── backend/
│   ├── app.py
│   ├── cache.py
│   ├── database.py
│   ├── models.py
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

## Local Frontend Development

Serve `frontend/public` with any static server and point API calls at the backend:

```html
<script>window.__API_BASE__ = "http://localhost:8000";</script>
```

Or use the Docker stack so `/api` proxies automatically.
