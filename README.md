# Submodule version

## Git **S**ubmodule **V**ersion tool

[![NPM](https://nodei.co/npm/submodule-version.png?mini=true)](https://www.npmjs.com/package/submodule-version)

`Submodule version` is a tool to manage git submodules as versioned packages.

This tool is designed to split projects into submodules *without npm-packages headache*.

With `submodule version` code can be organized like a *single monorepo*, but each submodule can be *easily reused* in other projects like an npm package.

Each module — the project itself and every submodule — declares its dependencies in the `sv` field of its `package.json`, and each release is just a semver git tag. When modules are installed, updated or deleted, `sv` resolves the newest mutually compatible version set across the whole dependency tree with the **PubGrub** algorithm (the one behind Dart's `pub` package manager), reading tags and their `package.json` files straight from the GitHub API without cloning. The resolved set is then applied to the working tree: missing submodules are added, versions are switched to the selected tags and the corresponding `package.json` files are updated — and if no compatible set exists, nothing is touched and a descriptive conflict error is reported.

## Problem to solve

Take a look at the following situation:

- Project has 2 submodules `ui-button-element` and `render-engine`
- Package `ui-button-element` depends on the `render-engine`
- Third repo `ui-slider-element` depends on the newest version of the `render-engine` and is not included in the project

This causes the following problems:

- Adding the submodule `ui-slider-element` causes difficulties handling different `render-engine` versions
- Manually switching branches in submodules with a big codebase is confusing
- An updated `ui-button-element` with a new version of `render-engine` should be used in another project with the same version

Submodule version helps to

- Handle which project should be updated and which version should be installed
- Help update submodules and their dependencies
- Install new submodules

## Installation

- Install sv tool `npm i -D submodule-version`
- Set up a GitHub token (see below) — `sv` reads module versions through the GitHub API
- Install first submodule `npx sv i <git_repo>` — the `workspaces` section in `package.json` is added automatically on `init`, and `npm install` runs automatically, so the submodule is linked in node_modules and its dependencies are installed
- Use your submodule in code `import submodule from 'submodule-name'` 🔥

### GitHub token

`sv` lists module versions through the GitHub GraphQL API, which does not work anonymously — a token is required:

1. Create a personal access token at [github.com/settings/tokens](https://github.com/settings/tokens). A **classic** token with the `repo` scope works for both public and private repos; for a **fine-grained** token, grant read-only access to *Contents* and *Metadata* on the repositories you use as submodules.
2. Export it before running `sv`:

   ```
   export GITHUB_TOKEN=<your_token>
   ```

   or pass it via the JS API: `new SV(process.cwd(), 'modules', { githubToken: '<your_token>' })`.

By default submodules live in `modules/` — unless existing submodules in `.gitmodules` point elsewhere, then their directory is used. To use another directory pass the `--modules-dir` flag (`npx sv --modules-dir libs i <git_repo>`) or the constructor argument in the JS API (`new SV(process.cwd(), 'libs')`). The directory is stored in `package.json` as `sv-dir`, so every later call reuses it automatically — no need to pass the flag again. The matching `workspaces` entry is added to `package.json` automatically as well.

## How it works

- Each submodule and the main project has its own `package.json` with `sv` object inside. `sv` object will be generated automatically and will contain every dependency version
  ```
  "sv": {
      "git@github.com:guljeny/submodule-version.git": "^1.0.0"
  }
  ```
- Each submodule has [version](#versioning) tags, and `sv` uses the list of these tags to resolve dependencies
- The installed version of a submodule is the version tag git `HEAD` points at
- `Submodule version` resolves the newest compatible set with PubGrub and loads nested repositories only when a selected version requires them
- `sv` never switches a submodule version if it has uncommitted changes or unpushed commits — your local work is always kept intact 🧯
- After modules are installed, switched or removed, `sv` runs `npm install` automatically — no manual `npm i` is needed (on plain `npx sv` it runs only when something actually changed)

## Versioning

Submodules without specified version tags will be installed with a ref to the latest commit. You should manage them manually.

To add a new version to a submodule:
- Specify the version in `package.json`
- Add and push a git tag with the same version (`git tag 1.0.1`)

Or use the [`publish`](#programmatic-api) API, which bumps the version, commits, tags and pushes in one call.


## Commands

- `npx sv` - Resolve, validate and install/sync all modules (default command)
- `npx sv put <url> [target] [--ver 1.2.0] [--no-verify]` - Install a submodule or change its version (`install`, `i`). Without `target` the module is installed in the project root; `target` is a parent module name. Without `--ver` the highest possible version is selected (as if `'*'` was passed). `--no-verify` applies the Git/package.json/npm mutation without PubGrub compatibility checks
- `npx sv delete <path> [--no-verify]` - Delete a submodule from its parent (project root when the path is a plain name) by path (`remove`, `r`). `--no-verify` skips PubGrub compatibility checks
- `npx sv list-versions [name] [--installed]` - List available versions of one module, or of every resolved module when `name` is omitted (`ls`). With `--installed` shows the versions actually checked out in the submodules
- `npx sv update [path]` - Update modules to the latest allowed versions, all of them or a single one by path (`u`)
- `npx sv publish [module] [--bump release|minor|major] [-m message] [--repo-url git_url]` - Commit, tag and push a new version of a module (or the project itself when `module` is omitted). `--repo-url` is required for the first publish of a module without a git remote (`p`)
- `npx sv help` - Description of all commands

All commands accept the global `--modules-dir <dir>` option to use another submodule directory instead of `modules/`. The chosen directory is recorded in `package.json` as `sv-dir` and reused by later commands automatically.

## Programmatic API

The `SV` class can be used directly from code:

```ts
import { PubGrub, SV, versionUtil } from 'submodule-version';

const sv = new SV(process.cwd(), 'modules', { githubToken: '…' });
await sv.init();

await sv.put('git@github.com:org/render-engine.git', '^1.2.0');
const resolution = sv.getResolution();
```

The constructor accepts `(projectDir, modulesDir?, { githubToken? })`. The modules directory is resolved as: explicit `modulesDir` argument → `sv-dir` recorded in `package.json` → the common directory of existing submodules in `.gitmodules` → `modules`. The GitHub GraphQL API is used to list module versions without cloning, so a token is required: pass `githubToken` or set the `GITHUB_TOKEN` environment variable.

### Dependency resolution

- `sv.init()` resolves `package.json#sv` with PubGrub and installs/syncs submodules to the resolved versions. It also adds the modules dir to `workspaces` in `package.json` when it is missing, and runs `npm install` when anything changed. All mutations (`put`, `delete`, updates) run `npm install` automatically after applying.
- `sv.getResolution()` returns the selected version and selected-version dependencies for every resolved module.
- The working copy of an installed submodule is the source of truth for its checked-out version: dependencies edited locally but not yet published as a tag take part in the resolution immediately. The overlay applies only to the version tag `HEAD` points at, and only when that version exists on the remote — a `HEAD` without a version tag (mid-publish) or a local-only tag falls back to the remote manifest.
- `new PubGrub(source).resolve(rootDeps)` runs the resolver with a custom entry source, which is useful for tests and non-GitHub registries.

### Installing, updating and deleting modules

By default, `put` and `delete` first run a check resolve and touch the working tree and `package.json` files only when the resolution succeeds. The explicit `dangerous*` variants skip that check.

- `sv.put(url, version?, parentName?)` - Install a module or change its version. Instead of `url` you can pass the name of an already installed module. All argument forms are supported: `put(url)`, `put(url, version)`, `put(url, parentName)`, `put(url, version, parentName)`.
  - Without `parentName` the module is installed/updated in the project root and the range is written to the root `package.json#sv`.
  - With `parentName` the module is added to (or updated in) the parent module and the range is written to the parent's own `package.json#sv`, so the change survives publishing the parent.
  - Without `version` the highest possible version is selected, as if `'*'` was passed.
- `sv.delete(name, parentName?)` - Delete a module from its parent (the project root when `parentName` is omitted); the dependency is removed from the corresponding `package.json#sv` and the submodule is uninstalled.
- `sv.dangerousPut(url, version?, parentName?)` and `sv.dangerousDelete(name, parentName?)` perform the same Git, `package.json` and `npm install` mutations without running PubGrub. `dangerousPut` keeps the submodule's current Git HEAD and records the requested range for a later verified resolve.
- `sv.listVersions(name?)` - With `name` returns the available versions of one package (`string[]`); without it returns `{ [pkgName]: string[] }` for every resolved package.

### Simulating changes

`EntryStore.simulate(overrides, rootDeps, callback)` runs the callback against a hypothetically changed dependency tree — every fetch inside the callback sees the overridden modules, and the overrides cease to exist once the callback finishes (also on error):

```ts
import { EntryStore, PubGrub } from 'submodule-version';

const store = new EntryStore();

// the three override forms:
const overrides = [
  // add B to the root
  { add: 'git@github.com:org/b.git', version: '^1.2.3' },
  // add B to any version of the installed module A
  { parent: 'A', add: 'git@github.com:org/b.git', version: '*' },
  // delete B
  { delete: 'B' },
];

const resolution = await store.simulate(overrides, rootDeps, deps => (
  new PubGrub(store).resolve(deps)
));
```

Root-level overrides (without `parent`) are applied to a copy of `rootDeps` that is passed to the callback; `parent` overrides rewrite every version of the parent module. `version` defaults to `'*'`.

### Inspecting changes and versions

- `sv.hasChanges(module?)` - `true` if the module (or the project itself, when `module` is omitted) has uncommitted changes or unpushed commits
- `sv.hasUncommittedChanges(module?)` - `true` if the working tree has uncommitted changes
- `sv.currentVersion(module?)` - The version tag `HEAD` points at, or `null` when there is none
- `sv.latestVersion(module?)` - The latest known version tag (`0.0.0` when there are no tags)
- `sv.getRemote(module?)` - The `origin` remote URL, or `null`
- `sv.isPublished(module?)` - `true` if the module is a git repo with a configured remote

### Syncing with the remote

- `sv.isRemoteAhead(module?)` - `true` if the remote branch has commits the local one does not (fetches from `origin` first)
- `sv.pullRebaseAutostash(module?)` - Catch up with the remote via `pull --rebase --autostash`. On conflict everything is restored to the previous state (`rebase --abort` + `stash pop`) and a `GIT_SYNC_CONFLICT` error is thrown — further sync is only possible with a manual rebase

### Publishing

- `sv.publish({ module?, repoUrl?, message?, bump })` - Commit, tag and push a new version of a module (or the project itself). Returns the published version.
  - `bump: 'release' | 'minor' | 'major'` - How to bump the latest version (`1.2.3` → `1.2.4`, `1.3.0`, `2.0.0`)
  - For a module without a git remote, pass `repoUrl` — `sv` initializes the repo and sets the remote automatically
  - Publishing is only possible from the latest version (`GIT_NOT_LATEST_VERSION` error otherwise)
  - Submodules are checked out on tags (detached `HEAD`) — `publish` creates a local branch bound to the remote branch before committing, and syncs with the remote (`pull --rebase --autostash`) when it is ahead
  - If the working tree is clean and `HEAD` already has a version tag, `publish` just pushes the branch and the tag without bumping

### Version utilities

`versionUtil` exposes standard SemVer validation, comparison, filtering and finite-set operations used by PubGrub: `validate`, `satisfies`, `compare`, `sort`, `select`, `latest`, `intersection`, `union`, `difference`, `intersects`, `isSubset` and `bump`.

### Error handling

`printError(error)` turns any error thrown by the resolver or the `SV` methods into a human-readable string — version conflicts with the requiring parents and the dependency chain, circular dependencies, unknown versions, git layer failures and GitHub API errors. The CLI prints all its errors through it:

```ts
import { printError, SV } from 'submodule-version';

try {
  await sv.put('git@github.com:org/b.git', '^2.0.0');
} catch (error) {
  console.error(printError(error as Error));
  // Version conflict for C:
  //   - ^1.3.2 required by my-project
  //   - not ^1.4.2 required by B@2.0.0
  //   chain: A -> B -> C
  //   available versions: 1.4.2, 1.3.2
}
```

## Submodule dependencies

Submodules can contain their own dependencies specified in `package.json` as `sv` object.

To install a submodule into a submodule, run `npx sv put <git_url> <target_submodule>`
