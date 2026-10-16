import { isId } from "./ids.js"

function assertAccount(account: string): void {
  if (!isId(account)) throw new Error(`invalid account id: ${account}`)
}

export function statusSubject(account: string): string {
  assertAccount(account)
  return `status.${account}`
}

export function commandSubject(account: string): string {
  assertAccount(account)
  return `commands.${account}`
}

export const STATUS_WILDCARD = "status.>"
