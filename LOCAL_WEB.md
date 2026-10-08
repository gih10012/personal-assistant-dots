# Local private web workspace

This is an observation and owner-control surface, not an action whitelist for the native model. Project views read the same durable task ledger; filters do not change task ownership, execution permission or facts. Resources and capability events come from their authority endpoints. Missing endpoints are shown as unavailable, never filled with invented successful capabilities.

## Initialize and open

From the repository, run `node scripts/web-auth.mjs`. It creates an owned mode-0700 directory under `~/.local/state/personal-assistant-dots/web-auth`, mode-0600 auth files, and prints paths only. Existing files are never overwritten. Use the printed `config.json` path for `DOTS_WEB_AUTH_CONFIG`, and the existing private mesh config path for `DOTS_MESH_CONFIG`. Start with `pnpm dev`; the default bind is `127.0.0.1:3100`.

Open `http://127.0.0.1:3100/login`. Select `owner-login.txt` to manage tasks or `viewer-login.txt` for the read-only project/capability workspace. Do **not** select `config.json`, a Codex auth file, or a mesh bearer credential. Login credentials are submitted in the request body, never URLs or command arguments, and are not retained in localStorage.

Only the configured exact loopback origin is accepted: `localhost` and `127.0.0.1` are not interchangeable. To use another loopback host/port, initialize a separate private directory with `node scripts/web-auth.mjs /absolute/private/directory http://localhost:3100` and configure the server to match.

`deploy/personal-assistant-dots.service` is a user-service template for the existing mesh installation. It starts the production build on `127.0.0.1:3100`, uses private paths under `~/.local/state`, and sets umask `0077`. Review its paths first, run `pnpm build`, then `systemctl --user link /absolute/repository/deploy/personal-assistant-dots.service`, `systemctl --user daemon-reload`, and `systemctl --user start personal-assistant-dots.service`. Linking and starting do not enable login-time autostart. Only use `enable` if you explicitly want that behavior.

## Permission boundaries

- Anonymous: no private pages, task records, files, event streams or actions.
- Viewer: projects, their task/native-state projection, resource and capability-event observations only. No legacy private chat/file/live-computer APIs or actions.
- Owner: existing task/control/settings actions, still subject to the mesh authority's leases, exact-operation approval, budget and delegated grants.
- Browser sessions: signed role and expiry, HttpOnly, SameSite=Strict, fixed 8-hour lifetime. Secure is set for HTTPS; loopback HTTP is the explicit local-development exception.
- Mutations check exact Host and Origin. Legacy side-effecting GET computer routes additionally require an owner and a same-origin browser fetch or explicit exact Origin. Each private page, action and API repeats authorization; Proxy alone is not trusted.
- Signing keys and mesh credentials remain outside the repository, behind mode-0600 files. They are never included in browser props, JSON or localStorage. Capability projection omits authentication/execution internals.

Logout clears this browser's cookie. A copied session remains usable until its fixed expiry; rotating the private signing key invalidates all existing sessions. This initial local deployment does not claim per-device session revocation or an Internet-safe identity provider. Do not expose this server on a public interface or reverse proxy without a separate authenticated deployment review. Legacy Composio cross-site OAuth callbacks are deliberately not exempted from this owner/same-origin gate.

`/projects` reports page-scoped counts and row-id task cursors. It displays explicit unavailable/error states and does not conflate unavailable data with an empty or completed task list. The native task projection shows thread, turn, harness, plan and goal; raw checkpoints, rollouts and credentials are not shown.

Run `pnpm test:mesh`, `pnpm exec tsc --noEmit`, and `pnpm build`. Security tests cover role isolation, expiry/tampering, cross-origin attacks, private file validation and repeated action/route guards. Runtime HTTP and browser verification still require a configured local deployment.

After starting the configured server, run `DOTS_WEB_AUTH_CONFIG=/absolute/private/config.json node scripts/check-web-access.mjs`. This read-only HTTP acceptance check reads the private login files without printing them, checks actual owner/viewer and anonymous routes, rejects CSRF/server-action attempts, and checks factual source-state envelopes. It does not submit work or operate a computer.

For an isolated real-browser check, install Mozilla's geckodriver separately and run `DOTS_WEB_AUTH_CONFIG=/absolute/private/config.json DOTS_GECKODRIVER=/absolute/geckodriver node scripts/check-web-browser.mjs`. It uses the installed Firefox in a separate headless temporary profile, exercises the file chooser/login and project page, verifies HttpOnly isolation and desktop/narrow layout, and saves screenshots in an owned private directory outside this repository. It never opens the user's active desktop profile. The output reports actual CSS viewport dimensions because Firefox can enforce a minimum window width; it does not pretend a requested 390px window was necessarily achieved.

## Deployment acceptance, 2026-10-08

- Local user unit is linked and running, not enabled for autostart. Bind: `127.0.0.1:3100`; entry: `http://127.0.0.1:3100/login`.
- Existing private auth files were reused. No model or operator credential was printed, uploaded, or supplied to the browser.
- The real HTTP access script passed anonymous isolation, owner/viewer reads and denied writes, private chat/file API isolation, same-origin checks, projection envelopes and cursor validation.
- An isolated headless Firefox session completed file login, rendered actual ledger projects and capability-source states, and passed HttpOnly and desktop/narrow horizontal-overflow checks. Screenshots remain private and are not committed. This does not claim a HarmonyOS browser test.
- Native queue/transport/security/observation unit suite: 24 tests passed. TypeScript and Next.js production build passed. Public CI is configured separately; its result must be checked after publication.
- Available project data and unavailable capability endpoints are both real source responses, not mocked success. Independent phone delivery, native voice, overnight continuity, global performance guarantees and Internet deployment are not proved by these Web checks.
