enum ComapreMode {
  major = 0,
  minor = 1,
  path = 2,
}

const cleanup = (v: string) => v.replace(/^\^?~?/, '');

const toArray = (v: string): number[] => (
  cleanup(v).split('.').map(Number)
);

const mode = (v: string) => {
  // Minor and path can be vary. Only major should be same
  if (v.startsWith('^')) return ComapreMode.major;
  // Path can be vary. Major and minor should be same
  if (v.startsWith('~')) return ComapreMode.minor;

  // Everything should be same
  return ComapreMode.path;
};

const compare = (
  baseVer: number[],
  actualVer: number[],
  compareMode: ComapreMode,
) => {
  const val = new Array(3).fill(null).reduce((acc, _, i) => {
    // Alrady is not compatible
    if (!acc) return acc;
    // Mode not include comparation, version should be same or hier
    if (i > compareMode) return actualVer[i] >= baseVer[i];

    return baseVer[i] === actualVer[i];
  }, true);

  return val;
};

const pick = (allVersions: string[], v: string) => {
  if (v === '*') return allVersions;

  const vMode = mode(v);
  const vArr = toArray(v);

  return allVersions.filter(av => {
    const avArr = toArray(av);

    return compare(vArr, avArr, vMode);
  });
};

const validate = (v: string, relative?: boolean) => {
  if (relative) {
    if (v === '*') return true;

    return /^[\^$]?\d+\.\d+\.\d+$/.test(v);
  }

  return /^\d+\.\d+\.\d+$/.test(v);
};

const latest = (versions: string[]) => (
  cleanup([...versions].sort((v1, v2) => {
    const v1Arr = toArray(v1);
    const v2Arr = toArray(v2);

    return v1Arr.reduce((acc, v1Val, i) => {
      if (acc !== 0) return acc;
      const v2Val = v2Arr[i];

      return v2Val - v1Val;
    }, 0);
  })[0])
);

export const versionUtil = {
  compare,
  pick,
  validate,
  latest,
};
