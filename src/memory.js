import { addDays, parseRelativeDate } from "./domain.js";
import { newId } from "./store.js";

const TASK_KEYWORDS = [
  ["fertilize", /\bfertiliz(e|er|ing)?\b/i],
  ["water", /\bwater(ing)?\b/i],
  ["prune", /\bprun(e|ing)?\b/i],
  ["harvest", /\bharvest(ing)?\b/i],
  ["thin seedlings", /\bthin(ning)?\b/i],
  ["harden off", /\bharden\s+off\b/i]
];

export function extractHeuristicMemory({ body, today, user = {} }) {
  const text = String(body || "");
  const profileUpdates = extractProfileUpdates(text);
  const planting = extractPlanting(text, today);
  const plantings = planting ? [planting] : [];
  const reminders = [];

  if (/\bremind\b/i.test(text)) {
    const task = inferTask(text);
    const plantName = planting?.plantName || latestPlantName(user) || inferPlantNameFromText(text);
    const explicitDate = parseReminderDueDate(text, today);
    const dueDate = explicitDate || inferDefaultDueDate(task, planting?.plantedAt || today);

    if (task && dueDate) {
      reminders.push({
        task,
        plantName,
        dueDate,
        instructions: defaultReminderInstructions(task, plantName),
        source: "heuristic"
      });
    }
  }

  return {
    profileUpdates,
    plantings,
    reminders
  };
}

export function applyMemoryUpdates(user, updates, options = {}) {
  const now = options.now || new Date().toISOString();
  const sourceMessageSid = options.sourceMessageSid || "";
  const events = [];

  user.profile = {
    ...(user.profile || {}),
    ...(updates.profileUpdates || {})
  };

  user.plantings ||= [];
  for (const planting of updates.plantings || []) {
    if (!planting.plantName || !planting.plantedAt) {
      continue;
    }

    const duplicate = user.plantings.find(
      (item) =>
        item.plantName.toLowerCase() === planting.plantName.toLowerCase() &&
        item.plantedAt === planting.plantedAt &&
        item.sourceMessageSid === sourceMessageSid
    );
    if (duplicate) {
      continue;
    }

    const record = {
      id: newId("planting"),
      plantName: planting.plantName,
      plantedAt: planting.plantedAt,
      notes: planting.notes || "",
      source: planting.source || "message",
      sourceMessageSid,
      createdAt: now
    };
    user.plantings.push(record);
    events.push(`Saved ${record.plantName} as planted on ${record.plantedAt}.`);
  }

  user.reminders ||= [];
  for (const reminder of updates.reminders || []) {
    if (!reminder.task || !reminder.dueDate) {
      continue;
    }

    const linkedPlanting = findLatestPlanting(user, reminder.plantName);
    const duplicate = user.reminders.find(
      (item) =>
        item.task === reminder.task &&
        item.dueDate === reminder.dueDate &&
        item.plantName === (reminder.plantName || "") &&
        item.sourceMessageSid === sourceMessageSid
    );
    if (duplicate) {
      continue;
    }

    const record = {
      id: newId("reminder"),
      task: reminder.task,
      plantName: reminder.plantName || linkedPlanting?.plantName || "",
      plantingId: linkedPlanting?.id || "",
      dueDate: reminder.dueDate,
      instructions: reminder.instructions || defaultReminderInstructions(reminder.task, reminder.plantName),
      status: "pending",
      source: reminder.source || "message",
      sourceMessageSid,
      createdAt: now
    };
    user.reminders.push(record);
    events.push(`Set a ${record.task} reminder for ${record.plantName || "your garden"} on ${record.dueDate}.`);
  }

  return events;
}

export function memoryExtractionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["profileUpdates", "plantings", "reminders"],
    properties: {
      profileUpdates: {
        type: "object",
        additionalProperties: false,
        required: ["zip", "city", "state", "country", "timeZone"],
        properties: {
          zip: { type: ["string", "null"] },
          city: { type: ["string", "null"] },
          state: { type: ["string", "null"] },
          country: { type: ["string", "null"] },
          timeZone: { type: ["string", "null"] }
        }
      },
      plantings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["plantName", "plantedAt", "notes"],
          properties: {
            plantName: { type: "string" },
            plantedAt: { type: "string", description: "ISO date, YYYY-MM-DD" },
            notes: { type: ["string", "null"] }
          }
        }
      },
      reminders: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["task", "plantName", "dueDate", "instructions"],
          properties: {
            task: { type: "string" },
            plantName: { type: ["string", "null"] },
            dueDate: { type: "string", description: "ISO date, YYYY-MM-DD" },
            instructions: { type: "string" }
          }
        }
      }
    }
  };
}

