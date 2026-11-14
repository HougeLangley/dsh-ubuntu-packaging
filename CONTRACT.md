# dsh-ubuntu-packaging — Frozen Delivery Contract (v1)

This file is the single source of truth for every parallel worker. Do not edit it.
Package root: `/Users/suyeqin/dsh-ubuntu-packaging`
Target baseline: **Ubuntu 26.04 LTS "resolute"** (released 2026-04-23), with 25.10 "questing" and 24.04 LTS "noble" called out where behaviour differs.

## 1. What we ship

A standard DeepSeek Harness (dsh) **bundle** named `dsh-ubuntu-packaging`, version `0.1.0`,
publishable to GitHub and listable in the dsh plugin market.

It gives a dsh agent:

1. A runtime **skill** `ubuntu-packaging` — the researched Ubuntu/Debian packaging,
   build, test and fix methodology.
2. Six **Host tools** for inspecting, linting, scaffolding, planning builds and tests,
   and diagnosing build/test logs. No shell execution.

Zero runtime dependencies except the harness-provided `@deepseek-ai/dsh-tools`.
Node.js >= 22, ESM only, no TypeScript, no build step.

## 2. Frozen repository layout and ownership

```
/Users/suyeqin/dsh-ubuntu-packaging
├── package.json              # p8-core
├── cordis.patch.yml          # p8-core
├── lib/
│   ├── index.js              # p8-core: entry, tool registration, skill registration
│   ├── parse.js              # p8-core: deb822, changelog, rules, series, tests/control
│   ├── lint.js               # p8-core
│   ├── scaffold.js           # p8-core
│   ├── buildplan.js          # p8-core
│   ├── testplan.js           # p8-core
│   └── diagnose.js           # p8-core
├── skills/ubuntu-packaging/
│   ├── SKILL.md              # p8-research
│   └── references/*.md       # p8-research
├── docs/
│   ├── SOURCES.md            # p8-research
│   ├── DETAIL.md             # p8-docs
│   ├── preview.svg           # p8-docs
│   └── MARKETPLACE.md        # p8-docs
├── locale/en.json            # p8-docs
├── locale/zh.json            # p8-docs
├── icon.svg                  # p8-docs
├── README.md                 # p8-docs
├── README.zh-CN.md           # p8-docs
├── LICENSE                   # p8-docs (MIT, HougeLangley)
├── CHANGELOG.md              # p8-docs
├── tests/*.test.mjs          # p8-core
└── .gitignore                # p8-docs
```

Do not create files outside your ownership. Never run `git`, never install the plugin,
never edit `CONTRACT.md`.

## 3. package.json (exact shape; p8-core writes it)

```json
{
  "name": "dsh-ubuntu-packaging",
  "version": "0.1.0",
  "description": "Ubuntu packaging toolkit for DeepSeek Harness: inspect, lint, scaffold and plan debian/ source packages, then test and diagnose the resulting .deb builds.",
  "type": "module",
  "main": "./lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": [
    "lib",
    "skills",
    "docs",
    "locale/*.json",
    "cordis.patch.yml",
    "icon.svg",
    "README.md",
    "README.zh-CN.md",
    "LICENSE",
    "CHANGELOG.md"
  ],
  "engines": { "node": ">=22", "dsh": ">=0.2.1-rc.5 <0.3.0-0" },
  "keywords": ["dsh", "dsh-plugin", "deepseek-harness", "ubuntu", "debian", "packaging", "deb", "sbuild", "autopkgtest", "lintian"],
  "license": "MIT",
  "author": "HougeLangley",
  "repository": { "type": "git", "url": "git+https://github.com/HougeLangley/dsh-ubuntu-packaging.git" },
  "homepage": "https://github.com/HougeLangley/dsh-ubuntu-packaging#readme",
  "bugs": { "url": "https://github.com/HougeLangley/dsh-ubuntu-packaging/issues" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "peerDependencies": { "@deepseek-ai/dsh-tools": ">=0.2.1-rc.5 <0.2.2-0 || >=0.2.2-rc.1 <0.3.0-0" },
  "peerDependenciesMeta": { "@deepseek-ai/dsh-tools": { "optional": true } },
  "scripts": { "test": "node --test \"tests/**/*.test.mjs\"" }
}
```

`cordis.patch.yml`:

```yaml
- insert:
    - id: ubuntu-packaging
      name: dsh-ubuntu-packaging
```

## 4. Host entry contract (`lib/index.js`)

