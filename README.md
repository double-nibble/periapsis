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
- Every message is encrypted and signed end to end (x25519 + ed25519); the broker is a
  dumb pipe that cannot read or forge messages.
- Trust is anchored by one root key you hold. A registry of public keys, signed by that
  root key and served over HTTPS, distributes identities. Private keys never leave the
  machine that owns them.
- Each account authenticates to the broker with its own NATS nkey; possession of a locally
  generated seed is the only credential, so no password is stored or transmitted.
- Broker traffic is a secure WebSocket on 443, so it looks like ordinary HTTPS.

## Layout

- `packages/core` — the wire contract: schema, subjects, signing, sealed envelope, registry.
- `packages/transport` — the broker abstraction over NATS WebSocket.
- `packages/hub` — aggregator, state store, dashboard.
- `packages/reporter` — per-account reporter: providers and the runtime.
- `packages/cli` — operator commands: keygen, enrollment, registry signing, broker auth.
- `deploy/` — Terraform for the broker and registry.

## Infrastructure

Stand up the broker and registry and publish the installer. Done once from your
workstation. You need a domain in Route53 and its hosted zone id.

Build and, if you authenticated to AWS with `aws login`, export the bridge profile:

```
pnpm install && pnpm build
export AWS_PROFILE=terraform-login
```

Apply the broker + registry, then export the outputs:

```
cd deploy
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: domain, zone_id, allowed_cidrs, letsencrypt_email,
# vpc_id, and a public subnet_id (route to an internet gateway, auto-assigned public IP)
terraform init
terraform apply
export REGISTRY_BUCKET="$(terraform output -raw registry_bucket)"
export REGISTRY_URL="$(terraform output -raw registry_url)"
export BROKER_INSTANCE_ID="$(terraform output -raw broker_instance_id)"
export BROKER_URL="$(terraform output -raw broker_url)"
cd ..
```

Verify the broker is up (NATS over secure WebSocket on 443):

```
node packages/cli/dist/cli.js broker-check "$BROKER_URL"
```

Generate the root key — the fleet's trust anchor; back up `root.key` and keep it offline —
and the hub key:

```
node packages/cli/dist/cli.js keygen root
node packages/cli/dist/cli.js keygen hub
```

Reporters are not keyed here: each generates its own identity and NATS credential when it
installs. Publish the installer and its public bootstrap to the status site:

```
pnpm bundle
node packages/cli/dist/cli.js bootstrap \
  --broker "$BROKER_URL" --registry "$REGISTRY_URL" --root-pub root.pub.json
aws s3 cp scripts/install.sh        "s3://$REGISTRY_BUCKET/install.sh"     --content-type text/x-shellscript
aws s3 cp dist-bundle/periapsis.mjs "s3://$REGISTRY_BUCKET/periapsis.mjs"  --content-type text/javascript
aws s3 cp dist-bundle/reporter.mjs  "s3://$REGISTRY_BUCKET/reporter.mjs"   --content-type text/javascript
aws s3 cp bootstrap.json            "s3://$REGISTRY_BUCKET/bootstrap.json" --content-type application/json
```

`bootstrap.json` holds only public values (the broker and registry URLs and the root signing
key). No secret is ever published or downloaded.

## Enrollment

Every account — the hub and each reporter — proves itself with keys it generates locally,
and prints a one-line **enrollment** carrying only public values. You authorize it on your
workstation with `enroll`, which records the identity in a working `registry.json` and the
NATS nkey in `accounts.json`. After enrolling one or more accounts, apply the change:

```
# sign and publish the registry
node packages/cli/dist/cli.js sign-registry root.key registry.json > signed-registry.json
aws s3 cp signed-registry.json "s3://$REGISTRY_BUCKET/registry.json" --content-type application/json

# regenerate the broker's nkey authorization and reload it
node packages/cli/dist/cli.js broker-accounts --accounts-file accounts.json
aws ssm start-session --target "$BROKER_INSTANCE_ID"
#   sudo tee /etc/nats/accounts.conf >/dev/null <<'CONF'
#   # paste the contents of accounts.conf here
#   CONF
#   sudo systemctl restart nats
#   exit
```

