export class GithubError extends Error {
  constructor (type: string, public details: Record<string, any> = {}) {
    super(type);
  }
}
