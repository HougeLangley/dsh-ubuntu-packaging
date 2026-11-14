# From a bare host to a PPA upload

The full command sequence for taking one source package from zero to a signed
Launchpad upload, with the preconditions and the place to look when a step
fails. Baseline is Ubuntu 26.04 LTS `resolute`; substitute another codename only
where stated. Source URLs for every claim are in [sources](sources.md).

## Step 0 — Host prerequisites

**Preconditions:** Ubuntu host, a Launchpad account, a GPG key whose name and
email match the changelog trailer, and `sudo`.

```none
sudo apt install -y devscripts debhelper dh-make build-essential lintian \
  autopkgtest sbuild mmdebstrap uidmap ubuntu-dev-tools quilt
sudo snap install ppa-dev-tools
sudo snap install --classic git-ubuntu
```

Put your user in the groups the tools expect, then log in again:

```none
sudo usermod --append --groups adm,libvirt,lxd,sbuild,sudo "$USER"
groups "$USER"
```

**Expected:** `groups` lists `adm libvirt lxd sbuild sudo`.

**If it fails:** group changes need a fresh login session; `snap install`
failures are usually proxy/network, not packaging.

### Choose an sbuild backend

`sbuild` supports two backends.

| Backend | When to use | Requirement |
| --- | --- | --- |
| `unshare` | Default on 25.10 and later; no root, no schroot setup, chroots built on demand | `sbuild`, `mmdebstrap`, `uidmap` |
| `schroot` | Ubuntu 22.04 and earlier, cross-building, architecture variants | `mk-sbuild` from `ubuntu-dev-tools`, a registered schroot |

`unshare` with `mmdebstrap` creates and manages chroot tarballs automatically,
so it needs no pre-created chroot. It cannot cross-build and cannot build
architecture variants, which is why `schroot` still exists.

Configure `unshare` in `~/.config/sbuild/config.pl`:

```perl
$chroot_mode = 'unshare';
$unshare_mmdebstrap_keep_tarball = 1;
$unshare_tmpdir_template = '/var/tmp/tmp.sbuild.XXXXXXXXXX';
$clean_source = 0;
$run_lintian = 1;
$lintian_opts = ["-L", ">=pedantic", "--show-overrides"];
1;
```

For `schroot`, create the chroots and keep them fresh:

```none
mk-sbuild resolute --arch=amd64
schroot -l
sbuild-update -udc resolute-amd64
```

**Expected:** `schroot -l` lists `resolute-amd64`; `sbuild --dist=resolute`
builds without asking for a chroot name.

**If it fails:** `mk-sbuild` failures are usually mirror or debootstrap
problems; `unshare` failures are usually a missing `uidmap` or
`subuid`/`subgid` mapping.

## Step 1 — Get the source

**Preconditions:** a package name, or a `.dsc` you already have.

Three common routes:

```none
git ubuntu clone hello                 # git-ubuntu, branches per release
pull-lp-source hello resolute          # ubuntu-dev-tools
dpkg-source -x hello_2.10-0ubuntu1.dsc # unpack an existing source package
```

**Expected:** a directory such as `hello-2.10/` containing `debian/`.

**If it fails:** `pull-lp-source` needs network and the right suite name; a
missing `debian/` means you downloaded a binary or the wrong tarball.

## Step 2 — Inspect and adjust `debian/`

**Preconditions:** the unpacked tree.

Check the four required files and the source format before touching anything:

```none
ls debian/
cat debian/source/format
head -5 debian/changelog
dpkg-checkbuilddeps
```

**Expected:** `changelog`, `control`, `copyright`, `rules` present;
`source/format` reads `3.0 (quilt)`; `dpkg-checkbuilddeps` prints nothing.

**If it fails:** `dpkg-checkbuilddeps` names the missing build dependencies —
install them or add them to `Build-Depends`. A missing `source/format` defaults
to `1.0`; add the file.

For a brand-new package, generate the skeleton instead of writing it by hand:

```none
dh_make --createorig -p hello_2.10
```

**Expected:** a `debian/` directory with example files; delete the `*.ex` and
`*.EX` samples, then edit `control`, `copyright` and `changelog`.

**If it fails:** `dh_make` needs the upstream tarball next to the tree and a
name/version in `-p name_version` form.

## Step 3 — Pick the upload version

**Preconditions:** a target suite, normally `resolute` for the development
release or a stable codename for an SRU.

For a PPA, keep the archive version and append a tilde suffix:

```none
codename="resolute"
dch -l "~${codename}" --distribution "${codename}" "Build for PPA"
```

