# The `debian/` reference

Field-level reference for every file a Ubuntu source package needs. Baseline is
Ubuntu 26.04 LTS `resolute` with `debhelper` 13.31ubuntu1 (compat 13) and
`debian-policy` 4.7.4.0. Sources for each claim are listed in
[sources](sources.md).

## deb822 rules

`debian/control`, `debian/tests/control` and most modern control files use the
`deb822` format, the same syntax as `deb822(5)`:

- A **stanza** (paragraph) is a group of fields with no blank line inside it.
  Stanzas are separated by one or more blank lines.
- A **field** starts at column 0 as `Name: value`. The colon is mandatory and is
  conventionally followed by one space.
- A **continuation line** starts with one or more spaces or tabs and belongs to
  the field above it.
- A blank line inside a field would end the stanza. A single `.` on a
  continuation line means an empty line in `Description`.
- Field names are case-insensitive in parsing but keep the canonical spelling
  (`Build-Depends`, `Standards-Version`, `Vcs-Git`).
- Multi-value fields use commas. Continuation lines are the normal way to wrap a
  long `Build-Depends` or `Description`.

## `debian/changelog`

The first line is the entry header; change lines are indented; the last line is
the trailer:

```none
hello (2.10-0ubuntu1) resolute; urgency=medium

  * New upstream release.
  * Drop the patch now applied upstream.

 -- Jane Doe <jane@example.com>  Thu, 13 Nov 2026 10:00:00 +0800
```

| Element | Rule |
| --- | --- |
| Source name | Must equal `Source:` in `debian/control`. |
| Version | `[epoch:]upstream[-debian_revision]`, with the Ubuntu revision appended. |
| Distribution | The target suite (`resolute`); a space-separated list is allowed. |
| Urgency | One of `low`, `medium`, `high`, `emergency`, `critical`. |
| Change lines | Indented by at least two spaces; `*` major, `-` minor by convention. |
| Trailer | One leading space, `Name <email>`, two spaces, RFC 5322 date. |
| Date | Format of `date -R`; `dch` writes it automatically. |
| Entries | Newest first, one entry per upload, never re-upload a version. |

Create and edit with `dch`, not by hand: `dch --create --package hello
--newversion 2.10-0ubuntu1` for a new file, `dch -v <version> "<text>"` for a new
entry, `dch -l "~resolute" "<text>"` to add the PPA suffix, `dch -r` to finalise
the entry.

## `debian/control`

Two or more stanzas: exactly one source stanza, then one stanza per binary
package.

### Source stanza

```none
Source: hello
Section: devel
Priority: optional
Maintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>
XSBC-Original-Maintainer: Jane Doe <jane@example.com>
Standards-Version: 4.7.4
Build-Depends: debhelper-compat (= 13), help2man, texinfo
Homepage: https://www.gnu.org/software/hello/
Rules-Requires-Root: no
Testsuite: autopkgtest
Vcs-Git: https://git.launchpad.net/ubuntu/+source/hello
Vcs-Browser: https://git.launchpad.net/ubuntu/+source/hello
```

| Field | Required | Notes |
| --- | --- | --- |
| `Source` | yes | Source package name; must match `debian/changelog`. |
| `Maintainer` | yes | `Name <email>`; for Ubuntu uploads usually Ubuntu Developers. |
| `Uploaders` | no | Comma-separated co-maintainers. |
| `Section` | recommended | Archive area (`devel`, `utils`, `x11`, ...). |
| `Priority` | recommended | `required`, `important`, `standard`, `optional`, `extra` is obsolete. |
| `Build-Depends` | as needed | Build-time packages, comma-separated. |
| `Build-Depends-Arch` / `-Indep` | no | Split build dependencies by binary kind. |
| `Standards-Version` | yes | Debian Policy version the package targets; `4.7.4` here. |
| `Homepage` | no | Upstream URL; `lintian` expects `http(s)://`. |
| `Vcs-Git` / `Vcs-Browser` | no | Version-control location, per Policy §5.6.26. |
| `Testsuite` | no | `autopkgtest` enables DEP-8 runs. |
| `Rules-Requires-Root` | recommended | `no` when `debian/rules` needs no root. |
| `XSBC-Original-Maintainer` | no | Ubuntu convention for the Debian maintainer. |

Prefer `debhelper-compat (= 13)` in `Build-Depends` and do not also ship
`debian/compat`; two declarations for one compat level is an error.

### Binary stanza

```none
Package: hello
Architecture: any
Depends: ${misc:Depends}, ${shlibs:Depends}
Description: The classic greeting, and a good example
 The GNU hello program produces a familiar, friendly greeting.  It
 allows non-programmers to use a classic computer science tool.
 .
 Seriously, though: this is an example of how to do a Debian package.
```

