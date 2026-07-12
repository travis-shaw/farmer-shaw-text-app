import { todayInTimeZone, seasonForDate, formatUserLocation, daysBetween } from "./domain.js";
import { GARDEN_ASSISTANT_INSTRUCTIONS } from "./prompts.js";
import {
  applyMemoryUpdates,
  extractHeuristicMemory,
  normalizeExtractedMemory
} from "./memory.js";
import { extractOutputText } from "./openai.js";

const MAX_HISTORY_MESSAGES = 8;

export class GardenAssistant {
  constructor({ store, openai, config }) {
    this.store = store;
    this.openai = openai;
    this.config = config;
  }

  async handleInboundMessage(message) {
    const today = todayInTimeZone(this.config.defaultTimeZone);
    const existingUser = await this.store.getUser(message.from);
    const userWithProviderLocation = mergeProviderLocation(existingUser, message.location);
    const updates = await this.extractMemory(message, userWithProviderLocation, today);
    const priorConversation = existingUser.conversation || [];
    const now = new Date().toISOString();

    const events = await this.store.mutateUser(message.from, (user) => {
      user.profile = mergeProviderLocation(user, message.location).profile;
      return applyMemoryUpdates(user, updates, {
        now,
        sourceMessageSid: message.messageSid
      });
    });

    const updatedUser = await this.store.getUser(message.from);
    const reply = await this.generateReply({
      message,
      user: updatedUser,
      events,
      today,
      priorConversation
    });

    await this.store.mutateUser(message.from, (user) => {
      user.conversation ||= [];
      user.conversation.push({
        role: "user",
        body: message.body || (message.media?.length ? "[image]" : ""),
        mediaCount: message.media?.length || 0,
        providerMessageSid: message.messageSid,
        createdAt: now
      });
      user.conversation.push({
        role: "assistant",
        body: reply,
        createdAt: new Date().toISOString()
      });
      user.conversation = user.conversation.slice(-40);
    });

    return {
      reply,
      events,
      user: updatedUser
    };
  }

  async extractMemory(message, user, today) {
    const heuristic = extractHeuristicMemory({
      body: message.body,
      today,
      user
    });

    if (!this.openai.enabled || !message.body) {
      return heuristic;
    }

    try {
      const llmUpdates = await this.openai.extractMemory({
        body: message.body,
        today,
        user
      });

      if (!llmUpdates) {
        return heuristic;
      }

      return mergeMemoryUpdates(heuristic, normalizeExtractedMemory(llmUpdates));
    } catch (error) {
      console.warn(`[memory] Falling back to heuristic extraction: ${error.message}`);
      return heuristic;
    }
  }

  async generateReply({ message, user, events, today, priorConversation }) {
    if (!this.openai.enabled) {
      return fallbackReply({ message, user, events, today });
    }

    const context = buildGardenContext(user, today, events);
    const history = priorConversation.slice(-MAX_HISTORY_MESSAGES).map((entry) => ({
      role: entry.role,
      content: entry.body
    }));

    const userContent = [
      {
        type: "input_text",
        text: message.body || "The user sent a plant photo without extra text. Help identify visible issues and ask for any missing details."
      },
      ...(await this.openai.mediaContentItems(message.media))
    ];

    const response = await this.openai.createResponse({
      instructions: GARDEN_ASSISTANT_INSTRUCTIONS,
      input: [
        {
          role: "developer",
          content: context
        },
        ...history,
        {
          role: "user",
          content: userContent
        }
      ]
    });

    return (
      extractOutputText(response) ||
      "I had trouble forming a useful answer just now. Can you send that again with your location and the plant name?"
    );
  }
}

function buildGardenContext(user, today, events = []) {
  const location = formatUserLocation(user.profile);
  const season = seasonForDate(today);
  const plantings = [...(user.plantings || [])]
    .sort((a, b) => b.plantedAt.localeCompare(a.plantedAt))
    .slice(0, 12)
    .map((planting) => {
      const age = daysBetween(planting.plantedAt, today);
      const ageText = Number.isFinite(age) ? `${age} days ago` : "unknown age";
      return `- ${planting.plantName}, planted ${planting.plantedAt} (${ageText})`;
    })
    .join("\n");

  const reminders = (user.reminders || [])
    .filter((reminder) => reminder.status === "pending")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 10)
    .map((reminder) => `- ${reminder.task} ${reminder.plantName || "garden"} on ${reminder.dueDate}`)
    .join("\n");

  return `
Current date: ${today}
Current season: ${season}
Known user location: ${location || "unknown"}
Known timezone: ${user.profile?.timeZone || "unknown"}

Recently saved events from this message:
${events.length ? events.map((event) => `- ${event}`).join("\n") : "- None"}

Known plantings:
${plantings || "- None"}

Pending reminders:
${reminders || "- None"}
`.trim();
}

function fallbackReply({ message, user, events, today }) {
  const body = String(message.body || "");
  const location = formatUserLocation(user.profile);
  const prefix = events.length ? `${events.join(" ")} ` : "";

  if (message.media?.length) {
    return `${prefix}I received the photo. Add OPENAI_API_KEY and I can analyze visible plant symptoms from images. For now, tell me the plant name, your location, how often you water, and whether the spots or wilting appeared suddenly.`;
  }

  if (/\bwhat\b.*\bplant\b|\bplant\b.*\bright now\b/i.test(body)) {
    if (!location) {
      return `${prefix}I can help with that. What ZIP code or city/state is your garden in, and are you planting in containers, raised beds, or in-ground?`;
    }
    return `${prefix}For ${location} on ${today}, I would choose heat-tolerant starts or quick crops unless your season is mild: herbs, bush beans, cucumbers, summer squash, or succession greens with shade. Tell me sun hours and bed/container size and I will narrow it down.`;
  }

  if (events.length) {
    return `${prefix}I will use that timing in future advice. If you want, send the plant variety and whether it is in a pot, raised bed, or in-ground.`;
  }

  return "I can help. Send your plant question with your ZIP code or city/state. For plant problems, a clear photo plus watering, sun, and how long it has looked that way helps a lot.";
}

function mergeProviderLocation(user, location = {}) {
  const next = structuredClone(user);
  const profile = {
    ...(next.profile || {})
  };

  if (location.zip && !profile.zip) profile.zip = location.zip;
  if (location.city && !profile.city) profile.city = titleCase(location.city);
  if (location.state && !profile.state) profile.state = location.state.toUpperCase();
  if (location.country && !profile.country) profile.country = location.country;
  if (location.latitude && location.longitude) {
    profile.latitude = location.latitude;
    profile.longitude = location.longitude;
  }
  if (location.address && !profile.address) profile.address = location.address;

  next.profile = profile;
  return next;
}

function mergeMemoryUpdates(first, second) {
  return {
    profileUpdates: {
      ...(first.profileUpdates || {}),
      ...(second.profileUpdates || {})
    },
    plantings: dedupeRecords([...(first.plantings || []), ...(second.plantings || [])], [
      "plantName",
      "plantedAt"
    ]),
    reminders: dedupeRecords([...(first.reminders || []), ...(second.reminders || [])], [
      "task",
      "plantName",
      "dueDate"
    ])
  };
}

function dedupeRecords(records, keys) {
  const seen = new Set();
  return records.filter((record) => {
    const id = keys.map((key) => record[key] || "").join("|").toLowerCase();
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function titleCase(value) {
  return String(value)
    .toLowerCase()
    .split(/\s+/)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
