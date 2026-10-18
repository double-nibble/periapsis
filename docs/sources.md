# Sources

A reporter reads what it watches from `instances.json` (by default
`~/.periapsis/instances.json`): a JSON array of **instances**. This page explains every
field an instance takes, every value each field accepts, and every built-in provider and
agent source with its `params`.

## The model in one paragraph

An **instance** is one thing a reporter reads on a schedule: one GitHub login, one Jira
site, one calendar. Each instance belongs to a **source**, a category such as `code` or
`calendar`. The reporter publishes one snapshot per source, combining the items of every
instance in it, and the dashboard shows the health of each source. Each item has a
**kind** (`pr`, `calendar`, `ticket`, …), and the kind decides which dashboard panel shows
it. An instance is read either by a **provider**, code in the reporter that calls a
service's API (`mode: "direct"`), or by the machine's headless `claude` using its
connectors (`mode: "agent"`).

## Instance fields

| Field | Type | Required | Default | What it is |
| --- | --- | --- | --- | --- |
| `instance` | string | yes | — | Your name for this instance, unique in the file |
| `provider` | string | direct, unless `module` | — | Which built-in provider reads it |
| `source` | string | agent | the provider's source | Which source it belongs to |
| `mode` | `"direct"` or `"agent"` | no | `"direct"` | Read by a provider, or by headless Claude |
| `params` | object | depends | `{}` | Settings and credentials for the provider or agent source |
| `every` | string or number | no | direct: `everyMs` (1 minute); agent: 15 minutes | How often it runs |
| `permissionMode` | `"dontAsk"` or `"auto"` | no | `"dontAsk"` | Agent only: how headless Claude approves tool calls |
| `module` | string | no | — | Direct only: path to an external provider module |

### `instance`

A name you choose that identifies this instance. It is not looked up anywhere and has no
fixed set of values; it only has to be unique within one reporter's `instances.json`. The
reporter uses it to:

- **Schedule and remember the instance.** Each instance's last run and last good items are
  kept under its name. Two instances with the same name overwrite each other.
- **Key its items.** Every item's key is `<account>:<source>:<instance>/<id>`, so two
  instances of the same source never collide, even when both read the same service. The
  hub tracks dismissals, snoozes and resolution by that key, so **renaming an instance**
  makes its items reappear as new ones.
- **Tag its items.** The dashboard shows the instance name as a tag on each item, which is
  how you tell `work-github` from `personal-github` items at a glance.
- **Report errors.** Logs and the dashboard's source health say which instance failed, as
  `<instance>: <error>`.

Name it after what it reads, in short lowercase words: `github`, `acme-jira`,
`client-wiki`, `family-cal`, `slack`. When a source has a single instance, the service name
is enough; when it has several, name the account or site each one reads.

```json
[
  { "instance": "github", "provider": "github" },
  { "instance": "acme-jira", "provider": "jira", "params": { "site": "acme.atlassian.net", "email": "alice@example.com", "tokenFile": "~/.periapsis/acme-token" } },
  { "instance": "globex-jira", "provider": "jira", "params": { "site": "globex.atlassian.net", "email": "alice@example.com", "tokenFile": "~/.periapsis/globex-token" } }
]
```

Both Jira instances belong to the `tickets` source, so they are published together and
appear in the same list, each item tagged `acme-jira` or `globex-jira`.

### `source`

The category the instance belongs to. Every instance of a source on a reporter is
published as one snapshot, and the dashboard shows each source's health (last report, and
the error when every instance of it is failing). A direct instance takes its provider's
source, so `source` is usually left out; an agent instance must set it, because it names
the agent source to run.

A source name is 2 to 31 lowercase letters, digits or dashes, starting with a letter. The
standard sources:

| Source | Item kinds | Dashboard panel | Direct providers | Agent source |
| --- | --- | --- | --- | --- |
| `code` | `pr` | Pull requests; a PR you must act on also in Needs you | `github`, `bitbucket` | — |
| `calendar` | `calendar` | Calendar | `gcal`, `ical` | `calendar` (Google Calendar) |
| `tickets` | `ticket` | Needs you | `jira`, `linear` | `tickets` (Linear) |
| `projects` | `project`, `ticket` | Projects; one asking for an update also in Needs you | `linear-projects` | `projects` (Linear) |
| `docs` | `doc` | Docs; one with comments to answer also in Needs you | `confluence`, `notion` | `docs` (Notion) |
| `messages` | `message` | Needs you | — | `messages` (Slack) |
| `email` | `email` | Needs you | — | `email` (Gmail) |

