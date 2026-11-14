import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { buildPlan } from '../lib/buildplan.js'
import { testPlan } from '../lib/testplan.js'

const CHANGELOG = [
  'hello (2.10-0ubuntu1) resolute; urgency=medium',
  '',
  '  * Initial packaging.',
  '',
  ' -- Jane Doe <jane@example.com>  Thu, 13 Nov 2026 10:00:00 +0800',
  '',
].join('\n')

async function makePackage(t, { withTests = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ubuntu-plan-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = { 'debian/changelog': CHANGELOG }
  if (withTests) files['debian/tests/control'] = 'Tests: smoke\nDepends: @\nRestrictions: superficial\n'
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, ...relative.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  return root
}

function phase(plan, name) {
  const found = plan.phases.find((entry) => entry.name === name)
  assert.ok(found, `missing phase ${name}`)
  return found
}

function commands(plan) {
  return plan.phases.flatMap((entry) => entry.commands.map((command) => command.cmd))
}

const BUILD_PHASES = ['Install tooling', 'Prepare source', 'Build', 'Inspect', 'Test', 'Sign and upload']

test('sbuild binary plans are ordered and carry the required commands and notes', async (t) => {
  const packageDir = await makePackage(t)
  const plan = await buildPlan({ packageDir })

  assert.deepEqual(plan.phases.map((entry) => entry.name), BUILD_PHASES)
  assert.equal(phase(plan, 'Build').commands[0].cmd, 'LC_ALL=C sbuild --dist=resolute --arch=amd64')
  const cdCommand = commands(plan).find((command) => command.startsWith('cd '))
  assert.ok(cdCommand)
  assert.ok(cdCommand.includes(packageDir), 'the plan must cd into the package directory')
  assert.equal(plan.prerequisites[0].command, 'sudo apt update')
  assert.equal(plan.prerequisites[0].required, true)
  assert.ok(plan.prerequisites.some((entry) => entry.command.includes('sbuild') && entry.command.includes('mmdebstrap')))
  assert.match(commands(plan).join('\n'), /LC_ALL=C lintian --info \.\.\/hello_2\.10-0ubuntu1_amd64\.changes/)
  assert.match(commands(plan).join('\n'), /dpkg-deb -I \.\.\/hello_2\.10-0ubuntu1_amd64\.deb/)
  assert.equal(plan.checklist.length, 6)

  const notes = plan.notes.join('\n')
  assert.match(notes, /LC_ALL=C/)
  assert.match(notes, /source-only upload/i)
  assert.match(notes, /local binary build/i)
  assert.match(notes, /unshare/i)
  assert.match(notes, /no-pre-clean/i)
  assert.match(notes, /mixed source\+binary|mixed source\+binary uploads|Launchpad rejects/i)
  assert.match(notes, /~resolute1/)

  const debsign = phase(plan, 'Sign and upload').commands.find((entry) => entry.cmd.startsWith('debsign'))
  assert.ok(debsign)
  assert.equal(debsign.optional, true, 'signing is optional when sign=false and no PPA is given')
  assert.ok(!commands(plan).some((cmd) => cmd.includes('dput')))
})

test('sbuild source+binary uses --source and prepares a source-only upload', async (t) => {
  const packageDir = await makePackage(t)
  const plan = await buildPlan({ packageDir, mode: 'source+binary', tool: 'sbuild' })

  assert.equal(phase(plan, 'Build').commands[0].cmd, 'LC_ALL=C sbuild --source --dist=resolute --arch=amd64')

  const sourceOnly = await buildPlan({ packageDir, mode: 'source', tool: 'sbuild' })
  assert.ok(phase(sourceOnly, 'Prepare source').commands.some((entry) =>
    entry.cmd === 'LC_ALL=C dpkg-buildpackage --build=source --no-check-builddeps --no-pre-clean'))
  assert.equal(phase(sourceOnly, 'Build').commands[0].cmd, 'LC_ALL=C sbuild --source --dist=resolute --arch=amd64')
})

test('dpkg-buildpackage supports binary and source modes', async (t) => {
  const packageDir = await makePackage(t)
  const binary = await buildPlan({ packageDir, tool: 'dpkg-buildpackage' })
  assert.equal(phase(binary, 'Build').commands[0].cmd, 'LC_ALL=C dpkg-buildpackage -us -uc -b')

  const source = await buildPlan({ packageDir, tool: 'dpkg-buildpackage', mode: 'source' })
  assert.equal(phase(source, 'Build').commands[0].cmd, 'LC_ALL=C dpkg-buildpackage -us -uc -S')
  assert.ok(phase(source, 'Prepare source').commands.some((entry) =>
    entry.cmd === 'LC_ALL=C dpkg-buildpackage --build=source --no-check-builddeps --no-pre-clean'))

  const full = await buildPlan({ packageDir, tool: 'dpkg-buildpackage', mode: 'source+binary' })
  assert.equal(phase(full, 'Build').commands[0].cmd, 'LC_ALL=C dpkg-buildpackage -us -uc')
})

test('debuild is supported for binary builds', async (t) => {
  const packageDir = await makePackage(t)
  const plan = await buildPlan({ packageDir, tool: 'debuild' })
  assert.equal(phase(plan, 'Build').commands[0].cmd, 'LC_ALL=C debuild -us -uc')
})

test('signing and a PPA add debsign, dput and the source upload command', async (t) => {
  const packageDir = await makePackage(t)
  const plan = await buildPlan({
    packageDir,
    sign: true,
    ppa: 'jane/hello',
    mode: 'binary',
    tool: 'sbuild',
  })

  const upload = phase(plan, 'Sign and upload').commands
  assert.equal(upload[0].cmd, 'LC_ALL=C dpkg-buildpackage --build=source --no-check-builddeps --no-pre-clean')
  assert.equal(upload[1].cmd, 'debsign ../hello_2.10-0ubuntu1_source.changes')
  assert.equal(upload[1].optional, false)
  assert.equal(upload[2].cmd, 'dput ppa:jane/hello ../hello_2.10-0ubuntu1_source.changes')
  assert.ok(plan.prerequisites.some((entry) => entry.command.includes('dput')))
  assert.match(plan.notes.join('\n'), /ppa:jane\/hello/)
  assert.match(plan.notes.join('\n'), /PPA/i)
})

test('paths containing spaces are quoted so commands stay copy-pasteable', async (t) => {
  const parent = await makePackage(t)
  const spaced = join(parent, 'hello with space')
  await mkdir(join(spaced, 'debian'), { recursive: true })
  await writeFile(join(spaced, 'debian', 'changelog'), CHANGELOG, 'utf8')

  const plan = await buildPlan({ packageDir: spaced })
  const cd = commands(plan).find((command) => command.startsWith('cd '))
  assert.ok(cd)
  assert.match(cd, /^cd '.*hello with space'$/)
  assert.ok(phase(plan, 'Build').commands[0].cmd.startsWith('LC_ALL=C sbuild '))
})

test('build plan rejects invalid mode, tool and ppa values', async (t) => {
  const packageDir = await makePackage(t)
  await assert.rejects(() => buildPlan({ packageDir, mode: 'everything' }), /mode/)
  await assert.rejects(() => buildPlan({ packageDir, tool: 'make' }), /tool/)
  await assert.rejects(() => buildPlan({ packageDir, ppa: 'not-a-ppa' }), /ppa/)
  await assert.rejects(() => buildPlan({}), /packageDir/)
})

const TEST_PHASES = ['Static checks', 'Install and smoke test', 'DEP-8 tests', 'autopkgtest', 'PPA', 'Deeper checks']

test('LXD test plans build an image and run autopkgtest with the lxd backend', async (t) => {
  const packageDir = await makePackage(t)
  const plan = await testPlan({ packageDir })

  assert.deepEqual(plan.phases.map((entry) => entry.name), TEST_PHASES)
  const all = commands(plan).join('\n')
  assert.match(all, /autopkgtest-build-lxd ubuntu-daily:resolute/)
  assert.match(all, /autopkgtest --apt-upgrade --shell-fail --output-dir \.\.\/autopkgtest-out .* -- lxd autopkgtest\/ubuntu\/resolute\/amd64/)
  assert.match(all, /lintian --info \.\.\/hello_\*\.changes/)
  assert.match(all, /sudo apt install \.\.\/hello_\*\.deb/)
  assert.match(all, /sudo apt purge -y hello/)
  assert.match(all, /dpkg -s hello/)
  assert.equal(plan.dep8, null, 'a package with debian/tests/control needs no skeleton')
  assert.match(plan.notes.join('\n'), /LC_ALL=C/)
  assert.ok(plan.prerequisites.some((entry) => entry.command.includes('snap install lxd')))
})

test('QEMU test plans build a cloud image and use the qemu backend', async (t) => {
  const packageDir = await makePackage(t)
  const plan = await testPlan({ packageDir, mode: 'qemu' })
  const all = commands(plan).join('\n')
  assert.match(all, /autopkgtest-buildvm-ubuntu-cloud -r resolute -a amd64/)
  assert.match(all, /-- qemu adt-resolute-amd64\.img/)
  assert.ok(plan.prerequisites.some((entry) => entry.command.includes('qemu-system-x86')))
})

test('local test plans run without a virtualization backend', async (t) => {
  const packageDir = await makePackage(t)
  const plan = await testPlan({ packageDir, mode: 'local' })
  const all = commands(plan).join('\n')
  assert.match(all, /sudo LC_ALL=C autopkgtest --apt-upgrade --shell-fail --output-dir \.\.\/autopkgtest-out .* -- null/)
  assert.ok(!all.includes('autopkgtest-build-lxd'))
})

test('PPA test plans require a PPA and add create/dput/wait/tests commands', async (t) => {
  const packageDir = await makePackage(t)
  await assert.rejects(() => testPlan({ packageDir, mode: 'ppa' }), /ppa is required/)

  const plan = await testPlan({ packageDir, mode: 'ppa', ppa: 'jane/hello' })
  const ppaPhase = phase(plan, 'PPA').commands.map((entry) => entry.cmd)
  assert.ok(ppaPhase.includes('ppa create jane/hello'))
  assert.ok(ppaPhase.includes('dput ppa:jane/hello ../hello_*.changes'))
  assert.ok(ppaPhase.includes('ppa wait jane/hello --release resolute'))
  assert.ok(ppaPhase.includes('ppa tests jane/hello --release resolute'))
  assert.match(commands(plan).join('\n'), /-- lxd autopkgtest\/ubuntu\/resolute\/amd64/)
  assert.ok(plan.prerequisites.some((entry) => entry.command.includes('ppa-dev-tools')))
})

test('a package without DEP-8 tests gets a copyable skeleton', async (t) => {
  const packageDir = await makePackage(t, { withTests: false })
  const plan = await testPlan({ packageDir })

  assert.ok(plan.dep8)
  assert.match(plan.dep8.control, /^Tests: smoke$/m)
  assert.match(plan.dep8.control, /^Depends: @$/m)
  assert.match(plan.dep8.control, /^Restrictions: superficial$/m)
  assert.match(plan.dep8.script, /^#!\/bin\/sh$/m)
  assert.match(plan.dep8.script, /command -v hello/)
  assert.match(plan.dep8.script, /hello --version/)
})

test('failure triage covers the required classes and the checklist is complete', async (t) => {
  const packageDir = await makePackage(t)
  const plan = await testPlan({ packageDir })

  assert.ok(plan.failureTriage.length >= 10)
  const triage = plan.failureTriage.map((entry) => `${entry.symptom} ${entry.cause} ${entry.fix}`).join('\n')
  assert.match(triage, /Launchpad/)
  assert.match(triage, /network|external services/i)
  assert.match(triage, /breaks-testbed/)
  assert.match(triage, /flaky/i)
  assert.match(triage, /proposed/)

  const checklist = plan.checklist.join('\n')
  assert.match(checklist, /lintian/)
  assert.match(checklist, /installs/)
  assert.match(checklist, /upgrade/)
  assert.match(checklist, /purge/)
  assert.match(checklist, /DEP-8/)

  await assert.rejects(() => testPlan({ packageDir, mode: 'cloud' }), /mode/)
  await assert.rejects(() => testPlan({}), /packageDir/)
})

test('every log-producing command carries LC_ALL=C across all plans', async (t) => {
  const packageDir = await makePackage(t)
  const tools = 'sbuild|dpkg-buildpackage|debuild|lintian|autopkgtest(?:-build-lxd|-buildvm-ubuntu-cloud)?'
  const startsWithTool = new RegExp(`^(?:sudo )?(?:LC_ALL=C )?(?:${tools})\\b`)
  const prefixed = new RegExp(`^(?:sudo )?LC_ALL=C (?:${tools})\\b`)

  const plans = []
  for (const tool of ['sbuild', 'dpkg-buildpackage', 'debuild']) {
    for (const mode of ['binary', 'source', 'source+binary']) {
      plans.push(await buildPlan({ packageDir, tool, mode, sign: true, ppa: 'jane/hello' }))
    }
  }
  for (const mode of ['local', 'lxd', 'qemu', 'ppa']) {
    plans.push(await testPlan({ packageDir, mode, ...(mode === 'ppa' ? { ppa: 'jane/hello' } : {}) }))
  }

  let checked = 0
  for (const plan of plans) {
    for (const command of commands(plan)) {
      if (!startsWithTool.test(command)) continue
      assert.ok(prefixed.test(command), `missing LC_ALL=C: ${command}`)
      checked += 1
    }
  }
  assert.ok(checked >= 20, `expected many log-producing commands, saw ${checked}`)
})
