# SupplyRestore architecture

## System overview

```text
Next.js operator dashboard
          │ HTTP / polling
          ▼
FastAPI backend ── SQLite (accounts, warehouses, inventory, history)
     │
     ├── simulator: inventory, shipments, routes, vendors, disruptions
     ├── deterministic optimizer: feasibility and contract scoring
     ├── supplier learner: outcome history and reward-based ranking
     └── Groq LLM agent: tool-driven action choice and replan
```

## Recovery workflow

```text
Recovery contract / goal
  → monitor inventory and shipments
  → detect a shortage or violated constraint
  → investigate inventory, vendors, and route state
  → compare feasible options with the optimizer
  → supplier learner ranks eligible suppliers
  → LLM selects an approved action via a typed tool
  → execute simulated transfer or purchase order
  → verify inventory and delivery effect
  → if an action fails, re-investigate and replan
  → verify the contract and save the result
```

## Decision responsibilities

| Component | Responsibility |
| --- | --- |
| Recovery contract | Operator-defined fulfilment, cost, carbon, delay, route, and vendor guardrails. |
| Deterministic optimizer | Rejects unsafe options and compares feasible actions. |
| Supplier learner | Ranks safe suppliers from simulated delivery history and rewards. |
| Groq LLM | Investigates through tools, chooses between approved options, executes actions, and replans. |
| Verification tool | Checks post-action inventory/delivery state and can invalidate a chosen plan. |

The LLM does not bypass the optimizer or recovery contract. This keeps the agentic workflow explainable while still allowing autonomous investigation, execution, verification, and adaptation.

## Supplier learning

Each supplier retains simulated outcome history: success/failure, on-time result, actual delivery time, cost, and carbon. After a purchase, the learner updates a reward: successful and on-time delivery produces a positive reward; failure, lateness, high cost, and high carbon reduce it. The next safe supplier comparison uses this learnt signal with the contract-normalized optimizer score. The LLM remains responsible for the final tool-driven action and receives the learner recommendation as context.

## Persistence boundary

SQLite persists user accounts, password hashes, warehouses, SKU-100 inventory values, and recovery history. The active logistics scenario, route events, live run state, and learner session are held in backend memory for the hackathon simulation; restarting the backend resets that live state.

## API groups

| Group | Purpose |
| --- | --- |
| `/auth/*` | Sign-up, login, and session identity. |
| `/warehouses/*` | Create, update, and delete warehouse details and inventory. |
| `/history/*` | Retrieve saved recovery outcomes. |
| `/state`, `/reset` | Read or reset the simulated network. |
| `/contracts`, `/runs` | Submit a recovery goal and observe the active workflow. |
| `/runs/{id}/certificate` | Read the final verification result. |
