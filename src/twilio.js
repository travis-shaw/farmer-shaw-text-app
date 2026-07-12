import crypto from "node:crypto";

export function parseTwilioMessage(params) {
  const get = (name) => params.get(name) || "";
  const numMedia = Number.parseInt(get("NumMedia") || "0", 10) || 0;
  const media = [];

  for (let index = 0; index < numMedia; index += 1) {
    const url = get(`MediaUrl${index}`);
    if (!url) {
      continue;
    }

    media.push({
      url,
      contentType: get(`MediaContentType${index}`),
      index
    });
  }

  return {
    provider: "twilio",
    messageSid: get("MessageSid") || get("SmsMessageSid") || get("SmsSid"),
    accountSid: get("AccountSid"),
    from: get("From"),
    to: get("To"),
    body: get("Body"),
    media,
    location: {
      city: get("FromCity"),
      state: get("FromState"),
      zip: get("FromZip"),
      country: get("FromCountry"),
      latitude: get("Latitude"),
      longitude: get("Longitude"),
      address: get("Address")
    },
    raw: Object.fromEntries(params.entries())
  };
}

export function twimlResponse(messages) {
  const body = messages
    .filter(Boolean)
    .map((message) => `  <Message>${escapeXml(message)}</Message>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${body}\n</Response>`;
}

export function splitSms(text, limit = 1400) {
  const normalized = String(text || "").trim();
  if (normalized.length <= limit) {
    return normalized ? [normalized] : [];
  }

  const chunks = [];
  let remaining = normalized;

  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut < limit * 0.6) {
      cut = remaining.lastIndexOf(" ", limit);
    }
    if (cut < limit * 0.6) {
      cut = limit;
    }

    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

export function validateTwilioSignature({ url, params, signature, authToken }) {
  if (!signature || !authToken || !url) {
    return false;
  }

  const sorted = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const base = `${url}${sorted.map(([key, value]) => `${key}${value}`).join("")}`;
  const expected = crypto.createHmac("sha1", authToken).update(base).digest("base64");

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function sendSms({ to, body }, config) {
  const { accountSid, authToken, fromNumber, messagingServiceSid } = config.twilio;
  if (!accountSid || !authToken || (!fromNumber && !messagingServiceSid)) {
    console.log(`[sms:dev] To ${to}: ${body}`);
    return { dev: true };
  }

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const form = new URLSearchParams();
  form.set("To", to);
  form.set("Body", body);

  if (messagingServiceSid) {
    form.set("MessagingServiceSid", messagingServiceSid);
  } else {
    form.set("From", fromNumber);
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Twilio send failed: ${response.status} ${JSON.stringify(payload)}`);
  }

  return payload;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
