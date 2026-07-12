import test from "node:test";
import assert from "node:assert/strict";
import { applyMemoryUpdates, extractHeuristicMemory } from "../src/memory.js";

test("extractHeuristicMemory records a planting and fertilizer reminder", () => {
  const updates = extractHeuristicMemory({
    body: "I planted a tomato today. Remind me when to fertilize it.",
    today: "2026-07-11",
    user: { plantings: [] }
  });

  assert.equal(updates.plantings.length, 1);
  assert.equal(updates.plantings[0].plantName, "tomato");
  assert.equal(updates.plantings[0].plantedAt, "2026-07-11");
  assert.equal(updates.reminders.length, 1);
  assert.equal(updates.reminders[0].task, "fertilize");
  assert.equal(updates.reminders[0].dueDate, "2026-07-25");
});

test("applyMemoryUpdates appends durable planting and reminder records", () => {
  const user = {
    profile: {},
    plantings: [],
    reminders: []
  };
  const updates = {
    profileUpdates: { zip: "94707", country: "US" },
    plantings: [{ plantName: "basil", plantedAt: "2026-07-11" }],
    reminders: [{ task: "water", plantName: "basil", dueDate: "2026-07-13" }]
  };

  const events = applyMemoryUpdates(user, updates, {
    now: "2026-07-11T12:00:00.000Z",
    sourceMessageSid: "SM123"
  });

  assert.equal(user.profile.zip, "94707");
  assert.equal(user.plantings.length, 1);
  assert.equal(user.reminders.length, 1);
  assert.equal(user.reminders[0].status, "pending");
  assert.equal(events.length, 2);
});