**Expected:** the changelog header reads
`hello (2.10-0ubuntu1~resolute1) resolute; urgency=medium`.

**If it fails:** Launchpad rejects a version it has already accepted; bump the
trailing number (`~resolute2`). Verify ordering first:

```none
dpkg --compare-versions 2.10-0ubuntu1~resolute1 lt 2.10-0ubuntu1 && echo true
```

That must print `true`: a PPA version sorts *below* the archive version.

## Step 4 — Build the source package

**Preconditions:** clean tree; no `.pc/` directory; no build dependencies needed
on the host because this step only packages sources.

```none
quilt pop -a && rm -r .pc     # only when quilt was used
dpkg-buildpackage --build=source --no-check-builddeps --no-pre-clean
```

**Expected:** in the parent directory, `hello_2.10-0ubuntu1~resolute1.dsc`,
`.orig.tar.gz` and `.debian.tar.xz`, plus `_source.changes` when signing is set
up. The command prints the generated file list.

**If it fails:** `dpkg-source: error:` means a patch or series problem — fix
`debian/patches/series` and the patches, not the build flags. A dirty tree
usually means `.pc/` survived.

## Step 5 — Build the binary in a clean chroot

**Preconditions:** a configured backend (step 0) and network access for the
chroot.

```none
cd hello-2.10
sbuild --dist=resolute
```

Build both source and binary with `sbuild --source --dist=resolute`. Build for
another architecture with `sbuild --arch=arm64 --dist=resolute` (needs
`schroot`). Reuse a locally built dependency with
`sbuild --extra-package=/path/to/libfoo.deb --dist=resolute`.

**Expected:** binary `.deb` files in the parent of the source tree and a build
log ending with the `.changes` summary. `sbuild` places artifacts in the current
directory, or in the parent when run from inside an unpacked source tree, so
`../` paths work from the source root.

**If it fails:** read `sbuild`'s own log first, then the package log; missing
build dependencies appear as `dpkg-checkbuilddeps: error: Unmet build
dependencies:`. A cross-build error on `unshare` means the backend cannot do it —
switch to `schroot`.

Once a local build works, lint it:

```none
lintian ../hello_2.10-0ubuntu1~resolute1_amd64.deb
lintian ../hello_2.10-0ubuntu1~resolute1.dsc
```

**Expected:** no `E:` tags. Warnings need a judgement call, not silence.

## Step 6 — Inspect the artifacts

**Preconditions:** a successful binary build.

```none
dpkg-deb -I ../hello_2.10-0ubuntu1~resolute1_amd64.deb
dpkg-deb -c ../hello_2.10-0ubuntu1~resolute1_amd64.deb
lesspipe ../hello_2.10-0ubuntu1~resolute1_amd64.deb
```

**Expected:** `-I` shows the control fields and installed size; `-c` lists
files under `./usr/`; `lesspipe` opens the package as an archive.

**If it fails:** a `.deb` that is missing files points at `debian/install` or
the upstream `make install` step; a package that installs nothing points at a
missing `override_dh_auto_install`.

## Step 7 — Install, smoke, upgrade, remove, purge

**Preconditions:** the `.deb` and its dependencies available.

```none
sudo apt install ./hello_2.10-0ubuntu1~resolute1_amd64.deb
hello --version
sudo apt remove hello
dpkg -s hello          # deinstall ok config-files
sudo apt purge hello
dpkg -s hello          # unknown ok not-installed
```

**Expected:** the command runs; after `remove` the status is
`deinstall ok config-files`; after `purge` the package is unknown.

**If it fails:** `dpkg -L hello` shows where files landed. A missing binary in
`PATH` usually means the wrong install directory; a `postinst` failure appears
in the same output.

## Step 8 — Run the DEP-8 tests

**Preconditions:** `Testsuite: autopkgtest` and `debian/tests/` present, or skip
to the archive-package form.

Build the testbed once:

```none
autopkgtest-build-lxd ubuntu-daily:resolute
autopkgtest-buildvm-ubuntu-cloud -r resolute -v
```

Run against the local tree, or against the PPA:

```none
autopkgtest --apt-upgrade --shell-fail --output-dir dep8-hello hello/ \
  -- lxd autopkgtest/ubuntu/resolute/amd64

autopkgtest --apt-upgrade --shell-fail --output-dir dep8-hello \
  --setup-commands="sudo add-apt-repository -y -u -s ppa:user/hello" \
  --no-built-binaries hello -- qemu /var/lib/adt-images/autopkgtest-resolute-amd64.img
```

