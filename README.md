# AI Study Guide API

Final assignment **Devscale AI Product Engineering**: API Hono yang menjalankan pipeline AI sungguhan secara asinkron.

Kirim sebuah **topik** (opsional: materi/catatan sendiri) → API langsung membalas `202` → worker BullMQ memanggil model lewat **anvia** dalam 3 langkah → hasil study guide (tujuan belajar, penjelasan konsep, kuis pilihan ganda) disimpan di PostgreSQL lewat **Prisma 8 (Prisma Next)**.

## Stack

| Tool | Peran |
| --- | --- |
| Hono + `@hono/node-server` | HTTP API (port `3000`) |
| Zod | Validasi request & skema output model |
| Prisma 8 (Prisma Next) + PostgreSQL 16 | Menyimpan job, status, dan hasil |
| BullMQ 6 + Redis 7 | Antrean job, retry + backoff |
| anvia (`@anvia/core`, `@anvia/openai`) | Panggilan model terstruktur di worker |

## Endpoint

| Endpoint | Fungsi | Response |
| --- | --- | --- |
| `POST /jobs` | Validasi input, simpan job `QUEUED`, enqueue ke BullMQ | `202` `{ id, status }` · `400` input salah · `503` Redis mati |
| `GET /jobs` | Semua job + status + hasil yang tersimpan (opsional `?status=COMPLETED`) | `200` `{ total, data: [...] }` |
| `GET /jobs/:id` | Status & hasil satu job | `200` job · `404` jika tidak ada |

Body `POST /jobs`:

```json
{
  "topic": "Big-O notation",          // wajib, 3-200 karakter
  "level": "beginner",                // beginner | intermediate | advanced (default beginner)
  "material": "teks artikel/catatan"  // opsional, 50-20.000 karakter
}
```

Bentuk satu job (dipakai di `GET /jobs` dan `GET /jobs/:id`):

```json
{
  "id": "uuid",
  "status": "COMPLETED",
  "step": "save",
  "input": { "topic": "Big-O notation", "level": "beginner", "hasMaterial": false },
  "attempts": 1,
  "error": null,
  "createdAt": "2026-10-05T00:11:13.985962Z",
  "finishedAt": "2026-10-05T00:11:46.218Z",
  "result": {
    "title": "...",
    "overview": "...",
    "objectives": ["..."],
    "concepts": [{ "name": "...", "explanation": "...", "example": "...", "commonMistake": "..." }],
    "quiz": [{ "question": "...", "options": ["A", "B", "C", "D"], "answerIndex": 2, "explanation": "..." }]
  }
}
```

`result` bernilai **`null`** selama job belum `COMPLETED` (termasuk saat `FAILED`).

## Alur pipeline

```text
POST /jobs ──► StudyJob (QUEUED) ──► Redis / BullMQ ──► worker
                                                        │
          status: PROCESSING                            ▼
          step:   outline  → cek topik bisa dipelajari, buat tujuan + daftar konsep
                  explain  → jelaskan tiap konsep + contoh + kesalahan umum
                  quiz     → buat soal pilihan ganda, buang soal yang jawabannya tidak valid
                  save     → simpan StudyGuide + set COMPLETED dalam satu transaksi
```

Status job: `QUEUED → PROCESSING → COMPLETED`, atau `RETRYING` (gagal sementara, akan dicoba lagi) → `FAILED`.

**Penanganan kegagalan**

- Setiap job punya `attempts: 3` dengan backoff eksponensial (5s, 10s).
- Error sementara (provider timeout, rate limit, output model tidak valid) → status `RETRYING`, lalu dicoba lagi.
- Topik yang tidak bisa dipelajari (mis. teks acak) ditolak oleh langkah `outline` dengan `UnrecoverableError` → langsung `FAILED` tanpa retry.
- Di percobaan terakhir → `FAILED`, `error` berisi pesannya, `step` menunjukkan langkah yang gagal.
- Kalau enqueue ke Redis gagal, job langsung ditandai `FAILED` dan API membalas `503` (tidak ada job "nyangkut" di `QUEUED`).

## Cara menjalankan

Butuh Node.js 22+, pnpm, Docker, dan API key provider OpenAI-compatible untuk anvia.

```bash
pnpm install
cp .env.example .env          # isi OPENAI_API_KEY (dan OPENAI_BASE_URL / OPENAI_MODEL bila perlu)

docker compose up -d --wait   # PostgreSQL :55432 + Redis :6380

pnpm contract:emit            # generate contract Prisma ke src/generated/prisma
pnpm db:init                  # buat tabel + tandatangani database
pnpm db:verify

pnpm dev                      # terminal 1: API  -> http://localhost:3000
pnpm worker:dev               # terminal 2: worker
```

Setelah mengubah `prisma/schema.prisma`: `pnpm contract:emit` lalu `pnpm db:update`.

> Prisma 8 membaca kolom `DateTime` sebagai `Temporal`. Node < 26.8 belum punya `Temporal` bawaan, jadi `src/utils/db.ts` memasang `temporal-polyfill` sebelum client dibuat.

## Demo alur lengkap

Bisa juga pakai [`requests.http`](requests.http) (ekstensi VS Code REST Client).

```bash
# 1. Mulai job
curl -i -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"topic":"Big-O notation and time complexity","level":"beginner"}'

# 2. Lihat semua job (status berubah QUEUED -> PROCESSING -> COMPLETED)
curl http://localhost:3000/jobs

# 3. Ambil hasil satu job
curl http://localhost:3000/jobs/<ID>

# 4. Job gagal: topik acak ditolak oleh langkah outline -> FAILED
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"topic":"qwxz jjkl ppfv zzrt","level":"beginner"}'

# 5. Hasil tetap ada setelah restart: matikan `pnpm dev` (Ctrl+C), jalankan lagi, lalu
curl http://localhost:3000/jobs/<ID>
```

## Struktur kode

| File | Isi |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Server Hono, logger, error handler, graceful shutdown |
| [`src/config/env.ts`](src/config/env.ts) | Validasi environment variable dengan Zod |
| [`src/modules/job/router.ts`](src/modules/job/router.ts) | Ketiga endpoint `/jobs` |
| [`src/modules/job/schema.ts`](src/modules/job/schema.ts) | Validasi body & query |
| [`src/modules/job/presenter.ts`](src/modules/job/presenter.ts) | Bentuk response job (`result: null` bila belum siap) |
| [`src/modules/job/service.ts`](src/modules/job/service.ts) | Pipeline AI 3 langkah (outline → explain → quiz) |
| [`src/modules/job/status.ts`](src/modules/job/status.ts) | Konstanta status dan langkah pipeline |
| [`src/worker/worker.ts`](src/worker/worker.ts) | Worker BullMQ: update status per langkah, retry, FAILED, transaksi simpan |
| [`src/worker/queue.ts`](src/worker/queue.ts) / [`config.ts`](src/worker/config.ts) | Queue, koneksi Redis, opsi retry |
| [`src/llm/models.ts`](src/llm/models.ts) | Client anvia OpenAI-compatible |
| [`src/utils/db.ts`](src/utils/db.ts) | Client Prisma Next + polyfill Temporal |
| [`prisma/schema.prisma`](prisma/schema.prisma) | Model `StudyJob` 1-1 `StudyGuide` |
