import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import https from "node:https"
import { Readable } from "node:stream"
import { test } from "node:test"
import { fetchAiWebpage } from "./ai-source-web.js"
import { AiSourceError, AI_WEB_MAX_BYTES } from "./ai-source-types.js"

test("web fetching pins validated DNS, refuses private redirects, limits bytes and fetches no page assets", async (t) => {
  const original = https.get
  t.after(() => {
    https.get = original
  })
  let calls = 0
  let response: {
    status: number
    headers: Record<string, string>
    body: string
  } = {
    status: 302,
    headers: { location: "http://127.0.0.1/private" },
    body: "",
  }
  https.get = ((_url: unknown, options: unknown, callback: unknown) => {
    calls++
    const config = options as unknown as {
      lookup: (
        host: string,
        options: unknown,
        cb: (error: unknown, address: string, family: number) => void,
      ) => void
      headers: Record<string, string>
    }
    config.lookup("public.example", {}, (_error, address, family) => {
      assert.equal(address, "8.8.8.8")
      assert.equal(family, 4)
    })
    assert.equal("Cookie" in config.headers, false)
    assert.equal("Authorization" in config.headers, false)
    const request = new EventEmitter()
    queueMicrotask(() => {
      const incoming = Readable.from([
        Buffer.from(response.body),
      ]) as Readable & { statusCode: number; headers: Record<string, string> }
      incoming.statusCode = response.status
      incoming.headers = response.headers
      ;(callback as unknown as (stream: typeof incoming) => void)(incoming)
    })
    return request
  }) as unknown as typeof https.get
  const dns = async () => [{ address: "8.8.8.8", family: 4 }]
  await assert.rejects(
    fetchAiWebpage("https://public.example", dns),
    (error) =>
      error instanceof AiSourceError && error.code === "INVALID_SOURCE_URL",
  )
  assert.equal(calls, 1)
  response = {
    status: 200,
    headers: {
      "content-type": "text/html",
      "content-length": String(AI_WEB_MAX_BYTES + 1),
    },
    body: "",
  }
  await assert.rejects(
    fetchAiWebpage("https://public.example", dns),
    (error) =>
      error instanceof AiSourceError && error.code === "WEBPAGE_TOO_LARGE",
  )
  response = {
    status: 200,
    headers: { "content-type": "text/html" },
    body: '<main><p>Cedar code W-42.</p><img src="https://assets.example/image.png"/><script src="https://assets.example/run.js"></script></main>',
  }
  const before = calls
  assert.match(
    (await fetchAiWebpage("https://public.example", dns)).text,
    /W-42/,
  )
  assert.equal(calls, before + 1)
  response = {
    status: 302,
    headers: { location: "https://public.example/next" },
    body: "",
  }
  await assert.rejects(
    fetchAiWebpage("https://public.example", dns),
    (error) =>
      error instanceof AiSourceError && error.code === "TOO_MANY_REDIRECTS",
  )
})