| Field | Required | Notes |
| --- | --- | --- |
| `Package` | yes | Binary package name, lowercase. |
| `Architecture` | yes | `any`, `all`, or an explicit list. |
| `Section` / `Priority` | recommended | Override the source values. |
| `Essential` | no | `yes` only for packages the system cannot boot without. |
| `Depends` | usually | Runtime dependencies; keep `${misc:Depends}` and, for compiled code, `${shlibs:Depends}`. |
| `Pre-Depends` | rarely | Only when unpack order matters. |
| `Recommends` / `Suggests` | no | Weak dependencies. |
| `Breaks` / `Conflicts` / `Replaces` / `Provides` | no | Relationship fields per Policy chapter 7. |
| `Description` | yes | Synopsis line, then an indented long description; `.` for blank lines. |
| `Homepage` | no | Overrides the source value. |
| `Built-Using` | no | For packages embedding other packages' code. |
| `Package-Type` | no | `deb` (default) or `udeb`. |

`${misc:Depends}` collects debhelper-computed dependencies; `${shlibs:Depends}`
collects library dependencies from `dpkg-shlibdeps`. A binary that links
libraries but omits `${shlibs:Depends}` ships broken dependencies.

## `debian/rules`

An executable Makefile. The minimal modern form:

```make
#!/usr/bin/make -f

%:
	dh $@
```

`dh` runs a sequence of `dh_*` commands per target. Required targets are
`build`, `build-arch`, `build-indep`, `binary`, `binary-arch`, `binary-indep`
and `clean`; the `%:` catch-all rule forwards all of them to `dh $@`.

Add-ons append to the sequencer: `dh $@ --with python3 --buildsystem=pybuild`
runs the `python3` add-on and the `pybuild` build system. Prefer
`--buildsystem=` over hand-written `override_dh_auto_build` unless the upstream
build genuinely differs.

### Overrides

An `override_dh_<command>:` target replaces that command in the sequence:

```make
override_dh_auto_configure:
	dh_auto_configure -- --enable-shared --disable-static

override_dh_auto_test:
	# Upstream test suite needs a network; the DEP-8 test covers it instead.
```

Rules that apply: override only what needs changing, keep the original `dh_*`
call inside the target, and comment every override that skips a check. The
override feature needs `debhelper` 7.0.50 or later, which compat 13 satisfies.

### Inspecting a sequence

`dh binary-arch --no-act` prints the commands the `binary-arch` sequence would
run without executing them; use it to confirm which helpers touch your package.
`binary-indep` commands receive `-i`, `binary-arch` commands receive `-a`. Each
helper records success in `debian/<package>.debhelper.log`, which `dh_clean`
deletes, and `dh` resumes after the last logged command. `--until`, `--before`,
`--after` and `--remaining` override that behaviour.

## `debian/copyright` (DEP-5)

Machine-readable copyright per the DEP-5 specification. The short form:

```none
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: hello
Source: https://ftp.gnu.org/gnu/hello/

Files: *
Copyright: 1992-2026 Free Software Foundation, Inc.
License: GPL-3+

Files: debian/*
Copyright: 2026 Jane Doe <jane@example.com>
License: GPL-3+

License: GPL-3+
 This program is free software: you can redistribute it and/or modify it
 under the terms of the GNU General Public License as published by the Free
 Software Foundation, either version 3 of the License, or (at your option)
 any later version.
 .
 On Debian systems, the full text of the GNU General Public License version 3
 can be found in /usr/share/common-licenses/GPL-3.
```

| Field | Rule |
| --- | --- |
| `Format` | Required first field; the DEP-5 format URL. |
| `Upstream-Name` | Upstream project name. |
| `Source` | Where the upstream source came from. |
| `Files` | Glob (`*`, `debian/*`) selecting the files this stanza covers. |
| `Copyright` | Copyright holders and years; continuation lines allowed. |
| `License` | Short licence name, matching a standalone `License:` paragraph. |
| `Comment` | Free-form note. |
| `Files-Excluded` | Files removed when repacking the tarball. |

The file is installed as `/usr/share/doc/<package>/copyright`; Policy requires
that copy to be verbatim.

## `debian/source/format`

One line, no comments needed:

| Value | Meaning |
| --- | --- |
| `3.0 (quilt)` | Separate upstream tarball plus `debian/` patches. The default choice. |
| `3.0 (native)` | No upstream tarball, no Debian revision; Debian or Ubuntu is upstream. |
| `1.0` | Legacy format; `lintian` warns and new packages must not use it. |

If the file is absent, `dpkg-source` assumes `1.0` for backwards compatibility
and `lintian` warns. `3.0` adds compression choices, multiple upstream tarballs,
no need to strip `debian/` from the tarball, and quilt-compatible patches under
`debian/patches/`.

