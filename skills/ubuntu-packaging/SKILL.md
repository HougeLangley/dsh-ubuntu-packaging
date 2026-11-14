# Ubuntu packaging, build, test and fix

Drive a Ubuntu source package from an unpacked tree to a signed upload, and
diagnose the build, lint and test failures found on the way. Every command below
runs on a Ubuntu host with `sudo`. The tools of this plugin do not execute
anything: they read files and print commands for you to run.

## 1. Baseline

Build and test against Ubuntu 26.04 LTS, codename `resolute`, released
2026-04-23. Use 25.10 `questing` and 24.04 LTS `noble` only where behaviour is
called out as different.

| Component | `resolute` | Used for |
| --- | --- | --- |
| `debhelper` | `13.31ubuntu1`, compat 13 | `dh` sequences in `debian/rules` |
| `debian-policy` | `4.7.4.0` | `Standards-Version` and packaging rules |
| `lintian` | `2.129.0ubuntu2` | static checks on `.dsc`, `.deb`, `.changes` |
| `autopkgtest` | `5.55` | DEP-8 as-installed tests |
| `sbuild` | `0.91.2ubuntu3` | clean-chroot binary and source builds |

```none
sudo apt install -y devscripts debhelper dh-make build-essential lintian \
  autopkgtest sbuild mmdebstrap uidmap ubuntu-dev-tools quilt
```

On 25.10 and later `sbuild` manages chroots on demand with `mmdebstrap` and the
`unshare` backend, the recommended setup; on 24.04 LTS install it from
`noble-backports` (`sudo apt install -y -t noble-backports sbuild mmdebstrap
uidmap`). Use `schroot` only on 22.04 and earlier, or for cross-building.

## 2. Source and binary packages

A **source package** is what you upload: `hello_2.10-0ubuntu1.dsc` plus
`hello_2.10.orig.tar.gz` and `hello_2.10-0ubuntu1.debian.tar.xz` for
`3.0 (quilt)`. A **binary package** is a `.deb` built from it for one
architecture. PPAs and the archive accept **source-only** uploads and Launchpad
builds the binaries, so always build a binary locally first. The `.changes` file
is the signed upload manifest listing every file of the upload.

Builds write artifacts to the parent directory of the source tree, so build
commands are usually followed by `cd ..`. `debian/` holds the packaging and is
not the `DEBIAN/` directory `dpkg-buildpackage` generates inside a binary.

| Path | Required | Purpose |
| --- | --- | --- |
| `debian/changelog` | yes | name, version, distribution, urgency, maintainer, date |
| `debian/control` | yes | deb822 source stanza plus one stanza per binary |
| `debian/copyright` | yes | DEP-5 machine-readable copyright and licence |
| `debian/rules` | yes | executable Makefile driving `dh` |
| `debian/source/format` | yes in practice | `3.0 (quilt)`, `3.0 (native)`, legacy `1.0` |
| `debian/watch` | optional | `uscan` release tracking, `version=4` |
| `debian/patches/` | with quilt | `series` plus DEP-3 patches |
| `debian/tests/` | optional | DEP-8 `control` plus test scripts |
| `debian/install` | optional | `dh_install` placement, one mapping per line |
| `debian/compat` | optional | compat level as a file; prefer `debhelper-compat` |

Field-by-field requirements: [the debian/ reference](references/debian-reference.md).

## 3. Version strings

| Version | Upstream | Debian revision | Ubuntu revision |
| --- | --- | --- | --- |
| `9.7-3ubuntu2` | `9.7` | `3` | `ubuntu2` |
| `2.10-0ubuntu1` | `2.10` | `0` (no Debian packaging) | `ubuntu1` |

- **Upstream version** starts with a digit and may contain letters, digits, `.`,
  `+`, `~`, `-`; the Debian revision may contain letters, digits, `.`, `+`, `~`.