```js
export const name = 'dsh-ubuntu-packaging'
export const inject = ['tools']
export async function apply(ctx) { /* six tools + skill, all inside ctx.effect */ }
```

Use the proven registration pattern:

```js
import { defineTool } from '@deepseek-ai/dsh-tools'
const dispose = ctx.tools.register(defineTool({
  name: 'ubuntu_inspect_package',
  description: '...',
  parameters: { path: { type: 'string', required: true, description: '...' } },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { /* ... */ } },
    render: (_args, value) => [{ type: 'text', text: '...' }],
  },
  execute: async (args, execution) => { /* return object */ },
}))
```

Load `defineTool` with a dynamic import and an identity fallback, exactly like the
AOSC plugin: `const module = await import('@deepseek-ai/dsh-tools')`; on failure warn and
return `(definition) => definition`.

Register the skill only when `ctx.get('skills')` exists:

```js
const skills = typeof ctx.get === 'function' ? ctx.get('skills') : undefined
if (skills) {
  const content = await readFile(new URL('../skills/ubuntu-packaging/SKILL.md', import.meta.url), 'utf8')
  disposers.push(skills.register({
    name: 'ubuntu-packaging',
    description: 'Ubuntu packaging: debian/ source packages, dpkg-buildpackage, sbuild, lintian, autopkgtest and release checks.',
    whenToUse: 'Use when inspecting, linting, scaffolding, building, testing or debugging Ubuntu/Debian source packages.',
    content,
    source: 'runtime',
    resourceBase: { kind: 'directory', path: fileURLToPath(new URL('../skills/ubuntu-packaging/', import.meta.url)) },
  }))
}
```

A missing skill file must only warn, never fail activation. Every disposer is owned by
`ctx.effect(() => () => { for (const d of disposers.reverse()) d() })`.

## 5. Tool contracts

All paths accept absolute or cwd-relative paths. All errors are thrown `Error`s naming
the file and rule. Honor `execution.signal` in any network work.

### 5.1 `ubuntu_inspect_package`

Input: `{ path: string }` — source package root (contains `debian/`) or the `debian/` directory itself.

Output:
```json
{
  "path": "/abs/src",
  "layout": {
    "debian": true, "changelog": true, "control": true, "copyright": true, "rules": true,
    "sourceFormat": "3.0 (quilt)", "compat": null, "debhelperCompat": "13",
    "watch": true, "patches": 2, "tests": 1, "installFiles": ["hello.install"],
    "conffiles": false, "manpages": false, "native": false
  },
  "changelog": {
    "source": "hello", "version": "2.10-0ubuntu1",
    "upstreamVersion": "2.10", "debianRevision": "0", "ubuntuRevision": "ubuntu1",
    "distribution": "resolute", "urgency": "medium",
    "maintainer": "Jane Doe <jane@example.com>", "date": "Thu, 13 Nov 2026 10:00:00 +0800",
    "entries": 1
  },
  "control": {
    "source": {
      "source": "hello", "section": "devel", "priority": "optional", "maintainer": "Ubuntu Developers <...>",
      "standardsVersion": "4.7.4", "buildDepends": ["debhelper-compat (= 13)"],
      "homepage": "https://...", "rulesRequiresRoot": "no", "testsuite": ["autopkgtest"],
      "vcs": { "Vcs-Browser": "...", "Vcs-Git": "..." }
    },
    "packages": [
      { "package": "hello", "architecture": "any", "depends": ["${misc:Depends}", "${shlibs:Depends}"], "description": "..." }
    ]
  },
  "rules": { "present": true, "executable": true, "dhSequencer": true, "overrides": ["dh_auto_configure"], "buildsystem": "autotools" },
  "tests": {
    "control": true,
    "entries": [{ "tests": ["build"], "depends": ["@", "build-essential"], "restrictions": [] }],
    "scripts": ["build"]
  },
  "patches": {
    "series": ["0001-fix-build.patch"],
    "files": ["0001-fix-build.patch"],
    "dep3": { "0001-fix-build.patch": { "Description": "...", "Origin": "...", "Forwarded": "..." } }
  },
  "issues": [ /* same objects as ubuntu_lint_package */ ]
}
```
Missing files yield null/empty structures. A non-existent path throws.

Parsing rules:
- `debian/control` is deb822: stanzas separated by blank lines, continuation lines start
  with space/tab, `.` means blank line in descriptions. Preserve field spelling.
