export class ToolError extends Error {
  constructor(public code: string, message: string, public hint?: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
