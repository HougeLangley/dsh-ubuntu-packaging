# Fix playbook: FTBFS, autopkgtest regressions, migration

How to classify a failing build or test, find the root cause, and pick the edit.
Baseline is Ubuntu 26.04 LTS `resolute`. Sources for each claim are in
[sources](sources.md).

## Rule zero: verify the claim before the fix

Do not guess a cause from a summary line. Reproduce with the same tool that
failed:

| Failure seen in | Reproduce with |
| --- | --- |
| Launchpad upload build | `sbuild --dist=resolute` on the same source |
| PPA build | same `sbuild` build, then compare the log |
| autopkgtest on Launchpad | `autopkgtest --shell-fail …` locally, then with the proxy |
| Lintian tag | `lintian --info <tag>` |
| Version rejection | `dpkg --compare-versions` |
| Missing package in the archive | `rmadison <package>` |

If the local reproduction passes, the difference is environmental — pocket,
architecture, network, or a Launchpad-only step — and the fix belongs in the
package or in the test, not in the build command.

## FTBFS classification

Every archive build failure falls into one of these classes. The class decides
who can fix it and whether a rebuild is enough.

| Class | Symptom | Typical fix |
| --- | --- | --- |
| Normal build issue | Syntax error, compile error, always reproducible | Fix the code or add a patch |
| Platform-specific | Fails only on one architecture; endianness on `s390x`, 64-bit assumptions on `armhf`, partial-port limits on `i386` | Patch the code; reproduce on that arch (`sbuild --arch=…` needs `schroot`) |
| Intermittent | Local build fine, Launchpad failed once; network outage, race, odd environment dependency | Retry the build once or twice, then find and fix the real cause if it recurs |
| Dependency | A dependency is missing, in the wrong pocket, or the wrong version | Fix the dependency or its version requirement; an Archive Admin may be needed to remove an invalid binary |
| ABI change | New toolchain or core library (`glibc`, `gcc`, `glib2.0`, `ruby`, `python3`); stricter defaults, different ABI | No-change rebuild (`buildN`), then patch or pick the new upstream release |
| Package-specific | None of the above; packaging logic or an upstream quirk | Tweak the package: build flags, a patch, an override |
| Launchpad-specific | Builds locally and in a PPA, fails only on upload | Reproduce the upload-only step (`pkgbinarymangler`), or report to Launchpad |

### Normal and platform-specific

Read the first real error, not the last line. Compiler errors name the file and
line; the fix is a patch under `debian/patches/` with a DEP-3 header, or a build
flag in `debian/rules`.

For an architecture-only failure, build for that architecture
(`sbuild --arch=<arch> --dist=resolute`, `schroot` backend) or inspect the log's
architecture tag. Endianness and word-size assumptions are the usual causes on
`s390x` and `armhf`; `i386` is a partial port with its own limits.

### Intermittent

A single failure with no local reproduction is often transient. Use the
`Retry Build` button on Launchpad once or twice. If the same package fails
repeatedly, stop retrying and find the cause: a network fetch during build, a
time or locale dependency, or a race in the test suite. Recurring "intermittent"
failures are real bugs.

### Dependency and ABI

Dependency failures name the package and version:

```none
dpkg-checkbuilddeps: error: Unmet build dependencies: libfoo-dev (>= 2.1)
```

Check what the archive actually has:

```none
rmadison libfoo
```

If the version exists but not in the pocket you build against, that is a pocket
problem, not a packaging one. If a newer toolchain broke the build, try a
no-change rebuild first by bumping the version to `2.0-2build1`, then patch. A
no-change rebuild must not use `ubuntuN`, because that would block automatic
sync from Debian.

### Launchpad-specific: `pkgbinarymangler`

Launchpad runs `pkgbinarymangler` after `dh_builddeb`, and PPAs disable it. A
failure there shows up as repeated lock messages from *other* packages, because
the failing package holds the lockfile:

```none
INFO: pkgstripfiles: waiting for lock (libvirt-common-hwe) ...
```

Reproduce by installing the mangler locally and rebuilding:

```none
sudo apt install -y pkgbinarymangler
```

Then look past the lock noise for the first package that actually failed.

## Reading a build log

Work top-down through phases; the first failure is authoritative because later
errors are usually fallout.