- `debian/changelog` is RFC 5322-like: first line `source (version) distribution; urgency=X`,
  change lines indented, trailer ` -- Name <email>  Date`.
- `debian/rules`: detect shebang, `%:` target, `dh $@`, `override_dh_*:` targets.
- `debian/source/format` first non-comment line.
- `debian/patches/series` non-comment lines; each patch's leading `Description:`,
  `Origin:`, `Forwarded:`, `Author:`, `Last-Update:`, `Applied-Upstream:` headers.
- `debian/tests/control` is deb822.
- `compat` file vs `debhelper-compat (= N)` in Build-Depends.

### 5.2 `ubuntu_lint_package`

Input: `{ path: string, strict?: boolean, targetRelease?: string }` (default `resolute`).

Output: `{ path, ok, errorCount, warningCount, infoCount, issues: [...] }`
Issue: `{ code, severity: "error"|"warning"|"info", rule, message, file, line, fix }`.
`ok = errorCount === 0 && (!strict || warningCount === 0)`.
Use a real lintian tag as `code` when the rule maps to one; otherwise `U###`. Document
the mapping in `lib/lint.js`.

Required rules (minimum):

| Code | Sev | Rule |
| --- | --- | --- |
| `no-debian-changelog` | error | `debian/changelog` missing |
| `no-control-file` | error | `debian/control` missing |
| `no-copyright-file` | error | `debian/copyright` missing |
| `no-debian-rules` | error | `debian/rules` missing |
| `debian-rules-not-executable` | error | `debian/rules` is not executable |
| `missing-debian-source-format` | warning | `debian/source/format` missing |
| `source-format-1.0` | warning | source format is `1.0` |
| U001 | error | changelog first line malformed |
| U002 | error | changelog source name differs from control `Source` |
| U003 | warning | version has no Debian revision while format is `3.0 (quilt)` |
| U004 | warning | distribution is `unstable` or `UNRELEASED` |
| U005 | warning | urgency not one of low/medium/high/emergency/critical |
| U006 | warning | changelog trailer date not RFC 5322 (`date -R` format) |
| U007 | warning | changelog trailer missing ` -- Name <email>  Date` shape |
| `no-section-field` | warning | source stanza `Section` missing |
| `no-priority-field` | warning | source stanza `Priority` missing |
| `no-standards-version-field` | error | `Standards-Version` missing |
| U008 | info | `Standards-Version` older than `4.7.4` |
| `build-depends-on-essential-package-without-using-version` | warning | `Build-Depends` on `build-essential`/`dpkg-dev` without version |
| `debhelper-compat-file-is-missing` | error | neither `debian/compat` nor `debhelper-compat (= N)` |
| `package-uses-old-debhelper-compat-version` | warning | compat < 13 |
| U009 | warning | both `debian/compat` and `debhelper-compat (= N)` present |
| `rules-requires-root-missing` | warning | `Rules-Requires-Root` missing |
| U010 | error | no binary package stanza |
| U011 | warning | binary `Architecture` missing/odd |
| U012 | info | binary `Depends` lacks `${misc:Depends}` |
| U013 | warning | `Description` synopsis starts lowercase or ends with a period |
| U014 | info | `Homepage` missing or not http(s) |
| U015 | info | no `Vcs-Git`/`Vcs-Browser` |
| U016 | warning | `debian/rules` has no `dh $@` |
| U017 | warning | direct `dh_*` call outside an `override_dh_*` target |
| U018 | warning | deprecated `dh_clean -k` |
| U019 | warning | `debian/rules` missing `#!/usr/bin/make -f` |
| U020 | warning | `debian/copyright` missing DEP-5 `Format:` |
| U021 | warning | copyright has no `Files:` stanza |
| U022 | warning | copyright has no `License:` stanza |
| `debian-watch-file-is-missing` | info | no `debian/watch` |
| U023 | warning | watch file missing `version=4` |
| U024 | warning | watch URL uses `http://` |
| U025 | warning | watch URL has no `(...)` capture group |
| U026 | error | `debian/patches/series` lists a missing patch |
| U027 | warning | patch file exists but is not listed in `series` |
| U028 | warning | patch lacks DEP-3 `Description:` |
| U029 | warning | patch lacks `Origin:` or `Forwarded:` |
| U030 | info | patch filename does not start with `NNNN-` |
| U031 | warning | `Testsuite: autopkgtest` declared but `debian/tests/control` missing |
| U032 | error | `debian/tests/control` entry lacks `Tests` or `Depends` |
| U033 | error | unknown DEP-8 restriction |
| U034 | warning | test script listed in `Tests:` does not exist |
| U035 | warning | test script is not executable |
| U036 | info | test script lacks a shebang |
| U037 | info | `Tests: build` without `build-essential` in `Depends` |
| U038 | warning | `debian/install` line references a path absent from the source tree (best effort) |
| U039 | info | `DEB_BUILD_OPTIONS`/hardening not referenced in rules (informational only) |

