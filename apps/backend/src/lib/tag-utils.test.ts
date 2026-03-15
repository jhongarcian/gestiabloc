import { describe, test } from "node:test"
import assert from "node:assert/strict"

import {
  normalizeTagSearchTerm,
  normalizeTenantTagName,
  parseCsvIds,
} from "./tag-utils.js"

describe("normalizeTenantTagName", () => {
  test("converts spaces to hyphens and lowercases", () => {
    assert.equal(normalizeTenantTagName("VIP Client"), "vip-client")
  })

  test("preserves hyphens and collapses separators", () => {
    assert.equal(normalizeTenantTagName("vip---client"), "vip-client")
    assert.equal(normalizeTenantTagName(" vip__client "), "vip-client")
  })

  test("returns empty string when no alphanumeric characters remain", () => {
    assert.equal(normalizeTenantTagName(" --- "), "")
  })
})

describe("normalizeTagSearchTerm", () => {
  test("uses the same slug normalization as tenant tags", () => {
    assert.equal(normalizeTagSearchTerm(" High Priority "), "high-priority")
  })
})

describe("parseCsvIds", () => {
  test("parses, trims, deduplicates, and removes empty items", () => {
    assert.deepEqual(parseCsvIds("a, b,,a, c "), ["a", "b", "c"])
  })

  test("returns an empty array for blank input", () => {
    assert.deepEqual(parseCsvIds(""), [])
  })
})