- **`ubuntuN`** counts Ubuntu changes on a Debian revision: `2.0-2` becomes
  `2.0-2ubuntu1`, then `2.0-2ubuntu2`. Only a revision beginning with `ubuntu`
  blocks automatic sync from Debian.
- **`~` sorts before everything**, including the empty string, so `1.0~rc1` is
  earlier than `1.0` and `3.1-1ubuntu2~22.04.1` is earlier than `3.1-1ubuntu2`.
- **`~<codename>1`** is the PPA suffix, keeping the PPA version below the
  archive version: `3.3.0-1ubuntu0.1` becomes `3.3.0-1ubuntu0.1~resolute1`.
  Keep the trailing number, because Launchpad refuses a version it has accepted.
- **`+dfsg` / `+ds`** mark a repackaged tarball and belong to the upstream
  version: `7.80+dfsg1-5`. Ubuntu inherits them unchanged; `+` sorts after the
  bare version, so `7.80+dfsg1` is later than `7.80`.
- **`buildN`** marks a no-change rebuild and keeps the package syncable:
  `2.0-2` becomes `2.0-2build1`, then `2.0-2build2`; do not use `ubuntuN`
  unless the source changed.
- **Native vs quilt**: native packages have no Debian revision and no separate
  upstream tarball (`3.0 (native)`); quilt packages have both
  (`3.0 (quilt)`). A native Debian package with Ubuntu delta becomes
  `2.0ubuntu1`; a native Ubuntu package carries a bare `ubuntu`, as `2.0ubuntu`.
- **`+really`** rolls a bad upload back: to revert `3.1` to `2.0-2ubuntu2`,
  upload `3.1+really2.0-2ubuntu2`. Never lower a version without it, and never
  use an epoch for a rollback; epochs (`1:8.0.4+dfsg-1`) reset ordering after a
  scheme change and need Debian consensus.

Verify an ordering claim with
`dpkg --compare-versions 3.98ubuntu5.3~18.04.1 lt 3.98ubuntu5.3 && echo true`.
SRU and backport examples: [build to release](references/build-test-release.md).

## 4. Build

Build from the source directory that contains `debian/`, and choose the command
by what it must produce.

| Goal | Command |
| --- | --- |
| source-only package for upload | `dpkg-buildpackage --build=source --no-check-builddeps --no-pre-clean` |
| binary-only, clean chroot | `sbuild --dist=resolute` |
| source and binary in one pass | `sbuild --source --dist=resolute` |
| local binary, no chroot | `dpkg-buildpackage -us -uc -b` |
| local build via devscripts | `debuild -us -uc` |
| incremental rebuild, no clean | `dpkg-buildpackage -us -uc -b -nc` |

- `--build=source` (`-S`) builds the source package only, `--build=binary`
  (`-b`) binaries only, `--build=full` both. `--no-check-builddeps` (`-d`)
  skips the build-dependency check; use it only when the tooling is present.
  `--no-pre-clean` (`-nc`) keeps the tree and skips `debian/rules clean`.
- `-us -uc` skip GPG signing of `.dsc` and `.changes`; drop them when the upload
  must be signed.
- `sbuild --no-clean-source` skips the in-chroot clean, so build dependencies
  need not be on the host. `DEB_BUILD_OPTIONS="parallel=3" sbuild
  --dist=resolute` sets parallelism.
- `sbuild --arch=<arch>` builds another architecture (needs `schroot`),
  `--extra-package=/path/to/dep.deb` adds a local dependency, `--run-lintian`
  lints in the same run, and `--chroot-mode=unshare` forces the modern backend.

Inspect the result before testing it:

```none
dpkg-deb -I ../hello_2.10-0ubuntu1_amd64.deb
dpkg-deb -c ../hello_2.10-0ubuntu1_amd64.deb
lesspipe ../hello_2.10-0ubuntu1_amd64.deb
```

Sign a source upload with `debsign ../hello_2.10-0ubuntu1_source.changes`;
`gbp buildpackage` wraps the same steps for a git-ubuntu branch. Whatever the
tool, `.dsc`, `.debian.tar.*`, `.deb` and `.changes` land in the parent dir.

