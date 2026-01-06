export class GitError extends Error {
  constructor (type: string, public details: Record<string, any> = {}) {
    super(type);
  }
}
