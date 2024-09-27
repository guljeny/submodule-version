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
- `Submodule version` creates a graph of whole project and install only possible and actual versions

## Versioning

Sumodules without specified version tags will be installed with ref to the latest commit. You should manage them manually.

To add new version in submodule:
- Specify version in `package.json`
- Add and push git tag with the same version (`git tag 1.0.1`)


## Commands

- `npx sv validate` - Validate all dependencis and install missing modules
- `npx sv install <git_url> [target_submodule]` - Install new dependency
- `npx sv update` - Update all dependencies to the latest possible versions
- `npx sv help` - Description of all commands

## Submodule dependencies 

Sumbodules can contains their own dependencies specified in `package.json` as `sv` object.

To install submodule in submodule run `npx install <git_url> [target_submodule]`
