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

The fleet has three kinds of participant: the **infrastructure** (a broker and a
registry), the **hub** (your dashboard, on a machine you control), and one or more
**reporters** (on your subaccount machines). Set them up in that order.

You will use two identities you generate: a **root** key that signs the registry, and a
**hub** key the hub runs as. Each reporter generates its own key on its own machine.

### Prerequisites

- Node >= 22.13 and pnpm on the machines that build the code (the hub, each reporter).
- A domain you control in Route53, and AWS credentials with permission to apply the
  Terraform. If you authenticated with `aws login` (your credentials show as type
  `login`), export the bridge profile before running Terraform so it can read them:

  ```
  export AWS_PROFILE=terraform-login
  ```

  The deploy config also defaults `aws_profile` to this, so plain `terraform` commands
  work once that profile exists.
- Build the repo once so the CLI is available:

  ```
  pnpm install && pnpm build
  CLI=packages/cli/dist/cli.js
  ```

### 1. Stand up the infrastructure

```
cd deploy
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:

- `domain` — your domain, e.g. `double-nibble.com`.
- `zone_id` — its Route53 hosted zone id.
- `allowed_cidrs` — the source IPs of your hub and reporters (e.g. `["203.0.113.4/32"]`).
- `letsencrypt_email` — an address you control, for cert expiry notices.
- `aws_profile` — the profile Terraform uses for AWS credentials. The default,
  `terraform-login`, bridges an `aws login` session via a `credential_process`; set it
  to your own profile if you authenticate differently.

Then:

```
terraform init
terraform validate
terraform plan
terraform apply
```

Note the outputs — `broker_url` (`wss://api.<domain>`), `registry_url`
(`https://status.<domain>/registry.json`), and `registry_bucket`. `terraform.tfvars`
and Terraform state are gitignored; keep them local.

### 2. Generate the root and hub keys

On a machine you control (your hub machine is fine):

```
node $CLI keygen root   # writes root.key, prints the root public identity
node $CLI keygen hub    # writes hub.key, prints the hub public identity
```

`root.key` is the anchor of the whole fleet — keep it safe and offline where you can.
Note the **root public key** from the `keygen root` output; every machine is configured
with it. The commands also write `root.pub.json` and `hub.pub.json` (redirect stdout to
save them).

### 3. Build and publish the first registry

Start a registry containing the hub, then add reporters as you onboard them (step 6).
The helper pulls the current registry, adds keys, signs with the root key, and uploads:

```
node $CLI keygen hub > hub.pub.json
packages/cli/scripts/publish-registry.sh root.key <registry_bucket> hub.pub.json
```

### 4. Provision broker credentials

Give each account its own NATS credentials so a reporter can only publish its own
subject. Connect to the broker over SSM and write them into `/etc/nats/accounts.conf`:

```
aws ssm start-session --target <broker_instance_id>
# edit /etc/nats/accounts.conf, then:
sudo systemctl restart nats
```

### 5. Run the hub

On your hub machine, copy the hub config example and fill it in:

```
cp packages/hub/config.example.json hub-config.json
```

Set `brokerUrl` and `registryUrl` (from the Terraform outputs), `rootSignPublic` (the
root public key from step 2), and `boxPrivate` (the hub's box private key, from
`hub.key`). Then start the hub:

```
node packages/hub/dist/main.js hub-config.json
```

It subscribes to the fleet, ingests sealed status from every reporter, and serves the
dashboard on `http://127.0.0.1:4747` (or your configured `port`). Open that in a
browser.

### 6. Bring a reporter online

On each subaccount machine (macOS):

```
curl -fsSL https://raw.githubusercontent.com/double-nibble/periapsis/main/packages/reporter/install/install.sh | bash
```

The first run clones and builds the repo, generates this account's keypair locally
(`~/.periapsis/<account>.key`, which never leaves the machine), and writes a starter
config at `~/.periapsis/config.json`. Edit that config:

- `rootSignPublic` — the root public key from step 2.
- each instance's provider params — for GitHub, a token and your login.

Then admit this account to the registry by sending its **public** key
(`~/.periapsis/<account>.pub.json`) to yourself and running:

```
packages/cli/scripts/publish-registry.sh root.key <registry_bucket> sub1.pub.json
```

Re-run the installer to start the reporter as a launchd agent:

```
curl -fsSL https://raw.githubusercontent.com/double-nibble/periapsis/main/packages/reporter/install/install.sh | bash
```

Within a minute the reporter seals its first snapshot to the hub, and the account
appears on the dashboard. Logs are at `~/.periapsis/reporter.log`.

## Develop

```
pnpm install
pnpm build
pnpm lint
pnpm test
```

Requires Node >= 22.13 and pnpm.
