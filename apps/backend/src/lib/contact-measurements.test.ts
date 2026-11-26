import assert from "node:assert/strict"
import test from "node:test"
import { z } from "zod"

import {
  optionalContactHeightSchema,
  optionalContactWeightSchema,
} from "./contact-measurements.js"

const schema = z.object({ height: optionalContactHeightSchema, weight: optionalContactWeightSchema })

test("contact measurements normalize whole-number feet, inches, and pounds", () => {
  for (const height of ["5 ft 2 in", "5f 2in", "5'2\"", " 5 FEET 2 INCHES "]) {
    for (const weight of ["260", "260 lb", "260 lbs", "260 pounds", " 0260 LB "]) {
      assert.deepEqual(schema.parse({ height, weight }), { height: "5 ft 2 in", weight: "260 lb" })
    }
  }
  assert.equal(schema.parse({ height: "0 ft 8 in" }).height, "0 ft 8 in")
  assert.equal(schema.parse({ height: "9 ft 11 in", weight: "9999" }).weight, "9999 lb")
})

test("contact measurement PATCH omissions preserve data and empty values clear it", () => {
  assert.deepEqual(schema.parse({}), {})
  assert.deepEqual(schema.parse({ height: null, weight: null }), { height: null, weight: null })
  assert.deepEqual(schema.parse({ height: "  ", weight: "" }), { height: null, weight: null })
})

test("height rejects text, partial measurements, invalid inches, and non-integer numbers", () => {
  for (const height of [
    "tall", "5", "5 ft", "2 in", "5 ft 12 in", "0 ft 0 in", "10 ft 0 in",
    "-5 ft 2 in", "5.5 ft 2 in", "5 ft 2.5 in", "5e0 ft 2 in", "170 cm",
    "<script>5 ft 2 in</script>", "5 ft 2 in extra", 62, {}, ["5 ft 2 in"],
  ]) {
    assert.equal(schema.safeParse({ height }).success, false, JSON.stringify(height))
  }
})

test("weight rejects text, signs, decimal/scientific notation, wrong units, and non-strings", () => {
  for (const weight of [
    "heavy", "0", "0000", "-260", "+260", "260.5", "2.6e2", "10000", "260 kg",
    "260 lb extra", "260<script>", 260, {}, ["260"], true,
  ]) {
    assert.equal(schema.safeParse({ weight }).success, false, JSON.stringify(weight))
  }
})
