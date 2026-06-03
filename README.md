# AI Chatbot

A Docker-based AI chatbot API built with FastAPI, PostgreSQL, Redis, and Ollama.

## Features

- Chat endpoint with session memory and Redis caching
- Conversation history and session management
- Ollama integration for local LLM inference

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- Git

## Quick Start

1. Clone the repository:

   ```bash
   git clone <your-repo-url>
   cd ai-chatbot
   ```

2. Create your local environment file:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and set your own values (especially `POSTGRES_PASSWORD`).

3. Start the stack:

   ```bash
   docker compose up --build
   ```

4. Pull the Ollama model (first run only):

   ```bash
   docker compose exec ollama ollama pull phi3:mini
   ```

5. Open the API:

   - Health check: http://localhost:8000/
   - API docs: http://localhost:8000/docs

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_USER` | PostgreSQL username | `admin` |
| `POSTGRES_PASSWORD` | PostgreSQL password | *(required)* |
| `POSTGRES_DB` | PostgreSQL database name | `chatdb` |
| `POSTGRES_HOST` | PostgreSQL host (Docker service name) | `postgres` |
| `POSTGRES_PORT` | PostgreSQL port | `5432` |
| `REDIS_HOST` | Redis host | `redis` |
| `REDIS_PORT` | Redis port | `6379` |
| `OLLAMA_HOST` | Ollama host | `ollama` |
| `OLLAMA_PORT` | Ollama port | `11434` |
| `OLLAMA_MODEL` | Default model name | `phi3:mini` |

> **Security note:** Never commit your `.env` file to Git. Only `.env.example` belongs in the repository.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check |
| `GET` | `/models` | List available Ollama models |
| `POST` | `/chat` | Send a chat message |
| `GET` | `/history` | Get all chat history |
| `GET` | `/memory/{session_id}` | Get conversation for a session |
| `GET` | `/sessions` | List all sessions |
| `DELETE` | `/session/{session_id}` | Delete a session |

## Project Structure

```
.
├── backend/
│   ├── app.py          # FastAPI application
│   ├── cache.py        # Redis client
│   ├── database.py     # PostgreSQL connection
│   ├── models.py       # SQLAlchemy models
│   ├── Dockerfile
│   └── requirements.txt
├── docker-compose.yml
├── .env.example
└── README.md
```

## Upload to GitHub

```bash
git init
git add .
git commit -m "Initial commit: AI chatbot with FastAPI and Docker"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

After cloning on another machine, always run `cp .env.example .env` and fill in your secrets locally.
