interface IParseResult {
  name: string;
  url: string;
  version: string | null;
}

const PARSE_REGEX = /^(?<url>.*\.git)(@(?<version>.*))?$/;
const NAME_REGEX = /\/(?<name>.*)\.git/;

const makeEmptyObject = (url: string) => ({
  name: '',
  url,
  version: null,
});

export const parseGitUrl = (url: string): IParseResult => {
  const { groups } = PARSE_REGEX.exec(url) || {};

  if (!groups || !groups.url) return makeEmptyObject(url);

  const { groups: nameGroups } = NAME_REGEX.exec(url) || {};
  const { name } = nameGroups || {};

  if (!name) return makeEmptyObject(url);

  return {
    url: groups.url,
    version: groups.version,
    name,
  };
};
