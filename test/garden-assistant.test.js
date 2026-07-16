import test from "node:test";
import assert from "node:assert/strict";
import { GardenAssistant } from "../src/garden-assistant.js";

test("photo messages fall back to a helpful reply when image analysis fails", async () => {
  const assistant = new GardenAssistant({
    store: null,
    config: {
      defaultTimeZone: "America/New_York"
    },
    openai: {
      enabled: true,
      async mediaContentItems() {
        throw new Error("Media download failed: 401");
      }
    }
  });

  const reply = await assistant.generateReply({
    message: {
      body: "Why are these leaves yellow?",
      media: [
        {
          url: "https://api.twilio.com/media/image.jpg",
          contentType: "image/jpeg"
        }
      ]
    },
    user: {
      profile: {},
      plantings: [],
      reminders: []
    },
    events: [],
    today: "2026-07-15",
    priorConversation: []
  });

  assert.match(reply, /I received the photo/);
  assert.match(reply, /could not analyze the image just now/);
});
