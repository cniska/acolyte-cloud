# Acolyte Cloud

Cloud API for [Acolyte](https://acolyte.sh) — portable agent identity across machines.

Vercel Edge Functions fronting Neon Postgres with pgvector for memory embeddings and session storage.

## Setup

1. Create a [Neon](https://neon.tech) database (free tier works)
2. Install dependencies and configure:

```bash
pnpm install
cp .env.example .env
# Set DATABASE_URL to your Neon connection string
```

3. Run migrations:

```bash
pnpm migrate
```

## Auth

Generate an Ed25519 keypair — the private key signs tokens (CLI side), the public key verifies them (server side):

```bash
openssl genpkey -algorithm ed25519 -out private.pem
openssl pkey -in private.pem -pubout -out public.pem
```

Sign a token:

```bash
pnpm sign-token <user-id>
```

## Deploy

1. Link to Vercel: `vercel link`
2. Set env vars: `DATABASE_URL` (Neon connection string) and `JWT_SECRET` (contents of `public.pem`)
3. Deploy: `vercel deploy --prod`
4. Optionally add a custom domain: `vercel domains add cloud.yourdomain.sh`

## API

All endpoints require `Authorization: Bearer <token>` (EdDSA JWT).

| Domain | Method | Route | Description |
|--------|--------|-------|-------------|
| Memory | GET | `/api/v1/memories` | List memories |
| | POST | `/api/v1/memories` | Write memory |
| | DELETE | `/api/v1/memories/:id` | Delete memory |
| | POST | `/api/v1/memories/touch-recalled` | Update recall timestamps |
| Embeddings | POST | `/api/v1/memories/embeddings` | Write embedding |
| | POST | `/api/v1/memories/embeddings/get` | Batch get embeddings |
| | DELETE | `/api/v1/memories/embeddings/:id` | Delete embedding |
| | POST | `/api/v1/memories/embeddings/search` | Vector similarity search |
| Sessions | GET | `/api/v1/sessions` | List sessions |
| | POST | `/api/v1/sessions` | Save session |
| | GET | `/api/v1/sessions/:id` | Get session |
| | DELETE | `/api/v1/sessions/:id` | Delete session |
| | GET | `/api/v1/sessions/active` | Get active session |
| | PUT | `/api/v1/sessions/active` | Set active session |

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
