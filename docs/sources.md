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

### `github`

One item per open PR, titled with what to do next: Review for, Fix failing checks, Address
requested changes, Reply to, Merge it, Resolve merge conflicts, Update the branch, Request
reviewers, Finish the draft, or Chase reviewers after a week in review. A PR with nothing to
do shows its status (In review, Approved, waits on parent, …), size, checks, reviewers and
open threads.

| Param | Required | Default | Value |
| --- | --- | --- | --- |
| `token` | no | the machine's `gh` login | A GitHub token with read access to the repositories |
| `login` | no | the token's user | The GitHub username whose PRs to report |

With no params, run `gh auth login` once on the reporter machine.

```json
{ "instance": "github", "provider": "github", "every": "5m" }
```

### `bitbucket`

Bitbucket Cloud PRs, with the same next actions as `github`. Bitbucket reports no diff size
or merge state, so those are left out.

| Param | Required | Default | Value |
| --- | --- | --- | --- |
| `repos` | yes | — | Repositories as `workspace/repo`, e.g. `["acme/api", "acme/web"]` |
| `token` / `tokenFile` / `tokenEnv` | yes | — | A Bitbucket API token that can read pull requests |
| `email` | no | — | Your Atlassian email; when set, the token is sent as basic auth instead of a bearer token |

```json
{ "instance": "bitbucket", "provider": "bitbucket", "every": "5m",
  "params": { "repos": ["acme/api", "acme/web"], "tokenFile": "~/.periapsis/bitbucket-token" } }
```

### `gcal`

This month's events over the Google Calendar API, including calendars subscribed from other
accounts, which `ical` cannot see.

| Param | Required | Default | Value |
| --- | --- | --- | --- |
| `clientId`, `clientSecret` | yes | — | An OAuth client (Desktop app) with the Calendar API enabled |
| `refreshToken` | yes | — | From a one-time consent for the `calendar.readonly` scope; publish the consent screen to production so it does not expire |
| `calendarId` | no | every calendar in the account's list | One calendar's ID, e.g. `"primary"` |

```json
{ "instance": "family-cal", "provider": "gcal",
  "params": { "clientId": "…", "clientSecret": "…", "refreshToken": "…", "calendarId": "primary" } }
```

### `ical`

This month's events from an ICS feed, with recurring events expanded. No OAuth.

| Param | Required | Default | Value |
| --- | --- | --- | --- |
| `icsUrl` | yes | — | An ICS feed URL. For Google Calendar: *Settings → your calendar → Integrate calendar → Secret address in iCal format* (owner only) |

```json
{ "instance": "family-cal", "provider": "ical", "every": "15m",
  "params": { "icsUrl": "https://calendar.google.com/calendar/ical/…/basic.ics" } }
```

### `jira`

Jira Cloud issues assigned to you that are not done, one item per issue: in progress or due
by today first, backlog last. One instance per site.

| Param | Required | Default | Value |
| --- | --- | --- | --- |
| `site` | yes | — | The site, e.g. `"acme.atlassian.net"` |
| `email` | yes | — | Your Atlassian account email |
| `token` / `tokenFile` / `tokenEnv` | yes | — | An API token from id.atlassian.com |
| `jql` | no | `assignee = currentUser() AND statusCategory != Done` | A JQL query to use instead |

```json
{ "instance": "acme-jira", "provider": "jira", "every": "5m",
  "params": { "site": "acme.atlassian.net", "email": "alice@example.com", "tokenFile": "~/.periapsis/atlassian-token" } }
```

### `confluence`

Confluence Cloud pages that mention you, or that you created or edited recently, with their
open comments. A page asks you to answer when it has open top-level comments from someone
else, or to read a mention. One instance per site.

| Param | Required | Default | Value |
| --- | --- | --- | --- |
| `site`, `email`, `token` / `tokenFile` / `tokenEnv` | yes | — | As for `jira`; one Atlassian token works for both |
| `days` | no | `30` | How many days back to look for your pages |
| `cql` | no | your pages from the last `days` | A CQL query for your pages to use instead; mentions are always read |

```json
{ "instance": "acme-wiki", "provider": "confluence", "every": "30m",
  "params": { "site": "acme.atlassian.net", "email": "alice@example.com", "tokenFile": "~/.periapsis/atlassian-token" } }
```

### `notion`

Notion pages with their unresolved page comments and unchecked top-level to-dos. Comments
on blocks inside a page are not read.

| Param | Required | Default | Value |
| --- | --- | --- | --- |
| `token` / `tokenFile` / `tokenEnv` | yes | — | An internal integration secret with read content and read comments capabilities; share the pages, or a parent page, with the integration |
| `pages` | no | — | Page URLs or ids to watch |
| `query` | no | `"RFC"` | Without `pages`, watch shared pages whose title contains this |
| `email` | no | — | Your Notion email; a discussion whose last comment is not yours then asks you to answer. Needs the integration's user email capability |

