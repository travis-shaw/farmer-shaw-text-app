import test from "node:test";
import assert from "node:assert/strict";
import { parseTwilioMessage, splitSms, twimlResponse } from "../src/twilio.js";

test("parseTwilioMessage collects text, sender, and media", () => {
  const params = new URLSearchParams({
    MessageSid: "SM123",
    From: "+15555550100",
    To: "+15555550199",
    Body: "What is wrong with this tomato?",
    NumMedia: "1",
    MediaUrl0: "https://api.twilio.com/media/image.jpg",
    MediaContentType0: "image/jpeg",
    FromCity: "BERKELEY",
    FromState: "CA",
    FromZip: "94707"
  });

  const parsed = parseTwilioMessage(params);

  assert.equal(parsed.from, "+15555550100");
  assert.equal(parsed.body, "What is wrong with this tomato?");
  assert.equal(parsed.media.length, 1);
  assert.equal(parsed.media[0].contentType, "image/jpeg");
  assert.equal(parsed.location.zip, "94707");
});

test("twimlResponse escapes XML content", () => {
  const xml = twimlResponse(["Tomatoes need <sun> & water"]);

  assert.match(xml, /&lt;sun&gt; &amp; water/);
  assert.match(xml, /^<\?xml/);
});

test("splitSms keeps chunks under the limit", () => {
  const chunks = splitSms("a ".repeat(50), 25);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 25));
});
