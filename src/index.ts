import { Hono } from "hono";
import { app } from "./app.js";

if (!(app instanceof Hono)) {
  throw new Error("Vercel entrypoint must default-export a Hono app");
}

export default app;
