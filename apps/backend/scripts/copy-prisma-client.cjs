const { cpSync, existsSync, mkdirSync } = require("node:fs")
const { resolve } = require("node:path")

const source = resolve(__dirname, "../src/generated/prisma")
const target = resolve(__dirname, "../dist/generated/prisma")
if (!existsSync(resolve(source, "index.js"))) {
  throw new Error("Generate the Prisma client before building the backend.")
}
mkdirSync(target, { recursive: true })
cpSync(source, target, { recursive: true })