| Phase marker | What it means |
| --- | --- |
| `dpkg-buildpackage: info: source package …` | Packaging started; version and distribution come from the changelog |
| `dpkg-buildpackage: info: host architecture …` | Cross or native build; compare with the failure arch |
| `dh_auto_configure` | Build-system detection and configuration |
| `dh_auto_build` | Compilation |
| `dh_auto_test` | Upstream test suite |
| `dh_auto_install` | Install into `debian/tmp` |
| `dh_install` / `dh_missing` | File placement into binary packages |
| `dpkg-shlibdeps` | Library dependency computation |
| `dh_builddeb` | `.deb` creation; `pkgbinarymangler` runs after this on Launchpad |
| `dpkg-deb: building package` | Last successful step before upload |

## Signature table

| Signature | Root cause | Edit |
| --- | --- | --- |
| `dpkg-checkbuilddeps: error: Unmet build dependencies:` | Missing `Build-Depends` | Add the named package, with a version if the log asks for one |
| `No package 'foo' found` | `pkg-config` cannot find `foo.pc` | Add the `-dev` package that ships it |
| `fatal error: foo.h: No such file or directory` | Undeclared header provider | `apt-file search foo.h`, add the package |
| `cannot find -lfoo` | Linker cannot find `libfoo.so` | Add the `-dev` package; check `-L` paths |
| `undefined reference to 'x'` / `collect2: error: ld returned 1 exit status` | Missing object, library, or link order | Fix the link line or add the library dependency |
| `configure: error: … not found` | Configure cannot detect a dependency | Add the `-dev` package, or pass the right `--with-…` option |
| `dh_auto_configure: … unknown option` | Build system misdetected | `override_dh_auto_configure` with explicit options |
| `dh: command not found` | `debhelper` not in `Build-Depends` | Add `debhelper-compat (= 13)` |
| `dh_…: unknown option` with a compat error | Helper option newer than the declared compat level | Raise `debhelper-compat` or drop the option |
| `dpkg-shlibdeps: error: no dependency information found for …` | Private/unversioned library, or no shlibs entry | `override_dh_shlibdeps` with `-l`, or `dh_makeshlibs` in the library package |
| `debian/rules: … Permission denied` | Rules file not executable | `chmod +x debian/rules` |
| `ModuleNotFoundError: No module named …` | Missing Python build dependency | Add the `python3-*` module, depend on `dh-python` |
| `error: failed to select a version` / `no matching package named` | Cargo tries to fetch crates | Vendor crates, depend on `dh-cargo`, build offline |
| `go: … verifying module` / download during build | Go fetches modules | Vendor the module tree, depend on `dh-golang`, build offline |
| `FAIL:` / `not ok` / `AssertionError` | Upstream test suite fails | Reproduce, patch the test, or document an `override_dh_auto_test` |
| `dpkg-source: error:` | Patch or format inconsistency | `quilt pop -a && rm -r .pc`, fix `series` |
| `E: …` from lintian | Policy error | `lintian --info <tag>`, fix the named file |
| `error: unrecognized command-line option` | Compiler flag removed or renamed | Patch the build flags |
| `No rule to make target '…'` | Wrong build system or missing generated file | Override the matching `dh_auto_*` target |
| `missing-dependency-on-…` / `${shlibs:Depends}` absent | Binary stanza lacks the substitution variable | Add `${shlibs:Depends}` to `Depends` |

## autopkgtest regressions

The autopkgtest infrastructure runs DEP-8 tests on every supported architecture
after a build. A failure blocks migration and appears as `Regression` on the
update-excuses page.

The failure is one of:

| Cause | Signal in the log | Fix |
| --- | --- | --- |
| Test dependency missing | `Cannot install …` / `E: Unable to locate package` | Add it to `Depends:` in `debian/tests/control` |
| Testbed restriction mismatch | Test fails only on the container/VM runner | Declare the right `Restrictions:` (`isolation-machine`, `breaks-testbed`, …) |
| Network blocked | Timeouts, `Connection refused`, `npm`/`pip`/`composer` trying to fetch | Make the test offline, or use the proxy reproduction below |
| Test needs `-proposed` | Passes with `--apt-pocket=proposed=src:<pkg>` | Retrigger with the right trigger, or declare the dependency |
| Flaky test | Same test alternates PASS/FAIL | Retrigger once; if it recurs, fix the test |
| Real regression | Deterministic failure of the new version | Fix the package, not the test |
| Stale package | The summary shows an older version than the archive | Retrigger against the newer dependency |

Reproduce locally with the same runner and the proposed pocket:

