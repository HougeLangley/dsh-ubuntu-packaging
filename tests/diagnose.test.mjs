import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { diagnoseBuild, diagnoseLog, EVIDENCE_LIMIT, MAX_FINDINGS } from '../lib/diagnose.js'

const MIXED_LOG = [
  'dpkg-checkbuilddeps: error: Unmet build dependencies: libssl-dev zlib1g-dev',
  "checking for openssl... No package 'openssl' found",
  'src/foo.c:12:10: fatal error: bar.h: No such file or directory',
  'cc -o foo foo.o cannot find -lssl',
  'dh: command not found',
  'dpkg-shlibdeps: error: no dependency information found for /usr/lib/libfoo.so.1',
  'dpkg-source: error: cannot represent change to debian/patches: file has unsupported type',
  'debian/rules: Permission denied',
  "ModuleNotFoundError: No module named 'setuptools'",
  'error: failed to select a version for the requirement `foo = "^1"`',
  "foo.o: in function `main': /src/foo.c:3: undefined reference to `SSL_new'",
  'FAIL: test_greeting',
  'E: hello: no-copyright-file',
  'autopkgtest [12:00:00]: FAIL: smoke',
  'configure: error: C compiler cannot create executables',
  'No space left on device',
].join('\n')

test('diagnose recognises every documented failure class with an evidence line', () => {
  const result = diagnoseLog(MIXED_LOG)
  const ids = result.findings.map((finding) => finding.id)

  for (const id of [
    'missing-build-dep',
    'missing-pkg-config',
    'missing-header',
    'missing-library',
    'debhelper-compat',
    'shlibdeps',
    'dpkg-source-error',
    'rules-permission',
    'python-import',
    'rust-vendoring',
    'link-error',
    'test-failure',
    'lintian-error',
    'autopkgtest-failure',
    'configure-error',
    'out-of-space',
  ]) {
    assert.ok(ids.includes(id), `expected finding ${id}, got ${ids.join(', ')}`)
  }

  assert.equal(result.findings.length, 16)
  assert.equal(result.summary.errors, 16)
  assert.equal(result.summary.warnings, 0)
  assert.equal(result.summary.phase, 'configure')
  assert.equal(result.summary.lines, 16)

  const buildDep = result.findings.find((finding) => finding.id === 'missing-build-dep')
  assert.match(buildDep.evidence, /libssl-dev/)
  assert.match(buildDep.fix, /Build-Depends/)
  assert.match(buildDep.doc, /^https:\/\//)

  const python = result.findings.find((finding) => finding.id === 'python-import')
  assert.match(python.fix, /python3-setuptools/)

  const lintian = result.findings.find((finding) => finding.id === 'lintian-error')
  assert.match(lintian.evidence, /^E: hello:/)

  assert.ok(result.nextActions.length >= 3 && result.nextActions.length <= 6)
})

test('a warning-only log produces a warning finding', () => {
  const result = diagnoseLog('dh_auto_configure: warning: unknown option --enable-foo')
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].id, 'build-warning')
  assert.equal(result.findings[0].severity, 'warning')
  assert.equal(result.summary.warnings, 1)
  assert.equal(result.summary.errors, 0)
})

test('identical findings are de-duplicated but distinct evidence is kept', () => {
  const line = 'src/a.c:1:10: fatal error: a.h: No such file or directory'
  const deduped = diagnoseLog([line, line].join('\n'))
  assert.equal(deduped.findings.length, 1)

  const distinct = diagnoseLog([
    'src/a.c:1:10: fatal error: a.h: No such file or directory',
    'src/b.c:1:10: fatal error: b.h: No such file or directory',
  ].join('\n'))
  assert.equal(distinct.findings.length, 2)
  assert.deepEqual(new Set(distinct.findings.map((finding) => finding.id)), new Set(['missing-header']))
})

test('findings are capped at 40 and evidence is truncated to 300 characters', () => {
  const many = Array.from(
    { length: 60 },
    (_, index) => `src/f${index}.c:1:10: fatal error: header${index}.h: No such file or directory`,
  ).join('\n')
  const capped = diagnoseLog(many)
  assert.equal(capped.findings.length, MAX_FINDINGS)
  assert.equal(capped.findings[0].evidence.includes('header0.h'), true)
  assert.equal(capped.findings[MAX_FINDINGS - 1].evidence.includes('header39.h'), true)

  const longLine = `src/a.c:1:10: fatal error: ${'x'.repeat(400)}.h: No such file or directory`
  const truncated = diagnoseLog(longLine)
  assert.equal(truncated.findings[0].evidence.length, EVIDENCE_LIMIT)
  assert.ok(truncated.findings[0].evidence.length <= 300)
})

