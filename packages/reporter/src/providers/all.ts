import type { Provider } from "../provider.js"
import { bitbucket } from "./bitbucket.js"
import { calendar } from "./calendar.js"
import { github } from "./github.js"
import { ical } from "./ical.js"
import { jira } from "./jira.js"

// The direct providers available to the reporter and the probe.
export const PROVIDERS = new Map<string, Provider>([
  ["github", github],
  ["bitbucket", bitbucket],
  ["gcal", calendar],
  ["ical", ical],
  ["jira", jira],
])