```none
autopkgtest --apt-upgrade --shell-fail --output-dir dep8-hello hello/ \
  -- lxd autopkgtest/ubuntu/resolute/amd64
autopkgtest --apt-pocket=proposed=src:hello --shell-fail hello/ \
  -- qemu /var/lib/adt-images/autopkgtest-resolute-amd64.img
```

`--shell-fail` leaves the testbed mounted on failure so you can inspect
`/tmp`, the installed packages, and the test script's own state.

### Reproducing the network restriction

The archive test runners block most outbound traffic. The reliable clue is a
test that passes locally but fails after upload, with port errors, unreachable
URLs, or an upstream language tool (`npm`, `composer`, `pip`) failing to fetch.
Mimic it with the internal proxy:

```none
autopkgtest \
  --env='no_proxy=127.0.0.1,127.0.1.1,localhost,localdomain,novalocal,internal,archive.ubuntu.com,security.ubuntu.com,ddebs.ubuntu.com,changelogs.ubuntu.com,ppa.launchpad.net' \
  --env='http_proxy=http://squid.internal:3128' \
  --apt-upgrade --shell-fail hello/ \
  -- qemu /var/lib/adt-images/autopkgtest-resolute-amd64.img
```

A proxy is a partial imitation — the real environment also has firewalls — but
a failure under the proxy is strong evidence. The correct fix is to remove the
network dependency from the test, not to extend the allowlist.

### Flaky tests

Retrigger with the ♻ control on the autopkgtest page once, and check the
per-architecture history first: if someone already retried, do not pile on.
Declare `Restrictions: flaky` only for genuinely nondeterministic tests, and
keep `skippable` for tests that need unavailable hardware. A test that fails 1
in 5 runs is still a bug in the package or the test.

## Migration blocking

The update-excuses page prints one line per package:

```none
Migration status for hello (2.10-0ubuntu1 to 2.10-0ubuntu2): BLOCKED: …
```

| Status | Meaning | Action |
| --- | --- | --- |
| `Will attempt migration` | Healthy, in progress | Wait |
| `Waiting for test results` / `Test in progress` | Tests still running | Wait, then re-check |
| `BLOCKED: Rejected/violates migration policy/introduces a regression` | Usually an autopkgtest `Regression` | Work the regression table above |
| `BLOCKED: Cannot migrate due to another item` | Another package blocks this one | Follow the `Invalidated by dependency` line |
| `BLOCKED: Maybe temporary, maybe blocked but Britney is missing information` | A dependency failed to build (`missing build on <arch>`) | Fix the dependency, then retrigger |
| `Impossible Depends: A -> B/version/arch` | Dependency cannot be satisfied, often a `main`/`universe` mismatch | Fix the component or the dependency |
| `migrating A to testing makes B uninstallable` | B has a versioned build dependency on the old A | No-change rebuild of B |
| `Depends: A [B] (not considered)` | B is invalid or rejected | Fix B first |

Component mismatches (`… in main cannot depend on … in universe`) need an
Archive Admin or a `main-inclusion-review` request; they are not fixable from
the package alone.

Implicit dependencies come from `Breaks`/`Conflicts` and can require running
both packages through the test together. Re-run autopkgtest with the other
package as a trigger, or use `&all-proposed=1` on a test URL to pull everything
from `-proposed` and see whether that unblocks it.

## Version checks

Before blaming migration, verify the versions you think you have:

```none
rmadison hello
dpkg --compare-versions 3.98ubuntu5.3~18.04.1 lt 3.98ubuntu5.3 && echo true
```

`dpkg --compare-versions` exits 0 when the relation holds. Use it to prove:

- a PPA suffix sorts below the archive version
  (`1.0-1ubuntu1~resolute1 lt 1.0-1ubuntu1` → true);
- a rollback stays installable
  (`3.1+really2.0-2ubuntu2 lt 3.1` → false, because `+` sorts after `3.1`; the
  rollback version is deliberately *higher* than the version it replaces, so
  package managers accept it as an upgrade);
- an SRU bump is later (`1.0-1ubuntu1.1 gt 1.0-1ubuntu1` → true).

Operators are `lt`, `le`, `eq`, `ne`, `ge`, `gt`. An exit code of `1` means the
relation is false, not that the command failed.

## Closing checklist

- Reproduce the failure with the same tool that reported it.
- Name the failing phase and the first real error.
- Pick the edit from the class table, not from the last error line.
- Rebuild from a clean tree (`quilt pop -a && rm -r .pc`, `debian/rules clean`).
- Re-run lintian, the install/purge cycle, and autopkgtest.
- For an archive upload, re-check update-excuses after the retrigger.
