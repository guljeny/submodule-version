import { parseGitUrl } from '../parseGitUrl';

describe('Parse git url', () => {
  it('Without version', () => {
    const url = 'git@github.com:Casique-front/audio-mixer.git';

    expect(parseGitUrl(url)).toEqual({
      url: 'git@github.com:Casique-front/audio-mixer.git',
      version: undefined,
      name: 'audio-mixer',
    });
  });

  it('With version', () => {
    const url = 'git@github.com:Casique-front/audio-mixer.git@1.0.1';

    expect(parseGitUrl(url)).toEqual({
      url: 'git@github.com:Casique-front/audio-mixer.git',
      version: '1.0.1',
      name: 'audio-mixer',
    });
  });

  it('Wrong string', () => {
    const url = 'xxx@version';

    expect(parseGitUrl(url)).toEqual({
      url: 'xxx@version',
      version: null,
      name: '',
    });
  });
});
