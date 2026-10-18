# periapsis

Observe-first monitoring for a fleet of autonomous agents you operate. Each agent reports its own status outbound to a central hub; you watch the whole fleet from one dashboard. Commands flow back only on request, signed, and only for actions a reporter has opted into.

Every reporter knows only its own identity and the hub address — never its peers. The hub is a sink and a renderer: it never reaches into a worker. Status items are labeled by account, so one view aggregates many agents without conflating them.

## Security model

- Reporters publish; the hub subscribes. No inbound surface on a worker.
- Every message is encrypted and signed end to end (x25519 + ed25519); the broker is a dumb pipe that cannot read or forge messages.
- Trust is anchored by one root key you hold. A registry of public keys, signed by that root key and served over HTTPS, distributes identities. Private keys never leave the machine that owns them.
- Each account authenticates to the broker with its own NATS nkey; possession of a locally generated seed is the only credential, so no password is stored or transmitted.
- Broker traffic is a secure WebSocket on 443, so it looks like ordinary HTTPS.

## Layout

- `packages/core` — the wire contract: schema, subjects, signing, sealed envelope, registry.
- `packages/transport` — the broker abstraction over NATS WebSocket.
- `packages/hub` — aggregator, state store, dashboard.
- `packages/reporter` — per-account reporter: providers and the runtime.
- `packages/cli` — operator commands: keygen, enrollment, registry signing, broker auth.
- `deploy/` — Terraform for the broker and registry.

# Getting Started

Clone and build:

```bash
git clone git@github.com:double-nibble/periapsis.git
cd periapsis
pnpm install && pnpm build
```

## Bootstrapping

Setup involves three kinds of machine, which may be the same box:

* **Operator workstation**: Holds `root.key` and your AWS credentials, and is the only place anything is signed
* **Hub machine**: Runs the dashboard for orchestration
* **Reporter machine**: Runs a reporter that's being orchestrated

The most likely configuration is that the operator workstation and hub machine are the same machine.

No machine ever receives another machine's private key. Everything in this section runs on the operator workstation, once. You need a domain in Route53 and its hosted zone ID.

Apply the broker + registry, then export the outputs:

```bash
## If you use `aws login` for creds, you might need this bridge:
# export AWS_PROFILE_OLD=$AWS_PROFILE  # Save you current profile 
# export AWS_PROFILE=terraform-login   # Setup the Terraform bridge

cd deploy
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` and populate your Route53 managed DNS `domain`, its `zone_id`, `allowed_cidrs` that can connect to the broker, a `letsencrypt_email` address for creating certificates, your `vpc_id`, and a public `subnet_id` that has a route to an internet gateway with auto-assigned public IP configured.

```bash
terraform init
terraform apply
export REGISTRY_BUCKET="$(terraform output -raw registry_bucket)"
export REGISTRY_URL="$(terraform output -raw registry_url)"
export BROKER_INSTANCE_ID="$(terraform output -raw broker_instance_id)"
export BROKER_URL="$(terraform output -raw broker_url)"
cd ..

## If you used the bridge, reset your setup
# export AWS_PROFILE=$AWS_PROFILE_OLD
# export AWS_PROFILE_OLD=
```

Generate the root key:

```bash
node packages/cli/dist/cli.js keygen root
```

The hub and the reporters are not keyed here: each generates its own identity and NATS credential on its own machine. Publish the installer and its public bootstrap to the status site:

```bash
pnpm bundle
node packages/cli/dist/cli.js bootstrap \
  --broker "${BROKER_URL}" \
  --registry "${REGISTRY_URL}" \
  --root-pub root.pub.json
aws s3 cp scripts/install.sh "s3://${REGISTRY_BUCKET}/install.sh" --content-type text/x-shellscript
aws s3 cp dist-bundle/periapsis.mjs "s3://${REGISTRY_BUCKET}/periapsis.mjs" --content-type text/javascript
aws s3 cp dist-bundle/reporter.mjs "s3://${REGISTRY_BUCKET}/reporter.mjs" --content-type text/javascript
aws s3 cp bootstrap.json "s3://${REGISTRY_BUCKET}/bootstrap.json" --content-type application/json
aws s3 cp root.pub.json "s3://${REGISTRY_BUCKET}/root.pub.json" --content-type application/json
```

`bootstrap.json` holds only public values (the broker and registry URLs and the root signing
key). No secret is ever published or downloaded.

## Hub

This is your dashboard machine. You'll need the repository copied and built and copy `root.pub.json` over.

If it's the same machine, you can skip this and go to the keygen step.

```bash
git clone git@github.com:double-nibble/periapsis.git
cd periapsis
pnpm install && pnpm build
export DOMAIN="<your-domain>"
export BROKER_URL="wss://api.${DOMAIN}"
export REGISTRY_URL="https://status.${DOMAIN}/registry.json"
curl -fsSLO "https://status.${DOMAIN}/root.pub.json"
```