```json
{ "instance": "notion", "provider": "notion", "every": "30m",
  "params": { "tokenFile": "~/.periapsis/notion-token", "email": "alice@example.com" } }
```

### `linear` and `linear-projects`

Linear over its API. `linear` reads the issues assigned to you that are not completed or
canceled: started or due by today first, backlog last. `linear-projects` reads the projects
you lead or are a member of that are not completed or canceled, with health, progress,
target date, lead, the latest update, and how many open issues are yours; a started project
you lead asks for an update when the last one is over a week old.

| Param | Required | Default | Value |
| --- | --- | --- | --- |
| `apiKey` / `apiKeyFile` / `apiKeyEnv` | yes | — | A personal API key from Linear's *Settings → Security & access* |

```json
{ "instance": "linear", "provider": "linear", "every": "10m", "params": { "apiKeyFile": "~/.periapsis/linear-key" } },
{ "instance": "linear-projects", "provider": "linear-projects", "every": "1h", "params": { "apiKeyFile": "~/.periapsis/linear-key" } }
```

## Agent sources

An agent instance sets `"mode": "agent"` and a `source`. The built-in sources:

| Source | Connector | Reports | `auto` allowed | Params |
| --- | --- | --- | --- | --- |
| `calendar` | Google Calendar | Every event this month, on every calendar you can see | yes | — |
| `messages` | Slack | DMs and mentions awaiting your reply, one per conversation | yes | — |
| `email` | Gmail | Unread or important threads, and threads awaiting your reply | yes | — |
| `tickets` | Linear | Issues assigned to you that are not done | with `deny` | — |
| `projects` | Linear | Your active projects, and your issues in them due within 2 days | with `deny` | — |
| `docs` | Notion | Pages with open comment threads and to-dos | with `deny` | `pages`: page URLs to watch; default your recent pages titled `RFC…` |

```json
[
  { "instance": "slack", "source": "messages", "mode": "agent", "every": "5m" },
  { "instance": "gmail", "source": "email", "mode": "agent", "every": "10m" },
  { "instance": "rfcs", "source": "docs", "mode": "agent", "every": "1h",
    "params": { "pages": ["https://www.notion.so/…"] } }
]
```

### An inline agent source

A source defined in `params` needs no code change. When `params` has both `tools` and
`instructions`, they replace any built-in source of that name.

| Param | Required | Value |
| --- | --- | --- |
| `tools` | yes | Connector tool names Claude may use, as `mcp__claude_ai_<Connector>__<tool>`; list read tools only |
| `instructions` | yes | What to report, one item per what, with what to put in `key`, `title`, `detail`, `url`, `group`, `priority` and `fingerprint` |
| `kind` | no | The item kind: `task`, `ticket`, `pr`, `project`, `doc`, `message`, `email` or `calendar`. Defaults to the source name when that is a kind, else `task` |
| `deny` | for `auto` | The connector's write tools, denied outright. On a built-in source, adds to its own list |

```json
{ "instance": "yahoo", "source": "yahoo-mail", "mode": "agent", "every": "15m",
  "params": {
    "kind": "email",
    "tools": ["mcp__claude_ai_Yahoo__search", "mcp__claude_ai_Yahoo__get_message"],
    "instructions": "Report unread mail addressed to me that needs a reply, one item per message. key: message id. title: what to do. url: the message link. fingerprint: the message id."
  } }
```

## A complete example

A personal machine reading GitHub and a calendar directly, and Slack and Gmail through
Claude:

```json
[
  { "instance": "github", "provider": "github", "every": "5m" },
  { "instance": "family-cal", "provider": "ical", "every": "15m",
    "params": { "icsUrl": "https://calendar.google.com/calendar/ical/…/basic.ics" } },
  { "instance": "slack", "source": "messages", "mode": "agent", "every": "5m" },
  { "instance": "gmail", "source": "email", "mode": "agent", "every": "15m", "permissionMode": "auto" }
]
```

This publishes four sources (`code`, `calendar`, `messages`, `email`), each with one
instance.

## Adding a source

- **A provider for an existing source** (say GitLab under `code`): write a module whose
  default export is a provider and point an instance at it with `module`, or define an
  inline agent source. No change to periapsis.
- **A built-in provider**: add it to `packages/reporter/src/providers/` and register it in
  `providers/all.ts`, in a PR.
- **A new kind** of item, with its own dashboard rendering: a PR that adds the kind to
  `packages/core/src/kind.ts` and the hub.

## Testing a source

`periapsis-probe` runs instances once and prints what each source would publish, with no
broker or keys:

```json
{ "account": "personal", "instances": [ { "instance": "github", "provider": "github" } ] }
```

```
PERIAPSIS_LOG=debug node packages/reporter/dist/probe.js probe.json
```

It prints `{ "<source>": { "items": […], "note": "…" } }`, the body the reporter would seal
and publish.