Known DEP-8 restrictions: `breaks-testbed`, `isolation-machine`, `isolation-container`,
`needs-reboot`, `needs-root`, `skippable`, `flaky`, `superficial`, `build-needed`,
`allow-stderr`, `rw-build-tree`, `big-parallel`.
Known urgencies: `low`, `medium`, `high`, `emergency`, `critical`.
Known formats: `3.0 (quilt)`, `3.0 (native)`, `1.0`.

### 5.3 `ubuntu_scaffold_package`

Input:
```json
{
  "sourceDir": "/abs/hello-2.10", "packageName": "hello", "upstreamVersion": "2.10",
  "debianRevision": "0", "ubuntuRevision": "ubuntu1", "distribution": "resolute",
  "maintainer": "Jane Doe <jane@example.com>", "homepage": "https://www.gnu.org/software/hello/",
  "license": "GPL-3+", "buildSystem": "autotools", "architecture": "any",
  "description": "Classic greeting program", "buildDepends": ["texinfo"], "depends": [],
  "tests": true, "native": false, "overwrite": false
}
```
`buildSystem`: `autotools | cmake | meson | python | rust | go | node | custom`.
Validate everything before writing: package name regex, version starts with a digit,
distribution codename, maintainer shape, license non-empty, build system enum.
Refuse an existing `debian/` unless `overwrite: true`.

Generate:
- `debian/control` (source + one binary stanza; `Build-Depends: debhelper-compat (= 13),
  <buildDepends>`; `Standards-Version: 4.7.4`; `Rules-Requires-Root: no`; `Homepage`;
  `Package`, `Architecture`, `Depends: ${misc:Depends}${shlibs, }`, `Description`).
- `debian/rules` (`#!/usr/bin/make -f`, `%:\n\tdh $@`, plus a commented override stub for
  the selected build system when it is not autotools).
- `debian/changelog` (first entry with `-0ubuntu1`, urgency medium, current RFC 5322 date).
- `debian/copyright` (DEP-5 skeleton with `Format`, `Upstream-Name`, `Source`,
  `Files: *`, `License: <license>`; a clear TODO marker for the full license text).
- `debian/source/format` (`3.0 (native)` when `native`, else `3.0 (quilt)`).
- `debian/watch` when `homepage` is present (`version=4`, `<homepage>/(.+)\.tar\.gz`-style).
- `debian/tests/control` + `debian/tests/smoke` when `tests` (DEP-8 `Tests: smoke`,
  `Depends: @`, `Restrictions: superficial`; script checks `command -v <packageName>` and
  `--version`, exits 0).

Output: `{ packageDir, created: [...], files: { "debian/control": "text", ... }, lint: { ... }, warnings: [] }`.

### 5.4 `ubuntu_build_plan`

Input: `{ packageDir: string, release?: string, arch?: string, mode?: "binary"|"source"|"source+binary", tool?: "sbuild"|"dpkg-buildpackage"|"debuild", sign?: boolean, ppa?: string }`
Defaults: `resolute`, `amd64`, `binary`, `sbuild`, `false`, null.

Output: `{ prerequisites: [{command, purpose, required}], phases: [{name, commands: [{cmd, purpose, optional}]}], notes: [], checklist: [] }`
Phases in order:
1. Install tooling — `sudo apt update`; `sudo apt install -y devscripts debhelper dh-make build-essential lintian autopkgtest sbuild mmdebstrap uidmap`.
2. Prepare source — `cd <packageDir>`; `dpkg-buildpackage --build=source --no-check-builddeps --no-pre-clean` for source mode; `debsign` when signing.
3. Build — `sbuild --dist=<release>` (binary), `sbuild --source --dist=<release>` (both), `dpkg-buildpackage -us -uc -b` (dpkg binary), `debuild -us -uc` (debuild).
4. Inspect — `dpkg-deb -I`, `dpkg-deb -c`, `lesspipe` the `.deb`.
5. Test — `lintian <changes-or-dsc-or-deb>`, `sudo apt install ./<pkg>.deb`, smoke command.
6. Sign and upload — `debsign`, `dput ppa:<ppa> <changes>`; PPA version suffix `~<codename>1` note.
Notes must state: PPA/Archive accept source-only uploads; do a local binary build first;
`sbuild` unshare backend is recommended on 25.10+; `dpkg-buildpackage --build=source` is
the current source-only practice; `sbuild --source` builds both and Launchpad rejects
mixed uploads.