## 5. Test

Work through these stages in order; never skip one because a later one is slower.

**Static checks.** Lint the source metadata and the binary, because the tags
differ:

```none
lintian ../hello_2.10-0ubuntu1.dsc
lintian ../hello_2.10-0ubuntu1_amd64.deb
```

`--info` prints each tag's long description, `--pedantic` adds pedantic tags,
`--show-overrides` marks tags an override hides, and `--fail-on error,warning`
makes CI fail. Justify a deliberate tag in `debian/<package>.lintian-overrides`
or `debian/source/lintian-overrides`; never silence the whole run.

**Install, smoke, upgrade, remove, purge.** This catches bugs no linter sees.
Install the previous version first and the new `.deb` over it to exercise the
upgrade path:

```none
sudo apt install ./hello_2.10-0ubuntu1_amd64.deb
dpkg -L hello
command -v hello && hello --version
sudo apt remove hello        # keeps conffiles
dpkg -s hello                # expect "deinstall ok config-files"
sudo apt purge hello         # deletes conffiles
dpkg -s hello                # expect "unknown ok not-installed"
```

**DEP-8 tests.** Declare them in `debian/tests/control` (`Tests: build`,
`Depends: @, build-essential`, `Restrictions: superficial`) and put the scripts
in `debian/tests/`. `@` expands to every binary built by the source package.
Restrictions choose the testbed: `breaks-testbed`, `isolation-machine`,
`isolation-container`, `needs-reboot`, `needs-root`, `skippable`, `flaky`,
`superficial`, `build-needed`, `allow-stderr`, `rw-build-tree`,
`big-parallel`. Declare `Testsuite: autopkgtest` in the source stanza so the
infrastructure runs them.

**autopkgtest.** Build a testbed image once, then reuse it:

```none
autopkgtest-build-lxd ubuntu-daily:resolute
autopkgtest-buildvm-ubuntu-cloud -r resolute -v
```

Run against a source directory (trailing slash) or an archive package (no
slash), where `--apt-upgrade` (`-U`) upgrades the testbed, `--shell-fail` drops
you into a shell on failure, and `--output-dir` keeps the logs:

```none
autopkgtest --apt-upgrade --shell-fail --output-dir dep8-hello hello/ \
  -- lxd autopkgtest/ubuntu/resolute/amd64
autopkgtest --apt-upgrade --shell-fail --output-dir dep8-hello hello/ \
  -- qemu /var/lib/adt-images/autopkgtest-resolute-amd64.img
```

To reproduce CI, enable the proposed pocket of the package under test, where
`=proposed` takes the whole pocket and `=proposed=src:a,b` selected sources:

```none
autopkgtest --apt-pocket=proposed=src:hello --shell-fail hello/ \
  -- qemu /var/lib/adt-images/autopkgtest-resolute-amd64.img
```

For a PPA build, add the PPA inside the testbed and do not rebuild locally:

```none
autopkgtest --apt-upgrade --shell-fail --output-dir dep8-hello \
  --setup-commands="sudo add-apt-repository -y -u -s ppa:user/hello" \
  --no-built-binaries hello -- lxd autopkgtest/ubuntu/resolute/amd64
```

**Deeper checks.** `sudo piuparts -d resolute hello_2.10-0ubuntu1_amd64.deb`
installs, upgrades and removes the package in a minimal chroot while diffing the
filesystem; `reprotest auto -- null` builds twice under varied conditions and
compares artifacts. `debci` and the `autopkgtest.ubuntu.com` result pages give
archive-scale coverage. Prefer `autopkgtest` over running a script by hand: a
test that passes outside the DEP-8 harness can still fail in CI.

## 6. Release

Set a unique version, sign it, upload it, then wait for Launchpad.