Any other name is allowed for an inline agent source (see below), such as `chores` or
`yahoo-mail`; its items show by their kind like any other. Setting `source` on a direct
instance overrides the provider's own, for example to publish a second GitHub login as its
own `code-oss` source with separate health.

### `provider`

The built-in provider that reads a direct instance. One of: `github`, `bitbucket`, `gcal`,
`ical`, `jira`, `linear`, `linear-projects`, `confluence`, `notion`. Each is described under
[Direct providers](#direct-providers). Ignored when `mode` is `"agent"`.

### `mode`

- `"direct"` (default): a provider calls the service's API with the credential in `params`.
  No Claude is involved, so it costs no tokens and can run every minute.
- `"agent"`: the reporter runs the machine's headless `claude -p`, allowed only the
  source's read-only connector tools, and Claude replies with the items. It needs no token,
  since it uses the connectors already signed in to that Claude, but needs the `claude` CLI
  and those connectors on the reporter machine, and spends tokens on every run.

Either way, the items are sealed and published the same way.

### `params`

An object of settings for the provider or agent source; what it accepts is listed with each
one below. Credentials can be given three ways, so `instances.json` need not hold the
secret:

| Form | Example | Reads |
| --- | --- | --- |
| `token` | `"token": "ghp_…"` | the value itself |
| `tokenFile` | `"tokenFile": "~/.periapsis/jira-token"` | the file's contents, trimmed (`~` is the home directory) |
| `tokenEnv` | `"tokenEnv": "JIRA_TOKEN"` | the environment variable |

The same goes for any credential a provider names: `apiKey`, `apiKeyFile`, `apiKeyEnv` for
Linear. `gcal` takes its values literally.

For an agent instance, `params` other than `tools`, `instructions`, `kind` and `deny` are
passed to Claude as the instance's settings, so a source can be given options such as the
pages to watch.

### `every`

How often the instance runs: a string of a number and a unit, `s`, `m` or `h` (`"30s"`,
`"5m"`, `"1.5h"`), or a number of milliseconds (`300000`). The minimum is 10 seconds.
Without it, a direct instance runs every `everyMs` of the reporter config (one minute by
default) and an agent instance every 15 minutes. The reporter logs each instance's interval
when it starts. Instances of one source may run at different rates; each snapshot of the
source still carries the latest items of all of them.

### `permissionMode`

Agent instances only. How headless Claude approves its tool calls:

- `"dontAsk"` (default): only the source's listed read tools run; any other tool is refused.
- `"auto"`: a classifier approves tool calls, and the source's write tools are denied
  outright. Use it where an organization's managed settings ignore the allowed-tools list.
  It runs only for a source whose write tools are known: the built-in `calendar`, `email`
  and `messages` list them; for any other source, list them in `params.deny`.

### `module`

Direct instances only. A path to a JavaScript module, resolved against the reporter's
working directory, whose default export is a provider: an object with a `source` string and
an async `read(instance)` returning `{ items }`. It replaces `provider`, so a provider can
live outside this repo:

```json
{ "instance": "gitlab", "module": "./providers/gitlab.js", "every": "5m", "params": { "tokenEnv": "GITLAB_TOKEN" } }
```

## Direct providers

| Provider | Source | Kind | Reads |
| --- | --- | --- | --- |
| `github` | `code` | `pr` | Open PRs you authored or are asked to review |
| `bitbucket` | `code` | `pr` | Open PRs you authored or are reviewing, in listed repos |
| `gcal` | `calendar` | `calendar` | This month's events, over the Google Calendar API |
| `ical` | `calendar` | `calendar` | This month's events from an ICS feed |
| `jira` | `tickets` | `ticket` | Jira Cloud issues assigned to you, not done |
| `linear` | `tickets` | `ticket` | Linear issues assigned to you, not completed or canceled |
| `linear-projects` | `projects` | `project` | Linear projects you lead or are a member of |
| `confluence` | `docs` | `doc` | Confluence pages mentioning you, or yours, with open comments |
| `notion` | `docs` | `doc` | Notion pages with open comments and to-dos |

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
