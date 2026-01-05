type TDetails = {
  name: string;
  parents?: Record<string, string>;
  version?: string;
  parent?: string;
}

export class GraphError extends Error {
  constructor (type: string, public details: TDetails) {
    super(type);
  }
}