```none
codename="resolute"
dch -l "~${codename}" --distribution "${codename}" "Build for PPA"
dpkg-buildpackage -S -I -i -nc -d
debsign ../hello_2.10-0ubuntu1~resolute1_source.changes
dput ppa:user/hello ../hello_2.10-0ubuntu1~resolute1_source.changes
ppa wait ppa:user/hello
ppa tests --show-url ppa:user/hello --release resolute
```

`ppa create hello` creates the PPA and enables its build architectures. `ppa
wait` exits 0 only after the PPA packages have fully built, and `ppa tests`
prints the autopkgtest trigger URLs. Archive uploads follow the same shape with
sponsorship through a Core Dev; Launchpad rejects mixed binary/source uploads.

## 7. Fix playbook

Find the failing step by its signature, apply the edit in the last column, then
rebuild and retest. This table also triages a log you cannot classify.

| Log signature | Root cause | Edit |
| --- | --- | --- |
| `dpkg-checkbuilddeps: error: Unmet build dependencies: libfoo-dev` | Build dependency undeclared. | Add `libfoo-dev` to `Build-Depends:` in `debian/control`. |
| `No package 'foo' found` (from `pkg-config`) | The `-dev` package shipping `foo.pc` is undeclared. | Add `libfoo-dev` to `Build-Depends:`. |
| `fatal error: foo.h: No such file or directory` | Header comes from an undeclared `-dev` package. | Find the provider with `apt-file search foo.h` and add it to `Build-Depends:`. |
| `cannot find -lfoo`, `undefined reference to ...`, `collect2: error: ld returned 1 exit status` | Linker cannot resolve a library. | Add the provider of `libfoo.so` to `Build-Depends:`; for a private library see the `shlibdeps` row. |
| `dh_auto_configure: ... configure: error:` | Wrong build-system arguments. | Add `override_dh_auto_configure:` calling `dh_auto_configure -- <options>`. |
| `dh: command not found`, `dh_...: unknown option`, compat-level error | `debhelper` missing from `Build-Depends`, or the compat level does not match the options used. | Add `debhelper-compat (= 13)` to `Build-Depends:` and delete `debian/compat`. |
| `dpkg-shlibdeps: error: no dependency information found for ...` | Binary links a private or unversioned library, or the library package ships no shlibs entry. | Add `override_dh_shlibdeps:` with the right `-l` path, or make the library package call `dh_makeshlibs`. |
| `debian/rules: ... Permission denied` | `debian/rules` is not executable. | `chmod +x debian/rules` and commit the mode change. |
| `ModuleNotFoundError: No module named ...` during build | Python build dependency undeclared. | Add the `python3-*` module to `Build-Depends:`; depend on `dh-python` and call `dh_python3`. |
| `error: failed to select a version`, `no matching package named ...` (cargo) | Rust build resolves crates over the network. | Vendor the crates, depend on `dh-cargo`, and build offline. |
| `go: ... verifying module ...`, module download during build | Go fetches modules at build time. | Ship the vendored module tree, depend on `dh-golang`, and keep the build offline. |
| `FAIL:`, `not ok`, `AssertionError`, `Error: Process completed` | The upstream test suite fails under the build. | Reproduce with the built tree, then patch the test or add a documented `override_dh_auto_test:`. |
| `E: <package>: <tag>` from `lintian` | Policy error such as a wrong path or a missing manpage. | Run `lintian --info <tag>`, fix the file the tag names. |
| `autopkgtest ... FAIL`, `Regression` on the update-excuses page | DEP-8 test fails in the archive environment. | Read the log, rerun with `--shell-fail`, fix `debian/tests/*` or the package; retrigger only for flaky runs. |
| Passes locally, fails on Launchpad; port errors, unreachable URLs | autopkgtest blocks most outbound network. | Reproduce with `--env='no_proxy=...' --env='http_proxy=http://squid.internal:3128'`, then make the test offline. |

Failure classes, migration blocking, flaky reruns and reproduction recipes:
[the fix playbook](references/fix-playbook.md).

## 8. Changelog discipline