The `hub-config` writes `hub-config.json` (the hub's box and signing keys and its own NATS nkey seed) and prints the hub enrollment. Pipe it straight into `enroll`:

```bash
node packages/cli/dist/cli.js keygen hub
node packages/cli/dist/cli.js hub-config \
  --hub-key hub.key \
  --root-pub root.pub.json \
  --broker "${BROKER_URL}" \
  --registry "${REGISTRY_URL}" > hub.token
```

The output is the token to be enrolled, redirected to `hub.token`. If your operator workstation and hub will be the same machine, you can do the enrollment here. Otherwise, copy that `hub.token` file to the operator machine.

## Enrollment

Every piece (the hub and each reporter) proves itself with keys it generates locally, and prints a one-line **enrollment** carrying only public values. You authorize a token on the operator workstation (the workstation with the `root.key`):

```bash
packages/cli/scripts/enroll.sh root.key "${REGISTRY_BUCKET}" < hub.token
```

Now we'll update the broker's nkey authorization and reload it. This is something you'll need to do for each new enrollment.

```bash
cat accounts.conf | pbcopy
# Connect to the broker to write the file
aws ssm start-session --target "${BROKER_INSTANCE_ID}"
sudo tee /etc/nats/accounts.conf >/dev/null <<'CONF'
# paste the contents of accounts.conf here
CONF
sudo systemctl restart nats
exit
```

Authentication is by nkey: possession of a locally generated seed is the only credential, so no password is ever stored or transmitted.

## Starting Hub

Now that the broker is running and the hub has been authorized, you can start the hub:

```bash
node packages/hub/dist/main.js hub-config.json
```

The hub serves the dashboard at `http://127.0.0.1:4747`. From another shell:

```bash
curl -sS http://127.0.0.1:4747/api/model
```

It returns the aggregated fleet model as JSON, empty until a reporter publishes.

## Reporters

One reporter per worker, on that worker's Mac. Nothing is copied to the machine and no password is typed. It generates its own identity and NATS credential and prints an enrollment line:

```bash
export DOMAIN="<your domain>"
curl -fsSL "https://status.${DOMAIN}/install.sh" | bash -s -- "https://status.${DOMAIN}" <worker_name>
```

The installer downloads the reporter, writes this machine's own keys into `~/.periapsis/config.json`, and prints an enrollment token. Send the token to the operator, who enrolls it on the workstation and installs the new `accounts.conf` on the broker (Enrollment, above). Then start the reporter, like the hub, in a shell:
```
~/.periapsis/run
```

It runs in the foreground and logs what it loads and when it connects; Ctrl-C stops it, and
`PERIAPSIS_LOG=debug ~/.periapsis/run` shows more. Within a few minutes — the hub re-reads the registry every five — the account appears
on the dashboard, labeled by account and locked to its own `status.<account>` subject.

To choose what a reporter watches, edit `~/.periapsis/instances.json` (an array of
instances; see Providers) and restart the reporter. It reads the file on every start, and
logs which instances it loaded.

### Responding from the dashboard

Click an item to open it. From there you can dismiss it, snooze it, or respond: type what
that account's Claude should do about it, such as "Address the comments on this PR, reply
to each, and push the fixes" or "Summarize this PR and recommend whether to approve". The
hub seals the prompt to that account and signs it with its own key; the reporter runs it
only if the hub's signature, from the registry, checks out.

The reporter runs each response in turn with the machine's own `claude` and settings, and
reports it as a task: queued, running, then done or failed with Claude's reply. Respond to
a task to continue the same Claude session. A dismissed or snoozed item comes back when it
has new activity.

A machine runs responses only when its `~/.periapsis/config.json` has a `respond` section:

```json
"respond": { "cwd": "~/code", "permissionMode": "auto", "timeoutMinutes": 30 }
```

- `cwd` — where Claude starts (default `~`).
- `permissionMode` — Claude's permission mode for the run (default `auto`).
- `model`, `timeoutMinutes` — optional; the timeout defaults to 30 minutes.

A hub configured before it signed commands needs its signing key: copy `signPrivate`
from `hub.key` into `hub-config.json`.

To remove a reporter and its keys from a Mac:

```
curl -fsSL https://status.<your-domain>/install.sh | bash -s -- --uninstall
```

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

Each instance runs on its own schedule, set by `every`: `"30s"`, `"5m"`, `"1h"` (at least
10 seconds). Without it, a direct instance runs every minute and an agent instance every
15 minutes, since each agent run is a headless `claude`. Poll a calendar hourly and Slack
every few minutes, for example:

```json
[
  { "instance": "mycal", "source": "calendar", "mode": "agent", "every": "1h" },
  { "instance": "slack", "source": "messages", "mode": "agent", "every": "5m" }
]
```

The reporter logs each instance's schedule when it starts. Instances of the same source may
run at different rates; each update to that source still carries every instance's latest
items.

### Direct providers

#### github

Open pull requests authored by, and awaiting review from, a GitHub login. Type: `code`.

```json
{ "provider": "github", "instance": "github", "every": "5m" }
```

It reads with the machine's `gh` login (`gh auth login` once), as that login's user.
Optional `params` override either:

- `token` — a GitHub token with read access to the relevant repositories.
- `login` — the GitHub username whose open PRs to report.

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

Built-in: `calendar` (Google Calendar connector), `email` (Gmail), `messages` (Slack).

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
- `deny` — the connector's write tools, denied explicitly. On a built-in source it adds to
  the source's own list.

Headless Claude runs in `dontAsk` mode: any tool outside `tools` is refused. Where an
organization's managed settings ignore `--allowedTools`, set `"permissionMode": "auto"` on
the instance; a classifier then approves tool calls, so the deny list is what keeps writes
out. Auto mode runs only for a source whose write tools are named — built-in `calendar`,
`email` and `messages` are; for any other, list them in `params.deny`:

```json
{ "source": "calendar", "instance": "work", "mode": "agent", "every": "1h", "permissionMode": "auto" }
```

Changing a built-in source's contract or a direct provider is a change to this repo (a
PR); a new inline agent source is config only.
