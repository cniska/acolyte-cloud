# Acolyte Cloud

Cloud API for [Acolyte](https://acolyte.sh) — portable agent identity across machines.

Vercel Edge Functions fronting Neon Postgres with pgvector for memory embeddings and session storage.

## Setup

```bash
pnpm install
cp .env.example .env
# Set DATABASE_URL to your Neon connection string
```

## Auth

Generate an Ed25519 keypair:

```bash
openssl genpkey -algorithm ed25519 -out private.pem
openssl pkey -in private.pem -pubout -out public.pem
```

Set `JWT_SECRET` to the contents of `public.pem` on Vercel. Sign tokens locally:

```bash
pnpm sign-token <user-id>
```

## Database

```bash
pnpm migrate
```

## Deploy

```bash
vercel deploy
```

## API

All endpoints require `Authorization: Bearer <token>` (EdDSA JWT).

### Memory

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/v1/memories` | List memories |
| POST | `/api/v1/memories` | Write memory |
| DELETE | `/api/v1/memories/:id` | Delete memory |
| POST | `/api/v1/memories/touch-recalled` | Update recall timestamps |

### Embeddings

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/v1/memories/embeddings` | Write embedding |
| POST | `/api/v1/memories/embeddings/get` | Batch get embeddings |
| DELETE | `/api/v1/memories/embeddings/:id` | Delete embedding |
| POST | `/api/v1/memories/embeddings/search` | Vector similarity search |

### Sessions

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/v1/sessions` | List sessions |
| POST | `/api/v1/sessions` | Save session |
| GET | `/api/v1/sessions/:id` | Get session |
| DELETE | `/api/v1/sessions/:id` | Delete session |
| GET | `/api/v1/sessions/active` | Get active session |
| PUT | `/api/v1/sessions/active` | Set active session |

## Connect Acolyte

In your Acolyte config (`~/.config/acolyte/config.toml`):

```toml
cloudUrl = "https://cloud.acolyte.sh"

[features]
cloudSync = true
```

Set the token as an environment variable:

```bash
export ACOLYTE_CLOUD_TOKEN=$(pnpm sign-token <user-id>)
```

## License

[MIT](LICENSE)
