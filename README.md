# Hono + Prisma + BullMQ

A teaching project for the **Devscale AI Product Engineering program**. Build an asynchronous travel recommendation API with Hono, PostgreSQL, Prisma Next, Redis, and BullMQ.

A client submits a destination and budget. The API saves the request and returns immediately; a separate worker calls an AI model and stores the suggestions for the client to retrieve later.

## What you will learn

- Create HTTP routes with Hono and validate request bodies with Zod.
- Define database models and query PostgreSQL through Prisma Next.
- Separate HTTP request handling from slow AI work using BullMQ.
- Run an API and a worker as separate processes connected through Redis.
- Generate structured AI output and persist it in the database.
- Understand the difference between accepting a job and completing it.

## Request flow

```text
Client                         API                         Worker
  |                             |                             |
  |-- POST /jobs --------------->|                             |
  |                             |-- Save PENDING job in PostgreSQL
  |                             |-- Enqueue job in Redis ---->|
  |<-- 202 Accepted + job ID ----|                             |
  |                             |                    Load job from PostgreSQL
  |                             |                    Generate AI suggestions
  |                             |                    Save JobResult records
  |                             |                    Set job to COMPLETED
  |-- GET /jobs/:id ------------>|                             |
  |<-- Saved suggestions -------|                             |
```

The queue is named `ai-tenerary-queue`, and each submitted task is named `generate-destination`. The API and worker must use the same queue name and Redis connection.

## Stack

| Tool | Role |
| --- | --- |
| Hono + Node.js | HTTP server on port `3000` |
| Zod | Request validation and AI output schema |
| Prisma Next | Typed database queries and generated data contracts |
| PostgreSQL 16 | Stores jobs and generated suggestions |
| BullMQ + Redis 7 | Background job queue |
| Anvia + OpenAI-compatible provider | Structured AI generation |
| TypeScript + tsx | Development runtime |
| pnpm + Docker Compose | Dependencies and local services |

This repository uses **Prisma Next prerelease packages** and the contract-based API (`db.orm.public.Job`). Use the versions in the lockfile and the commands below; standard Prisma Client tutorials may use different APIs.

## Getting started

### 1. Install prerequisites and dependencies

You need Node.js **22.18 or newer**, pnpm (this project was inspected with `11.22.0`), Docker with Docker Compose, and an API key for an OpenAI-compatible provider.

```bash
git clone git@github.com:Devscale-Indonesia/hono-prisma-bullmq.git
cd hono-prisma-bullmq
pnpm install --frozen-lockfile
cp .env.example .env
```

### 2. Configure the environment

Edit `.env`:

```dotenv
DATABASE_URL="postgresql://hono:hono@localhost:55432/hono"
OPENAI_API_KEY="your-api-key"
# Optional: set this when using a custom OpenAI-compatible provider.
# OPENAI_BASE_URL="https://your-provider.example/v1"
```

The database URL matches the credentials and host port in `docker-compose.yml`. Redis is configured directly in [`src/worker/config.ts`](src/worker/config.ts) as `localhost:6380`; there is no Redis environment variable in the current implementation.

The model defaults to `gpt-5.6-luna` in [`src/llm/models.ts`](src/llm/models.ts). Ensure your configured provider supports that model, or change the default model ID in that file to one your provider supports. The app does not currently read a model ID from the environment.

Keep real credentials in `.env`, which is excluded from Git.

### 3. Start PostgreSQL and Redis

```bash
docker compose up -d
docker compose ps
```

| Service | Host address | Container port |
| --- | --- | --- |
| PostgreSQL | `localhost:55432` | `5432` |
| Redis | `localhost:6380` | `6379` |

The API and worker run on your host machine. Docker Compose starts only the database and Redis.

### 4. Generate the contract and initialize the database

```bash
pnpm contract:emit
pnpm exec prisma db init
pnpm exec prisma db verify
```

The schema lives in [`prisma/schema.prisma`](prisma/schema.prisma). Contract generation writes the runtime metadata and TypeScript types to `src/generated/prisma/`, as configured in `prisma.config.ts`. Database initialization creates the missing schema structures and signs the database with the contract.

After editing the schema during a lesson:

```bash
pnpm contract:emit
pnpm exec prisma db update --dry-run
pnpm exec prisma db update
```

Review the preview before applying schema changes to a database containing data you want to keep.

### 5. Run the API and worker

In one terminal:

```bash
pnpm dev
```

In another terminal:

```bash
pnpm worker:dev
```

The API listens at `http://localhost:3000`. Try `/jobs`; there is no route at `/`. Keep both processes running to complete jobs.

## Try the API

### Submit a job

```bash
curl -i -X POST http://localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"destination":"Bali, Indonesia","budget":"IDR 2,000,000"}'
```

