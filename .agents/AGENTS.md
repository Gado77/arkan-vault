# Arkan Vault & Hermes — Agent Guidelines

> **Welcome to the Arkan Vault project.**
> This file contains architectural context, codebase rules, and mandatory guidelines for AI agents working in this repository.

## 1. Project Overview

**Arkan Vault** is a persistent memory layer designed for AI agents (like Hermes). It is built with a backend (FastAPI/Python) and a web frontend (Next.js/TypeScript).

- **Backend (`backend/`)**: Provides the core `MemoryObject` API, persistent storage (SQLite/PostgreSQL + ChromaDB for vectors), file operations, and a background Knowledge Pipeline for embeddings.
- **Frontend (`web/`)**: A Next.js web application providing the Hermes voice interface. It uses WebSockets (`ws://`) to stream audio PCM to Gemini for live voice interactions, and features an `AudioCaptureEngine` with a background wake-word detector (`Hey Jarvis`).
- **Memory Gateway (`web/lib/arkan/`)**: The bridge between Hermes (Gemini Live) and the Arkan backend. Tools like `arkan_create`, `arkan_read`, `arkan_delete`, etc., are exposed here for Gemini to manage memory natively.

## 2. Hard Rules (Never Violate)

1. **DO NOT ALTER THE ARKAN BACKEND CRUD**: The backend memory CRUD (Create, Read, Update, Delete) is considered stable and heavily tested. Do not modify the core FastAPI routes or Services (`backend/services/`) unless explicitly requested by the user.
2. **Never commit secrets**: Do not put passwords, OAuth tokens, API keys, or any secrets in committed code. Use `.env.local` for local development.
3. **Use Zod for Validation**: Always validate inputs using Zod schemas on the web/frontend side.
4. **Test-Driven Changes**: Any changes to core behaviors (such as `memory-gateway.ts` or timeouts) must pass existing unit tests (`npm run test` or `vitest`).
5. **No `eval()` or implicit eval**: Avoid dynamic execution of strings.
6. **No "Placeholder" logic**: If implementing a feature, write the actual logic. Do not leave `// TODO: implement this later` unless instructed.

## 3. Project Structure Documentation Rule

- **Mandatory Update:** Whenever any modification is made to the structure of the project (such as creating new modules, renaming folders, adding services, or changing configuration layouts), you must immediately update the Hermes Agent documentation memory (ID: `mem_f5559dcb67ed428db62ad0bd6a2dc296`) inside the Arkan Vault to reflect these changes.
- **Rationale:** This ensures that if the user switches agents, any new agent will be able to read this memory and immediately understand the project structure without requiring manual explanation.

## 4. Web Frontend (Hermes Live) Architecture

- **`LiveVoiceView.tsx`**: The main interface for Hermes Voice. Contains the orb animation, mic controls, and drawer.
- **`use-gemini-live.ts`**: The core React Hook orchestrating the WebSocket connection to Gemini Live. It handles PCM streaming, function calling (tools), state machine (sleeping, listening, thinking, speaking), and idle timeouts (10s real idle).
- **Audio Engine (`lib/audio/`)**: Custom `AudioCaptureEngine` that manages microphone access, destinations, and seamless transitions between Wake Word detection (local PCM capturing) and Gemini streaming without dropping the mic.
- **Wake Word**: When the wake word is detected, `use-gemini-live.ts` instantly plays a synthesized chime via `Web Audio API` (zero latency) and connects to Gemini.

## 5. Development Commands

- **Backend**:
  - Start server: `cd backend && uvicorn api.main:app --reload --port 8000`
- **Web / Frontend**:
  - Start development server: `npm run dev` (Port 3000)
  - Run Hermes Local Proxy (Wake Word daemon + Next.js): `node scripts/start-hermes-local.mjs` (usually runs on port 20128).
  - Run unit tests: `npm run test` or `vitest`

## 6. Important Notes on "Memory"

- Arkan Vault uses the concept of **MemoryObject**.
- A memory object has: `id`, `type`, `title`, `content`, `project`, `tags`, `context`, etc.
- **Bootstrap Cache**: Hermes loads a basic contextual profile on boot (via `profile-base` and `profile-context` tags) so it always knows the user's name and essential preferences without performing active tool calls.

---
*Always consult this file and the `ARCHITECTURE.md` file before proposing major structural changes.*
