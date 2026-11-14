# dsh-ubuntu-packaging

Ubuntu/Debian source-package toolkit for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`): six host tools plus the `ubuntu-packaging` skill for inspecting, linting, scaffolding, planning and diagnosing `debian/` packages.

The tools are read-only by design, except `ubuntu_scaffold_package`, which writes only `<sourceDir>/debian/`. None of them starts a shell or touches the network: a build plan is a plan, a test plan is a plan, and a diagnosis is a reading of the log you hand it.

English | [简体中文](README.zh-CN.md)

## Install

Install into the `web` or `desktop` profile; the commands are identical apart from the profile name.

### From GitHub

```sh
dsh plugin --profile web add github:HougeLangley/dsh-ubuntu-packaging
```

### From the v0.1.0 release tarball

```sh
curl -LO https://github.com/HougeLangley/dsh-ubuntu-packaging/releases/download/v0.1.0/dsh-ubuntu-packaging-0.1.0.tgz
dsh plugin --profile web add ./dsh-ubuntu-packaging-0.1.0.tgz
```

`dsh plugin add` also accepts the release URL in place of a downloaded path.

### From a local checkout

```sh
git clone https://github.com/HougeLangley/dsh-ubuntu-packaging.git
dsh plugin --profile web add ./dsh-ubuntu-packaging
```

### From the Plugins page

Open **Settings → Plugins**, add the plugin with `github:HougeLangley/dsh-ubuntu-packaging`, the release `.tgz`, or the path to your checkout, then enable it.

Restart `dsh web` (or the desktop app) after any of these. The bundle is ESM with no build step. If the optional `@deepseek-ai/dsh-tools` peer is missing, the plugin only warns: activation still succeeds and the skill still loads.

## Requirements

- **dsh** 0.2.1-rc.5 or newer in the 0.2.x line; **Node.js 22 or newer** (ESM only, no TypeScript, no build step).
- **Ubuntu 22.04 or newer** (or a Debian derivative) for real builds and package tests. The tools themselves are file readers and writers, so they run wherever dsh runs.
- Target baseline: **Ubuntu 26.04 LTS "resolute"**, the default for lint and for every plan. Ubuntu 25.10 "questing" and 24.04 LTS "noble" are called out where behaviour differs.
- Real builds and tests need the Ubuntu toolchain on the host, installed with root (`sudo apt`): `dpkg-buildpackage`, `sbuild`, `lintian` and `autopkgtest`. Each plan lists the prerequisites it needs. On Ubuntu 25.10 and newer, sbuild's `unshare` backend is the recommended one; `schroot` is legacy.

## Tools

| Tool | What it does | Network | Writes files |
| --- | --- | :---: | :---: |
| `ubuntu_inspect_package` | Parses `debian/` and returns a normalized view: layout, changelog, deb822 `control`, `rules`, `source/format`, DEP-3 patches and DEP-8 tests, plus the lint issues it finds. | No | No |
| `ubuntu_lint_package` | Static checks with stable, lintian-compatible codes: missing `debian/` files, changelog/control mismatches, debhelper compat, `Rules-Requires-Root`, DEP-5 copyright, `debian/watch`, quilt series and DEP-8 tests. `strict: true` turns warnings into a failure. | No | No |
| `ubuntu_scaffold_package` | Generates a validated `debian/` skeleton: control, rules, changelog, DEP-5 copyright, `source/format`, a watch file when a homepage is given, and a DEP-8 smoke test when tests are enabled. Refuses an existing `debian/` unless `overwrite: true`. | No | **Yes, `<sourceDir>/debian/` only** |
| `ubuntu_build_plan` | Produces an ordered, release-aware build plan: tooling, source preparation, `sbuild` / `dpkg-buildpackage` / `debuild`, artifact inspection, lintian, sign and upload notes. | No | No |
| `ubuntu_test_plan` | Produces a test plan: lintian, install/smoke/remove/purge, DEP-8 `debian/tests`, `autopkgtest` on LXD, QEMU and PPA, plus failure triage. | No | No |
| `ubuntu_diagnose_build` | Reads a build log (inline text or a file path you pass) and returns findings with evidence, cause, a concrete fix and a documentation link. | No | No |

Every tool accepts absolute or working-directory-relative paths and reports errors that name the file and the rule.

## The `ubuntu-packaging` skill

The bundle also registers a runtime skill, `ubuntu-packaging`, so an agent can run the whole loop without further reading: the resolute/questing/noble baseline, source versus binary packages, version strings, building with `dpkg-buildpackage` / `sbuild` / `debuild` / `gbp`, testing with `lintian` / `autopkgtest` / `piuparts` / `reprotest`, PPA and archive release steps, the FTBFS and autopkgtest fix playbook, changelog discipline, DEP-3 patches, DEP-5 copyright, `debian/watch`, and a troubleshooting table. Reference sheets live in `skills/ubuntu-packaging/references/`.

## Example prompts

**Inspect a package before upload**

> Inspect `./hello-2.10` and tell me what would fail review: changelog versus control mismatch, debhelper compat, missing DEP-5 fields, malformed patches. Then fix the lint errors you find.

**Generate a `debian/` skeleton**

> Scaffold a `debian/` directory for `./hello-2.10`: package `hello`, upstream 2.10, `-0ubuntu1`, target `resolute`, maintainer `Jane Doe <jane@example.com>`, homepage `https://www.gnu.org/software/hello/`, license `GPL-3+`, autotools build, and include a DEP-8 smoke test.

