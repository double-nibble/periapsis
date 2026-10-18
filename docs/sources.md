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

### bitbucket

Open Bitbucket Cloud pull requests you authored or are reviewing, one item per PR titled with
what to do next, like `github`: review it, fix failing builds, address changes, reply to an
open comment thread, merge, request reviewers, finish the draft or chase reviewers.
Bitbucket does not report diff size or merge state, so those are left out. Type: `code`.

```json
{ "provider": "bitbucket", "instance": "bitbucket", "every": "5m",
  "params": { "repos": ["acme/api", "acme/web"], "tokenFile": "~/.periapsis/bitbucket-token" } }
```

- `repos`: the repositories to read, as `workspace/repo`. Bitbucket has no search across a
  workspace for reviews, so each is listed.
- `token` (or `tokenFile` / `tokenEnv`): a Bitbucket API token with read access to pull
  requests, sent as a bearer token. Set `email` to send it with your Atlassian email as
  basic auth instead.

### jira

Jira Cloud issues assigned to you that are not done, one item per issue: in progress or due
by today first, backlog last. Source: `tickets`. One instance per Jira site.

```json
{ "provider": "jira", "instance": "acme-jira", "every": "5m",
  "params": { "site": "acme.atlassian.net", "email": "you@example.com", "tokenFile": "~/.periapsis/jira-token" } }
```

- `site`: the Jira Cloud site.
- `email` and `token` (or `tokenFile` / `tokenEnv`): an Atlassian account and an API token
  from id.atlassian.com, with read access to the issues.
- `jql`: optional; replaces the default query (`assignee = currentUser() AND
  statusCategory != Done`).

### confluence

Confluence Cloud pages that mention you, or that you created or edited recently, with
their open comments, shown under Docs. A page asks you to answer when it has open
top-level inline or footer comments from someone else, or to read a mention. Source:
`docs`. One instance per Confluence site.

```json
{ "provider": "confluence", "instance": "acme-wiki", "every": "30m",
  "params": { "site": "acme.atlassian.net", "email": "you@example.com", "tokenFile": "~/.periapsis/atlassian-token" } }
```

- `site`, `email` and `token` (or `tokenFile` / `tokenEnv`): as for `jira`; one Atlassian
  API token works for both.
- `days`: how far back to look; default 30.
- `cql`: optional; replaces the query for your pages (mentions are always read).

### notion

Notion pages you are working through, shown under Docs: their unresolved page comments
and unchecked top-level to-dos. With `email`, a discussion whose last comment is not yours
asks you to answer. Comments on individual blocks inside a page are not read. Source:
`docs`.

```json
{ "provider": "notion", "instance": "notion", "every": "30m",
  "params": { "tokenFile": "~/.periapsis/notion-token", "email": "you@example.com" } }
```

- `token` (or `tokenFile` / `tokenEnv`): an internal integration secret with read content
  and read comments capabilities; share the pages (or a parent page) with the integration.
- `pages`: optional page URLs or ids to watch; otherwise pages shared with the integration
  whose title contains `query` (default `RFC`).
- `email`: optional; your Notion account's email. Needs the integration's "read user
  information including email addresses" capability.

### linear and linear-projects

Linear over its GraphQL API, without a Claude connector. `linear` reads the issues assigned
to you that are not completed or canceled: started or due by today first, backlog last.
Source: `tickets`. `linear-projects` reads the projects you lead or are a member of that are
not completed or canceled, with health, progress, target date, lead, the latest update as
the item's body, and how many open issues are yours; a started project you lead asks for an
update when the last one is over a week old. Source: `projects`.

```json
{ "provider": "linear", "instance": "linear", "every": "10m", "params": { "apiKeyFile": "~/.periapsis/linear-key" } },
{ "provider": "linear-projects", "instance": "linear", "every": "1h", "params": { "apiKeyFile": "~/.periapsis/linear-key" } }
```

- `apiKey` (or `apiKeyFile` / `apiKeyEnv`): a Linear personal API key, from Settings →
  Security & access, with read access.

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
