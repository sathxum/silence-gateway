# Silence Gateway — app development notes

100% self-hosted TanStack Start app. No external build services are involved.

- `vite.config.ts` uses the nitro `node-server` preset (runs on a plain VPS).
- `src/integrations/supabase/client.ts` supports `VITE_SUPABASE_URL=SAME_ORIGIN`
  so the browser talks to the backend on whatever origin serves the UI
  (tunnel URL, LAN IP or localhost — auto-detected, nothing hardcoded).
