# Acolyte Cloud

Cloud API for [Acolyte](https://acolyte.sh) — portable agent identity across machines.

Vercel Edge Functions fronting Neon Postgres with pgvector for memory embeddings and session storage.

## Quick start

1. Create a [Neon](https://neon.tech) database (free tier works)
2. Run setup — prompts for the connection string, generates keypair, runs migrations:

```bash
pnpm install
pnpm setup
```

3. Deploy to Vercel:

```bash
vercel link
cat public.pem | vercel env add JWT_SECRET production
vercel env add DATABASE_URL production
vercel deploy --prod
```

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm setup` | Interactive setup (env, keypair, migrations) |
| `pnpm migrate` | Run database migrations |
| `pnpm sign-token <user-id>` | Generate a signed JWT |
| `pnpm verify` | Typecheck |

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
