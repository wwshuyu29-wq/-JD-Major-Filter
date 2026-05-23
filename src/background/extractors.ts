import { normalizeText } from "../shared/text";

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " "
  };

  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    if (entity.startsWith("#x")) {
      return String.fromCharCode(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCharCode(Number.parseInt(entity.slice(1), 10));
    }
    return entities[entity.toLowerCase()] ?? `&${entity};`;
  });
}

function collectJsonStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") {
    if (value.length >= 2) {
      output.push(value);
    }
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonStrings(item, output));
    return output;
  }

  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      if (/description|requirement|qualification|responsibility|job|title|location|major|content|text/i.test(key)) {
        collectJsonStrings(item, output);
      } else if (typeof item === "object") {
        collectJsonStrings(item, output);
      }
    });
  }

  return output;
}

function extractEmbeddedJsonText(html: string): string {
  const scriptMatches = Array.from(html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi));
  const chunks: string[] = [];

  for (const match of scriptMatches) {
    const body = match[1]?.trim() ?? "";
    if (!/(job|position|require|qualification|description|major|专业|职责|要求)/i.test(body)) {
      continue;
    }

    const jsonLikeMatches = body.match(/\{[\s\S]{80,}\}/g) ?? [];
    for (const jsonLike of jsonLikeMatches.slice(0, 4)) {
      try {
        chunks.push(...collectJsonStrings(JSON.parse(jsonLike)));
      } catch {
        const loose = jsonLike
          .replace(/\\u([0-9a-fA-F]{4})/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
          .replace(/\\"/g, "\"");
        chunks.push(loose);
      }
    }
  }

  return chunks.join("\n");
}

function extractHtmlText(html: string): string {
  const embeddedJson = extractEmbeddedJsonText(html);
  const visibleText = html
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "\n")
    .replace(/<(br|p|li|div|section|article|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "\n");

  return normalizeText(decodeHtmlEntities(`${embeddedJson}\n${visibleText}`));
}

function extractJsonText(raw: string): string {
  try {
    return normalizeText(collectJsonStrings(JSON.parse(raw)).join("\n"));
  } catch {
    return normalizeText(raw);
  }
}

export function extractDetailText(raw: string, contentType: string): string {
  if (/json/i.test(contentType)) {
    return extractJsonText(raw);
  }

  return extractHtmlText(raw);
}
