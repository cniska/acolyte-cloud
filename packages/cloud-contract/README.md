# @acolyte/cloud-contract

Shared Zod schemas and TypeScript types for the Acolyte Cloud API.

## Install

```bash
pnpm add @acolyte/cloud-contract
```

## Use

```ts
import { writeMemorySchema } from "@acolyte/cloud-contract";

const request = writeMemorySchema.parse(payload);
```

The package defines request and response shapes only. HTTP clients, persistence, and server handlers remain owned by their applications.
