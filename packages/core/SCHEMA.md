# Wire contract

The contract every reporter publishes against and the hub validates on receipt.

## Identifiers

`account` and `source` are lowercase, start with a letter, and contain only
letters, digits and dashes, 2 to 31 characters.

A reporter is one `account`. A `source` is a category of work within it
(`github`, `jira`, `slack`). Vendor and instance identity do not appear here;
they live in an item's `meta`.

## Kinds

Every item has one `kind` from this fixed vocabulary:

| kind       | meaning                                      |
|------------|----------------------------------------------|
| `task`     | an action item not tracked elsewhere         |
| `ticket`   | issue tracker item                           |
| `pr`       | code review                                  |
| `project`  | a tracked project or epic                    |
| `doc`      | documentation or spec needing attention      |
| `message`  | chat needing a reply                         |
| `email`    | mail thread needing a reply                  |
| `calendar` | an event; feeds the fleet schedule           |

The hub groups and counts on `kind` and `account` only. An unknown kind is
rejected.

## Snapshot

A reporter publishes the complete current set for one `source`. Anything left
out of `items` is resolved by the hub.

```json
{
  "account": "sub1",
  "source": "github",
  "items": [ ... ],
  "note": "optional note on what was checked",
  "failed": false
}
```

If a source cannot be read, send `{ "account", "source", "failed": true, "note" }`
and the hub keeps that source's items as they were. `items` is required unless
`failed` is true; an empty list resolves everything for the source.

## Item

```json
{
  "key": "stable id from the source",
  "kind": "pr",
  "priority": 1,
  "title": "imperative: what to do",
  "detail": "one line of context",
  "url": "https link to the thing",
  "group": "project or topic name",
  "fingerprint": "id of the latest relevant event",
  "meta": { "instance": "which vendor instance" }
}
```

- `key` is unique within an account and source. Two instances of one vendor use
  distinct keys. The hub stores items under `(account, source, key)`.
- `priority` is 1 (today), 2 (this week) or 3 (when convenient); default 2.
- `fingerprint` changes only when something new happened.
- `url` is dropped to null unless its host is a known provider over https.
- `meta` holds vendor and instance identity for display. It never affects
  grouping, counting or dedup.

Limits: 300 items per snapshot; title 300, detail 600, meta 30 keys.

## Signed envelope

Commands crossing the network are signed with ed25519 over a canonical
serialization (object keys sorted, `undefined` dropped) so the signature is
reproducible. Verification fails closed on a tampered payload or wrong key.

## Subjects

- `status.<account>` — a reporter publishes its snapshots here.
- `status.>` — the hub subscribes this.
- `commands.<account>` — the hub publishes signed commands here; the reporter
  for that account polls it.