## `debian/watch`

Drives `uscan` (from `devscripts`). Format version 4, one URL per line with a
capture group:

```none
version=4
https://ftp.gnu.org/gnu/hello/hello-(.*).tar.gz
```

`uscan` compares the newest matching upstream version with the version in
`debian/changelog` and downloads a newer tarball, symlinking it to
`<package>_<version>.orig.tar.gz`. For Launchpad-hosted tarballs, put the
download page first and the pattern second:

```none
version=4
https://launchpad.net/flufl.enum/+download http://launchpad.net/flufl.enum/.*/flufl.enum-(.+).tar.gz
```

`lintian` warns on `http://` URLs and on watch files without a capture group.

## `debian/patches/`

Required for changes outside `debian/` in a `3.0 (quilt)` package. `series`
lists patches in application order, one filename per line; blank lines and lines
starting with `#` are ignored.

```none
0001-fix-build-with-gcc-15.patch
0002-use-system-libfoo.patch
```

Each patch is a unified diff with a DEP-3 header:

```none
Description: Fix the build with GCC 15
 GCC 15 defaults to C23, which rejects the old implicit declarations.
Origin: upstream, https://example.com/commit/abc123
Bug: https://bugs.example.com/1234
Forwarded: https://lists.example.com/2026/03/msg00042.html
Author: Jane Doe <jane@example.com>
Last-Update: 2026-11-01
```

| DEP-3 field | Purpose |
| --- | --- |
| `Description` | Short summary plus an indented explanation. Required in practice. |
| `Origin` | `upstream`, `vendor`, `backport`, `Cherry-picked`, plus a URL. |
| `Bug` / `Bug-Debian` | Bug tracker reference. |
| `Forwarded` | URL where the patch was sent, or `not-needed`. |
| `Author` | Patch author, `Name <email>`. |
| `Reviewed-by` | Reviewer, when the patch was reviewed. |
| `Last-Update` | `YYYY-MM-DD` of the last header change. |
| `Applied-Upstream` | Version or commit URL when upstream took the patch. |

`Forwarded: not-needed` is the correct marker for a deliberate vendor-only
patch. Do not add a DEP-3 header to an unrelated patch during an SRU.

## `debian/tests/` (DEP-8)

`debian/tests/control` declares what the testbed needs; each file named in
`Tests:` is a script in `debian/tests/`.

```none
Tests: build
Depends: @, build-essential
Restrictions: superficial

Tests: smoke
Depends: @
Restrictions: needs-root
```

| Field | Rule |
| --- | --- |
| `Tests` | Space-separated script names in `debian/tests/`. |
| `Depends` | Packages installed before the test; `@` means every binary from this source. |
| `Restrictions` | Testbed requirements, comma-separated. |
| `Features` | Optional features a runner may provide. |
| `Classes` | Grouping for selective runs. |

Known restrictions: `breaks-testbed`, `isolation-machine`,
`isolation-container`, `needs-reboot`, `needs-root`, `skippable`, `flaky`,
`superficial`, `build-needed`, `allow-stderr`, `rw-build-tree`,
`big-parallel`. `breaks-testbed` forces a fresh testbed per test;
`isolation-machine` forces a VM; `isolation-container` forces a VM or container.

Scripts must be executable and start with a shebang. Exit 0 on success, print
the reason on stderr for a failure, and leave the testbed usable unless the
control file declares `breaks-testbed`.

## `debian/install`

Read by `dh_install`. Two shapes:

```none
example usr/bin
debian/example.desktop usr/share/applications
```

or, when the source package builds several binaries and `dh` installs into
`debian/tmp` first:

```none
usr/bin/
usr/lib/example/*.so
```

Use `<package>.install` per binary in the multi-package case. A path listed here
that the build does not produce fails the package build; check the path against
`debian/tmp` after `dh_auto_install`.

## `debian/compat`

Legacy way to declare the debhelper compat level: a single integer in a file.
Modern packages declare `debhelper-compat (= 13)` in `Build-Depends` instead.
Ship one or the other, never both. Compat 13 is current for `resolute`;
`lintian` warns about older levels.

## Minimal complete package

```none
hello-2.10/
├── debian/
│   ├── changelog           # 2.10-0ubuntu1
│   ├── control             # source + one binary stanza
│   ├── copyright           # DEP-5
│   ├── rules               # #!/usr/bin/make -f + %: dh $@
│   ├── source/format       # 3.0 (quilt)
│   ├── watch               # version=4
│   ├── patches/series      # empty or patch list
│   └── tests/control       # DEP-8
└── src/ …                  # upstream tree
```

Validate the result with `debian/rules clean`, `dh binary-arch --no-act` and
`dpkg-buildpackage -us -uc -b` before attempting a source-only upload.
