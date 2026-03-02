import { parsePhoneNumberFromString } from "libphonenumber-js"

export function formatPhoneNumber(value: string | null | undefined) {
  if (!value) {
    return "—"
  }

  const phoneNumber = parsePhoneNumberFromString(value)
  if (!phoneNumber) {
    return value
  }

  if (phoneNumber.countryCallingCode === "1") {
    return `+1 ${phoneNumber.formatNational()}`
  }

  return phoneNumber.formatInternational()
}
