# periapsis

Observe-first monitoring for a fleet of autonomous agents you operate. Each agent
reports its own status outbound to a central hub; you watch the whole fleet from one
dashboard. Commands flow back only on request, signed, and only for actions a reporter
has opted into.

Every reporter knows only its own identity and the hub address — never its peers. The
hub is a sink and a renderer: it never reaches into a worker. Status items are labeled
by account, so one view aggregates many agents without conflating them.

## Security model

- Reporters publish; the hub subscribes. No inbound surface on a worker.
- Commands are signed (ed25519) and checked against a per-reporter action allow-list.
- A reporter runs its agent read-only: no shell, no file writes, connector content is
  data, never instructions.

## Layout

- `packages/core` — the wire contract: schema, subjects, signing.
- `packages/hub` — aggregator, state store, dashboard.
- `packages/reporter` — per-account reporter: git provider and connector snapshots.

## Develop

```
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

Requires Node >= 22.13 and pnpm.
