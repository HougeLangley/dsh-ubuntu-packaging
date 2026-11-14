# Marketplace submission kit

**Status: not submitted, not listed.** `dsh-ubuntu-packaging` is not in the
`awesome-dsh-plugin/awesome-dsh-plugin` catalog, not in its generated site, and not in any
market index yet. The material below is ready to submit; nothing here claims a listing.

## What the upstream catalog accepts

The catalog lives in `awesome-dsh-plugin/awesome-dsh-plugin`. Two rules decide where a
submission goes:

- The list data is `data/plugins/<owner>__<repo>.yml`, one file per plugin.
- `README.md` and `README.zh.md` are generated from those files. Do not edit them by hand,
  do not append a row, and do not regenerate and commit them for a new entry — the PR is
  the one YAML file.

The marketplace app (`dsh-market`) is a consumer of the generated index, not a place to
submit entries. Merging the PR is what makes the plugin appear.

## The entry to add

File: `data/plugins/HougeLangley__dsh-ubuntu-packaging.yml`

```yaml
url: https://github.com/HougeLangley/dsh-ubuntu-packaging
name: HougeLangley/dsh-ubuntu-packaging
category: tools
description:
  en: 'Ubuntu and Debian source-package tools for DeepSeek Harness: inspect debian/, lint with lintian-compatible codes, scaffold a debian/ directory, plan dpkg-buildpackage or sbuild builds and autopkgtest runs, and diagnose build logs. Read-only except scaffold; no shell execution and no network access.'
  zh: '面向 DeepSeek Harness 的 Ubuntu/Debian 源码包工具：检查 debian/、按 lintian 兼容标签静态检查、生成 debian/ 骨架、规划 dpkg-buildpackage 或 sbuild 构建与 autopkgtest 测试，并诊断构建日志。除 scaffold 外均为只读；不启动 shell，不联网。'
tarball: https://github.com/HougeLangley/dsh-ubuntu-packaging/releases/download/v0.1.0/dsh-ubuntu-packaging-0.1.0.tgz
```

Notes on the fields:

- `category: tools` is the closest fit. The catalog confirms the category is applied from
  this line, not from `package.json` keywords or the market UI.
- The English description is single-quoted because it contains `: `. Unquoted, YAML reads
  that colon as a nested key and the file fails to parse.
- `tarball` is pinned to the `v0.1.0` tag, so the versioned asset name cannot 404 when a
  later release is cut. Do not switch it to `releases/latest/download/` while the asset name
  carries the version.
- `icon:` is intentionally omitted. The catalog accepts GitHub-hosted raster images
  (`png`, `jpg`, `jpeg`, `webp`) only and refuses SVG; this repository ships `icon.svg` for
  the in-app plugin card, so the listing falls back to the owner avatar. Add a GitHub-hosted
  square PNG later if a custom storefront tile is wanted.
- No `npm:` key. The catalog detects an npm package from the registry and rejects a
  hand-written `npm:` field; this plugin is installed from GitHub or a release tarball.

## Submission steps

1. Confirm the repository is public, older than one day, and carries the `dsh-plugin`
   topic; the submission gate checks all three.
2. Confirm `package.json` declares `dsh.bundle` with `./cordis.patch.yml`, and that the file
   is present at the repository root.
3. Publish the `v0.1.0` GitHub release with the asset `dsh-ubuntu-packaging-0.1.0.tgz`, then
   check the exact tarball URL returns 200:

   ```sh
   curl -fsSI https://github.com/HougeLangley/dsh-ubuntu-packaging/releases/download/v0.1.0/dsh-ubuntu-packaging-0.1.0.tgz | head -n 1
   ```

4. Fork `awesome-dsh-plugin/awesome-dsh-plugin`.
5. Add exactly one file, `data/plugins/HougeLangley__dsh-ubuntu-packaging.yml`, with the
   content above. Change no other entry and no generated README.
6. Commit, push, and open a pull request against `main`.
7. Wait for the submission gate (entry count, `dsh.bundle`, repo age, awesome-lint, site
   build), then for a maintainer to read the repository against the description.

## Pull request

Title:

```text
Add HougeLangley/dsh-ubuntu-packaging
```

Body:

```markdown
## What

Adds one entry for `HougeLangley/dsh-ubuntu-packaging` under `tools`.

## Plugin

- Repository: https://github.com/HougeLangley/dsh-ubuntu-packaging
- Install: `dsh plugin --profile web add github:HougeLangley/dsh-ubuntu-packaging`
- Tarball: https://github.com/HougeLangley/dsh-ubuntu-packaging/releases/download/v0.1.0/dsh-ubuntu-packaging-0.1.0.tgz
- Six host tools plus the `ubuntu-packaging` runtime skill for Ubuntu and Debian source
  packages. Read-only except `ubuntu_scaffold_package`, which writes only into the package's
  `debian/` directory. No tool runs a shell or uses the network.

## Checks

Tick these on the branch before opening the PR.

- [ ] `package.json` declares `dsh.bundle` pointing at `cordis.patch.yml`
- [ ] Repository is public and older than one day
- [ ] Repository has the `dsh-plugin` topic
- [ ] The `v0.1.0` release is published and the tarball URL returns 200
- [ ] Only `data/plugins/HougeLangley__dsh-ubuntu-packaging.yml` is added; the generated
      READMEs are untouched
- [ ] Description matches the code: six tools, one skill, five read-only tools, one
      `debian/` writer, no shell, no network
- [ ] `icon:` omitted on purpose: the catalog refuses SVG and this repository ships
      `icon.svg`
```

## Pre-listing checklist

- [ ] `dsh.bundle` exists in `package.json` and `cordis.patch.yml` matches the bundle id.
- [ ] A clean-profile install works: `dsh plugin --profile web add github:...` in a fresh
      profile, then restart and confirm the six tools and the `ubuntu-packaging` skill load.
- [ ] Repository is public, at least one day old, not archived, and carries the
      `dsh-plugin` topic.
- [ ] The `v0.1.0` release exists with the exact asset name used in `tarball:`.
- [ ] `tarball:` is pinned to the tag and returns 200 (`curl -fsSI`).
- [ ] The description ends with a period, contains no marketing claims, and every claim in
      it is visible in the repository (six tools, one skill, the read-only boundary).
- [ ] The English description is quoted because of the `: ` sequence.
- [ ] Exactly one file is added to `data/plugins/`; no README edit; no other entry touched.
- [ ] `LICENSE`, `README.md` and `CHANGELOG.md` are present at the repository root.
- [ ] Test suite passes locally: `npm test`.
- [ ] `icon:` is omitted (SVG is refused) and the fallback avatar is acceptable.
- [ ] The PR states the current status honestly: this plugin is not listed until the PR is
      merged.

## After merge

The catalog site rebuilds from `data/plugins/`, and `dsh-market`'s Discover view picks up
the regenerated index when it next loads its index sources. The catalog also publishes an
npm-hosted copy (`dsh-plugin-catalog`), which can lag behind the site by a short while.
Listing is not a security review: the catalog checks the entry against the repository, not
the runtime behaviour of the plugin.

**Current state: no PR has been opened. Not submitted. Not listed.**
