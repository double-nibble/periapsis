# @periapsis/transport

A `Broker` abstraction over publish/subscribe, with two implementations:

- `MemoryBroker` — in-process, for tests and the stub reporter.
- `NatsBroker` — over NATS.

## Integration tests

The NATS tests run only when `NATS_URL` is set, and skip otherwise. To run
them, start a local server and point the tests at it:

```
nats-server -p 4222 --auth devtoken
NATS_URL=nats://127.0.0.1:4222 NATS_TOKEN=devtoken pnpm --filter @periapsis/transport test
```
