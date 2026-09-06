
# Submodule version

## Git **S**ubmodule **V**ersion tool

[![NPM](https://nodei.co/npm/submodule-version.png?mini=true)](https://www.npmjs.com/package/submodule-version)

`Submodule version` is a tool to manage git submodules as versioned packages.

This tool is designed to split projects into submodules *without npm-packages headache*.

With `submodule version` code can be organized like a *single monorepo*, but each submodule can be *easily reused* in other projects like an npm package.

Each module — the project itself and every submodule - declares its dependencies in the `sv` field of its `package.json`, and each release is just a semver git tag. When modules are installed, updated or deleted, `sv` resolves the newest mutually compatible version set across the whole dependency tree with the **PubGrub** algorithm (the one behind Dart's `pub` package manager), reading tags and their `package.json` files straight from the GitHub API without cloning. The resolved set is then applied to the working tree: missing submodules are added, versions are switched to the selected tags and the corresponding `package.json` files are updated — and if no compatible set exists, nothing is touched and a descriptive conflict error is reported.

## Problem to solve

Every module can require a different version range of the same dependency. For example:

- The project uses `ui-button-element@^1.0.0` and `render-engine@^1.0.0`
- `ui-button-element@1.0.0` requires `render-engine@^1.2.0`
- Adding `ui-slider-element@1.0.0` introduces `render-engine@^2.0.0`

The first two requirements can share a `1.x` release, but the slider requires `2.x`, so no version of `render-engine` satisfies the whole tree. Manually switching tags only risks breaking another module.

`sv` selects the newest mutually compatible versions. If the ranges conflict, it reports which module requested each range and leaves the project unchanged.

## Installation

- Install sv tool `npm i -D submodule-version`
- Set up a GitHub token (see below) - `export GITHUB_TOKEN=<your_token>`
- Install first submodule `npx sv i <git_repo>`
- Use your submodule in code `import submodule from 'submodule-name'` 🔥

### GitHub token

`sv` lists module versions through the GitHub GraphQL API, which does not work anonymously — a token is required:

1. Create a personal access token at [github.com/settings/tokens](https://github.com/settings/tokens). A **classic** token with the `repo` scope works for both public and private repos; for a **fine-grained** token, grant read-only access to *Contents* and *Metadata* on the repositories you use as submodules.
2. Export it before running `sv`:

   ```
   export GITHUB_TOKEN=<your_token>
   ```

   or pass it via the JS API: `new SV(process.cwd(), 'modules', { githubToken: '<your_token>' })`.

## How it works

- Each submodule and the main project has its own `package.json` with `sv` object inside. `sv` object will be generated automatically and will contain every dependency version
  ```
  "sv": {
      "git@github.com:guljeny/submodule-version.git": "^1.0.0"
  }
  ```
- Each submodule has [version](#versioning) tags, and `sv` uses the list of these tags to resolve dependencies
- The installed version of a submodule is the version tag git `HEAD` points at
- `Submodule version` resolves the newest compatible set with **PubGrub** and loads nested repositories only when a selected version requires them
- `sv` never switches a submodule version if it has uncommitted changes or unpushed commits — your local work is always kept intact 🧯
- After modules are installed, switched or removed, `sv` runs `npm install` automatically — no manual `npm i` is needed (on plain `npx sv` it runs only when something actually changed)

## Versioning

Submodules without specified version tags will be installed with a ref to the latest commit. You should manage them manually.

To add a new version to a submodule:
- Specify the version in `package.json`
- Add and push a git tag with the same version (`git tag 1.0.1`)

Or use the [`publish`](#sv-publish) API, which bumps the version, commits, tags and pushes in one call.


## Commands

- `npx sv` - Resolve, validate and install/sync all modules (default command)
- `npx sv --check-only` - Resolve the current dependency tree and report errors without changing package.json, submodules or node_modules
- `npx sv put <url> [target] [--ver 1.2.0] [--force]` - Install a submodule or change its version (`install`, `i`). Without `target` the module is installed in the project root; `target` is a parent module name. Without `--ver` the highest possible version is selected (as if `'*'` was passed). `--force` applies the Git/package.json/npm mutation even when PubGrub reports resolution errors
- `npx sv delete <path> [--force]` - Delete a submodule from its parent (project root when the path is a plain name) by path (`remove`, `r`). `--force` applies the mutation despite resolution errors
- `npx sv list-versions [name] [--installed]` - List available versions of one module, or of every resolved module when `name` is omitted (`ls`). With `--installed` shows the resolved (checked out) versions
- `npx sv update [path]` - Update modules to the latest allowed versions, all of them or a single one by path (`u`)
- `npx sv publish [module] [--bump release|minor|major] [-m message] [--repo-url git_url]` - Commit, tag and push a new version of a module (or the project itself when `module` is omitted). `--repo-url` is required for the first publish of a module without a git remote (`p`)
- `npx sv help` - Description of all commands

### Modules home directory

By default submodules live in `modules/` — unless existing submodules in `.gitmodules` point elsewhere, then their directory is used. To use another directory pass the `--modules-dir` flag (`npx sv --modules-dir libs`) or the constructor argument in the JS API (`new SV(process.cwd(), 'libs')`). The directory is stored in `package.json`, so every later call reuses it automatically — no need to pass the flag again.


### Submodule dependencies

Submodules can contain their own dependencies specified in `package.json` as `sv` object.

To install, update or delete a submodule into an another submodule, run `npx sv put <git_url> <target_submodule_name>`

## Programmatic API

### Public methods

- [`sv.resolve(...)`](#sv-resolve)
- [`sv.publish(...)`](#sv-publish)
- Errors: [`printError(...)`](#print-error)

### Creating an `SV` instance

```ts
import { SV } from 'submodule-version';

const sv = new SV(process.cwd(), 'modules', { githubToken: '*' });

const { resolution, errors } = await sv.resolve(
  'git@github.com:org/render-engine.git',
  '^1.2.0',
);
```

### Dependency resolution

<a id="sv-resolve"></a>

#### `sv.resolve(url?, versionOrParent?, parentName?)`

`sv.resolve(url?, versionOrParent?, parentName?)` is the single entry point for everything: validation, install, version switch and delete. It returns `{ resolution, errors }` or throw error (`NOT_A_NPM`, `NOT_A_GIT_REPO`, git/npm failures)

- Without arguments it validates and syncs the current tree
- `sv.resolve(true)` resolves the current tree in check-only mode: it returns
  `{ resolution, errors }` without writing manifests, changing Git submodules,
  running `npm install`, or invoking `onError`
- instead of `url` you can pass the name of an already installed module
- without `version` the highest possible version is selected).
- With `parentName` the range is written to another submodule.
- `sv.resolve(name, null, parentName?)` deletes the module.
- When `errors` is not empty nothing is mutated unless `onError(error)` constructor callback passed: it is called before writing any changes on disc, and return `true` - allow to continue or `false` - returns resolution at the place, installed modules not changed

### Publishing

<a id="sv-publish"></a>

#### `sv.publish({ module?, repoUrl?, message?, bump })`

Commits, tags and pushes a new version of a module (or the project itself). Returns the published version.

- `bump: 'release' | 'minor' | 'major'` - How to bump the latest version (`1.2.3` → `1.2.4`, `1.3.0`, `2.0.0`)
- For a module without a git remote, pass `repoUrl` — `sv` initializes the repo and sets the remote automatically
- Publishing from the latest version uses `bump`. Publishing from an older tag automatically creates a branch and prerelease tag named `<version>-patch.N` (for example `1.0.2-patch.4`); `N` is the next unused number in that patch line
- If the working tree is clean and `HEAD` already has a version tag, `publish` just pushes the branch and the tag without bumping

### Error handling

<a id="print-error"></a>

`printError(error)` turns any error from `errors` of a resolution or thrown by the `SV` methods into a human-readable string — version conflicts with the requiring parents and the dependency chain, circular dependencies, unknown versions, git layer failures and GitHub API errors. The CLI prints all its errors through it:

```ts
import { printError, SV } from 'submodule-version';

const { errors } = await sv.resolve('git@github.com:org/b.git', '^2.0.0');

errors.forEach(error => console.error(printError(error)));
// Version conflict for C:
//   - ^1.3.2 required by my-project
//   - not ^1.4.2 required by B@2.0.0
//   chain: A -> B -> C
//   available versions: 1.4.2, 1.3.2
```