### 5.5 `ubuntu_test_plan`

Input: `{ packageDir: string, release?: string, arch?: string, mode?: "local"|"lxd"|"qemu"|"ppa", ppa?: string, packageName?: string }`
Defaults: `resolute`, `amd64`, `lxd`, null.

Output: `{ prerequisites, phases, dep8: {control: string, script: string} | null, failureTriage: [{symptom, cause, fix}], checklist }`
Phases:
1. Static — `lintian` on `.changes`/`.dsc`/`.deb`.
2. Install and smoke — `sudo apt install ./pkg.deb`; `dpkg -L pkg`; run the binary; `sudo apt remove`/`purge`; check `dpkg -s`.
3. DEP-8 — show a `debian/tests/control` + script skeleton when the package has none.
4. autopkgtest local — build image (`autopkgtest-build-lxd ubuntu-daily:<release>` or
   `autopkgtest-buildvm-ubuntu-cloud -r <release>`), then
   `autopkgtest --apt-upgrade --shell-fail --output-dir <out> <packageDir> -- lxd autopkgtest/ubuntu/<release>/<arch>`
   or `-- qemu <image>`; `--apt-pocket=proposed=src:<pkg>` when testing -proposed.
5. PPA — `ppa create`, `dput`, `ppa wait`, `ppa tests --release <release>`.
6. Deeper — `piuparts`, `reprotest`, `debci`.
Failure triage must cover: test passes locally but fails on Launchpad (network
restrictions), missing test dependencies, `breaks-testbed`/`isolation-*` restriction
mismatch, flaky tests, and tests that need `-proposed`.

### 5.6 `ubuntu_diagnose_build`

Input: `{ log?: string, path?: string }` — exactly one of raw log text or a log file path.

Output:
```json
{
  "summary": { "lines": 0, "errors": 0, "warnings": 0, "phase": "build|configure|test|install|package|unknown" },
  "findings": [{ "id": "missing-build-dep", "severity": "error", "evidence": "...", "cause": "...", "fix": "...", "doc": "..." }],
  "nextActions": ["..."]
}
```
Recognize at least:
- `dpkg-checkbuilddeps: error: Unmet build dependencies: ...`
- `No package 'X' found` and `fatal error: X.h: No such file or directory`
- `cannot find -lX`
- `dh_auto_configure`/`dh_auto_build`/`dh_auto_test`/`dh_install` failures
- `dh: command not found`, `dh_*: unknown option` (debhelper compat mismatch)
- `dpkg-shlibdeps: error: no dependency information found`
- `dpkg-source: error:`
- `debian/rules: ... Permission denied`
- `ModuleNotFoundError`, `ImportError` (Python build deps)
- `error: failed to select a version` / `no matching package named` (Rust/Go vendoring)
- `undefined reference to`, `collect2: error: ld returned 1 exit status`
- `FAIL:`, `not ok`, `AssertionError`, `Error: Process completed` (test failures)
- `E: <pkg>: ...` lintian errors
- `autopkgtest ... FAIL` / `Regression`
Each finding names a concrete next edit (which `debian/control` field, which `rules`
override, which patch) and a documentation URL. Deduplicate identical findings and
cap the output at 40 findings.

## 6. Skill contract (`skills/ubuntu-packaging/SKILL.md`)

No YAML frontmatter. Body 240–340 lines, English, imperative. It must let an agent run
the whole Ubuntu packaging loop without further reading:

1. Baseline: Ubuntu 26.04 LTS `resolute` (released 2026-04-23), 25.10 `questing`,
   24.04 `noble`; `debhelper 13.31`, compat 13; `debian-policy 4.7.4`;
   `lintian 2.129`; `autopkgtest 5.55`; `sbuild 0.91`.
2. Source package vs binary package; `debian/` directory anatomy
   (`changelog`, `control`, `copyright`, `rules`, `source/format`, `watch`, `patches`,
   `tests`, `install`, `compat`).
