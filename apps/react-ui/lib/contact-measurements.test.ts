import assert from "node:assert/strict"
import test from "node:test"

import { prepareHeightUpdate, prepareWeightUpdate, readHeightInput, readWeightInput } from "./contact-measurements"

test("stored imperial measurements load into numeric inputs without a false dirty state", () => {
  for (const stored of ["5 ft 2 in", "5f 2in", "5'2\"", "5 feet 2 inches"]) {
    const input = readHeightInput(stored)
    assert.deepEqual(input, { feet: "5", inches: "2", legacyValue: null })
    assert.deepEqual(prepareHeightUpdate(stored, input), { value: undefined, error: null })
  }
  for (const stored of ["260", "260 lb", "260 lbs", "260 pounds"]) {
    const input = readWeightInput(stored)
    assert.deepEqual(input, { pounds: "260", legacyValue: null })
    assert.deepEqual(prepareWeightUpdate(stored, input), { value: undefined, error: null })
  }
})

test("numeric input saves with explicit units, refreshes, and clears to null", () => {
  const height = prepareHeightUpdate(null, { feet: "5", inches: "2", legacyValue: null })
  const weight = prepareWeightUpdate(null, { pounds: "260", legacyValue: null })
  assert.deepEqual(height, { value: "5 ft 2 in", error: null })
  assert.deepEqual(weight, { value: "260 lb", error: null })
  assert.deepEqual(readHeightInput(height.value!), { feet: "5", inches: "2", legacyValue: null })
  assert.deepEqual(readWeightInput(weight.value!), { pounds: "260", legacyValue: null })
  assert.deepEqual(prepareHeightUpdate(height.value!, readHeightInput(null)), { value: null, error: null })
  assert.deepEqual(prepareWeightUpdate(weight.value!, readWeightInput(null)), { value: null, error: null })
})

test("older unrecognized measurements are preserved until explicitly replaced or cleared", () => {
  for (const stored of ["170 cm", "5.5", "not measured"]) {
    assert.deepEqual(prepareHeightUpdate(stored, readHeightInput(stored)), { value: undefined, error: null })
    assert.deepEqual(prepareHeightUpdate(stored, readHeightInput(null)), { value: null, error: null })
    assert.equal(prepareHeightUpdate(stored, { feet: "5", inches: "2", legacyValue: null }).value, "5 ft 2 in")
  }
  for (const stored of ["80 kg", "260.5", "not measured"]) {
    assert.deepEqual(prepareWeightUpdate(stored, readWeightInput(stored)), { value: undefined, error: null })
    assert.deepEqual(prepareWeightUpdate(stored, readWeightInput(null)), { value: null, error: null })
    assert.equal(prepareWeightUpdate(stored, { pounds: "260", legacyValue: null }).value, "260 lb")
  }
})

test("partial heights and invalid numeric entries cannot be submitted", () => {
  for (const [feet, inches] of [["5", ""], ["", "2"], ["5", "12"], ["0", "0"], ["-5", "2"], ["5.5", "2"], ["5", "2x"]]) {
    const result = prepareHeightUpdate(null, { feet, inches, legacyValue: null })
    assert.ok(result.error, `${feet} ft ${inches} in`)
    assert.equal(result.value, undefined)
  }
  for (const pounds of ["0", "-260", "260.5", "2e2", "10000", "260 lb", "260x"]) {
    const result = prepareWeightUpdate(null, { pounds, legacyValue: null })
    assert.ok(result.error, pounds)
    assert.equal(result.value, undefined)
  }
})
