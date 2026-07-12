import { MEMORY_EXTRACTION_INSTRUCTIONS } from "./prompts.js";
import { memoryExtractionSchema, normalizeExtractedMemory } from "./memory.js";

export class OpenAIClient {
  constructor(config) {
    this.config = config;
  }

  get enabled() {
    return Boolean(this.config.openai.apiKey);
  }

  async createResponse(payload) {
    if (!this.enabled) {
      return null;
    }

    const response = await fetch(`${this.config.openai.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.openai.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.config.openai.model,
        store: false,
        ...payload
      })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`OpenAI response failed: ${response.status} ${JSON.stringify(body)}`);
    }

    return body;
  }

  async extractMemory({ body, today, user }) {
    if (!this.enabled) {
      return null;
    }

    const response = await this.createResponse({
      instructions: MEMORY_EXTRACTION_INSTRUCTIONS,
      input: [
        {
          role: "developer",
          content: `Today is ${today}. Existing user memory: ${JSON.stringify({
            profile: user.profile || {},
            plantings: user.plantings || []
          })}`
        },
        {
          role: "user",
          content: body || ""
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "garden_memory_extraction",
          strict: true,
          schema: memoryExtractionSchema()
        }
      }
    });

    const text = extractOutputText(response);
    if (!text) {
      return null;
    }

    return normalizeExtractedMemory(JSON.parse(text));
  }

  async mediaContentItems(media = []) {
    const items = [];

    for (const item of media) {
      if (!item.contentType?.startsWith("image/")) {
        continue;
      }

      if (!this.config.openai.inlineMedia) {
        items.push({
          type: "input_image",
          image_url: item.url
        });
        continue;
      }

      const dataUrl = await this.downloadMediaAsDataUrl(item);
      items.push({
        type: "input_image",
        image_url: dataUrl
      });
    }

    return items;
  }

  async downloadMediaAsDataUrl(item) {
    const headers = {};
    const { accountSid, authToken } = this.config.twilio;
    if (accountSid && authToken) {
      headers.Authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
    }

    const response = await fetch(item.url, { headers });
    if (!response.ok) {
      throw new Error(`Media download failed: ${response.status}`);
    }

    const mimeType = response.headers.get("content-type") || item.contentType || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  }
}

export function extractOutputText(response) {
  if (!response) {
    return "";
  }

  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  const pieces = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") {
        pieces.push(content.text);
      }
    }
  }

  return pieces.join("\n").trim();
}
