/**
 * Plan an Ubuntu/Debian build for a source package.
 *
 * The plan is advisory text: no command is executed. Every command is written
 * to be copy-pasteable from the package directory, and the phases are always
 * in the order install -> prepare -> build -> inspect -> test -> sign/upload.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { parseChangelog } from './parse.js'

export const BUILD_MODES = ['binary', 'source', 'source+binary']
export const BUILD_TOOLS = ['sbuild', 'dpkg-buildpackage', 'debuild']
export const BUILD_RELEASES = ['resolute', 'questing', 'noble']
export const DEFAULT_BUILD_RELEASE = 'resolute'
export const DEFAULT_BUILD_ARCH = 'amd64'

const TOOLING_PACKAGES = 'devscripts debhelper dh-make build-essential lintian autopkgtest sbuild mmdebstrap uidmap'

function shellQuote(value) {
  const text = String(value)
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text
  return `'${text.replace(/'/g, `'\\''`)}'`
}

function command(cmd, purpose, optional = false) {
  return { cmd, purpose, optional }
}

async function readPackageMeta(packageDir) {
  try {
    const text = await readFile(path.join(packageDir, 'debian', 'changelog'), 'utf8')
    const parsed = parseChangelog(text)
    if (parsed.source && parsed.version) {
      return { source: parsed.source, version: parsed.version, distribution: parsed.distribution }
    }
  } catch {
    // A plan does not require the package to exist yet; fall back to the directory name.
  }
  return { source: path.basename(packageDir) || 'package', version: null, distribution: null }
}

function artifactVersion(meta) {
  if (!meta.version) return '*'
  // Epochs make file names awkward; a glob keeps the command copy-pasteable.
  return /^\d+:/.test(meta.version) ? '*' : meta.version
}

/**
 * Build a build plan.
 *
 * @param {object} input `packageDir`, `release`, `arch`, `mode`, `tool`, `sign`, `ppa`
 */
