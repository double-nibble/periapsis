# @periapsis/transport

A `Broker` abstraction over publish/subscribe, with two implementations:

- `MemoryBroker` — in-process, for tests and the stub reporter.
- `NatsBroker` — over NATS WebSocket (`ws://` or `wss://`), so broker traffic
  is an ordinary secure WebSocket on 443.

## Integration tests

The NATS tests run only when `NATS_WS_URL` is set, and skip otherwise. To run
them, start a local NATS with a WebSocket listener and point the tests at it:

```
nats-server -c ws.conf   # a config with a websocket { port: 8080 } block
NATS_WS_URL=ws://127.0.0.1:8080 pnpm --filter @periapsis/transport test
```