One entry per upload, dated by the tool, never by hand:

```none
dch -v 2.10-0ubuntu1 "New upstream release."
dch -l "~resolute" "Build for PPA."
dch --create --package hello --newversion 2.10-0ubuntu1
```

The first line is `source (version) distribution; urgency=level`, with urgency
one of `low`, `medium`, `high`, `emergency`, `critical`. The trailer is
` -- Name <email>  Date` with a RFC 5322 date. Change lines are indented by at
least two spaces and conventionally use `*` for major and `-` for minor items.
The maintainer name and email must match the signing key; a version string must
never be uploaded twice.

## 9. Patches

In a `3.0 (quilt)` package every change outside `debian/` must be a patch listed
in `debian/patches/series`, applied top to bottom.

```none
quilt push -a
quilt new fix-build-with-gcc-15.patch
quilt add src/foo.c && $EDITOR src/foo.c
quilt refresh
quilt pop -a && rm -r .pc
```

`quilt header --dep3 -e` writes a DEP-3 header: `Description:`, `Origin:` or
`Forwarded:`, `Author:`, and optionally `Bug:`, `Last-Update:`,
`Applied-Upstream:`. `dpkg-source --commit` records an existing tree change as a
patch in one step, and `gbp pq` imports, edits and exports a patch queue on a
git-ubuntu branch. Always run `quilt pop -a && rm -r .pc` before committing or
building, because a stray `.pc/` corrupts the source diff.

## 10. Copyright and watch files

`debian/copyright` must be DEP-5: a `Format:` line with the copyright format
URL, `Upstream-Name:`, `Source:`, then one `Files:` stanza per licence area with
`Copyright:` and `License:`, plus a standalone `License:` paragraph holding the
licence text. The result is installed to
`/usr/share/doc/<package>/copyright`.

`debian/watch` drives `uscan`. The first line must be `version=4`; each later
line is a URL with a `(.*)` capture group, as in
`https://ftp.gnu.org/gnu/hello/hello-(.*).tar.gz`. Run `uscan` from the source
root to compare the watch version with `debian/changelog` and download a newer
tarball. Prefer `https://`, because `lintian` warns on plain `http://`.

## 11. Using the dsh tools

Six tools back this skill. All are read-only or plan-only: they parse the files
you point at and return findings or command lists. None runs a shell, installs a
package, builds or uploads, and none touches the network.

| Tool | Use it for | Step |
| --- | --- | --- |
| `ubuntu_inspect_package` | Parse `debian/`: layout, changelog, control, rules targets, patch series, DEP-8 entries. | 2, 3, 8, 9 |
| `ubuntu_lint_package` | Static policy checks with lintian-compatible tags and a fix per finding. | 5 |
| `ubuntu_scaffold_package` | Write a `debian/` skeleton for a new upstream tree. | 2, 10 |
| `ubuntu_build_plan` | Ordered build commands for source-only, binary, or both. | 4 |
| `ubuntu_test_plan` | Lint, install, smoke, DEP-8 and autopkgtest commands plus triage. | 5 |
| `ubuntu_diagnose_build` | Classify a build or test log into findings with cause and file to edit. | 7 |

Typical loop: `ubuntu_inspect_package` and `ubuntu_lint_package` first, fix what
they report, then `ubuntu_build_plan` for commands to run yourself. Feed a
failing log to `ubuntu_diagnose_build`; `ubuntu_test_plan` covers the whole test
chain. Use `ubuntu_scaffold_package` only for a new package, never to overwrite
an existing `debian/`.

## References

- [debian/ reference](references/debian-reference.md) — every file, field, deb822, DEP-5, DEP-3, DEP-8 and dh sequence.
- [build to release](references/build-test-release.md) — commands from a bare host to a PPA upload, with preconditions and expected output.
- [fix playbook](references/fix-playbook.md) — FTBFS classes, autopkgtest regressions, migration blocking, flaky reruns.
- [sources](references/sources.md) — the URL behind each claim in this skill.
