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
```

### 2. Keys

Generate the root key (the fleet's trust anchor — back up `root.key`) and the hub key.
Each writes a private `.key` and a public `.pub.json`:

```
cd ..
node packages/cli/dist/cli.js keygen root
node packages/cli/dist/cli.js keygen hub
```

### 3. Publish the registry

Upload a signed registry containing the hub:

```
packages/cli/scripts/publish-registry.sh root.key $REGISTRY_BUCKET hub.pub.json
curl -sS $REGISTRY_URL
```

The curl should return signed JSON containing the `hub` identity.

### 4. Broker credentials

Give each account its own NATS credentials so a reporter can only publish its own
subject:

```
aws ssm start-session --target $BROKER_INSTANCE_ID
# in the session: edit /etc/nats/accounts.conf, then:
sudo systemctl restart nats
exit
```

### 5. Run the hub

Write the hub config. Replace `<domain>` and paste the root public key (the `signPublic`
value from `root.pub.json`) and the hub box private key (the `boxPrivate` value from
`hub.key`):

```
cp packages/hub/config.example.json hub-config.json
# edit hub-config.json: brokerUrl, registryUrl, rootSignPublic, boxPrivate
node packages/hub/dist/main.js hub-config.json
```

The hub ingests sealed status from reporters and serves the dashboard at
`http://127.0.0.1:4747`. Open it in a browser.

### 6. Bring a reporter online

On each subaccount machine (macOS):

```
curl -fsSL https://raw.githubusercontent.com/double-nibble/periapsis/main/packages/reporter/install/install.sh | bash
```

The first run clones, builds, generates this account's keypair locally (the private key
never leaves the machine), and writes `~/.periapsis/config.json`. Edit that config: set
`rootSignPublic` (the root public key from step 2) and each instance's provider token and
login.

Admit this account to the registry — send its public key
(`~/.periapsis/<account>.pub.json`) to yourself and run, replacing `REGISTRY_BUCKET`:

```
packages/cli/scripts/publish-registry.sh root.key REGISTRY_BUCKET sub1.pub.json
```

Re-run the installer to start the reporter as a launchd agent:

```
curl -fsSL https://raw.githubusercontent.com/double-nibble/periapsis/main/packages/reporter/install/install.sh | bash
```

Within a minute the account appears on the dashboard. Logs: `~/.periapsis/reporter.log`.

## Develop

```
pnpm install
pnpm build
pnpm lint
pnpm test
```

Requires Node >= 22.13 and pnpm.
