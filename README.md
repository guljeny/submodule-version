# Submodule version

## Git **S**ubmodule **V**ersion tool

[![NPM](https://nodei.co/npm/submodule-version.png?mini=true)](https://www.npmjs.com/package/submodule-version)

`Submodule version` is a tool to manage git submodules as versioned packages.

This tool designed to split projects in-to submodules *without npm-packages headache*.

With `submodule version` code can be organized like a *single monorepo*, but each submodule can be *easily reused* in another projects like npm-package.

## Problem to solve

Take a look on the next situation:

- Project has 2 submodules `ui-button-element` and `render-engine`
- Package `ui-button-element` dependents on the `render-engine`
- Third repo `ui-slider-element` dependets on newest version of the `render-engine` and not included in the project

This cause next problems:

- Add submodule `ui-slider-element` cause difficulties with handle different `render-engine` versions
- Manual swithing branches in submodules with big codebase can confuse
- Updated `ui-button-element` with new version of `render-engine` should be used in another project with the same version

Submodule version helps to

- Handle which project should be updated and which version should be installed
- Help update submodules and theirs dependencies
- Install new submodules

## Installation

- Install sv tool `npm i -D submodule-version`
- Add `workspaces` section in `package.json`
  ```
    "workspaces": [
        "modules/*"
    ],
  ```
- Install first submodule `npx sv i <git_repo>`
- Install npm dependencies `npm i`. Submodule will be linked in node_modules and its dependencies will be installed
- Use your submodule in code `import submodule from 'submodule-name'` 🔥

## How it works

- Each submodule and main project has own `package.json` with `sv` object inside. `sv` object will be generated automatically and will contain every dependency version
  ```
  "sv": {
      "git@github.com:guljeny/submodule-version.git": "^1.0.0"
  }
  ```
- Each submodule has a [version](#versioning) tags, and `sv` use list of this tags to resolve dependencies
- The installed version of a submodule is the version tag git `HEAD` points at
- `Submodule version` creates a graph of whole project and install only possible and actual versions
- `sv` never switches a submodule version if it has uncommitted changes or unpushed commits — your local work is always kept intact 🧯

## Versioning

Sumodules without specified version tags will be installed with ref to the latest commit. You should manage them manually.

To add new version in submodule:
- Specify version in `package.json`
- Add and push git tag with the same version (`git tag 1.0.1`)

Or use the [`publish`](#programmatic-api) API, which bumps the version, commits, tags and pushes in one call.


## Commands

- `npx sv validate` - Validate all dependencis and install missing modules
- `npx sv install <git_url> [target_submodule]` - Install new dependency
- `npx sv update` - Update all dependencies to the latest possible versions
- `npx sv publish [module] [--bump release|minor|major] [-m message] [--repo-url git_url]` - Commit, tag and push a new version of a module (or the project itself when `module` is omitted). `--repo-url` is required for the first publish of a module without a git remote
- `npx sv help` - Description of all commands

## Programmatic API

The `SV` class can be used directly from code:

```ts
import { SV, versionUtil } from 'submodule-version';

const sv = new SV(process.cwd(), 'modules');
```

### Switching versions

- `sv.setVersion(name, version, constraint?)` - Checkout the submodule to a specific version tag and pin the version constraint in the project `package.json`. By default the constraint is an exact pin of the selected version; pass `^<version>` as `constraint` to keep receiving newer versions on update. If the submodule has local changes that cannot be carried over, the switch is aborted without touching the working tree (`GIT_DIRTY_SWITCH_CONFLICT` error)
- `sv.getConstraint(name)` - Read the current version constraint of a submodule from the project `package.json`
- `sv.setConstraint(name, constraint)` - Change the version constraint of a submodule without switching the checked-out version

### Inspecting changes and versions

- `sv.hasChanges(module?)` - `true` if the module (or the project itself, when `module` is omitted) has uncommitted changes or unpushed commits
- `sv.hasUncommittedChanges(module?)` - `true` if the working tree has uncommitted changes
- `sv.currentVersion(module?)` - The version tag `HEAD` points at, or `null` when there is none
- `sv.latestVersion(module?)` - The latest known version tag (`0.0.0` when there are no tags)
- `sv.getRemote(module?)` - The `origin` remote URL, or `null`
- `sv.isPublished(module?)` - `true` if the module is a git repo with a configured remote

### Publishing

- `sv.publish({ module?, repoUrl?, message?, bump })` - Commit, tag and push a new version of a module (or the project itself). Returns the published version.
  - `bump: 'release' | 'minor' | 'major'` - How to bump the latest version (`1.2.3` → `1.2.4`, `1.3.0`, `2.0.0`)
  - For a module without a git remote, pass `repoUrl` — `sv` initializes the repo and sets the remote automatically
  - Publishing is only possible from the latest version (`GIT_NOT_LATEST_VERSION` error otherwise)
  - Submodules are checked out on tags (detached `HEAD`) — `publish` creates a local branch bound to the remote branch before committing, and syncs with the remote (`pull --rebase --autostash`) when it is ahead
  - If the working tree is clean and `HEAD` already has a version tag, `publish` just pushes the branch and the tag without bumping

### Version utilities

`versionUtil` is also exported and now includes `versionUtil.bump(version, 'release' | 'minor' | 'major')` alongside `compare`, `pick`, `validate` and `latest`.

## Submodule dependencies 

Sumbodules can contains their own dependencies specified in `package.json` as `sv` object.

To install submodule in submodule run `npx install <git_url> [target_submodule]`
