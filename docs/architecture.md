# Architecture Notes

## Product Principle

The text message is the product surface. The user should not need an account, app install, or garden setup form before getting value. Farmer Shaw should learn by conversation: location, plantings, dates, preferences, photos, and reminders.

## Core Domain Objects

- User: phone number, approximate location, timezone, garden notes, subscription status.
- Message: inbound or outbound text, media metadata, timestamps, provider IDs.
- Planting: plant name, planted date, location or bed if known, notes, source message.
- Reminder: task, due date, plant link, instructions, status, sent timestamp.
- Recommendation: optional future record for product suggestions and affiliate attribution.

## Request Flow

1. Twilio posts inbound SMS/MMS data to the webhook.
2. The app normalizes the sender, text body, image URLs, and location-ish metadata.
3. Memory extraction records concrete facts such as plantings, user location, and reminders.
4. The assistant builds context from current date, season, location, prior plantings, and recent conversation.
5. The LLM generates a concise SMS response.
6. The app saves the assistant response and returns TwiML.

## Reminder Flow

1. Reminder records are created from explicit user requests.
2. The reminder loop scans due reminders.
3. Due reminders are sent through Twilio REST.
4. Sent reminders are marked so retries do not double-send.

For production, run reminders in a separate worker with a database lock or queue. The local loop is appropriate for development and a tiny pilot.

## Monetization Path

Start with trust, not product links. Good subscription triggers are:

- Unlimited conversations/photos
- Seasonal planting plans
- Planting calendar and reminder bundles
- Garden history and diagnosis archive
- Premium human expert review

Product recommendations should be clearly relevant and should preserve user trust. The first version should recommend categories, then later attach marketplace links after you have a quality/evaluation loop.
