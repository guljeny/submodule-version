import { versionUtil } from '../../versionUtil';
import { GithubError } from './GithubError';

/*
 * GitHub GraphQL API без внешних зависимостей (глобальный fetch, Node 18+).
 * Токен обязателен (GraphQL не работает анонимно): из JS API
 * (git.api.setToken) или GITHUB_TOKEN из env.
 */
const ENDPOINT = 'https://api.github.com/graphql';

/*
 * owner/repo из git-url'а: https/ssh (github.com:owner/repo.git)
 * и github:-shorthand (github:owner/repo).
 */
const parseSlug = (url: string): string | null => {
  const shorthand = /^github:(?<slug>[\w.-]+\/[\w.-]+)$/.exec(url);

  if (shorthand?.groups) return shorthand.groups.slug;

  const match = /github\.com[/:](?<slug>[\w.-]+\/[\w.-]+?)(\.git)?$/.exec(url);

  return match?.groups?.slug || null;
};

/* Токен, переданный через JS API (SV); без него — GITHUB_TOKEN из env */
let apiToken: string | undefined;

interface IGqlError {
  type?: string;
  message: string;
}

const gql = async (
  query: string,
  variables: Record<string, unknown>,
): Promise<any> => {
  const token = apiToken || process.env.GITHUB_TOKEN;

  if (!token) {
    throw new GithubError('GITHUB_TOKEN_REQUIRED', {});
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'submodule-version',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new GithubError('GITHUB_API_FAILED', { status: res.status });
  }

  const body = await res.json() as {
    data?: any,
    errors?: IGqlError[],
  };

  if (body.errors?.length) {
    /* NOT_FOUND = репо не существует или нет доступа (как 404 в REST) */
    const notFound = body.errors.some(e => e.type === 'NOT_FOUND');

    throw new GithubError('GITHUB_API_FAILED', {
      status: notFound ? 404 : 400,
      errors: body.errors.map(e => e.message),
    });
  }

  return body.data;
};

const TAGS_QUERY = `
  query ($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      refs(refPrefix: "refs/tags/", first: 100, after: $cursor) {
        nodes { name }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

/* Все semver-теги репозитория (пагинация по 100) */
const listTags = async (slug: string): Promise<string[]> => {
  const [owner, name] = slug.split('/');
  const tags: string[] = [];
  let cursor: string | null = null;

  do {
    const data = await gql(TAGS_QUERY, { owner, name, cursor });

    if (!data.repository) {
      throw new GithubError('GITHUB_API_FAILED', { status: 404, url: slug });
    }

    const { nodes, pageInfo } = data.repository.refs;

    nodes.forEach((node: { name: string }) => {
      if (versionUtil.validate(node.name)) tags.push(node.name);
    });

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);

  return tags;
};

/*
 * package.json каждого тега одним запросом: alias v<i> на
 * object(expression: "<tag>:package.json"). Теги отфильтрованы по semver,
 * так что инъекция в expression исключена. Нет файла — null.
 */
const listPackages = async (
  slug: string,
  tags: string[],
): Promise<Array<any | null>> => {
  if (!tags.length) return [];

  const [owner, name] = slug.split('/');

  const fields = tags.map((tag, i) => (
    // eslint-disable-next-line max-len
    `v${i}: object(expression: ${JSON.stringify(`${tag}:package.json`)}) { ... on Blob { text } }`
  )).join('\n');

  const query = `
    query ($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        ${fields}
      }
    }
  `;

  const data = await gql(query, { owner, name });

  return tags.map((tag, i) => {
    const text = data.repository?.[`v${i}`]?.text;

    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  });
};

export interface IGithubVersion {
  version: string;
  /* package.json на теге; нет файла или битый JSON — null */
  pkg: any | null;
}

export const api = {
  /* Токен из JS API; без него (и при undefined) работает env-переменная */
  setToken: (token?: string): void => {
    apiToken = token;
  },

  /*
   * Теги репозитория + package.json каждого тега: 1 запрос на страницу
   * тегов + 1 батч-запрос на deps всех тегов.
   */
  fetchVersions: async (url: string): Promise<IGithubVersion[]> => {
    const slug = parseSlug(url);

    if (!slug) {
      throw new GithubError('GITHUB_NOT_A_REPO_URL', { url });
    }

    const tags = await listTags(slug);
    const pkgs = await listPackages(slug, tags);

    return tags.map((version, i) => ({ version, pkg: pkgs[i] }));
  },
};