**Diagnose a failed build**

> Here is my sbuild log. Why did it fail, which `Build-Depends` line in `debian/control` is missing, and what exactly should I patch?

## Security and side effects

- **No shell execution.** The six tools never spawn a process. The build and test plans are text for you or the agent to run yourself.
- **No network access.** No tool downloads sources, queries Launchpad, runs `uscan`, or uploads anything. `ubuntu_scaffold_package` does not fetch an upstream tarball.
- **The write surface is one directory.** `ubuntu_scaffold_package` writes only inside `<sourceDir>/debian/`, and refuses to touch an existing `debian/` unless you pass `overwrite: true`.
- **Reads stay where you point them.** Inspection and linting read the package directory; `ubuntu_diagnose_build` reads only the log text or log file path you provide. It does not fetch a remote log.
- **No auto-fix, no auto-upload.** Findings carry the concrete edit; applying it is your call. Nothing is signed or uploaded for you.

## Repository layout

```text
package.json            bundle manifest, dsh.bundle patch, test script
cordis.patch.yml        inserts the ubuntu-packaging plugin
lib/
  index.js              activation, six tools, skill registration
  parse.js              deb822, changelog, rules, series, DEP-8 parsing
  lint.js               lintian-compatible rules
  scaffold.js           debian/ generator
  buildplan.js          build planning
  testplan.js           test planning
  diagnose.js           build log triage
skills/ubuntu-packaging/
  SKILL.md              the methodology the agent follows
  references/           debian-reference, build-test-release, fix-playbook, sources
docs/                   DETAIL.md, preview.svg, MARKETPLACE.md, SOURCES.md
locale/                 en.json, zh.json
tests/                  node:test suites for parsing, lint and the tools
```

## Development

Node.js 22 or newer, no install step required:

```sh
npm test                                   # node --test "tests/**/*.test.mjs"
node --check lib/index.js
```

The suite uses the built-in `node:test` runner with fixture packages. It needs no Ubuntu toolchain: the tool tests assert on parsed results and generated `debian/` text.

## License

MIT © 2026 HougeLangley. See [LICENSE](LICENSE). Changes are recorded in [CHANGELOG.md](CHANGELOG.md); marketplace submission material lives in [docs/MARKETPLACE.md](docs/MARKETPLACE.md).
