# AI Developer Agent — Level 2

An AI-powered developer agent designed to understand software engineering tasks, analyze project files, create execution plans, use developer tools, test results, and verify completed work.

## 🚀 Overview

AI Developer Agent is a Level 2 autonomous software engineering system that follows a structured development workflow:

**UNDERSTAND → PLAN → EXECUTE → TEST → VERIFY**

The agent can work with uploaded software projects, inspect their structure, analyze files, execute development operations, and use AI providers to assist with software engineering tasks.

The project is designed as a developer-focused AI backend with a browser-based interface.

---

## ✨ Core Capabilities

- 📁 Upload complete project folders
- 📦 Upload ZIP-based projects
- 🔍 Analyze project structures and source files
- 🧠 Understand developer tasks using AI
- 📋 Generate structured execution plans
- ⚙️ Execute controlled developer tools
- 🧪 Run testing and verification workflows
- ✅ Verify execution results
- 🤖 Integrate AI model providers
- 🐙 GitHub-related project operations
- 🔎 Research capabilities
- 🗄️ PostgreSQL/Aiven database integration
- 🌐 Browser-based developer interface
- 🔐 Environment-based secret management

---

## 🔄 Agent Workflow

The agent follows a five-stage development lifecycle:

```text
┌──────────────┐
│  UNDERSTAND  │
└──────┬───────┘
       ↓
┌──────────────┐
│     PLAN     │
└──────┬───────┘
       ↓
┌──────────────┐
│   EXECUTE    │
└──────┬───────┘
       ↓
┌──────────────┐
│     TEST     │
└──────┬───────┘
       ↓
┌──────────────┐
│    VERIFY    │
└──────────────┘

---

## 🏗️ Architecture

```text
                    ┌─────────────────────┐
                    │   Browser Interface  │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │    Express Server   │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
        ┌───────────┐    ┌───────────┐    ┌───────────┐
        │   Agent   │    │   Tools   │    │ Providers │
        │   Engine  │    │  System   │    │  / AI     │
        └─────┬─────┘    └───────────┘    └─────┬─────┘
              │                                  │
              │                                  ▼
              │                           ┌─────────────┐
              │                           │  AI Models  │
              │                           └─────────────┘
              │
              ▼
       ┌────────────────┐
       │ Agent Workspace│
       │ & Project Files│
       └────────────────┘
              │
              ▼
       ┌────────────────┐
       │ PostgreSQL /   │
       │ Aiven Database │
       └────────────────┘
```

---

## 📁 Project Structure

```text
ai-agent-developer/
│
├── api/
│   └── index.js
│
├── src/
│   ├── routes/
│   │
│   ├── agent.ts
│   ├── app.js
│   ├── config.ts
│   ├── database-schema.sql
│   ├── database.ts
│   ├── github.ts
│   ├── index.html
│   ├── policy.ts
│   ├── providers.ts
│   ├── research.ts
│   ├── sandbox.ts
│   └── tools.ts
│
├── .env.example
├── .gitignore
├── Dockerfile
├── package.json
├── package-lock.json
├── tsconfig.json
├── vercel.json
└── README.md
```

---

## 🛠️ Tech Stack

- Node.js
- Express.js
- TypeScript
- JavaScript
- PostgreSQL
- Aiven PostgreSQL
- Multer
- Adm-Zip
- AI Model Providers
- GitHub Integration
- Vercel

---

## 🤖 AI Provider Architecture

The agent uses a provider-based architecture that allows AI services to be configured through environment variables.

API keys and credentials are not hardcoded into the application source code.

Provider configuration can be changed through environment variables without modifying the core agent architecture.

---

## 🔐 Environment Variables

Create a local `.env` file using `.env.example` as a reference.

Example:

```env
OPENROUTER_API_KEY=your_key_here
DATABASE_URL=your_database_url
```

Additional environment variables required by the application should also be configured locally.

### Security

Never commit `.env` to GitHub.

The project `.gitignore` excludes:

```text
.env
.env.*
node_modules/
.agent-workspace/
```

All API keys, database credentials, tokens, and other secrets must remain outside the source code.

---

## 💻 Local Development

### Install dependencies

```bash
npm install
```

### Configure environment variables

Create a `.env` file in the project root and configure the required credentials.

### Start development server

```bash
npm run dev
```

### Start production-style local server

```bash
npm start
```

The application runs locally at:

```text
http://localhost:3000
```

---

## 🧪 Type Checking

Run the TypeScript validation command:

```bash
npm run typecheck
```

This performs TypeScript checking without emitting compiled files.

---

## 📡 API Endpoints

The application provides endpoints for health checks, application status, workspace operations, tasks, uploads, and agent execution.

Important endpoints include:

```text
GET  /health
GET  /api/status
GET  /api/workspace
POST /api/agent/run
POST /api/tasks
```

---

## 📤 Project Upload

The agent supports complete project-folder uploads as well as ZIP uploads.

Folder uploads preserve the relative directory structure of the uploaded project.

Example:

```text
project/
├── package.json
├── src/
│   ├── App.js
│   └── utils/
│       └── helper.js
└── README.md
```

The directory hierarchy is preserved inside the agent workspace.

---

## ☁️ Vercel Deployment

The project includes a Vercel-compatible entry point:

```text
api/index.js
```

and Vercel configuration:

```text
vercel.json
```

The local Express server and Vercel serverless entry point are separated so the project can continue to run locally while exposing the Express application through the Vercel deployment environment.

### Deployment Requirements

Environment variables must be configured separately in the deployment platform.

Secrets should never be committed to the repository.

### Upload Consideration

Large project uploads may require a dedicated storage or client-upload architecture because serverless platforms can impose request-size and execution limits.

---

## 📊 Current Development Status

- [x] Express backend
- [x] Level 2 agent workflow
- [x] Project folder upload
- [x] ZIP project upload
- [x] Relative path preservation
- [x] Project workspace
- [x] Agent execution
- [x] Test and verification lifecycle
- [x] AI provider architecture
- [x] Environment-based configuration
- [x] PostgreSQL integration
- [x] GitHub integration
- [x] Vercel entry point
- [x] Vercel configuration
- [x] GitHub repository

---

## 🔮 Future Improvements

- Persistent per-user workspaces
- Improved automated testing
- Build and lint verification
- Advanced AI provider fallback
- Structured AI tool calling
- Persistent project storage
- Scalable large-file uploads
- Production monitoring and observability
- Additional developer integrations

---

## 🎯 Project Goal

The goal of AI Developer Agent is to move beyond simple AI chat and provide a structured software engineering workflow.

Instead of only generating responses, the agent is designed to:

```text
Understand
    ↓
Plan
    ↓
Execute
    ↓
Test
    ↓
Verify
```

This creates a foundation for an AI system capable of assisting developers with real software projects and structured engineering tasks.

---

## 📌 Project Status

**Version:** 2.0.0  
**Architecture:** Level 2 AI Developer Agent  
**Backend:** Node.js + Express  
**Database:** PostgreSQL / Aiven  
**Deployment:** Vercel-ready  

---

## 📄 License

No license has currently been specified for this project.