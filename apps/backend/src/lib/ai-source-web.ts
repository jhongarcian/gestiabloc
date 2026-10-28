import { lookup } from "node:dns/promises"
import http from "node:http"
import https from "node:https"
import { convert } from "html-to-text"
import {
  AI_WEB_MAX_BYTES,
  AiSourceError,
  publicIp,
  sourceUrl,
} from "./ai-source-types.js"

export type PublicLookup = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>
export async function resolvePublicHost(
  hostname: string,
  resolve: PublicLookup = (host) => lookup(host, { all: true, verbatim: true }),
) {
  const addresses = await resolve(hostname.replace(/^\[|\]$/g, ""))
  if (!addresses.length || addresses.some((entry) => !publicIp(entry.address)))
    throw new AiSourceError(
      400,
      "UNSAFE_SOURCE_URL",
      "The webpage must resolve only to public internet addresses.",
    )
  return addresses.find((address) => address.family === 4) ?? addresses[0]
}
export function webpageText(html: string) {
  return convert(html, {
    wordwrap: false,
    limits: {
      maxInputLength: AI_WEB_MAX_BYTES,
      maxDepth: 60,
      maxChildNodes: 100_000,
    },
    selectors: [
      ...[
        "script",
        "style",
        "nav",
        "footer",
        "form",
        "iframe",
        "noscript",
        "svg",
        "img",
      ].map((selector) => ({ selector, format: "skip" })),
      { selector: "a", options: { ignoreHref: true } },
    ],
  })
}
export async function fetchAiWebpage(rawUrl: string, resolve?: PublicLookup) {
  let current = sourceUrl(rawUrl)
  const signal = AbortSignal.timeout(25_000)
  for (let redirects = 0; redirects <= 3; redirects++) {
    const url = new URL(current)
    const address = await Promise.race([
      resolvePublicHost(url.hostname, resolve),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new AiSourceError(
                400,
                "DNS_TIMEOUT",
                "The webpage address could not be resolved in time.",
              ),
            ),
          5_000,
        )
        timer.unref()
      }),
    ])
    signal.throwIfAborted()
    const result = await new Promise<{ redirect?: string; text?: string }>(
      (resolve, reject) => {
        const request = (url.protocol === "https:" ? https : http).get(
          url,
          {
            signal,
            agent: false,
            family: address.family,
            maxHeaderSize: 16384,
            lookup: (_hostname, _options, callback) =>
              callback(null, address.address, address.family),
            headers: {
              "User-Agent": "Gestiabloc-Knowledge/1.0",
              Accept: "text/html,application/xhtml+xml,text/plain",
              "Accept-Encoding": "identity",
            },
          },
          (response) => {
            void (async () => {
              if (
                [301, 302, 303, 307, 308].includes(response.statusCode ?? 0)
              ) {
                const destination = response.headers.location
                response.destroy()
                if (!destination)
                  throw new AiSourceError(
                    400,
                    "INVALID_REDIRECT",
                    "The webpage returned an invalid redirect.",
                  )
                resolve({ redirect: sourceUrl(new URL(destination, url).href) })
                return
              }
              if (response.statusCode !== 200) {
                response.destroy()
                throw new AiSourceError(
                  400,
                  "WEBPAGE_UNAVAILABLE",
                  "The webpage could not be read. Check that it is publicly accessible.",
                )
              }
              const type = response.headers["content-type"]
                ?.split(";")[0]
                .trim()
                .toLowerCase()
              if (
                !["text/html", "application/xhtml+xml", "text/plain"].includes(
                  type ?? "",
                )
              ) {
                response.destroy()
                throw new AiSourceError(
                  400,
                  "UNSUPPORTED_WEBPAGE",
                  "Use a webpage or plain text URL. Upload documents as files instead.",
                )
              }
              if (
                response.headers["content-encoding"] &&
                response.headers["content-encoding"] !== "identity"
              ) {
                response.destroy()
                throw new AiSourceError(
                  400,
                  "UNSUPPORTED_ENCODING",
                  "The webpage requires an unsupported compressed response.",
                )
              }
              if (
                Number(response.headers["content-length"] ?? 0) >
                AI_WEB_MAX_BYTES
              ) {
                response.destroy()
                throw new AiSourceError(
                  400,
                  "WEBPAGE_TOO_LARGE",
                  "Webpages must be no larger than 2 MB.",
                )
              }
              let size = 0
              const parts: Buffer[] = []
              for await (const part of response) {
                size += part.length
                if (size > AI_WEB_MAX_BYTES) {
                  response.destroy()
                  throw new AiSourceError(
                    400,
                    "WEBPAGE_TOO_LARGE",
                    "Webpages must be no larger than 2 MB.",
                  )
                }
                parts.push(Buffer.from(part))
              }
              const body = new TextDecoder("utf-8", { fatal: true }).decode(
                Buffer.concat(parts),
              )
              resolve({
                text: type === "text/plain" ? body : webpageText(body),
              })
            })().catch(reject)
          },
        )
        request.on("error", reject)
      },
    )
    if (result.redirect) {
      current = result.redirect
      continue
    }
    return { text: result.text ?? "", finalUrl: current }
  }
  throw new AiSourceError(
    400,
    "TOO_MANY_REDIRECTS",
    "The webpage redirects too many times. Use its final public URL.",
  )
}
