# Sources

Every non-obvious claim in the `ubuntu-packaging` skill and its references is
traceable to a URL below. All URLs were fetched on **2026-11-14** and returned
HTTP 200.

Kind column: `primary` = 原文, the claim is stated directly at the URL;
`inferred` = 推断, the claim follows from the primary facts by the documented
ordering or naming rules.

## Release baseline and tool versions

| Claim | Source | Kind |
| --- | --- | --- |
| `resolute` is Ubuntu 26.04 LTS | https://packages.ubuntu.com/resolute/debhelper | primary |
| Ubuntu 26.04 LTS released 2026-04-23; 26.10 is `stonking` | https://documentation.ubuntu.com/project/release-team/list-of-releases/ | primary |
| `debhelper` is 13.31ubuntu1 in `resolute` | https://packages.ubuntu.com/resolute/debhelper | primary |
| `debian-policy` is 4.7.4.0 in `resolute` | https://packages.ubuntu.com/resolute/debian-policy | primary |
| `lintian` is 2.129.0ubuntu2 in `resolute` | https://packages.ubuntu.com/resolute/lintian | primary |
| `autopkgtest` is 5.55 in `resolute` | https://packages.ubuntu.com/resolute/autopkgtest | primary |
| `sbuild` is 0.91.2ubuntu3 in `resolute` | https://packages.ubuntu.com/resolute/sbuild | primary |
| compat level 13 is the current `debhelper-compat` value | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/debian-directory/ | primary |

## Version strings

| Claim | Source | Kind |
| --- | --- | --- |
| Version anatomy: upstream / Debian revision / Ubuntu revision | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/version-strings/ | primary |
| `ubuntuN` increments for Ubuntu changes; only `ubuntu` blocks sync | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/version-strings/ | primary |
| `~` sorts before everything, including the empty string | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/version-strings/ | primary |
| `+dfsg` / `+ds` belong to the upstream version and sort after it | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/version-strings/ | primary |
| `buildN` marks a no-change rebuild and keeps the package syncable | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/version-strings/ | primary |
| Native packages have no Debian revision; native Ubuntu packages use a bare `ubuntu` | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/version-strings/ | primary |
| `+really` is the rollback convention; epochs are not a rollback tool | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/version-strings/ | primary |
| PPA uploads append `~<string>1`; the number must increase per upload | https://documentation.ubuntu.com/project/contributors/building/build-packages-in-a-ppa/ | primary |
| `dpkg --compare-versions` operators and exit code | https://documentation.ubuntu.com/project/contributors/building/run-package-tests/ | primary |
| Canonical version comparison algorithm | https://manpages.ubuntu.com/manpages/resolute/man7/deb-version.7.html | primary |

## The `debian/` directory

| Claim | Source | Kind |
| --- | --- | --- |
| Required files: changelog, control, copyright, rules | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/debian-directory/ | primary |
| deb822 syntax: stanzas, continuation lines, `.` for blank lines | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/debian-directory/ | primary |
| deb822 parser details | https://manpages.ubuntu.com/manpages/resolute/man5/deb822.5.html | primary |
| changelog format, urgency values, RFC 5322 date, `dch` | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/debian-directory/ | primary |
| Source and binary stanza field lists | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/debian-directory/ | primary |
| Control field semantics, Policy chapter 5 | https://www.debian.org/doc/debian-policy/ | primary |
| `debian/rules` targets, `%: dh $@`, overrides, `dh binary-arch --no-act` | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/debian-directory/ | primary |
| `dh` sequence behaviour and `--until` / `--before` / `--after` | https://manpages.ubuntu.com/manpages/resolute/man1/dh.1.html | primary |
| `debian/install` single-package and `debian/tmp` forms | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/debian-directory/ | primary |
| `debian/watch` version 4 and `uscan` behaviour | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/debian-directory/ | primary |
| `debian/source/format` values and the `1.0` fallback | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/debian-directory/ | primary |
| DEP-5 copyright format and fields | https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/ | primary |
| DEP-5 example used in Ubuntu docs | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/debian-directory/ | primary |

## Patches

