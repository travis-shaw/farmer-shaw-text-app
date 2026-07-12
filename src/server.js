import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { config, rootDir } from "./config.js";
import { createStore } from "./store.js";
import { OpenAIClient } from "./openai.js";
import { GardenAssistant } from "./garden-assistant.js";
import {
  parseTwilioMessage,
  splitSms,
  twimlResponse,
  validateTwilioSignature
} from "./twilio.js";
import { startReminderLoop } from "./reminders.js";

const store = createStore(config);
const openai = new OpenAIClient(config);
const assistant = new GardenAssistant({ store, openai, config });
const stopReminders = config.disableReminderWorker ? null : startReminderLoop({ store, config });

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    console.error(error.stack || error.message);
    sendJson(res, 500, {
      error: "internal_error",
      message: config.devMode ? error.message : "Something went wrong."
    });
  }
});

server.listen(config.port, () => {
  console.log(`Farmer Shaw listening on http://localhost:${config.port}`);
  console.log(`Storage: ${path.join(config.dataDir, "store.json")}`);
});

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      openai: openai.enabled,
      reminders: !config.disableReminderWorker
    });
    return;
  }

  if (
    ["GET", "HEAD"].includes(req.method) &&
    ["/", "/privacy", "/terms", "/sms"].includes(url.pathname)
  ) {
    await serveStaticPage(url.pathname, res, req.method);
    return;
  }

  if (req.method === "POST" && url.pathname === "/webhooks/twilio/sms") {
    await handleTwilioWebhook(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/dev/sms") {
    await handleDevSms(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/dev/state" && config.devMode) {
    sendJson(res, 200, await store.getState());
    return;
  }

  sendJson(res, 404, {
    error: "not_found"
  });
}

async function handleTwilioWebhook(req, res) {
  const rawBody = await readBody(req);
  const params = new URLSearchParams(rawBody);

  if (config.twilio.validateSignature) {
    const signature = req.headers["x-twilio-signature"];
    const requestUrl = publicRequestUrl(req);
    const valid = validateTwilioSignature({
      url: requestUrl,
      params,
      signature,
      authToken: config.twilio.authToken
    });

    if (!valid) {
      sendText(res, 403, "Invalid Twilio signature");
      return;
    }
  }

  const message = parseTwilioMessage(params);
  const keywordReply = complianceKeywordReply(message.body);
  if (keywordReply) {
    sendXml(res, 200, twimlResponse([keywordReply]));
    return;
  }

  const result = await assistant.handleInboundMessage(message);
  const chunks = splitSms(result.reply, config.smsCharacterLimit);

  sendXml(res, 200, twimlResponse(chunks));
}

async function handleDevSms(req, res) {
  const rawBody = await readBody(req);
  const payload = parseRequestPayload(req, rawBody);
  const media = normalizeDevMedia(payload.media || payload.mediaUrl || payload.imageUrl);
  const message = {
    provider: "dev",
    messageSid: `dev_${Date.now()}`,
    from: payload.from || "+15555550100",
    to: payload.to || config.twilio.fromNumber || "+15555550199",
    body: payload.body || payload.Body || "",
    media,
    location: payload.location || {},
    raw: payload
  };

  const keywordReply = complianceKeywordReply(message.body);
  if (keywordReply) {
    sendJson(res, 200, {
      reply: keywordReply,
      memoryUpdates: [],
      reminder: null
    });
    return;
  }

  const result = await assistant.handleInboundMessage(message);
  sendJson(res, 200, result);
}

function complianceKeywordReply(body) {
  const keyword = String(body || "").trim().toUpperCase();

  if (["START", "YES", "UNSTOP"].includes(keyword)) {
    return "Farmer Shaw: You are now opted in to receive conversational garden help, plant photo replies, and reminders you request. Message frequency varies. Message and data rates may apply. Reply HELP for help or STOP to opt out.";
  }

  if (["HELP", "INFO"].includes(keyword)) {
    return "Farmer Shaw: For help, text your garden or plant question and we will reply. Message frequency varies. Message and data rates may apply. Reply STOP to opt out.";
  }

  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(keyword)) {
    return "Farmer Shaw: You have opted out and will no longer receive messages. Reply START to opt back in.";
  }

  return null;
}

function parseRequestPayload(req, rawBody) {
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("application/json")) {
    return JSON.parse(rawBody || "{}");
  }

  return Object.fromEntries(new URLSearchParams(rawBody).entries());
}

function normalizeDevMedia(value) {
  if (!value) {
    return [];
  }

  const values = Array.isArray(value) ? value : String(value).split(",");
  return values
    .map((url, index) => ({
      url: String(url).trim(),
      contentType: "image/jpeg",
      index
    }))
    .filter((item) => item.url);
}

function publicRequestUrl(req) {
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl.replace(/\/$/, "")}${req.url}`;
  }

  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${req.headers.host}${req.url}`;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res, status, payload) {
  sendText(res, status, JSON.stringify(payload, null, 2), "application/json; charset=utf-8");
}

function sendXml(res, status, payload) {
  sendText(res, status, payload, "application/xml; charset=utf-8");
}

function sendText(res, status, payload, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType
  });
  res.end(payload);
}

async function serveStaticPage(pathname, res, method = "GET") {
  const fileName = pathname === "/" ? "index.html" : `${pathname.slice(1)}.html`;
  const filePath = path.join(rootDir, "public", fileName);

  try {
    const content = await fs.readFile(filePath, "utf8");
    if (method === "HEAD") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(content)
      });
      res.end();
      return;
    }

    sendText(res, 200, content, "text/html; charset=utf-8");
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    throw error;
  }
}

function shutdown() {
  stopReminders?.();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
