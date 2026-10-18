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
instances; see [docs/sources.md](docs/sources.md)) and restart the reporter. It reads the file on every start, and
logs which instances it loaded.

### The dashboard

Chips across the top filter everything to one account. Below them, the calendar spans
the page, with today, week and month views. The left column counts what is open and lists
everything that needs you, in Now, Soon and When you can bands, with Open, Done, Not now
and Snooze on each row. The right column lists pull requests: review requests first, then
your own by repository, each with its size, age, reviewers, checks and open threads.

### Today's plan

The hub writes a daily plan at the top of the left column: a headline and three to six
steps across every account, naming the PRs, people and meetings involved. It runs the hub
machine's own `claude`, with no tools, over what the dashboard already shows, every three
hours and whenever you press ↻. Set `"plan": { "everyHours": 2, "model": "sonnet" }` in
`hub-config.json` to change how often and with which model, or `"plan": false` to turn it
off.

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

The sources a reporter can read, how to configure them and how to add your own are in
[docs/sources.md](docs/sources.md).
