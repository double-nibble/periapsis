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
- Broker traffic is a secure WebSocket on 443, so it looks like ordinary HTTPS.

## Layout

- `packages/core` — the wire contract: schema, subjects, signing, sealed envelope, registry.
- `packages/transport` — the broker abstraction over NATS WebSocket.
- `packages/hub` — aggregator, state store, dashboard.
- `packages/reporter` — per-account reporter: providers and the runtime.
- `packages/cli` — operator commands: keygen, registry signing.
- `deploy/` — Terraform for the broker and registry.

## Infrastructure

Stand up the broker and registry, mint the fleet's keys, and credential the broker. Done
once from your workstation. You need a domain in Route53 and its hosted zone id, and the
full list of accounts you will run.

Build the repo. If you authenticated to AWS with `aws login`, export the bridge profile so
Terraform can read your credentials:

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

`websocat "$BROKER_URL"` shows the raw server `INFO`; `nats --server "$BROKER_URL" rtt`
reports a round-trip.

Generate the root key (the trust anchor — back up `root.key`), the hub key, and one key
per account, then publish a signed registry containing all of them:

```
node packages/cli/dist/cli.js keygen root
node packages/cli/dist/cli.js keygen hub
node packages/cli/dist/cli.js keygen sub1
node packages/cli/dist/cli.js keygen sub2
packages/cli/scripts/publish-registry.sh root.key "$REGISTRY_BUCKET" \
  hub.pub.json sub1.pub.json sub2.pub.json
curl -sS "$REGISTRY_URL"
```

Generate the broker's NATS auth from the registry — each account may publish only its own
`status.<account>` and subscribe its own `commands.<account>`; the hub subscribes
`status.>` and publishes `commands.>`:

```
curl -sS "$REGISTRY_URL" > signed-registry.json
node packages/cli/dist/cli.js broker-accounts --registry-file signed-registry.json
```

This writes `accounts.conf` and `broker-creds.json` (the passwords — keep it local).
Install `accounts.conf` on the broker and restart NATS:

```
aws ssm start-session --target "$BROKER_INSTANCE_ID"
```

In the session, write the file — paste the contents of your local `accounts.conf` where
shown — and restart:

```
sudo tee /etc/nats/accounts.conf >/dev/null <<'EOF'
# paste the contents of accounts.conf here
EOF
sudo systemctl restart nats
exit
```

## Hub

Runs on your dashboard machine. Copy `hub.key`, `root.pub.json`, and `broker-creds.json`
there, set your broker and registry URLs, build, then assemble the hub config and run it:

```
export BROKER_URL="wss://api.<your-domain>"
export REGISTRY_URL="https://status.<your-domain>/registry.json"
pnpm install && pnpm build
node packages/cli/dist/cli.js hub-config \
  --hub-key hub.key --root-pub root.pub.json \
  --broker "$BROKER_URL" --registry "$REGISTRY_URL" \
  --broker-user hub --broker-pass "$(jq -r .hub broker-creds.json)"
node packages/hub/dist/main.js hub-config.json
```

The hub serves the dashboard at `http://127.0.0.1:4747`. From another shell:

```
curl -sS http://127.0.0.1:4747/api/model
```

It returns the aggregated fleet model as JSON, empty until a reporter publishes.

## Reporters

One reporter per account, on that account's machine. Copy that account's `<account>.key`,
`root.pub.json`, and its password from `broker-creds.json` to the machine. Set the URLs,
build, and write the account's provider config (edit in each instance's token and login):

```
export BROKER_URL="wss://api.<your-domain>"
export REGISTRY_URL="https://status.<your-domain>/registry.json"
pnpm install && pnpm build
cat > instances.json <<'EOF'
[ { "provider": "github", "instance": "mygh", "params": { "token": "YOUR_TOKEN", "login": "YOUR_LOGIN" } } ]
EOF
```

Assemble the reporter config and run it. The NATS password comes from the environment, so
it never lands in your shell history:

```
export PERIAPSIS_BROKER_PASS="<this account's password from broker-creds.json>"
node packages/cli/dist/cli.js reporter-config \
  --account sub1 --account-key sub1.key --root-pub root.pub.json \
  --broker "$BROKER_URL" --registry "$REGISTRY_URL" --instances instances.json
node packages/reporter/dist/main.js reporter-config.json
```

Within a minute the account appears on the dashboard, labeled by account and locked to its
own `status.<account>` subject. Repeat on each account's machine with that account's key
and password.

## Develop

```
pnpm install
pnpm build
pnpm lint
pnpm test
```

Requires Node >= 22.13 and pnpm.

## Providers

Each reporter instance names a `provider`, an `instance` label, and provider-specific
`params`. A reporter's `instances.json` is an array of these. Instances are grouped by the
provider's abstract `source` on the dashboard.

### github

Open pull requests authored by, and awaiting review from, a GitHub login. Source: `github`.

```json
{ "provider": "github", "instance": "mygh", "params": { "token": "<github token>", "login": "<github login>" } }
```

- `token` — a GitHub token (fine-grained or classic) with read access to the relevant
  repositories; used for the GraphQL `search` query.
- `login` — the GitHub username whose open PRs (authored and review-requested) to report.

### gcal

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

### ical

Today's events from a secret iCal feed, no OAuth. Source: `calendar`. Covers only
calendars you own (the secret iCal address is owner-only), and does not expand recurring
events.

```json
{ "provider": "ical", "instance": "mycal", "params": { "icsUrl": "https://calendar.google.com/calendar/ical/.../basic.ics" } }
```

- `icsUrl` — a private ICS feed URL. In Google Calendar: *Settings → <your calendar> →
  Integrate calendar → Secret address in iCal format*. Any ICS feed URL also works.
