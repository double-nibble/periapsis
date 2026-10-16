# periapsis infrastructure

Stands up the neutral central point: a NATS broker and a public-key registry,
both behind your own domain so traffic looks like ordinary HTTPS/service calls.

- `api.<domain>` — the NATS broker (`tls://api.<domain>:4222`)
- `status.<domain>` — the signed public-key registry (`https://status.<domain>/registry.json`)

## Apply

```
cp terraform.tfvars.example terraform.tfvars   # fill in your values
terraform init
terraform plan
terraform apply
```

Everything is destroyable with `terraform destroy` — no box or DNS left behind.

## After apply

Two steps Terraform does not do, because they involve private keys that must not
live in the state file or CI:

1. **NATS accounts.** Provision per-account NATS credentials so each reporter can
   publish only its own `status.<account>` subject, and write them into
   `/etc/nats/accounts.conf` on the broker (reachable via SSM:
   `aws ssm start-session --target <broker_instance_id>`), then
   `systemctl restart nats`.

2. **Registry.** Generate the root keypair and each identity's keypair with the
   keygen helper, sign the registry with the root key, and upload it to the
   registry bucket. The root private key stays with you; only public keys and the
   signed registry go to S3.

## Costs

A `t4g.nano`, one EIP, an S3 bucket and a CloudFront distribution — a few dollars
a month at low volume. `terraform destroy` stops all of it.
