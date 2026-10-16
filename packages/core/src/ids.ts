const ID = /^[a-z][a-z0-9-]{1,30}$/

export function isId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value)
}

const LINK_HOSTS = [
  /(^|\.)slack\.com$/,
  /^(mail|calendar|docs|drive)\.google\.com$/,
  /(^|\.)atlassian\.net$/,
  /^linear\.app$/,
  /(^|\.)notion\.(so|com)$/,
  /^github\.com$/,
  /(^|\.)bitbucket\.org$/,
]

export function safeLink(value: unknown): string | null {
  if (typeof value !== "string") return null
  try {
    const u = new URL(value)
    return u.protocol === "https:" && LINK_HOSTS.some((re) => re.test(u.hostname)) ? u.href : null
  } catch {
    return null
  }
}