Run the apply step once after enrolling the hub and your first reporters, and again whenever
you add a reporter. Authentication is by nkey: possession of a locally generated seed is the
only credential, so no password is ever stored or transmitted.

## Hub

`hub-config` writes `hub-config.json` (the hub's box key and its own NATS nkey seed) and
prints the hub enrollment. Pipe it straight into `enroll`:

```
export BROKER_URL="wss://api.<your-domain>"
export REGISTRY_URL="https://status.<your-domain>/registry.json"
node packages/cli/dist/cli.js hub-config \
  --hub-key hub.key --root-pub root.pub.json \
  --broker "$BROKER_URL" --registry "$REGISTRY_URL" | node packages/cli/dist/cli.js enroll
```

Apply the change (Enrollment, above), then copy `hub-config.json` to your dashboard machine,
build, and run it:

```
pnpm install && pnpm build
node packages/hub/dist/main.js hub-config.json
```

The hub serves the dashboard at `http://127.0.0.1:4747`. From another shell:

```
curl -sS http://127.0.0.1:4747/api/model
```

It returns the aggregated fleet model as JSON, empty until a reporter publishes.

## Reporters

One reporter per account, on that account's Mac. Nothing is copied to the machine and no
password is typed — it generates its own identity and NATS credential and prints an
enrollment line:

```
curl -fsSL https://status.<your-domain>/install.sh | bash -s -- https://status.<your-domain> sub1
```

The installer downloads the reporter, writes this machine's keys into
`~/.periapsis/config.json`, installs a launchd agent, and prints a one-line enrollment. Send
that line to whoever runs the fleet; they authorize it on the workstation:

```
echo '<the enrollment line>' | node packages/cli/dist/cli.js enroll
```

Then they apply the change (Enrollment, above). Within a minute the account appears on the
dashboard, labeled by account and locked to its own `status.<account>` subject.

To choose what a reporter watches, put an instances array in `~/.periapsis/instances.json`
before installing (or edit it and re-run the installer). See Providers.


## Develop

```
pnpm install
pnpm build
pnpm lint
pnpm test
```

Requires Node >= 22.13 and pnpm.

### Testing a provider

`periapsis-probe` runs a set of instances once and prints the per-source body each would
seal and publish — no broker, no keys. Write a probe config:

```json
{ "account": "sub2", "instances": [ { "source": "github", "instance": "mygh", "params": { "token": "...", "login": "..." } } ] }
```

Run it, with debug logs to watch the collection:

```
PERIAPSIS_LOG=debug node packages/reporter/dist/probe.js probe.json
```

It prints `{ "<source>": { ...items or failed, note } }` — exactly what the reporter would
publish to NATS.

### Adding a provider

**A new provider of an existing type** (e.g. Bitbucket or GitLab under `code`) needs no PR:

- *direct* — write a module whose default export is a `Provider` (a `source` string and an
  async `read` returning items), and point an instance at it with `module`.
- *agent* — define the source inline in the instance `params` (`tools`, `instructions`,
  `kind`), gathered through the machine's Claude connectors.

Built-in providers ship in `packages/reporter/src/providers/` (registered in
`providers/all.ts`); a frequently used external provider or inline agent source can be
promoted to a built-in with a PR.

**A new type** — a category with no existing item kind (say, a doorbell notification) —
needs a PR to periapsis: it adds the kind to the taxonomy and its dashboard rendering.

Either way, test with `periapsis-probe`, then add the instance to a reporter's
`instances.json`.

## Providers

A reporter's `instances.json` is an array of instances. Each names a `source` — the abstract
**type** (`code`, `calendar`, `messages`, …) that groups it on the dashboard. A **provider**
implements a type: GitHub, GitLab and Bitbucket are providers of `code`; `gcal` and `ical`
are providers of `calendar`. An instance is gathered one of two ways, set by `mode`:

- **direct** (default) — a provider calls the service's API. Needs a token or credential in
  `params` but no local Claude. `provider` names a built-in; `module` points at an external
  provider module (its default export is a `Provider`), so a provider of an existing type
  can be plugged in without changing periapsis.
- **agent** — the reporter runs the machine's headless `claude` with that source's
  connector tools. No token: it uses the connectors already authenticated in that Claude.
  Needs the `claude` CLI and the relevant connectors on the reporter machine, and spends
  tokens per poll. Direct is the way to save tokens.

The sealed item shape and the `status.<account>` flow are identical either way.

### Direct providers

#### github

Open pull requests authored by, and awaiting review from, a GitHub login. Type: `code`.

```json
{ "provider": "github", "instance": "mygh", "params": { "token": "<github token>", "login": "<github login>" } }
```

- `token` — a GitHub token (fine-grained or classic) with read access to the relevant
  repositories; used for the GraphQL `search` query.
- `login` — the GitHub username whose open PRs (authored and review-requested) to report.

#### gcal

Today's Google Calendar events over the API. Source: `calendar`. Sees calendars
subscribed from other accounts, which `ical` cannot.

```json
{ "provider": "gcal", "instance": "mycal", "params": { "clientId": "...", "clientSecret": "...", "refreshToken": "...", "calendarId": "primary" } }
```

- `clientId`, `clientSecret` — an OAuth client (Desktop app) with the Calendar API
  enabled.
- `refreshToken` — obtained once via an OAuth consent for the `calendar.readonly` scope.
  Publish the consent screen to production so the refresh token does not expire.
- `calendarId` — optional. A single calendar's ID; omit to read every calendar in the
  account's list, including subscribed ones.

#### ical

Today's events from a secret iCal feed, no OAuth. Source: `calendar`. Covers only
calendars you own (the secret iCal address is owner-only), and does not expand recurring
events.

```json
{ "provider": "ical", "instance": "mycal", "params": { "icsUrl": "https://calendar.google.com/calendar/ical/.../basic.ics" } }
```

- `icsUrl` — a private ICS feed URL. In Google Calendar: *Settings → <your calendar> →
  Integrate calendar → Secret address in iCal format*. Any ICS feed URL also works.

#### An external provider

A provider of an existing type can live outside this repo. Point an instance at its module;
set `source` to the type so it groups with the built-ins:

```json
{ "source": "code", "provider": "bitbucket", "mode": "direct", "module": "./providers/bitbucket.js",
  "params": { "workspace": "...", "token": "..." } }
```

The module's default export must be a `Provider` (a `source` string and an async `read`).

### Agent sources

An agent instance sets `mode: "agent"` and a `source`. A built-in source carries its own
connector tools and contract:

```json
{ "source": "calendar", "instance": "mycal", "mode": "agent" }
```

Built-in: `calendar` (Google Calendar connector).

A source can also be defined inline, so a new one needs only config — no code change:

```json
{ "source": "email", "instance": "yahoo", "mode": "agent",
  "params": {
    "kind": "email",
    "tools": ["mcp__claude_ai_Yahoo__search", "mcp__claude_ai_Yahoo__get_message"],
    "instructions": "Report unread mail addressed to the account that needs a reply. key: message id. title: what to do. url: the message link. fingerprint: the message id."
  } }
```

- `tools` — the connector tool names headless Claude may use.
- `instructions` — what to report, in the item shape the dashboard renders.
- `kind` — the item kind (`message`, `email`, `ticket`, …); defaults to the source name
  when that is itself a kind.

Changing a built-in source's contract or a direct provider is a change to this repo (a
PR); a new inline agent source is config only.
