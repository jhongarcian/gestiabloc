import assert from "node:assert/strict"
import { test } from "node:test"

import { registerRealtimeNotification } from "./realtime-notifications.js"

test("registerRealtimeNotification accepts each notification id once", () => {
  const known = new Set(["existing"])

  assert.equal(registerRealtimeNotification(known, "new"), true)
  assert.equal(registerRealtimeNotification(known, "new"), false)
  assert.equal(registerRealtimeNotification(known, "existing"), false)
  assert.deepEqual([...known], ["existing", "new"])
})
