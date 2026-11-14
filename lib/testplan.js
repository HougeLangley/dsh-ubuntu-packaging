/**
 * Plan the test pass for a built Ubuntu/Debian package.
 *
 * Advisory text only. Covers static checks, install/upgrade/remove/purge,
 * DEP-8 skeletons, local/LXD/QEMU autopkgtest runs, PPA validation and the
 * deeper reproducibility/upgrade checks.
 */

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { parseChangelog } from './parse.js'

export const TEST_MODES = ['local', 'lxd', 'qemu', 'ppa']
export const DEFAULT_TEST_RELEASE = 'resolute'
export const DEFAULT_TEST_ARCH = 'amd64'

function shellQuote(value) {
  const text = String(value)
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text
  return `'${text.replace(/'/g, `'\\''`)}'`
}

function command(cmd, purpose, optional = false) {
  return { cmd, purpose, optional }
}

async function statOrNull(target) {
  try {
    return await stat(target)
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null
    throw error
  }
}

async function readPackageMeta(packageDir) {
  try {
    const text = await readFile(path.join(packageDir, 'debian', 'changelog'), 'utf8')
    const parsed = parseChangelog(text)
    if (parsed.source && parsed.version) {
      return { source: parsed.source, version: parsed.version, distribution: parsed.distribution }
    }
  } catch {
    // Planning works without a changelog; fall back to the directory name.
  }
  return { source: path.basename(packageDir) || 'package', version: null, distribution: null }
}

function dep8Skeleton(packageName) {
  return {
    control: [
      'Tests: smoke',
      'Depends: @',
      'Restrictions: superficial',
      '',
    ].join('\n'),
    script: [
      '#!/bin/sh',
      'set -eu',
      '',
      `command -v ${packageName}`,
      `${packageName} --version`,
      '',
    ].join('\n'),
  }
}

/**
 * Build a test plan.
 *
 * @param {object} input `packageDir`, `release`, `arch`, `mode`, `ppa`, `packageName`
 */
export async function testPlan(input = {}) {
  if (typeof input.packageDir !== 'string' || input.packageDir.trim() === '') {
    throw new Error('ubuntu_test_plan: "packageDir" is required')
  }
  const packageDir = path.resolve(input.packageDir)
  const release = String(input.release ?? DEFAULT_TEST_RELEASE)
  if (!/^[a-z][a-z0-9-]*$/.test(release)) {
    throw new Error(`ubuntu_test_plan: release "${release}" is not a valid codename`)
  }
  const arch = String(input.arch ?? DEFAULT_TEST_ARCH)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(arch)) {
    throw new Error(`ubuntu_test_plan: arch "${arch}" is not a valid architecture`)
  }
  const mode = String(input.mode ?? 'lxd')
  if (!TEST_MODES.includes(mode)) {
    throw new Error(`ubuntu_test_plan: mode "${mode}" must be one of ${TEST_MODES.join(', ')}`)
  }
  const ppa = input.ppa === undefined || input.ppa === null || input.ppa === ''
    ? null
    : String(input.ppa).trim()
  if (ppa !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ppa)) {
    throw new Error(`ubuntu_test_plan: ppa "${ppa}" must look like "user/archive"`)
  }
  if (mode === 'ppa' && ppa === null) {
    throw new Error('ubuntu_test_plan: ppa is required when mode is "ppa"')
  }

  const meta = await readPackageMeta(packageDir)
  const packageName = input.packageName === undefined || input.packageName === null || input.packageName === ''
    ? meta.source
    : String(input.packageName)
  if (!/^[a-z0-9][a-z0-9+.-]+$/.test(packageName)) {
    throw new Error(`ubuntu_test_plan: packageName "${packageName}" is not a valid package name`)
  }

  const changes = `${meta.source}_*.changes`
  const deb = `${meta.source}_*.deb`
  const image = `adt-${release}-${arch}.img`
  const output = '../autopkgtest-out'
  const testsControl = await statOrNull(path.join(packageDir, 'debian', 'tests', 'control'))
  const dep8 = testsControl ? null : dep8Skeleton(packageName)

  const prerequisites = [
    {
      command: 'sudo apt update',
      purpose: 'Refresh the indexes of the test release.',
      required: true,
    },
    {
      command: 'sudo apt install -y autopkgtest lintian devscripts',
      purpose: 'Install the static checker and the autopkgtest runner.',
      required: true,
    },
  ]
  if (mode === 'lxd') {
    prerequisites.push(
      { command: 'sudo snap install lxd', purpose: 'Install the LXD backend used by autopkgtest-build-lxd.', required: true },
      { command: 'lxd init --auto', purpose: 'Initialise LXD once before building an image.', required: true },
    )
  }
  if (mode === 'qemu') {
    prerequisites.push({
      command: 'sudo apt install -y qemu-system-x86',
      purpose: 'Install QEMU for the cloud-image backend.',
      required: true,
    })
  }
  if (mode === 'ppa') {
    prerequisites.push(
      { command: 'sudo apt install -y dput', purpose: 'Upload the source package to the PPA.', required: true },
      { command: 'sudo snap install ppa-dev-tools --classic', purpose: 'Install the ppa CLI used to create, wait for and test the PPA.', required: true },
    )
  }
  prerequisites.push({
    command: 'sudo apt install -y piuparts reprotest',
    purpose: 'Optional deeper checks: install/upgrade/remove and reproducibility.',
    required: false,
  })

  /* 1. static */
  const staticCommands = [
    command(`cd ${shellQuote(packageDir)}`, 'Run the rest of the plan from the source package directory.', false),
    command(`lintian --info ../${changes}`, 'Lint the upload artifact; fix every E: tag.', false),
    command(`lintian --info ../${deb}`, 'Lint the built .deb as well.', true),
    command(`lintian --info ../${meta.source}_*.dsc`, 'Lint the source package description.', true),
  ]

  /* 2. install and smoke */
  const installCommands = [
    command(`sudo apt install -y ${packageName}`, 'Install the archive version first to exercise the upgrade path.', true),
    command(`sudo apt install ../${deb}`, 'Install (or upgrade to) the locally built package.', false),
    command(`dpkg -L ${packageName}`, 'List the installed files.', false),
    command(`command -v ${packageName}`, 'Check that the expected binary is on PATH.', true),
    command(`${packageName} --version`, 'Smoke-test the installed binary (adjust to the real executable).', true),
    command(`sudo apt remove -y ${packageName}`, 'Remove the package but keep conffiles.', true),
    command(`sudo apt purge -y ${packageName}`, 'Purge the package and its conffiles.', true),
    command(`dpkg -s ${packageName} || echo 'purged: dpkg -s reports not installed'`, 'Confirm the purge left no package state behind.', true),
  ]

  /* 3. DEP-8 presence */
  const dep8Commands = [
    command('test -f debian/tests/control', 'Fail early when DEP-8 metadata is missing (see the dep8 skeleton).', false),
    command(`grep -n '^Tests:' debian/tests/control`, 'Show the declared test names.', true),
  ]

  /* 4. autopkgtest */
  const autopkgtestCommands = []
  if (mode === 'lxd') {
    autopkgtestCommands.push(
      command(`autopkgtest-build-lxd ubuntu-daily:${release}`, `Build an LXD image for ${release}.`, false),
      command(
        `autopkgtest --apt-upgrade --shell-fail --output-dir ${output} ${shellQuote(packageDir)} -- lxd autopkgtest/ubuntu/${release}/${arch}`,
        'Run the DEP-8 tests inside LXD; --shell-fail keeps the testbed open on failure.',
        false,
      ),
    )
  } else if (mode === 'qemu') {
    autopkgtestCommands.push(
      command(`autopkgtest-buildvm-ubuntu-cloud -r ${release} -a ${arch}`, `Build the ${release} cloud image for QEMU.`, false),
      command(
        `autopkgtest --apt-upgrade --shell-fail --output-dir ${output} ${shellQuote(packageDir)} -- qemu ${image}`,
        'Run the DEP-8 tests inside QEMU.',
        false,
      ),
    )
  } else if (mode === 'local') {
    autopkgtestCommands.push(command(
      `sudo autopkgtest --apt-upgrade --shell-fail --output-dir ${output} ${shellQuote(packageDir)} -- null`,
      'Run the tests directly on this host (needs root; the host is modified).',
      false,
    ))
  } else {
    autopkgtestCommands.push(
      command(`autopkgtest-build-lxd ubuntu-daily:${release}`, `Build an LXD image for ${release}.`, false),
      command(
        `autopkgtest --apt-upgrade --shell-fail --output-dir ${output} ${shellQuote(packageDir)} -- lxd autopkgtest/ubuntu/${release}/${arch}`,
        'Reproduce the PPA test run locally; the Launchpad run itself is ppa tests.',
        false,
      ),
    )
  }
  autopkgtestCommands.push(command(
    `autopkgtest --apt-pocket=proposed=src:${packageName} --apt-upgrade --shell-fail --output-dir ${output} ${shellQuote(packageDir)} -- lxd autopkgtest/ubuntu/${release}/${arch}`,
    `Test against the -proposed pocket when a dependency is still in proposed.`,
    true,
  ))

  /* 5. PPA */
  const ppaCommands = []
  if (ppa) {
    ppaCommands.push(
      command(`ppa create ${ppa}`, 'Create the PPA if it does not exist yet.', true),
      command(`dput ppa:${ppa} ../${meta.source}_*.changes`, 'Upload the signed source-only upload to the PPA.', false),
      command(`ppa wait ${ppa} --release ${release}`, 'Wait for the Launchpad build to finish.', false),
      command(`ppa tests ${ppa} --release ${release}`, 'Run the PPA test suite on Launchpad.', false),
    )
  } else {
    ppaCommands.push(command(
      `dput ../${changes}`,
      'Upload the signed .changes to the archive configured in ~/.dput.cf (add a ppa:user/archive target for a PPA).',
      true,
    ))
  }

  /* 6. deeper */
  const deeperCommands = [
    command(`sudo piuparts ../${deb}`, 'Install, upgrade, remove and purge the .deb in a throwaway chroot.', true),
    command(`reprotest . ../${meta.source}_*.dsc .`, 'Rebuild twice in different environments and compare artifacts.', true),
    command(`debci test ${packageName} --arch ${arch}`, 'Run the package through a local debci instance when one is available.', true),
  ]

  const phases = [
    { name: 'Static checks', commands: staticCommands },
    { name: 'Install and smoke test', commands: installCommands },
    { name: 'DEP-8 tests', commands: dep8Commands },
    { name: 'autopkgtest', commands: autopkgtestCommands },
    { name: 'PPA', commands: ppaCommands },
    { name: 'Deeper checks', commands: deeperCommands },
  ]

  const failureTriage = [
    {
      symptom: 'The test passes in a local VM but fails on Launchpad.',
      cause: 'Launchpad testbeds have no access to arbitrary external services; tests that fetch the internet fail there.',
      fix: 'Vendor the fixture or serve it locally. Use Restrictions: skippable only as a last resort and link the bug.',
    },
    {
      symptom: 'autopkgtest reports "command not found" for a test dependency.',
      cause: 'debian/tests/control Depends does not list every tool the test uses.',
      fix: 'Add the missing packages to Depends (keep @ for the package binaries) and re-run with --shell-fail.',
    },
    {
      symptom: 'The testbed is destroyed or the run aborts after a service restart.',
      cause: 'The test reboots or breaks the testbed without declaring it.',
      fix: 'Add Restrictions: breaks-testbed (or needs-reboot) and isolate the destructive step; use isolation-machine only when a real machine is required.',
    },
    {
      symptom: 'The same test alternates between PASS and FAIL.',
      cause: 'Timing, port or random-seed flakiness.',
      fix: 'Seed random data, bind an ephemeral port, retry the run three times; only mark Restrictions: flaky with an upstream bug reference.',
    },
    {
      symptom: 'The test needs a dependency that is only in -proposed.',
      cause: 'The archive version is older than the dependency the test needs.',
      fix: `Run autopkgtest with --apt-pocket=proposed=src:${packageName}, or upload the dependency first.`,
    },
    {
      symptom: 'The test script is not found.',
      cause: 'The Tests: name does not match a file in debian/tests/, or the script is not executable.',
      fix: 'Name the file exactly as in Tests:, chmod +x it, and keep the #!/bin/sh shebang.',
    },
    {
      symptom: 'The installed package is missing from the testbed.',
      cause: 'Depends: @ was omitted or the package was not built for the tested architecture.',
      fix: 'Add @ to Depends and rebuild/test the same architecture that the archive will ship.',
    },
    {
      symptom: 'The test times out.',
      cause: 'The test does real builds or long computations on a small testbed.',
      fix: 'Split the long test or add Restrictions: big-parallel; keep the default smoke test short.',
    },
    {
      symptom: 'The test needs root but autopkgtest refuses to run it.',
      cause: 'The test uses sudo/apt without declaring the restriction.',
      fix: 'Add Restrictions: needs-root and avoid changing the testbed outside a container.',
    },
    {
      symptom: 'The PPA build fails but the local build passes.',
      cause: 'A Build-Depends is not available in the target release/architecture, or the version does not sort above the archive.',
      fix: `Check the PPA build log, add the missing dependency for that release, and bump with ~${release}N.`,
    },
    {
      symptom: 'autopkgtest modifies the developer machine.',
      cause: 'mode=local runs on the host as root.',
      fix: 'Prefer LXD or QEMU; reserve the local mode for disposable machines.',
    },
  ]

  const checklist = [
    'lintian reports no errors for the .changes/.dsc/.deb you test.',
    `The .deb installs on a clean ${release} system and the binary starts.`,
    'The upgrade path from the previously published version works (install the archive build, then the new .deb).',
    'apt remove leaves the package removed and apt purge removes conffiles; dpkg -s reports "not installed".',
    'DEP-8 tests are present and pass in autopkgtest with no failures and no flaky reruns.',
    'debian/tests/control restrictions match the testbed (breaks-testbed, isolation-*, needs-root).',
  ]

  return { prerequisites, phases, dep8, failureTriage, checklist }
}
