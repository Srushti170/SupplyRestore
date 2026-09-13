# SupplyRestore

SupplyRestore is a verification-first autonomous retail supply-chain recovery application. It monitors a logistics network, detects projected shortages, investigates warehouse and vendor alternatives, scores recovery options against an operator-defined contract, takes action, verifies the physical effect, and replans when conditions change.

The flagship scenario is repeatable: an inter-warehouse transfer initially wins, its route closes after dispatch, verification catches the failure and reconciles inventory, then the agent purchases from an eligible rapid vendor and issues a passed Recovery Certificate.

## Architecture

- `backend/`: FastAPI, Pydantic domain models, in-memory simulation, ten typed tools, deterministic optimizer, fake and Groq agent providers, and pytest coverage.
- `frontend/`: Next.js, React, TypeScript, Tailwind operator control room. It polls run state every 1.5 seconds.
- State is deliberately single-user and in-memory. `POST /reset` restores the fixed seed.

## Setup

Requirements: Python 3.12+ and Node.js 20.9+.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

cd ..\frontend
npm install
```

The website does not expose model-provider controls to operators. By default the backend uses its deterministic local agent so the application works without any external account. For live LLM operation, copy `backend/.env.example` to `backend/.env` and set `GROQ_API_KEY`; the server then selects the configured provider automatically. The pinned default is `qwen/qwen3.6-27b`. Override it with `GROQ_MODEL` if needed.

## Run

In two PowerShell terminals from the repository root:

```powershell
.\start-backend.ps1
```

```powershell
.\start-frontend.ps1
```

Open [http://localhost:3000](http://localhost:3000). API documentation is available at [http://localhost:8000/docs](http://localhost:8000/docs).

## Test and build

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q

cd ..\frontend
npm run build
```

## 60-second walkthrough

1. Open the control room and point out the Recovery Contract's hard limits.
2. Choose **Start recovery**.
3. Follow the live timeline through monitoring, shortage detection, route/vendor investigation, and the side-by-side optimizer comparison.
4. Show the transfer winning on cost and carbon, then the simulator closing its route mid-flight.
5. Show failed effect verification, the explicit replan, and the emergency purchase.
6. Finish on the green Recovery Certificate and its fulfilment, cost, carbon, and delay evidence.
7. Start another run to demonstrate that reset makes the workflow repeatable. When the server has a valid LLM API key, it automatically uses the live model without exposing infrastructure choices in the operator interface.

## API

- `POST /reset`
- `POST /contracts`
- `POST /runs`
- `GET /runs/{id}`
- `GET /runs/{id}/certificate`

Success is gated exclusively by a passed `verify_recovery_contract` result. An action response by itself can never mark a run verified.
