# Personal Assistant Dots

Product-layer fork of [composio-community/open-dot](https://github.com/composio-community/open-dot),
baseline commit `f838e17cf5c3a88ade5ceea54680a8145d048c1d`.
Not OpenAI's source code and not a claim of Dots parity.
The upstream snapshot did not include a license file; this fork preserves
provenance and does not relabel upstream code as MIT.

## Native runtime

The default engine forwards work to
[personal-assistant-mesh](https://github.com/gih10012/personal-assistant-mesh).
The worker uses **Codex app-server first**, with an explicitly configured Pi
fallback. No OpenClaw/OpenCode harness. Reuse the host's existing Codex login;
do not paste or copy OAuth tokens into this application.

Use the [private localhost setup](LOCAL_WEB.md). Both `DOTS_MESH_CONFIG` and
`DOTS_WEB_AUTH_CONFIG` are required, and `DOTS_DATA_DIR` should point outside
the repository. The default development/production bind is `127.0.0.1:3100`.

The config and its token file must be owned regular `0600` files, outside the
repository. Use an SSH loopback tunnel or TLS for the mesh authority. The fork
adds an owner/viewer login gate, HttpOnly SameSite=Strict 8-hour browser
sessions, exact loopback Host/Origin checks and per-action/per-route
authorization. A viewer can read the project/capability observation surface,
but cannot write or read legacy private chat/files/live-computer interfaces.
The browser never receives the mesh operator bearer. This is still a local
deployment, not an Internet-facing identity system.

Chat, channel/team text, routines and triggers submit stable task IDs into a durable authority.
Unknown submission outcomes retry the same immutable job, not a new job.
UI restarts resume polling saved jobs. Leader sessions use `leader:<dot-id>`;
child sessions use stable project/agent identities, so new UI conversations
do not reset a dot's native memory. `/plan <task>` and `/goal <objective>` use
native Codex interfaces. Stopping a task and canceling a schedule remain
different controls.

`DOTS_ENGINE=responses` explicitly selects the unmodified upstream API engine;
it is not an automatic fallback, may incur API costs, and requires separate
authorization/credentials. Native mode avoids API calls for chat titling.

## Verification and remaining gaps

```bash
node --test tests/mesh-*.test.ts
pnpm exec tsc --noEmit
pnpm build
```

The Node 26 suite covers durable queue/control recovery, original
conversation/channel routing, transport isolation, session/role/CSRF
security, repeated API/action guards and open capability projection.
The fork passes a full TypeScript check and Next.js production build.
Runtime HTTP and visual verification are recorded separately in
[LOCAL_WEB.md](LOCAL_WEB.md); unit tests alone do not establish live delivery,
native voice or official Dots parity.

Native mode currently forwards text, dot instructions, saved facts/skills and
rule context. It does **not** yet bridge the upstream browser live view,
credential vault, attachments, voice, or approval cards into Codex.
Composio rule-review is not a hard enforcement layer in native mode. Those
features must not be assumed available simply because their UI exists.
Channel/team text now uses the same native durable queue and records results
in the originating channel. Cloud-durable scheduling is not implemented.
Closing this UI doesn't stop already submitted cloud tasks, but
the inherited local scheduler is not a cloud scheduler.

See the mesh benchmark/acceptance documents for runtime evidence and the
capability gaps against official Dots.

## Observation, not a closed capability catalogue

`/projects` reads the mesh's task ledger, page-scoped status counts and native
thread/turn/Goal/Plan projection. Resource and capability-event cards read
their corresponding authority endpoints; unavailable endpoints are shown as
unavailable. Arbitrary resource kinds and metric metadata remain open.
Advertisements, declared health, evidence-scoped performance verification
and exact remote-use permission are separate facts. The registry and Web
views do not replace or constrain authorized native shell/tool discovery.

The default zero-spend policy does not silently turn text or voice into a
paid API call. The upstream Realtime voice UI is explicitly unavailable in
native mode until a separately authorized native voice bridge is verified.
