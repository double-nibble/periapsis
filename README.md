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

## Setup

Three kinds of participant: the **infrastructure** (broker + registry), the **hub**
(your dashboard), and one or more **reporters** (on your subaccount machines). Set them
up in order. All commands run from the repo root unless noted.

### Prerequisites

Build the repo once:

```
pnpm install && pnpm build
```

If you authenticated to AWS with `aws login` (your credentials show as type `login`),
export the bridge profile so Terraform can read them:

```
export AWS_PROFILE=terraform-login
```

You also need a domain in Route53 and its hosted zone id.

### 1. Infrastructure

```
cd deploy
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` — set `domain`, `zone_id`, `allowed_cidrs` (your hub and reporter
source IPs), `letsencrypt_email`, and your network: `vpc_id` and a **public** `subnet_id`
(its route table sends `0.0.0.0/0` to the VPC's internet gateway, and it auto-assigns a
public IP). The broker has no internet access otherwise, and SSM, cert issuance, and the
broker itself will all fail silently. Then:

```
terraform init
terraform apply
```

When it finishes, configure some environment variables from the outputs:

```
export REGISTRY_BUCKET="$(terraform output -raw registry_bucket)"
export REGISTRY_URL="$(terraform output -raw registry_url)"
export BROKER_INSTANCE_ID="$(terraform output -raw broker_instance_id)"
export BROKER_URL="$(terraform output -raw broker_url)"
```

Verify the broker is up and listening (NATS over secure WebSocket on 443):

```
node packages/cli/dist/cli.js broker-check "$BROKER_URL"
```

It connects through periapsis's own client and prints the broker's server `INFO`
(version, max payload, TLS), exiting non-zero if the broker cannot be reached. Two
ad-hoc alternatives: `websocat "$BROKER_URL"` shows the raw `INFO` line the server
sends on connect, and `nats --server "$BROKER_URL" rtt` reports a round-trip time.

### 2. Keys

Generate the root key (the fleet's trust anchor — back up `root.key`), the hub key, and a
key for your first account. Each writes a private `.key` and a public `.pub.json`:

```
cd ..
node packages/cli/dist/cli.js keygen root
node packages/cli/dist/cli.js keygen hub
node packages/cli/dist/cli.js keygen sub1
```

### 3. Publish the registry

Upload a signed registry containing the hub and the account:

```
packages/cli/scripts/publish-registry.sh root.key "$REGISTRY_BUCKET" hub.pub.json sub1.pub.json
curl -sS "$REGISTRY_URL"
```

The curl should return signed JSON containing the `hub` and `sub1` identities.

### 4. Broker credentials

Generate the broker's NATS auth from the registry. Every identity becomes a user: each
account may publish only its own `status.<account>` subject and subscribe its own
`commands.<account>`; the hub subscribes `status.>` and publishes `commands.>`.

```
curl -sS "$REGISTRY_URL" > signed-registry.json
node packages/cli/dist/cli.js broker-accounts --registry-file signed-registry.json
```

This writes `accounts.conf` (install on the broker) and `broker-creds.json` (the
generated passwords — keep it local). Install `accounts.conf` and restart NATS:

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

Re-running `broker-accounts` regenerates every password, so rebuild the hub and reporter
configs below whenever you run it.

### 5. Run the hub

Assemble the hub config, including its broker credentials, then run it:

```
node packages/cli/dist/cli.js hub-config \
  --hub-key hub.key --root-pub root.pub.json \
  --broker "$BROKER_URL" --registry "$REGISTRY_URL" \
  --broker-user hub --broker-pass "$(jq -r .hub broker-creds.json)"
node packages/hub/dist/main.js hub-config.json
```

The hub ingests sealed status from reporters and serves the dashboard at
`http://127.0.0.1:4747`. Open it in a browser.

The hub runs in the foreground; from another shell, verify it is serving:

```
curl -sS http://127.0.0.1:4747/api/model
```

It returns the aggregated fleet model as JSON — empty until a reporter publishes.

### 6. Bring a reporter online

Write the provider config, editing in each instance's token and login:

```
cat > instances.json <<'EOF'
[ { "provider": "github", "instance": "mygh", "params": { "token": "YOUR_TOKEN", "login": "YOUR_LOGIN" } } ]
EOF
```

Assemble the reporter config and run it. The NATS password comes from the environment, so
it never lands in your shell history:

```
export PERIAPSIS_BROKER_PASS="$(jq -r .sub1 broker-creds.json)"
node packages/cli/dist/cli.js reporter-config \
  --account sub1 --account-key sub1.key --root-pub root.pub.json \
  --broker "$BROKER_URL" --registry "$REGISTRY_URL" --instances instances.json
node packages/reporter/dist/main.js reporter-config.json
```

Within a minute `sub1` appears on the dashboard, labeled by account.

To add another account: generate its key (`keygen <account>`), admit it (step 3), re-run
broker credentials (step 4), and assemble a reporter config for it (this step). On a
dedicated subaccount machine, the installer automates the keygen and launchd setup:

```
curl -fsSL https://raw.githubusercontent.com/double-nibble/periapsis/main/packages/reporter/install/install.sh | bash
```

## Develop

```
pnpm install
pnpm build
pnpm lint
pnpm test
```

Requires Node >= 22.13 and pnpm.
