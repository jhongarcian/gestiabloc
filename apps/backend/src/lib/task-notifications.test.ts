import assert from "node:assert/strict"
import { test } from "node:test"

import { setRealtimeServer } from "./realtime.js"
import { emitStoredNotifications } from "./task-notifications.js"

test("emitStoredNotifications sends a committed automation notification to the user room", async () => {
  const emissions: Array<{ room: string; event: string; payload: Record<string, unknown> }> = []
  let room = ""
  setRealtimeServer({
    to: (nextRoom: string) => {
      room = nextRoom
      return {
        emit: (event: string, payload: Record<string, unknown>) => {
          emissions.push({ room, event, payload })
        },
      }
    },
  } as any)

  try {
    await emitStoredNotifications(["notification-1"], {
      notification: {
        findMany: async () => [{
          id: "notification-1",
          tenantId: "tenant-1",
          userId: "user-1",
          contactId: "contact-1",
          type: "AUTOMATION_NOTIFICATION",
          title: "Review Taylor Reed",
          body: "Open the contact for details.",
          readAt: null,
          createdAt: new Date("2026-10-02T15:00:00.000Z"),
          taskId: null,
          taskReminderId: null,
        }],
      },
    })
  } finally {
    setRealtimeServer(null)
  }

  assert.equal(emissions.length, 1)
  assert.equal(emissions[0]?.room, "user:user-1")
  assert.equal(emissions[0]?.event, "notification:created")
  assert.deepEqual(emissions[0]?.payload, {
    id: "notification-1",
    tenantId: "tenant-1",
    userId: "user-1",
    contactId: "contact-1",
    type: "AUTOMATION_NOTIFICATION",
    title: "Review Taylor Reed",
    body: "Open the contact for details.",
    readAt: null,
    createdAt: "2026-10-02T15:00:00.000Z",
    taskId: null,
    taskReminderId: null,
  })
})