Reproduce the archive environment with the proposed pocket:

```none
autopkgtest --apt-pocket=proposed=src:hello --shell-fail hello/ \
  -- qemu /var/lib/adt-images/autopkgtest-resolute-amd64.img
```

**Expected:** a summary block ending in `PASS` per test, and a report in
`dep8-hello/`.

**If it fails:** `--shell-fail` leaves you inside the testbed; the log names the
script and the failing command. Network-restricted failures are discussed in
[the fix playbook](fix-playbook.md).

## Step 9 — Sign the upload

**Preconditions:** a GPG key; `DEBEMAIL`/`DEBFULLNAME` matching it.

```none
debsign ../hello_2.10-0ubuntu1~resolute1_source.changes
```

**Expected:** `Successfully signed dsc and changes files`.

**If it fails:** `gpg: skipped "…": No secret key` means the key id or the
identity in the changelog is wrong; `debsign -k <keyid>` forces a key.

## Step 10 — Upload to the PPA

**Preconditions:** the PPA exists, `dput` configured, the `.changes` signed.

```none
ppa create hello
dput ppa:user/hello ../hello_2.10-0ubuntu1~resolute1_source.changes
```

**Expected:** `dput` prints the upload acknowledgement and the Launchpad URL
for the PPA; the upload is accepted (not rejected) within minutes.

**If it fails:** a signature rejection is a key or identity problem (fix the
key, then `debsign` again); a rejection saying the file already exists means the
version was uploaded before — bump it; a permission error means the PPA does not
exist or the wrong Launchpad user is configured.

## Step 11 — Wait for the build, then trigger tests

**Preconditions:** an accepted upload.

```none
ppa wait ppa:user/hello
ppa tests --show-url ppa:user/hello --release resolute
```

**Expected:** `ppa wait` exits 0 once every binary has built; `ppa tests` prints
`autopkgtest.ubuntu.com` request URLs.

**If it fails:** a failed PPA build means the source built locally but not in
Launchpad's environment — read the build log, then see the Launchpad-specific
class in [the fix playbook](fix-playbook.md). `ppa tests` request URLs need
permission to run; ask a Core Dev or use `#ubuntu-devel`.

## Step 12 — Archive upload

The archive takes the same source-only upload, but a sponsor uploads it, and the
result has to migrate from `-proposed` to `-release`.

```none
rmadison hello            # versions per suite
```

**Expected:** `rmadison` shows your version in the `-proposed` pocket; the
update-excuses page lists the package with `Will attempt migration` before it
lands in `-release`. The community FTBFS report at `qa.ubuntuwire.com/ftbfs`
shows which packages currently fail to build.

**If it fails:** migration blockers are catalogued in
[the fix playbook](fix-playbook.md); the update-excuses page names the blocker
(`Regression`, `Impossible Depends`, `missing build on <arch>`).

## Upload rules

- PPAs and the archive accept **source-only** uploads. Launchpad builds the
  binaries for every enabled architecture.
- Launchpad **rejects** an upload that contains both binaries and sources.
  `sbuild --source` produces both; do not `dput` that `.changes`.
- Every accepted upload must be signed and must list the files in `.changes`.
- A version string can be uploaded once. Re-uploading the same version, even
  with a typo fix, is refused.
- PPA versions use `~<codename>N` so they sort below the archive version.
- Rebuilding after a changelog edit needs a fresh source build **and** a fresh
  signature: `dpkg-buildpackage -S -I -i -nc -d` then `debsign`.

## Command summary

```none
# source
git ubuntu clone hello && cd hello
# version
dch -l "~resolute" --distribution resolute "Build for PPA"
# source package
dpkg-buildpackage --build=source --no-check-builddeps --no-pre-clean
# binary in chroot, from the source root
sbuild --dist=resolute
# check
lintian ../hello_2.10-0ubuntu1~resolute1_amd64.deb
dpkg-deb -I ../hello_2.10-0ubuntu1~resolute1_amd64.deb
# install and test
sudo apt install ./hello_2.10-0ubuntu1~resolute1_amd64.deb
autopkgtest --apt-upgrade --shell-fail hello/ -- lxd autopkgtest/ubuntu/resolute/amd64
# sign and upload
debsign ../hello_2.10-0ubuntu1~resolute1_source.changes
dput ppa:user/hello ../hello_2.10-0ubuntu1~resolute1_source.changes
ppa wait ppa:user/hello && ppa tests --show-url ppa:user/hello --release resolute
```
