export function todayInTimeZone(timeZone, now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

export function daysBetween(startIsoDate, endIsoDate) {
  const start = Date.parse(`${startIsoDate}T00:00:00.000Z`);
  const end = Date.parse(`${endIsoDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  return Math.floor((end - start) / 86_400_000);
}

export function parseRelativeDate(text, today) {
  const lower = text.toLowerCase();

  if (/\btoday\b/.test(lower)) {
    return today;
  }

  if (/\byesterday\b/.test(lower)) {
    return addDays(today, -1);
  }

  if (/\btomorrow\b/.test(lower)) {
    return addDays(today, 1);
  }

  const inMatch = lower.match(/\bin\s+(\d{1,3})\s+(day|days|week|weeks)\b/);
  if (inMatch) {
    const amount = Number.parseInt(inMatch[1], 10);
    const multiplier = inMatch[2].startsWith("week") ? 7 : 1;
    return addDays(today, amount * multiplier);
  }

  const isoMatch = lower.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    return isoMatch[1];
  }

  return null;
}

export function seasonForDate(isoDate) {
  const month = Number.parseInt(isoDate.slice(5, 7), 10);
  if ([12, 1, 2].includes(month)) {
    return "winter";
  }
  if ([3, 4, 5].includes(month)) {
    return "spring";
  }
  if ([6, 7, 8].includes(month)) {
    return "summer";
  }
  return "fall";
}

export function formatUserLocation(profile = {}) {
  if (profile.zip) {
    return profile.zip;
  }

  if (profile.city && profile.state) {
    return `${profile.city}, ${profile.state}`;
  }

  if (profile.city) {
    return profile.city;
  }

  if (profile.state) {
    return profile.state;
  }

  return "";
}

export function normalizePhone(value) {
  return String(value || "").trim();
}
