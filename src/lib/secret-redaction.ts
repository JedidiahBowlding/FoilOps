const SECRET_PATTERNS: RegExp[] = [
  /bot\d{6,}:[A-Za-z0-9_-]{20,}/g, // Telegram bot token
  /(?:api[-_]?key|token|secret|password|private[-_]?key)\s*[:=]\s*[^\s"']+/gi,
]

const REDACTION = '[REDACTED]'

export const SecretRedaction = {
  redactText(input: string): string {
    return SECRET_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, REDACTION), input)
  },

  redactUrl(input: string): string {
    let output = input

    for (const pattern of SECRET_PATTERNS) {
      output = output.replace(pattern, REDACTION)
    }

    // Specifically strip Telegram token path segment if present.
    output = output.replace(/\/bot[^/]+\//g, '/bot[REDACTED]/')

    return output
  },

  safeError(error: unknown): string {
    if (error instanceof Error) {
      return SecretRedaction.redactText(error.message)
    }

    return SecretRedaction.redactText(String(error))
  },
}
