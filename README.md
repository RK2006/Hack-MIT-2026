# Context Graph MVP

A local, versioned project knowledge graph that compiles task-relevant context for humans and coding agents.

## Prerequisites

- Node.js 20+
- npm
- Docker with Compose

## Foundation setup

```bash
npm install
docker compose up -d --wait postgres
export DATABASE_URL='postgresql://context_graph:context_graph_local@127.0.0.1:5432/context_graph'
export TEST_DATABASE_URL="$DATABASE_URL"
npm run db:migrate
```

The Compose password is for loopback-only local development. Copy `.env.example`
for other environments and never commit real credentials.

## Verification

```bash
npm test
npm run test:integration
npm run typecheck
npm run lint
npm run format:check
npm run context:smoke
```

Integration tests use a real PostgreSQL database and create a unique schema per
test. They drop only those test-owned schemas. The smoke command creates labeled
synthetic data; it does not reset or delete existing projects.

## Import the demo project

With `DATABASE_URL` configured and migrations applied:

```bash
npm run import:demo
```

The command imports the fixed, clearly labeled synthetic payments manifest once.
Running it again returns a conflict and never overwrites reviewed project context.
