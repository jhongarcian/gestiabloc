import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, test } from "node:test"
import type { Request } from "express"

import { enforceSameOrigin, getAllowedWebOrigins } from "./security.js"

describe("trusted web origins", () => {
  const environmentKeys = ["WEB_ORIGIN", "WEB_ADDITIONAL_ORIGINS"] as const
  let originalEnvironment: Array<string | undefined>

  beforeEach(() => {
    originalEnvironment = environmentKeys.map((key) => process.env[key])
    for (const key of environmentKeys) delete process.env[key]
  })

  afterEach(() => {
    environmentKeys.forEach((key, index) => {
      const value = originalEnvironment[index]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
  })

  function requestWithOrigin(origin?: string) {
    return { headers: { origin } } as Request
  }

  test("defaults to the primary local frontend without trusting other ports", () => {
    assert.deepEqual(getAllowedWebOrigins(), ["http://localhost:3000"])
    assert.throws(
      () => enforceSameOrigin(requestWithOrigin("http://localhost:3001")),
      { message: "Invalid origin", status: 403 },
    )
  })

  test("allows the explicitly configured second frontend for loading and saving", () => {
    process.env.WEB_ORIGIN = "http://localhost:3000"
    process.env.WEB_ADDITIONAL_ORIGINS = "http://localhost:3001"

    assert.deepEqual(getAllowedWebOrigins(), [
      "http://localhost:3000",
      "http://localhost:3001",
    ])
    for (const origin of getAllowedWebOrigins()) {
      assert.doesNotThrow(() => enforceSameOrigin(requestWithOrigin(origin)))
    }
    assert.equal(process.env.WEB_ORIGIN, "http://localhost:3000")
  })

  test("trims, normalizes, and deduplicates a comma-separated additional allowlist", () => {
    process.env.WEB_ORIGIN = " http://localhost:3000/ "
    process.env.WEB_ADDITIONAL_ORIGINS =
      " http://localhost:3001/ , ,http://localhost:3000,http://localhost:3001, "

    assert.deepEqual(getAllowedWebOrigins(), [
      "http://localhost:3000",
      "http://localhost:3001",
    ])
  })

  test("preserves www aliases for configured domains", () => {
    process.env.WEB_ORIGIN = "https://app.example.com/"
    process.env.WEB_ADDITIONAL_ORIGINS = "https://www.preview.example.com/"

    assert.deepEqual(getAllowedWebOrigins(), [
      "https://app.example.com",
      "https://www.app.example.com",
      "https://www.preview.example.com",
      "https://preview.example.com",
    ])
  })

  test("does not implicitly trust localhost when configured for production", () => {
    process.env.WEB_ORIGIN = "https://app.example.com"

    assert.throws(
      () => enforceSameOrigin(requestWithOrigin("http://localhost:3001")),
      { message: "Invalid origin", status: 403 },
    )
  })

  test("rejects unlisted ports, hosts, schemes, and deceptive subdomains", () => {
    process.env.WEB_ADDITIONAL_ORIGINS = "http://localhost:3001"

    for (const origin of [
      "http://localhost:3002",
      "http://127.0.0.1:3001",
      "https://localhost:3001",
      "http://localhost.attacker.example:3001",
      "https://attacker.example",
      "null",
    ]) {
      assert.throws(() => enforceSameOrigin(requestWithOrigin(origin)), {
        message: "Invalid origin",
        status: 403,
      })
    }
  })

  test("continues accepting non-browser requests without an Origin header", () => {
    assert.doesNotThrow(() => enforceSameOrigin(requestWithOrigin()))
  })
})
