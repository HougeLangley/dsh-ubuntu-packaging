# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
