import { todayInTimeZone } from "./domain.js";
import { sendSms } from "./twilio.js";

export function startReminderLoop({ store, config }) {
  let running = false;

  async function tick() {
    if (running) {
      return;
    }

    running = true;
    try {
      const today = todayInTimeZone(config.defaultTimeZone);
      const due = await store.getDueReminders(today);

      for (const item of due) {
        const body = formatReminderText(item.reminder);
        await sendSms({ to: item.userPhone, body }, config);
        await store.markReminderSent(item.userPhone, item.reminder.id);
      }
    } catch (error) {
      console.error(`[reminders] ${error.stack || error.message}`);
    } finally {
      running = false;
    }
  }

  const interval = setInterval(tick, config.reminderIntervalMs);
  tick();

  return () => clearInterval(interval);
}

export function formatReminderText(reminder) {
  const subject = reminder.plantName ? ` for your ${reminder.plantName}` : "";
  return `Farmer Shaw reminder${subject}: ${reminder.instructions}`;
}
