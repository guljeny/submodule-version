# Submodule version

## Git **S**ubmodule **V**ersion tool

[![NPM](https://nodei.co/npm/submodule-version.png?mini=true)](https://www.npmjs.com/package/submodule-version)

`Submodule version` is a tool to manage git submodules as versioned packages.

This tool designet to split projects in-to submodules *without npm-packages headache*.

With `submodule version` code can be organized like a *single monorepo*, but each submodule can be *easily reused* in another projects like npm-package.

## Problem to solve

Take a look on the next situation:

- Project has 2 submodules `ui-button-element` and `render-engine`
- Package `ui-button-element` dependents on the `render-engine`
- Third repo `ui-slider-element` dependets on newest version of the `render-engine`

This cause next problems:

- Add `ui-slider-element` cause difficulties with handle different `render-engine` versions
- How to update `ui-button-element` if it's repo contains new version?

Submodule version helps to

- Take a look which project should be updated and which version should be installed
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
- `Submodule version` creates a graph of whole project and install only possible and actual versions

## Commands

- `sv validate` - Validate all dependencis and install missing modules
- `sv install <git_url> [target_submodule]` - Install new dependency
- `sv update` - Update all dependencies to the latest possible versions
- `sv help` - Description of all commands