| Claim | Source | Kind |
| --- | --- | --- |
| Quilt changes outside `debian/` must be patches listed in `series` | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/patches/ | primary |
| DEP-3 header fields and examples | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/deb-3-patch-file-headers/ | primary |
| DEP-3 specification | https://dep-team.pages.debian.net/deps/dep3/ | primary |
| `quilt` workflow and `quilt header --dep3 -e` | https://documentation.ubuntu.com/project/contributors/updating/manage-patches/ | primary |
| `.pc/` must be removed before commit or build | https://documentation.ubuntu.com/project/contributors/updating/manage-patches/ | primary |
| `dpkg-source --commit` records a tree change as a patch | https://manpages.ubuntu.com/manpages/resolute/man1/dpkg-source.1.html | primary |
| `gbp pq` import/export workflow | https://manpages.ubuntu.com/manpages/resolute/man1/gbp-pq.1.html | primary |

## Build

| Claim | Source | Kind |
| --- | --- | --- |
| `dpkg-buildpackage` builds source-only packages | https://documentation.ubuntu.com/project/contributors/building/build-packages-locally/ | primary |
| `sbuild` builds binary and source+binary packages | https://documentation.ubuntu.com/project/contributors/building/build-packages-locally/ | primary |
| `--build=source --no-check-builddeps --no-pre-clean` source recipe | https://documentation.ubuntu.com/project/contributors/building/build-packages-locally/ | primary |
| `sbuild --dist=<release>` and `sbuild --source --dist=<release>` | https://documentation.ubuntu.com/project/contributors/building/build-packages-locally/ | primary |
| `--no-clean-source`, `DEB_BUILD_OPTIONS=parallel=N`, `--run-lintian` | https://documentation.ubuntu.com/project/contributors/building/build-packages-locally/ | primary |
| `--extra-package` for locally built dependencies | https://documentation.ubuntu.com/project/contributors/building/build-packages-locally/ | primary |
| Cross-builds and architecture variants need `schroot`, not `unshare` | https://documentation.ubuntu.com/project/contributors/building/build-packages-locally/ | primary |
| Launchpad rejects uploads mixing binaries and sources | https://documentation.ubuntu.com/project/contributors/building/build-packages-locally/ | primary |
| `--build` type semantics, `-b`, `-S`, `-d`, `-nc`, `-us`, `-uc` | https://manpages.ubuntu.com/manpages/resolute/man1/dpkg-buildpackage.1.html | primary |
| `sbuild` options `--source`, `--chroot-mode`, `--run-lintian`, `--run-piuparts` | https://manpages.ubuntu.com/manpages/resolute/man1/sbuild.1.html | primary |
| `sbuild` `unshare` backend with `mmdebstrap`; `noble-backports` on 24.04 | https://documentation.ubuntu.com/project/contributors/setup/set-up-for-ubuntu-development/ | primary |
| `mk-sbuild`, `schroot -l`, `sbuild-update -udc` | https://documentation.ubuntu.com/project/contributors/setup/set-up-for-ubuntu-development/ | primary |
| `dh_make --createorig`, `dpkg-buildpackage -us -uc`, `-nc`, `lesspipe` | https://documentation.ubuntu.com/project/contributors/new-package/create-a-new-package/ | primary |
| `dpkg-deb -I` / `-c` inspect a package | https://manpages.ubuntu.com/manpages/resolute/man1/dpkg-deb.1.html | primary |
| `debuild` wrapper | https://manpages.ubuntu.com/manpages/resolute/man1/debuild.1.html | primary |
| `gbp buildpackage` builds from a git branch | https://manpages.ubuntu.com/manpages/resolute/man1/gbp-buildpackage.1.html | primary |

## Testing

