# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-11-14

### Fixed

- Verified against Ubuntu 26.04.1 LTS and the official `hello 2.10-5build1` source package, whose `lintian` run is clean: the plugin no longer reports false errors or warnings for that package.
- Changelog parsing accepts space-separated multi-distribution headers (`frozen unstable`) and early Debian headers (`priority=LOW`); `U001` validates only the current entry and historical entries are parsed best-effort.
- DEP-8 parsing accepts `Test-Command` entries and treats `Depends` as optional; script existence and execute-bit checks apply only to `Tests:` entries.
- Non-DEP-5 `debian/copyright` and style-only advice (`U013`, `U029`, `U030`) are informational; an incomplete DEP-5 file still warns.
- Build-log diagnosis recognises localized (Chinese) messages for unmet build dependencies, missing headers, missing pkg-config packages, permission errors and command-not-found, in addition to English.
- Build and test plans prefix log-producing commands with `LC_ALL=C`, and `ubuntu_test_plan` returns a `notes` field explaining why.
- Host compatibility widened: `engines.dsh` and the `@deepseek-ai/dsh-tools` peer now accept `>=0.2.0-0 <0.3.0-0`.
- `ubuntu_scaffold_package` writes a long description in `debian/control`, removing the real `lintian` `extended-description-is-empty` warning from its output.
- Test suite grew to 91 tests, including the real `hello` shape and a Chinese-locale build log.

[0.1.1]: https://github.com/HougeLangley/dsh-ubuntu-packaging/releases/tag/v0.1.1

## [0.1.0] - 2026-11-14

### Added

- `ubuntu_inspect_package` host tool: normalized `debian/` view covering layout, changelog, deb822 `control`, `debian/rules`, source format, DEP-3 patches and DEP-8 tests.
- `ubuntu_lint_package` host tool: lintian-compatible static checks with stable issue codes, severity, fix hints and strict mode.
- `ubuntu_scaffold_package` host tool: validated `debian/` generator (control, rules, changelog, DEP-5 copyright, source format, watch file, DEP-8 smoke test) that writes only `<sourceDir>/debian/`.
- `ubuntu_build_plan` host tool: ordered build plan for `sbuild`, `dpkg-buildpackage` and `debuild`, including artifact inspection and upload notes.
- `ubuntu_test_plan` host tool: lintian, install/smoke, DEP-8, `autopkgtest` (LXD, QEMU, PPA) and failure-triage planning.
- `ubuntu_diagnose_build` host tool: build-log triage with evidence, cause, concrete fix and documentation link for each finding.
- `ubuntu-packaging` runtime skill with reference sheets for the Debian directory, build/test/release flow, the fix playbook and sources.
- Doc tooling metadata: English and Simplified Chinese locale entries, 36×36 plugin icon, 640×300 detail preview and the `docs/DETAIL.md` detail page.
- README, README.zh-CN, marketplace submission kit and this changelog.
- `node:test` suites covering deb822 and changelog parsing, lint rules, scaffolding output and build-log diagnosis.

[Unreleased]: https://github.com/HougeLangley/dsh-ubuntu-packaging/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/HougeLangley/dsh-ubuntu-packaging/releases/tag/v0.1.0