export function normalizeExtractedMemory(raw) {
  return {
    profileUpdates: removeNullish(raw?.profileUpdates || {}),
    plantings: (raw?.plantings || [])
      .filter((item) => item?.plantName && item?.plantedAt)
      .map((item) => ({
        plantName: cleanPlantName(item.plantName),
        plantedAt: item.plantedAt,
        notes: item.notes || "",
        source: "llm"
      })),
    reminders: (raw?.reminders || [])
      .filter((item) => item?.task && item?.dueDate)
      .map((item) => ({
        task: String(item.task).trim().toLowerCase(),
        plantName: item.plantName ? cleanPlantName(item.plantName) : "",
        dueDate: item.dueDate,
        instructions: item.instructions || "",
        source: "llm"
      }))
  };
}

function extractProfileUpdates(text) {
  const updates = {};
  const zipMatch = text.match(/\b(?:zip(?:\s+code)?(?:\s+is)?|i(?:'m| am)\s+in)\s*(\d{5})(?:-\d{4})?\b/i);
  if (zipMatch) {
    updates.zip = zipMatch[1];
    updates.country = "US";
  }

  const cityStateMatch = text.match(/\b(?:i(?:'m| am)\s+in|my garden is in|located in)\s+([A-Za-z .'-]{2,40}),\s*([A-Z]{2})\b/);
  if (cityStateMatch) {
    updates.city = titleCase(cityStateMatch[1].trim());
    updates.state = cityStateMatch[2].toUpperCase();
    updates.country = "US";
  }

  return updates;
}

function extractPlanting(text, today) {
  const plantingMatch = text.match(
    /\b(?:i\s+)?(?:just\s+)?(?:planted|transplanted|sowed|seeded|started)\s+(?:some\s+|a\s+|an\s+|my\s+)?([a-z][a-z0-9 -]{1,60})/i
  );
  if (!plantingMatch) {
    return null;
  }

  const plantName = cleanPlantName(
    plantingMatch[1]
      .split(/\b(?:today|yesterday|tomorrow|and|but|please|can|could|remind|when|where|in|on)\b|[.,!?;]/i)[0]
      .trim()
  );

  if (!plantName) {
    return null;
  }

  return {
    plantName,
    plantedAt: parseRelativeDate(text, today) || today,
    notes: "",
    source: "heuristic"
  };
}

function inferTask(text) {
  for (const [task, pattern] of TASK_KEYWORDS) {
    if (pattern.test(text)) {
      return task;
    }
  }

  return "check in";
}

function parseReminderDueDate(text, today) {
  const reminderText = text.slice(Math.max(0, text.toLowerCase().indexOf("remind")));
  return parseRelativeDate(reminderText, today);
}

function inferDefaultDueDate(task, plantedAt) {
  if (task === "fertilize") {
    return addDays(plantedAt, 14);
  }
  if (task === "water") {
    return addDays(plantedAt, 2);
  }
  if (task === "harvest") {
    return addDays(plantedAt, 60);
  }
  return addDays(plantedAt, 7);
}

function defaultReminderInstructions(task, plantName = "") {
  const subject = plantName ? `your ${plantName}` : "your plant";
  if (task === "fertilize") {
    return `Check ${subject}. If it is actively growing and not stressed, fertilize lightly according to the product label, then water it in.`;
  }
  if (task === "water") {
    return `Check soil moisture around ${subject}. Water deeply only if the top inch or two is dry.`;
  }
  if (task === "prune") {
    return `Inspect ${subject}. Prune dead, diseased, or crowded growth with clean tools.`;
  }
  return `Check on ${subject} and adjust care based on soil moisture, growth, and weather.`;
}

function inferPlantNameFromText(text) {
  const match = text.match(/\b(?:my|the|a|an)\s+([a-z][a-z -]{2,30})\b/i);
  return match ? cleanPlantName(match[1]) : "";
}

function latestPlantName(user) {
  const latest = [...(user.plantings || [])].sort((a, b) => b.plantedAt.localeCompare(a.plantedAt))[0];
  return latest?.plantName || "";
}

function findLatestPlanting(user, plantName = "") {
  const normalized = plantName.toLowerCase();
  return [...(user.plantings || [])]
    .filter((planting) => !normalized || planting.plantName.toLowerCase() === normalized)
    .sort((a, b) => b.plantedAt.localeCompare(a.plantedAt))[0];
}

function cleanPlantName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b(it|them|this|that)$/i, "")
    .trim();
}

function titleCase(value) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function removeNullish(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== null && entryValue !== undefined && entryValue !== "")
  );
}
