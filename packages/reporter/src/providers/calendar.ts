import type { InstanceConfig, Provider, ProviderItem, ProviderResult } from "../provider.js"

const TOKEN_URL = "https://oauth2.googleapis.com/token"
const CALENDARS = "https://www.googleapis.com/calendar/v3/calendars"

interface GoogleEvent {
  id: string
  summary?: string
  htmlLink?: string
  updated?: string
  start?: { dateTime?: string; date?: string }
}

async function accessToken(id: string, secret: string, refresh: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  })
  if (!res.ok) throw new Error(`google token ${res.status}`)
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error("google token response had no access_token")
  return json.access_token
}

// Today, in the reporter's local time.
function today(now: Date): { timeMin: string; timeMax: string } {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { timeMin: start.toISOString(), timeMax: end.toISOString() }
}

export function toItem(ev: GoogleEvent, instance: string): ProviderItem {
  const at = ev.start?.dateTime ?? ev.start?.date ?? ""
  return {
    key: ev.id,
    kind: "calendar",
    priority: 2,
    title: ev.summary ?? "(busy)",
    detail: at || undefined,
    url: ev.htmlLink,
    fingerprint: `${ev.updated ?? ""}:${at}`,
    meta: { at, instance },
  }
}

// Params: { clientId, clientSecret, refreshToken, calendarId? }. Reads today's
// events from one calendar, normalized to calendar items.
export const calendar: Provider = {
  source: "calendar",
  async read(config: InstanceConfig): Promise<ProviderResult> {
    const p = config.params
    const id = String(p.clientId ?? "")
    const secret = String(p.clientSecret ?? "")
    const refresh = String(p.refreshToken ?? "")
    const calendarId = String(p.calendarId ?? "primary")
    if (!id || !secret || !refresh)
      throw new Error("calendar instance needs clientId, clientSecret, refreshToken")
    const token = await accessToken(id, secret, refresh)
    const { timeMin, timeMax } = today(new Date())
    const q = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", timeMin, timeMax })
    const res = await fetch(`${CALENDARS}/${encodeURIComponent(calendarId)}/events?${q}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`calendar API ${res.status}`)
    const json = (await res.json()) as { items?: GoogleEvent[] }
    return { items: (json.items ?? []).map((ev) => toItem(ev, config.instance)) }
  },
}