| Claim | Source | Kind |
| --- | --- | --- |
| DEP-8 files are `debian/tests/control` plus scripts | https://documentation.ubuntu.com/project/how-ubuntu-is-made/processes/automatic-package-testing-autopkgtest/ | primary |
| `Tests:` / `Depends:` with `@` for all source binaries | https://documentation.ubuntu.com/project/how-ubuntu-is-made/processes/automatic-package-testing-autopkgtest/ | primary |
| `Testsuite: autopkgtest` enables infrastructure runs | https://documentation.ubuntu.com/project/how-ubuntu-is-made/concepts/debian-directory/ | primary |
| DEP-8 specification: restrictions, features, classes | https://salsa.debian.org/ci-team/autopkgtest/-/blob/master/doc/README.package-tests.rst | primary |
| `autopkgtest-build-lxd ubuntu-daily:<release>` | https://documentation.ubuntu.com/project/contributors/building/run-package-tests/ | primary |
| `autopkgtest-buildvm-ubuntu-cloud -r <release> -v` | https://documentation.ubuntu.com/project/contributors/building/run-package-tests/ | primary |
| `--apt-upgrade`, `--shell-fail`, `--output-dir`, `-- lxd`, `-- qemu` | https://documentation.ubuntu.com/project/contributors/building/run-package-tests/ | primary |
| `--setup-commands` with `add-apt-repository` and `--no-built-binaries` | https://documentation.ubuntu.com/project/contributors/building/run-package-tests/ | primary |
| `--apt-pocket=proposed=src:<pkg>` and comma-separated sources | https://documentation.ubuntu.com/project/contributors/building/run-package-tests/ | primary |
| Network-restriction reproduction with `--env no_proxy` / `http_proxy` | https://documentation.ubuntu.com/project/contributors/building/run-package-tests/ | primary |
| `-U` is `--apt-upgrade`; full option list | https://manpages.ubuntu.com/manpages/resolute/man1/autopkgtest.1.html | primary |
| `lintian` on `.dsc` / `.deb`; `--info`; `-nc` rebuild | https://documentation.ubuntu.com/project/contributors/new-package/create-a-new-package/ | primary |
| Lintian override file locations and `--fail-on` | https://manpages.ubuntu.com/manpages/resolute/man1/lintian.1.html | primary |
| Lintian flags used by the sbuild config (`-L`, `>=pedantic`) | https://documentation.ubuntu.com/project/contributors/setup/set-up-for-ubuntu-development/ | primary |
| `apt install ./pkg.deb`, `apt remove`, `apt purge`, `dpkg -s` states | https://documentation.ubuntu.com/project/contributors/building/install-built-packages/ | primary |
| `piuparts` installs, upgrades and removes packages in a chroot | https://manpages.ubuntu.com/manpages/resolute/man1/piuparts.1.html | primary |
| `piuparts -d <distro> <deb>` | https://manpages.ubuntu.com/manpages/resolute/man1/piuparts.1.html | inferred |
| `reprotest auto -- null` builds a Debian package twice | https://manpages.ubuntu.com/manpages/resolute/man1/reprotest.1.html | primary |
| `ppa tests --show-url ppa:user/name --release <release>` | https://documentation.ubuntu.com/project/contributors/building/run-package-tests/ | primary |
| `ppa tests` result format and `PASS` summary | https://documentation.ubuntu.com/project/contributors/building/run-package-tests/ | primary |

## Release and upload

| Claim | Source | Kind |
| --- | --- | --- |
| `dch -l "~<codename>" --distribution <codename>` | https://documentation.ubuntu.com/project/contributors/building/build-packages-in-a-ppa/ | primary |
| Rebuild and resign with `dpkg-buildpackage -S -I -i -nc -d` | https://documentation.ubuntu.com/project/contributors/building/build-packages-in-a-ppa/ | primary |
| `ppa create`, `ppa wait`, `dput ppa:` | https://documentation.ubuntu.com/project/contributors/building/build-packages-in-a-ppa/ | primary |
| `debsign` the `.changes` file | https://documentation.ubuntu.com/project/contributors/building/build-packages-locally/ | primary |
| `dput` and `debsign` semantics | https://manpages.ubuntu.com/manpages/resolute/man1/dput.1.html | primary |
| `debsign` options | https://manpages.ubuntu.com/manpages/resolute/man1/debsign.1.html | primary |
| `dch` options and `--create` | https://manpages.ubuntu.com/manpages/resolute/man1/dch.1.html | primary |
| `pull-ppa-debs` to fetch PPA binaries | https://documentation.ubuntu.com/project/contributors/building/install-built-packages/ | primary |
| `uscan` options | https://manpages.ubuntu.com/manpages/resolute/man1/uscan.1.html | primary |