A successful request returns **202 Accepted** with a `job` object containing `id`, `destination`, `budget`, `status: "PENDING"`, and `createdAt`. Copy the job ID for the next request.

Both input fields must be strings of at most 255 characters. Include a currency in the budget for a clearer AI prompt. Invalid bodies return a validation error. Empty strings currently pass HTTP validation but are rejected by the worker.

### List jobs and check status

```bash
curl http://localhost:3000/jobs
```

Response shape: `{ "jobs": [...] }`. A successfully processed job changes from `PENDING` to `COMPLETED`.

### Retrieve generated suggestions

```bash
curl http://localhost:3000/jobs/YOUR_JOB_ID
```

Response shape:

```json
{
  "jobId": "YOUR_JOB_ID",
  "destinationList": [
    {
      "id": "RESULT_ID",
      "name": "Example destination",
      "description": "An AI-generated description",
      "location": "Bali, Indonesia",
      "jobId": "YOUR_JOB_ID"
    }
  ]
}
```

The prompt asks for two suggestions, although the output schema does not enforce an exact count. The endpoint returns an empty `destinationList` when no results exist yet, including for an unknown job ID. It does not return job status; use `GET /jobs` to inspect status.

## Code walkthrough

| File | Read it to understand |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Server startup and route registration |
| [`src/modules/job/router.ts`](src/modules/job/router.ts) | Validation, database queries, and queue submission |
| [`src/modules/job/schema.ts`](src/modules/job/schema.ts) | Accepted request body |
| [`src/worker/queue.ts`](src/worker/queue.ts) | Queue producer |
| [`src/worker/config.ts`](src/worker/config.ts) | Shared queue name and Redis connection |
| [`src/worker/worker.ts`](src/worker/worker.ts) | Job processing, result persistence, and status update |
| [`src/modules/job/service.ts`](src/modules/job/service.ts) | AI prompt and structured output schema |
| [`src/llm/models.ts`](src/llm/models.ts) | Provider credentials, base URL, and model selection |
| [`src/utils/db.ts`](src/utils/db.ts) | Database client used by the application |
| [`prisma/schema.prisma`](prisma/schema.prisma) | `Job` and `JobResult` models |

`Job` stores the request and its status. `JobResult` stores each suggestion with a `jobId` string. The schema does not currently declare a relation or foreign key between these models.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the API with file watching |
| `pnpm worker:dev` | Run the worker with file watching |
| `pnpm contract:emit` | Regenerate the Prisma data contract |
| `pnpm exec prisma db verify` | Check the database against the contract |
| `pnpm exec tsc --noEmit` | Check TypeScript without emitting files |
| `pnpm build` | Attempt TypeScript compilation; see limitation below |
| `pnpm start` | Run `dist/index.js` after a working build |
| `docker compose stop` | Stop local services while retaining their volumes |

**Current build limitation:** the TypeScript configuration includes `prisma.config.ts` and `prisma/db.ts` outside its `src` root directory, so type checking and compilation currently report `TS6059`. Compiled Node execution also needs compatible module resolution for the source's extensionless imports. Use the `tsx` development commands for lessons; the build/start workflow needs follow-up work. There is no automated test script or compiled worker start script yet.

## Troubleshooting

- **Database connection fails:** check `docker compose ps` and ensure `DATABASE_URL` uses host port `55432` and the Compose credentials.
- **Tables are missing or the contract does not match:** regenerate the contract, initialize a fresh database or update an existing one, then run `pnpm exec prisma db verify`.
- **Redis connection fails:** ensure Redis is running on host port `6380`, matching `src/worker/config.ts`.
- **Jobs remain `PENDING`:** check that the worker is running and inspect its terminal output. AI or persistence failures do not currently update the database status to `FAILED`.
- **The provider rejects the request:** check the API key, optional base URL, and model ID in `src/llm/models.ts`.

## Classroom exercises

1. Start only the API, submit a job, and observe its `PENDING` status. Start the worker and explain why the original HTTP request does not need to remain open.
2. Require non-empty destination and budget values, then test missing, empty, and overlong inputs.
3. Add `PROCESSING` and `FAILED` states, plus a status endpoint that distinguishes a missing job from one still running.
4. Configure retries and backoff. Make result writes idempotent so a retry cannot create duplicate suggestions.
5. Add a database relation between jobs and results, and save results plus the completion status in a transaction.
6. Consider what happens if the database insert succeeds but enqueueing fails. Explore an outbox approach for reliable submission.
7. Add pagination, authentication, and tests before expanding the demo into a deployed application.

This teaching app focuses on the core workflow. It currently has no authentication, explicit retry policy, or transaction spanning result creation and status updates.
