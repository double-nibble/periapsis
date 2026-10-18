# Sources

A reporter reads its sources from `~/.periapsis/instances.json`, an array of instances.
This page lists every instance setting, the built-in providers and agent sources, and how
to add your own.

## Instances

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

## Direct providers

A direct provider that needs a credential takes it in `params` one of three ways, so
`instances.json` need not hold the secret itself:

- `token`: the value itself.
- `tokenFile`: a path to a file holding it (`~` is the home directory).
- `tokenEnv`: the name of an environment variable holding it.

The same applies to any other credential a provider names, such as `apiKey`
(`apiKeyFile`, `apiKeyEnv`).


### github

Open pull requests authored by, and awaiting review from, a GitHub login, one item per PR titled with what to do next: Review for, Fix failing checks, Address requested changes, Reply to, Merge it, Resolve merge conflicts, Update the branch, Request reviewers, Finish the draft, or Chase reviewers after a week in review. A PR with nothing to do keeps its status (In review, Approved, waits on parent, …) and its size, checks, reviewers and open threads. Type: `code`.

```json
{ "provider": "github", "instance": "github", "every": "5m" }
```

It reads with the machine's `gh` login (`gh auth login` once), as that login's user.
Optional `params` override either:

- `token` — a GitHub token with read access to the relevant repositories.
- `login` — the GitHub username whose open PRs to report.

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

The month's events from a secret iCal feed, no OAuth, with recurring events expanded
(daily, weekly, monthly and yearly rules, excluded dates and moved occurrences). Source:
`calendar`. Covers only calendars you own (the secret iCal address is owner-only).

```json
{ "provider": "ical", "instance": "mycal", "params": { "icsUrl": "https://calendar.google.com/calendar/ical/.../basic.ics" } }
```

- `icsUrl` — a private ICS feed URL. In Google Calendar: *Settings → <your calendar> →
  Integrate calendar → Secret address in iCal format*. Any ICS feed URL also works.

### An external provider

A provider of an existing type can live outside this repo. Point an instance at its module;
set `source` to the type so it groups with the built-ins:

```json
{ "source": "code", "provider": "bitbucket", "mode": "direct", "module": "./providers/bitbucket.js",
  "params": { "workspace": "...", "token": "..." } }
```

The module's default export must be a `Provider` (a `source` string and an async `read`).

## Agent sources

An agent instance sets `mode: "agent"` and a `source`. A built-in source carries its own
connector tools and contract:

```json
{ "source": "calendar", "instance": "mycal", "mode": "agent" }
```

Built-in: `calendar` (Google Calendar connector), `email` (Gmail), `messages` (Slack),
`tickets` (Linear issues), `projects` (Linear projects: health, progress, next steps, and
issues due soon) and `docs` (Notion RFCs: open comment threads and to-dos). `docs` watches
the pages in `params.pages` when set, else your recent pages titled `RFC…`:

```json
{ "source": "projects", "instance": "linear", "mode": "agent", "every": "1h" },
{ "source": "docs", "instance": "rfcs", "mode": "agent", "every": "1h",
  "params": { "pages": ["https://www.notion.so/…"] } }
```

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

## Adding a source

**A new provider of an existing type** (for example Bitbucket or GitLab under `code`) needs no change to periapsis:

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

## Testing a source

`periapsis-probe` runs a set of instances once and prints the per-source body each would
seal and publish — no broker, no keys. Write a probe config:

```json
{ "account": "personal", "instances": [ { "provider": "github", "instance": "github" } ] }
```

Run it, with debug logs to watch the collection:

```
PERIAPSIS_LOG=debug node packages/reporter/dist/probe.js probe.json
```

It prints `{ "<source>": { ...items or failed, note } }` — exactly what the reporter would
publish to NATS.
