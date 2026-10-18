// DNS labels separated by dots (or an IPv4 address); anything else, such as a
// stray brace from a shell typo, is a mistake the URL parser would let through.
const HOSTNAME =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/

// Why `value` is not a usable URL for `flag`, or null when it is.
export function urlProblem(value: string, protocols: string[], flag: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return `${flag} ${JSON.stringify(value)} is not a URL`
  }
  if (!protocols.includes(url.protocol))
    return `${flag} ${JSON.stringify(value)} must use ${protocols.map((p) => `${p}//`).join(" or ")}`
  if (!HOSTNAME.test(url.hostname))
    return `${flag} ${JSON.stringify(value)} has an invalid host ${JSON.stringify(url.hostname)}`
  return null
}
