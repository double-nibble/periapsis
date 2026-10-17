import type { InstanceConfig, Provider, ProviderItem, ProviderResult } from "../provider.js"
import { monthWindow } from "./window.js"

const TOKEN_URL = "https://oauth2.googleapis.com/token"
const CALENDARS = "https://www.googleapis.com/calendar/v3/calendars"
const CALENDAR_LIST = "https://www.googleapis.com/calendar/v3/users/me/calendarList"

interface GoogleEvent {
  id: string
  summary?: string
  htmlLink?: string
  updated?: string
  start?: { dateTime?: string; date?: string }
}

interface CalendarRef {
  id: string
  summary?: string
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
  if (!res.ok) throw new Error(`google token ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error("google token response had no access_token")
  return json.access_token
}

async function listCalendars(token: string): Promise<CalendarRef[]> {
  const res = await fetch(CALENDAR_LIST, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`calendarList ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = (await res.json()) as { items?: CalendarRef[] }
  return json.items ?? []
}

async function fetchEvents(
  token: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<GoogleEvent[]> {
  const q = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", timeMin, timeMax })
  const res = await fetch(`${CALENDARS}/${encodeURIComponent(calendarId)}/events?${q}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`calendar API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = (await res.json()) as { items?: GoogleEvent[] }
  return json.items ?? []
}

export function toItem(ev: GoogleEvent, instance: string, calendar?: CalendarRef): ProviderItem {
  const at = ev.start?.dateTime ?? ev.start?.date ?? ""
  return {
    key: calendar ? `${calendar.id}/${ev.id}` : ev.id,
    kind: "calendar",
    priority: 2,
    title: ev.summary ?? "(busy)",
    detail: at || undefined,
    url: ev.htmlLink,
    group: calendar?.summary,
    fingerprint: `${ev.updated ?? ""}:${at}`,
    meta: { at, instance },
  }
}

// Params: { clientId, clientSecret, refreshToken, calendarId? }. Reads today's
// events. With calendarId, reads that calendar; without, reads every calendar
// in the account's list, including subscribed ones owned by others.
export const calendar: Provider = {
  source: "calendar",
  async read(config: InstanceConfig): Promise<ProviderResult> {
    const p = config.params ?? {}
    const id = String(p.clientId ?? "")
    const secret = String(p.clientSecret ?? "")
    const refresh = String(p.refreshToken ?? "")
    if (!id || !secret || !refresh)
      throw new Error("calendar instance needs clientId, clientSecret, refreshToken")
    const token = await accessToken(id, secret, refresh)
    const { start, end } = monthWindow(new Date())
    const timeMin = start.toISOString()
    const timeMax = end.toISOString()
    const calendarId = p.calendarId ? String(p.calendarId) : ""
    const calendars = calendarId ? [{ id: calendarId }] : await listCalendars(token)
    const items: ProviderItem[] = []
    for (const cal of calendars) {
      for (const ev of await fetchEvents(token, cal.id, timeMin, timeMax)) {
        items.push(toItem(ev, config.instance, cal))
      }
    }
    return { items }
  },
}