## Failure analysis and migration

| Claim | Source | Kind |
| --- | --- | --- |
| FTBFS classes: normal, platform, intermittent, dependency, ABI, package-specific, Launchpad-specific | https://documentation.ubuntu.com/project/how-ubuntu-is-made/processes/proposed-migration/failure-to-build-from-source-ftbfs/ | primary |
| `Retry Build` for transient failures | https://documentation.ubuntu.com/project/how-ubuntu-is-made/processes/proposed-migration/failure-to-build-from-source-ftbfs/ | primary |
| ABI changes need a no-change rebuild or a patch | https://documentation.ubuntu.com/project/how-ubuntu-is-made/processes/proposed-migration/failure-to-build-from-source-ftbfs/ | primary |
| `pkgbinarymangler` lock behaviour and local reproduction | https://documentation.ubuntu.com/project/how-ubuntu-is-made/processes/proposed-migration/failure-to-build-from-source-ftbfs/ | primary |
| Migration status strings and `Regression` | https://documentation.ubuntu.com/project/how-ubuntu-is-made/processes/proposed-migration/autopkgtest-regressions/ | primary |
| Retriggering flaky runs with ♻; `rmadison` for versions | https://documentation.ubuntu.com/project/how-ubuntu-is-made/processes/proposed-migration/autopkgtest-regressions/ | primary |
| `Impossible Depends`, component mismatch, uninstallable, implicit dependency | https://documentation.ubuntu.com/project/how-ubuntu-is-made/processes/proposed-migration/issues-preventing-migration/ | primary |
| `&all-proposed=1` to test against the whole proposed pocket | https://documentation.ubuntu.com/project/how-ubuntu-is-made/processes/proposed-migration/special-migration-cases/ | primary |
| `lp-ftbfs-report` and archive test rebuilds | https://documentation.ubuntu.com/project/how-ubuntu-is-made/processes/proposed-migration/failure-to-build-from-source-ftbfs/ | primary |
| `dpkg-checkbuilddeps` reports unmet build dependencies | https://manpages.ubuntu.com/manpages/resolute/man1/dpkg-checkbuilddeps.1.html | primary |
| `apt-file search foo.h` finds a header provider | https://packages.ubuntu.com/resolute/apt-file | inferred |

## Language and helper packaging

| Claim | Source | Kind |
| --- | --- | --- |
| `dh-python` exists in `resolute` | https://packages.ubuntu.com/resolute/dh-python | primary |
| `dh-cargo` exists in `resolute` | https://packages.ubuntu.com/resolute/dh-cargo | primary |
| `dh-golang` exists in `resolute` | https://packages.ubuntu.com/resolute/dh-golang | primary |
| `quilt` is available from the archive | https://documentation.ubuntu.com/project/contributors/updating/manage-patches/ | primary |

## Results and infrastructure

| Claim | Source | Kind |
| --- | --- | --- |
| autopkgtest results are published per package, release and architecture | https://autopkgtest.ubuntu.com/ | primary |
| Launchpad PPAs and upload documentation | https://launchpad.net/ubuntu/+ppas | primary |
| Debian Policy Manual (Standards-Version 4.7.4.0) | https://www.debian.org/doc/debian-policy/ | primary |

## Notes on verification

- Every URL above was requested on 2026-11-14 and answered HTTP 200.
- Version numbers come from the `packages.ubuntu.com/resolute/<package>` pages,
  not from release notes, so they reflect the archive at fetch time.
- The `inferred` rows are the only claims not stated verbatim at the URL: the
  `piuparts -d` usage and the `apt-file search` invocation. Both follow from the
  tool's documented synopsis and the distribution name.
- Commands that appear only in a manpage example (for example
  `reprotest auto -- null`) are cited to that manpage, not to a tutorial.
