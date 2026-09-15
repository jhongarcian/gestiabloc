export const TRANSACTION_SEARCH_DEBOUNCE_MS = 300
export const TRANSACTION_SEARCH_MAX_LENGTH = 120

const INVISIBLE_OR_CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/gu

export function sanitizeTransactionSearchInput(value: string) {
  return value
    .normalize("NFKC")
    .replace(INVISIBLE_OR_CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .replace(/^\s+/, "")
    .slice(0, TRANSACTION_SEARCH_MAX_LENGTH)
}

export function sanitizeTransactionSearchQuery(value: string) {
  return sanitizeTransactionSearchInput(value).trim()
}
