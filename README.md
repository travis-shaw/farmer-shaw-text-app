# Farmer Shaw Text App

Farmer Shaw is an SMS-first garden assistant. A user texts a phone number, optionally includes plant photos, and gets gardening advice that can use the date, location, prior plantings, and pending reminders.

This repository is a runnable MVP backend with no npm dependencies. It is intentionally small:

- A Twilio-compatible inbound SMS/MMS webhook at `POST /webhooks/twilio/sms`
- An OpenAI Responses API client using built-in `fetch`
- Local JSON memory for users, plantings, conversation history, and reminders
- A reminder loop that sends SMS through Twilio when credentials are configured
- A dev endpoint at `POST /dev/sms` so you can test the assistant without Twilio
- Public compliance pages at `GET /privacy` and `GET /terms`

## Quickstart

```bash
cp .env.example .env
npm run dev
```

Then send a local test message:

```bash
curl -X POST http://localhost:3000/dev/sms \
  -H 'Content-Type: application/json' \
  -d '{"from":"+15555550100","body":"I planted a tomato today. Remind me when to fertilize it."}'
```

Without `OPENAI_API_KEY`, the app uses a small local fallback response and still saves memory and reminders. Add `OPENAI_API_KEY` to get LLM-powered answers.

## Twilio Setup

1. Buy or configure a Twilio phone number that supports SMS/MMS.
2. Expose this server publicly, for example with ngrok during development.
3. Set the phone number's incoming message webhook to:

```text
POST https://your-public-host/webhooks/twilio/sms
```

4. Configure `.env` with `PUBLIC_BASE_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`.
5. Set `TWILIO_VALIDATE_SIGNATURE=true` once the public URL is stable.

Twilio sends incoming webhook parameters as `application/x-www-form-urlencoded`, including `From`, `To`, `Body`, `NumMedia`, and media URLs such as `MediaUrl0`.

For A2P campaign registration, use these links after the app is exposed publicly:

```text
Privacy Policy: https://your-public-host/privacy
Terms and Conditions: https://your-public-host/terms
```

Sample campaign messages:

```text
Farmer Shaw: Based on your location and the current season, good planting options include basil, bush beans, cucumbers, and heat-tolerant herbs. What kind of sun does your garden get?
```

```text
Farmer Shaw: From your plant photo, the yellowing leaves may be related to watering stress or low nutrients. Check soil moisture first, then send how often you water and how much sun it gets.
```

```text
Farmer Shaw reminder: It has been about 2 weeks since you planted your tomato. If it is actively growing and not stressed, fertilize lightly according to the product label, then water it in.
```

## OpenAI Setup

Set:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6
```

The assistant sends normal text messages as text input and image attachments as vision input. If your Twilio media URLs require authentication, set `OPENAI_INLINE_MEDIA=true` so the server downloads each image and sends it to the model as a data URL.

## Current Architecture

```text
User SMS/MMS
   |
   v
Twilio phone number
   |
   v
POST /webhooks/twilio/sms
   |
   +--> Parse text, images, sender metadata
   +--> Save durable memory in data/store.json
   +--> Extract plantings and reminder requests
   +--> Call OpenAI Responses API for advice
   +--> Return TwiML response to Twilio

Reminder loop
   |
   +--> Scan pending reminders
   +--> Send due SMS through Twilio REST API
   +--> Mark reminders as sent
```

## Production Upgrades

The MVP is structured so these pieces can be swapped without rewriting the assistant logic:

- Replace JSON storage with Postgres.
- Move reminder sending to a queue such as BullMQ, SQS, or Cloud Tasks.
- Use the Twilio Node SDK for production signature validation.
- Add Stripe subscriptions and gate usage by account status.
- Add affiliate/product recommendation tools after the core advice quality is reliable.
- Add human escalation and local extension-office guidance for uncertain disease or pesticide advice.

## Useful Commands

```bash
npm run dev
npm test
npm start
```
