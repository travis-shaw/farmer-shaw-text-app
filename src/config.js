import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(__dirname, "..");

function loadDotenv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function toBool(value, defaultValue = false) {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function toInt(value, defaultValue) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

loadDotenv(path.join(rootDir, ".env"));

export function getConfig(env = process.env) {
  const dataDir = path.resolve(rootDir, env.DATA_DIR || "data");

  return {
    envName: env.NODE_ENV || "development",
    devMode: toBool(env.GARDEN_DEV_MODE, false),
    port: toInt(env.PORT, 3000),
    publicBaseUrl: env.PUBLIC_BASE_URL || "",
    defaultTimeZone: env.DEFAULT_TIME_ZONE || "America/New_York",
    smsCharacterLimit: toInt(env.SMS_CHARACTER_LIMIT, 1400),
    dataDir,
    reminderIntervalMs: toInt(env.REMINDER_INTERVAL_MS, 60000),
    disableReminderWorker: toBool(env.DISABLE_REMINDER_WORKER, false),
    openai: {
      apiKey: env.OPENAI_API_KEY || "",
      baseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      model: env.OPENAI_MODEL || "gpt-5.6",
      inlineMedia: toBool(env.OPENAI_INLINE_MEDIA, false)
    },
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID || "",
      authToken: env.TWILIO_AUTH_TOKEN || "",
      fromNumber: env.TWILIO_FROM_NUMBER || "",
      messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID || "",
      validateSignature: toBool(env.TWILIO_VALIDATE_SIGNATURE, false)
    }
  };
}

export const config = getConfig();
