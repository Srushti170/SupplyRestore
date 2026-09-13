# SupplyRestore

SupplyRestore is a hackathon application for autonomous retail supply-chain recovery. It monitors a simulated network, detects shortages, investigates warehouse and supplier options, optimizes within an operator-defined recovery contract, executes a recovery action, verifies its outcome, and replans when a disruption invalidates the original choice.

## What it demonstrates

- Goal → decision → action → intermediate verification → adaptation → final outcome.
- Groq-powered LLM agent making approved action and replan decisions through typed tools.
- Deterministic optimizer enforcing cost, carbon, delay, fulfilment, route, and supplier constraints.
- Supplier learning: simulated delivery outcomes update supplier rewards and later recommendations.
- SQLite-backed account, warehouse, inventory, and recovery-history data.
- Live dashboard with recovery timeline, map, decision evolution, and final certificate.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the workflow and component design.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS, Leaflet |
| Backend | Python 3.12+, FastAPI, Pydantic, Uvicorn |
| Agent provider | Groq (default: `qwen/qwen3.6-27b`) |
| Storage | SQLite |
| Tests | pytest |

## Prerequisites

- Node.js 20.9 or newer
- Python 3.12 or newer
- A Groq API key for live LLM decisions (optional; the local deterministic provider can run without one)

## Local setup

From the repository root:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

cd ..\frontend
npm install
cd ..
```

## Environment configuration

Never commit your `.env` files or API key.

```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.local.example frontend\.env.local
```

```dotenv
# backend/.env
GROQ_API_KEY=your_private_groq_key
GROQ_MODEL=qwen/qwen3.6-27b
```

```dotenv
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Run locally

Open two PowerShell terminals at the repository root:

```powershell
.\start-backend.ps1
```

```powershell
.\start-frontend.ps1
```

Open `http://localhost:3000`. The API docs are at `http://localhost:8000/docs`.

## Test and build

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest

cd ..\frontend
npm run build
```

## Demo data

For a reliable replan demonstration, create warehouses in Kolkata, Delhi, and Nagpur. Choose Kolkata as destination, set its SKU-100 inventory to `4`, Delhi to `40`, Nagpur to `18`, and request `30` units. Set minimum fulfilment to `100%`, maximum cost to `$500`, maximum carbon to `100 kg`, and maximum delay to `8 h`. The transfer is disrupted and the agent replans to an eligible supplier.

## Repository layout

```text
backend/       FastAPI API, agent orchestration, optimizer, simulator, SQLite persistence, tests
frontend/      Next.js operator dashboard
start-backend.ps1
start-frontend.ps1
ARCHITECTURE.md
```

## Deployment note

For cloud deployment, configure `GROQ_API_KEY` and `NEXT_PUBLIC_API_URL` in the host environment, allow the deployed frontend URL in backend CORS, and use persistent storage if recovery history must survive server restarts.
