import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const EMPTY_STATE = {
  version: 1,
  users: {}
};

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = null;
    this.writeQueue = Promise.resolve();
  }

  async load() {
    if (this.state) {
      return this.state;
    }

    try {
      const content = await fs.readFile(this.filePath, "utf8");
      this.state = JSON.parse(content);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      this.state = structuredClone(EMPTY_STATE);
    }

    if (!this.state.users) {
      this.state.users = {};
    }

    return this.state;
  }

  async getState() {
    const state = await this.load();
    return structuredClone(state);
  }

  async getUser(phone) {
    const state = await this.load();
    const user = ensureUser(state, phone);
    await this.save();
    return structuredClone(user);
  }

  async mutateUser(phone, updater) {
    const state = await this.load();
    const user = ensureUser(state, phone);
    const result = await updater(user);
    user.updatedAt = new Date().toISOString();
    await this.save();
    return result === undefined ? structuredClone(user) : result;
  }

  async getDueReminders(today) {
    const state = await this.load();
    const due = [];

    for (const user of Object.values(state.users)) {
      for (const reminder of user.reminders || []) {
        if (reminder.status === "pending" && reminder.dueDate <= today) {
          due.push({
            userPhone: user.phone,
            reminder: structuredClone(reminder)
          });
        }
      }
    }

    return due;
  }

  async markReminderSent(userPhone, reminderId, sentAt = new Date().toISOString()) {
    return this.mutateUser(userPhone, (user) => {
      const reminder = (user.reminders || []).find((item) => item.id === reminderId);
      if (!reminder) {
        return null;
      }

      reminder.status = "sent";
      reminder.sentAt = sentAt;
      return structuredClone(reminder);
    });
  }

  async save() {
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      await fs.writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`);
      await fs.rename(temporaryPath, this.filePath);
    });

    return this.writeQueue;
  }
}

export function createStore(config) {
  return new JsonStore(path.join(config.dataDir, "store.json"));
}

export function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function ensureUser(state, phone) {
  const normalizedPhone = String(phone || "anonymous").trim() || "anonymous";
  if (!state.users[normalizedPhone]) {
    const now = new Date().toISOString();
    state.users[normalizedPhone] = {
      id: newId("user"),
      phone: normalizedPhone,
      createdAt: now,
      updatedAt: now,
      profile: {},
      conversation: [],
      plantings: [],
      reminders: []
    };
  }

  return state.users[normalizedPhone];
}
