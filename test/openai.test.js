import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIClient } from "../src/openai.js";

test("Twilio media is inlined when Twilio credentials are configured", () => {
  const client = new OpenAIClient({
    openai: {
      inlineMedia: false
    },
    twilio: {
      accountSid: "AC123",
      authToken: "secret"
    }
  });

  assert.equal(
    client.shouldInlineMedia({
      url: "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/MM123/Media/ME123"
    }),
    true
  );
});

test("non-Twilio media is not inlined by default", () => {
  const client = new OpenAIClient({
    openai: {
      inlineMedia: false
    },
    twilio: {
      accountSid: "AC123",
      authToken: "secret"
    }
  });

  assert.equal(
    client.shouldInlineMedia({
      url: "https://example.com/tomato.jpg"
    }),
    false
  );
});