test('summary.phase follows the last build-stage marker', () => {
  assert.equal(diagnoseLog('dh_auto_configure\n./configure: line 1\n-- Configuring done').summary.phase, 'configure')
  assert.equal(diagnoseLog('dh_auto_configure\ndh_auto_build\nmake[1]: Entering directory').summary.phase, 'build')
  assert.equal(
    diagnoseLog('dh_auto_configure\ndh_auto_build\nPASS: all tests').summary.phase,
    'test',
  )
  assert.equal(diagnoseLog('dh_builddeb\ndpkg-deb: building package').summary.phase, 'package')
  assert.equal(diagnoseLog('hello world').summary.phase, 'unknown')
  assert.equal(diagnoseLog('').summary.phase, 'unknown')
})

test('an empty log still yields three next actions', () => {
  const result = diagnoseLog('')
  assert.equal(result.summary.lines, 0)
  assert.equal(result.summary.errors, 0)
  assert.equal(result.findings.length, 0)
  assert.equal(result.nextActions.length, 3)
})

test('debhelper helper failures are recognised, including dh_install specifics', () => {
  const build = diagnoseLog('dh_auto_build: error: make -j2 returned exit code 2')
  assert.equal(build.findings[0].id, 'dh-failure')
  assert.match(build.findings[0].fix, /override_/)

  const install = diagnoseLog('dh_install: error: missing files, aborting')
  assert.equal(install.findings[0].id, 'dh-install-missing-files')
  assert.match(install.findings[0].fix, /install/)

  const testPhase = diagnoseLog('dh_auto_test: error: make -j2 test returned exit code 2')
  assert.equal(testPhase.findings[0].id, 'dh-failure')
})

test('dpkg-buildpackage and collect2 summaries are recognised', () => {
  const buildFailed = diagnoseLog('dpkg-buildpackage: error: debian/rules build subprocess returned exit status 2')
  assert.equal(buildFailed.findings[0].id, 'build-command-failed')

  const linkFailed = diagnoseLog('collect2: error: ld returned 1 exit status')
  assert.equal(linkFailed.findings[0].id, 'link-error')
  assert.match(linkFailed.findings[0].fix, /-dev package/)
})

test('a real-looking autopkgtest failure is diagnosed', () => {
  const log = [
    'autopkgtest [12:00:00]: starting date: 2026-11-13',
    'autopkgtest [12:00:01]: test smoke: preparing testbed',
    'autopkgtest [12:00:06]: test smoke: -----------------------]',
    'autopkgtest [12:00:07]: test smoke: FAIL non-zero exit status 1',
  ].join('\n')
  const result = diagnoseLog(log)
  assert.equal(result.findings[0].id, 'autopkgtest-failure')
  assert.match(result.findings[0].evidence, /FAIL non-zero exit status 1/)
})

test('ANSI colour codes do not hide findings', () => {
  const result = diagnoseLog('\u001b[31mFAIL: test_colors\u001b[0m\n')
  assert.equal(result.findings[0].id, 'test-failure')
  assert.equal(result.findings[0].evidence, 'FAIL: test_colors')
})

test('diagnoseBuild reads a log file and enforces exactly one input', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ubuntu-diagnose-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const logPath = join(root, 'build.log')
  await writeFile(logPath, 'src/a.c:1:10: fatal error: a.h: No such file or directory\n', 'utf8')

  const fromFile = await diagnoseBuild({ path: logPath })
  assert.equal(fromFile.findings[0].id, 'missing-header')

  await assert.rejects(() => diagnoseBuild({ log: 'x', path: logPath }), /exactly one/)
  await assert.rejects(() => diagnoseBuild({}), /exactly one/)
  assert.equal((await diagnoseBuild({ log: 'x', path: '' })).findings.length, 0)
  await assert.rejects(
    () => diagnoseBuild({ path: join(root, 'missing.log') }),
    (error) => error.message.includes('cannot read log'),
  )
})

test('autopkgtest summary lines are diagnosed and set the test phase', () => {
  const failing = diagnoseLog('smoke FAIL')
  assert.equal(failing.findings.length, 1)
  assert.equal(failing.findings[0].id, 'test-failure')
  assert.equal(failing.findings[0].evidence, 'smoke FAIL')
  assert.equal(failing.summary.phase, 'test')

  const passing = diagnoseLog('smoke PASS')
  assert.equal(passing.findings.length, 0)
  assert.equal(passing.summary.phase, 'test')

  const errored = diagnoseLog('smoke ERROR')
  assert.equal(errored.findings.length, 1)
  assert.equal(errored.findings[0].id, 'test-failure')
  assert.equal(errored.findings[0].evidence, 'smoke ERROR')

  const mixed = diagnoseLog([
    'dpkg-checkbuilddeps: error: Unmet build dependencies: libbar-dev',
    'src/x.c:1:10: fatal error: bar.h: No such file or directory',
    'smoke FAIL',
  ].join('\n'))
  assert.deepEqual(
    mixed.findings.map((finding) => finding.id),
    ['missing-build-dep', 'missing-header', 'test-failure'],
  )
  assert.equal(mixed.summary.phase, 'test')
  assert.equal(mixed.summary.errors, 3)
  assert.equal(mixed.findings.at(-1).evidence, 'smoke FAIL')
  assert.ok(mixed.nextActions.length >= 3 && mixed.nextActions.length <= 6)
})