export async function buildPlan(input = {}) {
  if (typeof input.packageDir !== 'string' || input.packageDir.trim() === '') {
    throw new Error('ubuntu_build_plan: "packageDir" is required')
  }
  const packageDir = path.resolve(input.packageDir)
  const release = String(input.release ?? DEFAULT_BUILD_RELEASE)
  if (!/^[a-z][a-z0-9-]*$/.test(release)) {
    throw new Error(`ubuntu_build_plan: release "${release}" is not a valid codename`)
  }
  const arch = String(input.arch ?? DEFAULT_BUILD_ARCH)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(arch)) {
    throw new Error(`ubuntu_build_plan: arch "${arch}" is not a valid architecture`)
  }
  const mode = String(input.mode ?? 'binary')
  if (!BUILD_MODES.includes(mode)) {
    throw new Error(`ubuntu_build_plan: mode "${mode}" must be one of ${BUILD_MODES.join(', ')}`)
  }
  const tool = String(input.tool ?? 'sbuild')
  if (!BUILD_TOOLS.includes(tool)) {
    throw new Error(`ubuntu_build_plan: tool "${tool}" must be one of ${BUILD_TOOLS.join(', ')}`)
  }
  const sign = input.sign === true
  const ppa = input.ppa === undefined || input.ppa === null || input.ppa === ''
    ? null
    : String(input.ppa).trim()
  if (ppa !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ppa)) {
    throw new Error(`ubuntu_build_plan: ppa "${ppa}" must look like "user/archive"`)
  }

  const meta = await readPackageMeta(packageDir)
  const source = meta.source
  const version = artifactVersion(meta)
  const sourceChanges = `${source}_${version}_source.changes`
  const binaryChanges = `${source}_${version}_${arch}.changes`
  const deb = `${source}_${version}_${arch}.deb`
  const dsc = `${source}_${version}.dsc`
  const changesForUpload = mode === 'binary' ? binaryChanges : sourceChanges
  const sourceOnly = mode === 'source'

  const prerequisites = [
    {
      command: 'sudo apt update',
      purpose: 'Refresh apt indexes so the build dependencies resolve against the target release.',
      required: true,
    },
    {
      command: `sudo apt install -y ${TOOLING_PACKAGES}`,
      purpose: 'Install the packaging, build, lint, autopkgtest and sbuild tooling used by every phase.',
      required: true,
    },
    {
      command: 'dpkg-checkbuilddeps',
      purpose: 'Verify that every Build-Depends is installed before starting a long build.',
      required: false,
    },
  ]
  if (tool === 'sbuild') {
    prerequisites.push({
      command: 'sudo sbuild-adduser "$USER"',
      purpose: 'Allow the invoking user to run sbuild with the schroot backend (skip when using unshare).',
      required: false,
    })
  }
  if (ppa) {
    prerequisites.push({
      command: 'sudo apt install -y dput',
      purpose: 'Install dput so the signed .changes file can be uploaded to the PPA.',
      required: true,
    })
  }
  if (sign) {
    prerequisites.push({
      command: 'gpg --list-secret-keys --keyid-format long',
      purpose: 'Confirm the GPG key that debsign and dput will use is available.',
      required: true,
    })
  }

  /* 1. install tooling */
  const installCommands = [
    command('sudo apt update', 'Refresh the package indexes.', false),
    command(`sudo apt install -y ${TOOLING_PACKAGES}`, 'Install the full packaging toolchain once.', false),
  ]
  if (ppa) installCommands.push(command('sudo apt install -y dput', 'Add the upload tool for the PPA step.', false))
  if (sign) installCommands.push(command('sudo apt install -y gnupg', 'Ensure the signing tools are present.', true))

  /* 2. prepare source */
  const prepareCommands = [command(`cd ${shellQuote(packageDir)}`, 'Run every later command from the source package directory.', false)]
  if (sourceOnly) {
    prepareCommands.push(command(
      'LC_ALL=C dpkg-buildpackage --build=source --no-check-builddeps --no-pre-clean',
      'Produce the source package (the current source-only practice). --no-pre-clean skips debian/rules clean, so the tree must already be clean.',
      false,
    ))
    if (sign) {
      prepareCommands.push(command(`debsign ../${sourceChanges}`, 'Sign the source upload produced above.', false))
    }
  }

  /* 3. build */
  let buildCommand
  if (tool === 'sbuild') {
    buildCommand = mode === 'binary'
      ? command(`LC_ALL=C sbuild --dist=${release} --arch=${arch}`, `Build the binary package for ${release}/${arch}.`, false)
      : command(`LC_ALL=C sbuild --source --dist=${release} --arch=${arch}`, 'Build the source package and the binaries; upload only the source .changes.', false)
  } else if (tool === 'debuild') {
    buildCommand = mode === 'binary'
      ? command('LC_ALL=C debuild -us -uc', 'Build the binary package with debuild (no signing).', false)
      : mode === 'source'
        ? command('LC_ALL=C debuild -us -uc -S', 'Build the source package only with debuild.', false)
        : command('LC_ALL=C debuild -us -uc', 'Full build: source package and binaries.', false)
  } else if (mode === 'binary') {
    buildCommand = command('LC_ALL=C dpkg-buildpackage -us -uc -b', 'Build the binary package with dpkg-buildpackage.', false)
  } else if (mode === 'source') {
    buildCommand = command('LC_ALL=C dpkg-buildpackage -us -uc -S', 'Build the source package only; sign it with debsign afterwards.', false)
  } else {
    buildCommand = command('LC_ALL=C dpkg-buildpackage -us -uc', 'Full build: source package and binaries.', false)
  }

  /* 4. inspect */
  const inspectCommands = []
  if (!sourceOnly) {
    inspectCommands.push(
      command(`dpkg-deb -I ../${deb}`, 'Read the control fields of the built .deb (Depends, Provides, Description).', false),
      command(`dpkg-deb -c ../${deb}`, 'List the files the .deb installs before installing it.', false),
      command(`lesspipe ../${deb}`, 'Browse the .deb contents with lesspipe.', true),
    )
  }
  inspectCommands.push(command(
    `less ../${dsc}`,
    'Read the .dsc: source format, checksums and Build-Depends.',
    !sourceOnly,
  ))
  if (sourceOnly) {
    inspectCommands.push(command(
      `less ../${sourceChanges}`,
      'Check the .changes: files list, checksums and distribution.',
      false,
    ))
  }

  /* 5. test */
  const testCommands = [
    command(`LC_ALL=C lintian --info ../${changesForUpload}`, 'Lint the upload artifact; fix every E: tag before uploading.', false),
    command(`sudo apt install ../${deb}`, 'Install the locally built .deb (skip for source-only uploads).', sourceOnly),
    command(`dpkg -L ${source}`, 'List the installed files to pick the right smoke command.', true),
    command(`${source} --version`, 'Smoke-test the installed binary (adjust to the real executable name).', true),
  ]

  /* 6. sign and upload */
  const uploadCommands = []
  if (ppa && mode === 'binary') {
    uploadCommands.push(command(
      'LC_ALL=C dpkg-buildpackage --build=source --no-check-builddeps --no-pre-clean',
      'Produce the source-only upload that Launchpad accepts after the local binary build.',
      false,
    ))
  }
  uploadCommands.push(command(
    `debsign ../${ppa ? sourceChanges : changesForUpload}`,
    'Sign the .changes file; dput refuses unsigned uploads.',
    !(sign || ppa),
  ))
  if (ppa) {
    uploadCommands.push(command(
      `dput ppa:${ppa} ../${sourceChanges}`,
      'Upload the source-only .changes to the PPA.',
      false,
    ))
  }

  const phases = [
    { name: 'Install tooling', commands: installCommands },
    { name: 'Prepare source', commands: prepareCommands },
    { name: 'Build', commands: [buildCommand] },
    { name: 'Inspect', commands: inspectCommands },
    { name: 'Test', commands: testCommands },
    { name: 'Sign and upload', commands: uploadCommands },
  ]

  const notes = [
    'Launchpad and the Ubuntu archive accept source-only uploads. Build the binary locally first to prove the package builds, then upload the .changes produced by a source-only build.',
    'Do a local binary build (the Build phase) before uploading, so a source-only upload never hides an FTBFS.',
    `On Ubuntu 25.10 questing and newer, prefer the sbuild unshare backend (for example sbuild --chroot-mode=unshare); the schroot backend is legacy and needs extra setup.`,
    'dpkg-buildpackage --build=source --no-check-builddeps --no-pre-clean is the current source-only practice: --build=source stops after the source package, --no-check-builddeps skips the binary build-dependency check, and --no-pre-clean skips the implicit debian/rules clean, so only run it on an already clean tree.',
    'sbuild --source builds the source package AND the binaries; Launchpad rejects mixed source+binary uploads, so upload only the _source.changes file.',
    'LC_ALL=C is prefixed to sbuild, dpkg-buildpackage, debuild and lintian so their output stays English and ubuntu_diagnose_build can match it; run the printed commands as-is.',
    `PPA rebuilds must sort above the archive version: append ~${release}1 (for example 2.10-0ubuntu1~${release}1, using dch -l "~${release}") before uploading to the PPA.`,
    `Target release: ${release}; target architecture: ${arch}. Keep debian/changelog's distribution in sync with the release you build for.`,
  ]
  if (ppa) {
    notes.push(`PPA upload target: ppa:${ppa}. Run dput only after debsign succeeds, and wait for the PPA build before running ppa tests.`)
  } else {
    notes.push('No PPA was provided: sign the .changes with debsign, then upload it with dput to the archive configured in ~/.dput.cf.')
  }

  const checklist = [
    `debian/changelog has one entry for this upload, distribution ${release}, and a version that sorts above the previously published one.`,
    'lintian reports no errors for the .changes/.dsc/.deb you upload.',
    'The .deb installs on a clean system and the binary starts.',
    'The source-only upload contains the signed .changes, .dsc and orig tarball listed by dput.',
    'The PPA/archive build finishes successfully and the built binary matches the local build.',
    'The tree was clean before --no-pre-clean/--build=source, so no build artifacts leak into the source tarball.',
  ]

  return { prerequisites, phases, notes, checklist }
}