3. Version strings: upstream / Debian revision / Ubuntu revision; `ubuntuN`, `~`
   sorting, `~<codename>1` PPA suffix, `+dfsg`, `buildN`, native vs quilt.
4. Build: `dpkg-buildpackage` (source-only, binary, `-nc`), `sbuild` (unshare
   recommended on 25.10+, schroot legacy), `debuild`, `gbp`; artifact locations.
5. Test: `lintian` (tags, `--info`, overrides), install/smoke/upgrade/remove/purge,
   DEP-8 `debian/tests/control`, `autopkgtest` (PPA, LXD, QEMU, `-proposed` pockets),
   `piuparts`, `reprotest`.
6. Release: `debsign`, `dput` to PPA, PPA build wait, `ppa tests`, then archive upload /
   sponsorship; source-only upload rule.
7. Fix playbook: FTBFS classes (missing Build-Depends, configure, tests, install,
   shlibdeps, arch, ABI), autopkgtest regressions, migration blocking, network
   restrictions, flaky re-runs; for each, the log signature and the concrete edit.
8. Changelog discipline: `dch`, RFC 5322 dates, urgency, distribution, one entry per
   upload; `dch -l "~<codename>"`.
9. Patches: quilt `3.0 (quilt)`, `debian/patches/series`, DEP-3 headers, `quilt push/pop`,
   `dpkg-source --commit`, `gbp pq`.
10. `debian/copyright` DEP-5 and `debian/watch` (`uscan`).
11. "Using the dsh tools" mapping each of the six tools to a step.
12. Troubleshooting table mapping common errors to fixes.

`references/` must contain `debian-reference.md`, `build-test-release.md`,
`fix-playbook.md`, `sources.md`. Every non-obvious claim has a URL in `docs/SOURCES.md`.
Sources to use (all verified reachable): the Ubuntu project docs at
`https://documentation.ubuntu.com/...` (build-packages-locally, run-package-tests,
automatic-package-testing-autopkgtest, debian-directory, version-strings, patches,
DEP-3, FTBFS, autopkgtest-regressions, create-a-new-package, build-packages-in-a-ppa,
install-built-packages, set-up-for-ubuntu-development), `https://packages.ubuntu.com/resolute/<pkg>`
for versions, the Debian Policy Manual, `deb-version(7)`, `dpkg-buildpackage(1)`,
`sbuild(1)`, `autopkgtest(1)`, and the DEP-8 spec.

## 7. Metadata contract (p8-docs)

- `locale/en.json`: title "Ubuntu packaging", one-paragraph description covering the six
  tools, the skill, read-only/network boundaries, and that real builds/tests still need
  Ubuntu Linux with root/sbuild/autopkgtest. `meta.detail` = `docs/DETAIL.md`.
- `locale/zh.json`: same in Simplified Chinese.
- `docs/DETAIL.md`: exactly one image line `![Ubuntu packaging toolkit](preview.svg)`.
- `docs/preview.svg`: 640×300, self-contained, no text/fonts/scripts, light/dark readable.
- `icon.svg`: original 36×36, package box + Ubuntu-like circle motif, no text.
- `README.md` / `README.zh-CN.md`: install commands, tool table, skill name, requirements
  (Ubuntu 22.04+ host; Ubuntu 26.04 baseline; sbuild/autopkgtest for real runs),
  example prompts, security note (no shell execution; diagnose reads a log you provide),
  license.
- `docs/MARKETPLACE.md`: exact catalog entry for
  `awesome-dsh-plugin/awesome-dsh-plugin` (category `tools`), including the pinned
  `tarball:` URL placeholder `https://github.com/HougeLangley/dsh-ubuntu-packaging/releases/download/v0.1.0/dsh-ubuntu-packaging-0.1.0.tgz`,
  submission steps (data/plugins YAML), and pre-listing checklist.
- `LICENSE`: MIT, `Copyright (c) 2026 HougeLangley`.
- `CHANGELOG.md`: Keep a Changelog, 0.1.0 Added list.

## 8. Definition of done (every worker)

- Your files exist, parse, and contain no placeholder text.
- `cd /Users/suyeqin/dsh-ubuntu-packaging && node --test "tests/**/*.test.mjs"` passes.
- `node --check` passes for every `.js` / `.mjs` you wrote.
- Report files created, commands run with their real output, and anything unverified.
- No "done" without evidence. A report without command output is rejected.
