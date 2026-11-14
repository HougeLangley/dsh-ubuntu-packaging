import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  changelogSummary,
  controlSummary,
  DEFAULT_TARGET_RELEASE,
  lintPackage,
  loadPackage,
  rulesSummary,
  testsSummary,
} from '../lib/lint.js'

const CONTROL = [
  'Source: hello',
  'Section: devel',
  'Priority: optional',
  'Maintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>',
  'Build-Depends: debhelper-compat (= 13), texinfo',
  'Standards-Version: 4.7.4',
  'Rules-Requires-Root: no',
  'Homepage: https://www.gnu.org/software/hello/',
  'Vcs-Git: https://git.example.org/hello.git',
  'Vcs-Browser: https://git.example.org/hello',
  '',
  'Package: hello',
  'Architecture: any',
  'Depends: ${misc:Depends}, ${shlibs:Depends}',
  'Description: Classic greeting program',
  '',
].join('\n')

const CHANGELOG = [
  'hello (2.10-0ubuntu1) resolute; urgency=medium',
  '',
  '  * Initial packaging.',
  '',
  ' -- Jane Doe <jane@example.com>  Thu, 13 Nov 2026 10:00:00 +0800',
  '',
].join('\n')

const COPYRIGHT = [
  'Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/',
  'Upstream-Name: hello',
  'Source: https://www.gnu.org/software/hello/',
  '',
  'Files: *',
  'Copyright: 2026 Jane Doe <jane@example.com>',
  'License: GPL-3+',
  ' This program is free software; you can redistribute it and/or modify it',
  ' under the terms of the GNU General Public License.',
  '',
].join('\n')

const RULES = '#!/usr/bin/make -f\n\n%:\n\tdh $@\n'

const WATCH = [
  'version=4',
  'https://ftp.gnu.org/gnu/hello/ hello-([\\d.]+)\\.tar\\.gz',
  '',
].join('\n')

const PATCH = [
  'Description: Build the manual with the system toolchain',
  'Origin: upstream, https://example.org/commit/abc',
  'Forwarded: not-needed',
  '',
  '--- a/Makefile',
  '+++ b/Makefile',
  '',
].join('\n')

const TESTS_CONTROL = 'Tests: smoke\nDepends: @\nRestrictions: superficial\n'
const SMOKE = '#!/bin/sh\nset -eu\ncommand -v hello\nhello --version\n'

const VALID = {
  'debian/changelog': CHANGELOG,
  'debian/control': CONTROL,
  'debian/copyright': COPYRIGHT,
  'debian/rules': RULES,
  'debian/source/format': '3.0 (quilt)\n',
  'debian/watch': WATCH,
  'debian/patches/series': '0001-fix-build.patch\n',
  'debian/patches/0001-fix-build.patch': PATCH,
  'debian/tests/control': TESTS_CONTROL,
  'debian/tests/smoke': SMOKE,
}

async function writePackage(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ubuntu-lint-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = { ...VALID, ...overrides }
  for (const [relative, content] of Object.entries(files)) {
    if (content === null) continue
    const target = join(root, ...relative.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  for (const relative of ['debian/rules', 'debian/tests/smoke']) {
    if (files[relative] === null) continue
    await chmod(join(root, ...relative.split('/')), 0o755)
  }
  return root
}

function codes(result) {
  return result.issues.map((entry) => entry.code)
}

test('a well-formed package has no errors and no warnings', async (t) => {
  const root = await writePackage(t)
  const result = await lintPackage({ path: root })

  assert.equal(result.path, root)
  assert.equal(result.ok, true)
  assert.equal(result.errorCount, 0)
  assert.equal(result.warningCount, 0)
  assert.equal(result.infoCount, 1)
  assert.deepEqual(codes(result), ['U039'])
  assert.equal(result.issues[0].severity, 'info')
})

test('loadPackage exposes the layout and public summaries', async (t) => {
  const root = await writePackage(t)
  const pkg = await loadPackage(root)

  assert.equal(pkg.path, root)
  assert.equal(pkg.layout.debian, true)
  assert.equal(pkg.layout.changelog, true)
  assert.equal(pkg.layout.control, true)
  assert.equal(pkg.layout.copyright, true)
  assert.equal(pkg.layout.rules, true)
  assert.equal(pkg.layout.watch, true)
  assert.equal(pkg.layout.sourceFormat, '3.0 (quilt)')
  assert.equal(pkg.layout.compat, null)
  assert.equal(pkg.layout.debhelperCompat, '13')
  assert.equal(pkg.layout.patches, 1)
  assert.equal(pkg.layout.tests, 1)
  assert.equal(pkg.layout.native, false)
  assert.deepEqual(pkg.layout.installFiles, [])

  const changelog = changelogSummary(pkg.parsed.changelog)
  assert.equal(changelog.source, 'hello')
  assert.equal(changelog.debianRevision, '0')
  assert.equal(changelog.ubuntuRevision, 'ubuntu1')
  assert.equal(changelog.entries, 1)

  const control = controlSummary(pkg)
  assert.equal(control.source.section, 'devel')
  assert.equal(control.source.standardsVersion, '4.7.4')
  assert.deepEqual(control.source.buildDepends, ['debhelper-compat (= 13)', 'texinfo'])
  assert.equal(control.packages[0].package, 'hello')
  assert.equal(control.packages[0].architecture, 'any')

  const rules = rulesSummary(pkg.parsed.rules)
  assert.equal(rules.dhSequencer, true)
  assert.equal(
    rules.executable,
    process.platform !== 'win32',
    'POSIX execute bits are unavailable on Windows',
  )
  assert.equal(rules.buildsystem, 'autotools')
  assert.deepEqual(rules.overrides, [])

  const tests = testsSummary(pkg)
  assert.equal(tests.control, true)
  assert.deepEqual(tests.scripts, ['smoke'])
  assert.deepEqual(tests.entries[0].depends, ['@'])
})

test('missing mandatory files are reported as errors', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ubuntu-lint-empty-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const result = await lintPackage({ path: root })

  assert.equal(result.ok, false)
  assert.equal(result.errorCount, 4)
  assert.equal(result.warningCount, 1)
  const issues = codes(result)
  for (const code of ['no-debian-changelog', 'no-control-file', 'no-copyright-file', 'no-debian-rules', 'missing-debian-source-format']) {
    assert.ok(issues.includes(code), `expected ${code}`)
  }
  for (const entry of result.issues) {
    assert.equal(entry.line, null)
    assert.equal(typeof entry.fix, 'string')
  }
})

test('a changelog that disagrees with control Source is an error', async (t) => {
  const root = await writePackage(t, { 'debian/control': CONTROL.replace('Source: hello', 'Source: hello2') })
  const result = await lintPackage({ path: root })
  const mismatch = result.issues.find((entry) => entry.code === 'U002')
  assert.ok(mismatch)
  assert.equal(mismatch.severity, 'error')
  assert.equal(mismatch.line, 1)
  assert.match(mismatch.message, /hello2/)
})

test('UNRELEASED is a warning and the remediation names the target release', async (t) => {
  const root = await writePackage(t, { 'debian/changelog': CHANGELOG.replace('resolute;', 'UNRELEASED;') })
  const result = await lintPackage({ path: root })
  const distribution = result.issues.find((entry) => entry.code === 'U004')
  assert.ok(distribution)
  assert.equal(distribution.severity, 'warning')
  assert.match(distribution.fix, new RegExp(DEFAULT_TARGET_RELEASE))
  assert.equal(result.ok, true)

  const custom = await lintPackage({ path: root, targetRelease: 'noble' })
  assert.match(custom.issues.find((entry) => entry.code === 'U004').fix, /noble/)
})

test('an unknown urgency is a warning', async (t) => {
  const root = await writePackage(t, { 'debian/changelog': CHANGELOG.replace('urgency=medium', 'urgency=urgent') })
  const result = await lintPackage({ path: root })
  const urgency = result.issues.find((entry) => entry.code === 'U005')
  assert.ok(urgency)
  assert.equal(urgency.severity, 'warning')
  assert.match(urgency.message, /urgent/)
})

test('a missing Standards-Version is an error', async (t) => {
  const root = await writePackage(t, {
    'debian/control': CONTROL.replace('Standards-Version: 4.7.4\n', ''),
  })
  const result = await lintPackage({ path: root })
  const issue = result.issues.find((entry) => entry.code === 'no-standards-version-field')
  assert.ok(issue)
  assert.equal(issue.severity, 'error')
  assert.match(issue.fix, /4\.7\.4/)
})

test('debhelper compat must be declared and must be current', async (t) => {
  const missing = await writePackage(t, {
    'debian/control': CONTROL.replace('debhelper-compat (= 13)', 'debhelper'),
  })
  const missingResult = await lintPackage({ path: missing })
  assert.ok(missingResult.issues.some((entry) => entry.code === 'debhelper-compat-file-is-missing'))

  const old = await writePackage(t, {
    'debian/control': CONTROL.replace('debhelper-compat (= 13)', 'debhelper-compat (= 12)'),
  })
  const oldResult = await lintPackage({ path: old })
  const oldIssue = oldResult.issues.find((entry) => entry.code === 'package-uses-old-debhelper-compat-version')
  assert.ok(oldIssue)
  assert.equal(oldIssue.severity, 'warning')
  assert.match(oldIssue.message, /12/)
})

test('debian/rules must use dh $@ and must not call helpers outside overrides', async (t) => {
  const noSequencer = await writePackage(t, {
    'debian/rules': '#!/usr/bin/make -f\n\nbuild:\n\t./configure\n\tmake\n',
  })
  const noSequencerResult = await lintPackage({ path: noSequencer })
  assert.ok(noSequencerResult.issues.some((entry) => entry.code === 'U016'))

  const direct = await writePackage(t, {
    'debian/rules': '#!/usr/bin/make -f\n\n%:\n\tdh $@\n\nbuild:\n\tdh_auto_build\n',
  })
  const directResult = await lintPackage({ path: direct })
  assert.ok(directResult.issues.some((entry) => entry.code === 'U017' && entry.line === 7))

  const deprecated = await writePackage(t, {
    'debian/rules': '#!/usr/bin/make -f\n\n%:\n\tdh $@\n\noverride_dh_clean:\n\tdh_clean -k\n',
  })
  const deprecatedResult = await lintPackage({ path: deprecated })
  assert.ok(deprecatedResult.issues.some((entry) => entry.code === 'U018'))
})

test('copyright must be DEP-5 and watch must be secure and capturable', async (t) => {
  const noFormat = await writePackage(t, {
    'debian/copyright': COPYRIGHT.replace('Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\n', ''),
  })
  const noFormatResult = await lintPackage({ path: noFormat })
  assert.ok(noFormatResult.issues.some((entry) => entry.code === 'U020'))

  const httpWatch = await writePackage(t, {
    'debian/watch': WATCH.replace('https://ftp.gnu.org', 'http://ftp.gnu.org'),
  })
  const httpResult = await lintPackage({ path: httpWatch })
  assert.ok(httpResult.issues.some((entry) => entry.code === 'U024'))

  const noCapture = await writePackage(t, {
    'debian/watch': 'version=4\nhttps://ftp.gnu.org/gnu/hello/ hello.tar.gz\n',
  })
  const noCaptureResult = await lintPackage({ path: noCapture })
  assert.ok(noCaptureResult.issues.some((entry) => entry.code === 'U025'))
})

test('patch series and DEP-3 headers are validated', async (t) => {
  const missingPatch = await writePackage(t, {
    'debian/patches/series': '0001-fix-build.patch\n0002-missing.patch\n',
  })
  const missingResult = await lintPackage({ path: missingPatch })
  const u026 = missingResult.issues.find((entry) => entry.code === 'U026')
  assert.ok(u026)
  assert.equal(u026.severity, 'error')
  assert.equal(u026.line, 2)

  const unlisted = await writePackage(t, {
    'debian/patches/series': '',
    'debian/patches/0002-extra.patch': PATCH,
  })
  const unlistedResult = await lintPackage({ path: unlisted })
  assert.ok(unlistedResult.issues.some((entry) => entry.code === 'U027' && entry.file.endsWith('0002-extra.patch')))

  const noDescription = await writePackage(t, {
    'debian/patches/0001-fix-build.patch': 'Origin: upstream\nForwarded: not-needed\n\n--- a/x\n+++ b/x\n',
  })
  const noDescriptionResult = await lintPackage({ path: noDescription })
  assert.ok(noDescriptionResult.issues.some((entry) => entry.code === 'U028'))
  assert.ok(!noDescriptionResult.issues.some((entry) => entry.code === 'U029'))
})

test('unknown DEP-8 restrictions are errors', async (t) => {
  const root = await writePackage(t, {
    'debian/tests/control': 'Tests: smoke\nDepends: @\nRestrictions: superficial, teleport\n',
  })
  const result = await lintPackage({ path: root })
  const unknown = result.issues.filter((entry) => entry.code === 'U033')
  assert.equal(unknown.length, 1)
  assert.equal(unknown[0].severity, 'error')
  assert.match(unknown[0].message, /teleport/)
})

test('strict turns warnings into a failing result', async (t) => {
  const root = await writePackage(t, { 'debian/changelog': CHANGELOG.replace('resolute;', 'UNRELEASED;') })
  assert.equal((await lintPackage({ path: root })).ok, true)
  assert.equal((await lintPackage({ path: root, strict: true })).ok, false)
  assert.equal((await lintPackage({ path: root, strict: false })).warningCount, 1)
})

test('issues are sorted by file and line', async (t) => {
  const root = await writePackage(t, {
    'debian/control': CONTROL.replace('Standards-Version: 4.7.4\n', ''),
    'debian/rules': '#!/usr/bin/make -f\n\nbuild:\n\t./configure\n',
    'debian/watch': 'version=4\nhttp://ftp.gnu.org/gnu/hello/ (.+)\\.tar\\.gz\n',
  })
  const result = await lintPackage({ path: root })
  const sorted = [...result.issues].sort((left, right) => {
    const file = left.file.localeCompare(right.file)
    if (file !== 0) return file
    return (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER)
  })
  assert.deepEqual(result.issues.map((entry) => entry.file), sorted.map((entry) => entry.file))
  assert.deepEqual(result.issues.map((entry) => entry.line), sorted.map((entry) => entry.line))
})

test('the debian/ directory can be passed directly', async (t) => {
  const root = await writePackage(t)
  const result = await lintPackage({ path: join(root, 'debian') })
  assert.equal(result.path, root)
  assert.equal(result.errorCount, 0)
})

test('a missing path throws an Error naming the path', async () => {
  const missing = join(tmpdir(), 'definitely-missing-ubuntu-package')
  await assert.rejects(
    () => lintPackage({ path: missing }),
    (error) => error instanceof Error && error.message.includes(missing),
  )
})

test('secondary rules cover the remaining contract table', async (t) => {
  const codesOf = async (overrides) => codes(await lintPackage({ path: await writePackage(t, overrides) }))

  assert.ok((await codesOf({ 'debian/changelog': CHANGELOG.replace('2.10-0ubuntu1', '2.10') })).includes('U003'))

  const isoDate = CHANGELOG.replace('Thu, 13 Nov 2026 10:00:00 +0800', '2026-11-13T10:00:00+08:00')
  assert.ok((await codesOf({ 'debian/changelog': isoDate })).includes('U006'))

  const noDate = CHANGELOG.replace(
    ' -- Jane Doe <jane@example.com>  Thu, 13 Nov 2026 10:00:00 +0800',
    ' -- Jane Doe <jane@example.com>',
  )
  assert.ok((await codesOf({ 'debian/changelog': noDate })).includes('U007'))

  assert.ok((await codesOf({ 'debian/source/format': '1.0\n' })).includes('source-format-1.0'))

  assert.ok((await codesOf({
    'debian/control': CONTROL.replace('Standards-Version: 4.7.4', 'Standards-Version: 4.6.2'),
  })).includes('U008'))

  assert.ok((await codesOf({ 'debian/compat': '13\n' })).includes('U009'))

  const oldCompat = await codesOf({
    'debian/compat': '12\n',
    'debian/control': CONTROL.replace('debhelper-compat (= 13), ', ''),
  })
  assert.ok(oldCompat.includes('package-uses-old-debhelper-compat-version'))
  assert.ok(!oldCompat.includes('debhelper-compat-file-is-missing'))

  const sourceOnly = `${CONTROL.split('\n').slice(0, 10).join('\n')}\n`
  assert.ok((await codesOf({ 'debian/control': sourceOnly })).includes('U010'))

  const controlCodes = await codesOf({
    'debian/control': CONTROL
      .replace('Architecture: any\n', '')
      .replace('Description: Classic greeting program', 'Description: classic greeting program.')
      .replace('Homepage: https://www.gnu.org/software/hello/\n', '')
      .replace('Vcs-Git: https://git.example.org/hello.git\n', '')
      .replace('Vcs-Browser: https://git.example.org/hello\n', ''),
  })
  for (const code of ['U011', 'U013', 'U014', 'U015']) {
    assert.ok(controlCodes.includes(code), `expected ${code}`)
  }

  assert.ok((await codesOf({ 'debian/rules': '\n%:\n\tdh $@\n' })).includes('U019'))

  const copyrightCodes = await codesOf({
    'debian/copyright': 'Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\n',
  })
  assert.ok(copyrightCodes.includes('U021'))
  assert.ok(copyrightCodes.includes('U022'))

  assert.ok((await codesOf({ 'debian/watch': WATCH.replace('version=4\n', '') })).includes('U023'))

  assert.ok((await codesOf({ 'debian/tests/control': 'Depends: @\n' })).includes('U032'))
  assert.ok(!(await codesOf({ 'debian/tests/control': 'Tests: smoke\n' })).includes('U032'))
  assert.ok((await codesOf({ 'debian/tests/control': 'Tests: ghost\nDepends: @\n' })).includes('U034'))

  const notExecutable = await writePackage(t, {
    'debian/tests/control': 'Tests: other\nDepends: @\n',
    'debian/tests/other': '#!/bin/sh\ntrue\n',
  })
  const notExecutableCodes = codes(await lintPackage({ path: notExecutable }))
  if (process.platform === 'win32') {
    // Windows stores no POSIX execute bit, so U035 is intentionally skipped.
    assert.ok(!notExecutableCodes.includes('U035'))
  } else {
    assert.ok(notExecutableCodes.includes('U035'))
  }

  const noShebang = await writePackage(t, {
    'debian/tests/control': 'Tests: other\nDepends: @\n',
    'debian/tests/other': 'echo hi\n',
  })
  await chmod(join(noShebang, 'debian/tests/other'), 0o755)
  assert.ok(codes(await lintPackage({ path: noShebang })).includes('U036'))

  assert.ok((await codesOf({ 'debian/hello.install': 'usr/bin/definitely-missing\n' })).includes('U038'))
})

test('watch capture groups may live in the URL and watch issue lines point at the real entries', async (t) => {
  const urlCapture = await writePackage(t, {
    'debian/watch': 'version=4\nhttps://ftp.gnu.org/gnu/hello/hello-(.+)\\.tar\\.gz\n',
  })
  const urlResult = await lintPackage({ path: urlCapture })
  assert.ok(!urlResult.issues.some((entry) => entry.code === 'U025'))
  assert.equal(urlResult.errorCount, 0)
  assert.equal(urlResult.warningCount, 0)

  const patternCapture = await writePackage(t, {
    'debian/watch': 'version=4\nhttps://example.org/hello/ hello-([\\d.]+)\\.tar\\.gz\n',
  })
  assert.ok(!codes(await lintPackage({ path: patternCapture })).includes('U025'))

  const noCapture = await writePackage(t, {
    'debian/watch': 'version=4\n# comment\nhttps://ftp.gnu.org/gnu/hello/hello.tar.gz\n',
  })
  const u025 = (await lintPackage({ path: noCapture })).issues.find((entry) => entry.code === 'U025')
  assert.ok(u025)
  assert.equal(u025.line, 3)
  assert.match(u025.message, /hello\.tar\.gz/)

  const insecure = await writePackage(t, {
    'debian/watch': 'version=4\n# comment\nhttp://ftp.gnu.org/gnu/hello/ hello-([\\d.]+)\\.tar\\.gz\n',
  })
  const u024 = (await lintPackage({ path: insecure })).issues.find((entry) => entry.code === 'U024')
  assert.ok(u024)
  assert.equal(u024.line, 3)

  const oldVersion = await writePackage(t, {
    'debian/watch': '# comment\nversion=3\nhttps://example.org/ (.+)\\.tar\\.gz\n',
  })
  const u023 = (await lintPackage({ path: oldVersion })).issues.find((entry) => entry.code === 'U023')
  assert.ok(u023)
  assert.equal(u023.line, 2)

  const noVersion = await writePackage(t, {
    'debian/watch': 'https://example.org/ (.+)\\.tar\\.gz\n',
  })
  const missingVersion = (await lintPackage({ path: noVersion })).issues.find((entry) => entry.code === 'U023')
  assert.ok(missingVersion)
  assert.equal(missingVersion.line, 1)
})

const HELLO_CHANGELOG = [
  'hello (2.10-2ubuntu1) resolute; urgency=medium',
  '',
  '  * New upstream release.',
  '',
  ' -- Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>  Thu, 13 Nov 2026 10:00:00 +0800',
  '',
  'hello-debhelper (1.3-17) frozen unstable; urgency=low',
  '',
  '  * Historical Debian entry.',
  '',
  ' -- Old Maintainer <old@example.com>  Mon, 01 Jan 2001 00:00:00 +0000',
  '',
].join('\n')

const HELLO_COPYRIGHT = [
  'This package was debianized by the Debian hello maintainers.',
  '',
  'It was downloaded from https://www.gnu.org/software/hello/',
  '',
  'Upstream Author: The GNU Project',
  '',
  'Copyright: 1992-2026 Free Software Foundation, Inc.',
  '',
  'This program is free software; you can redistribute it and/or modify',
  'it under the terms of the GNU General Public License as published by',
  'the Free Software Foundation; either version 3, or (at your option)',
  'any later version.',
  '',
].join('\n')

test('the official hello-2.10 shape lints with 0 errors and 0 warnings', async (t) => {
  const root = await writePackage(t, {
    'debian/changelog': HELLO_CHANGELOG,
    'debian/control': CONTROL
      .replace('Standards-Version: 4.7.4', 'Standards-Version: 4.6.2')
      .replace('Rules-Requires-Root: no', 'Rules-Requires-Root: no\nTestsuite: autopkgtest')
      .replace('Description: Classic greeting program', 'Description: example package based on GNU hello'),
    'debian/copyright': HELLO_COPYRIGHT,
    'debian/watch': 'version=4\nhttps://ftp.gnu.org/gnu/hello/hello-(.+)\\.tar\\.gz\n',
    'debian/patches/series': 'fix-manpage.patch\n',
    'debian/patches/0001-fix-build.patch': null,
    'debian/patches/fix-manpage.patch': [
      'Description: Install the manpage in the correct directory',
      '',
      '--- a/hello.1',
      '+++ b/hello.1',
      '',
    ].join('\n'),
    'debian/tests/control': [
      'Test-Command: hello',
      'Restrictions: superficial',
      '',
      'Tests: upstream',
      'Restrictions: superficial',
      '',
    ].join('\n'),
    'debian/tests/upstream': '#!/bin/sh\nset -eu\nhello --version\n',
  })
  await chmod(join(root, 'debian/tests/upstream'), 0o755)

  const result = await lintPackage({ path: root })
  assert.equal(result.ok, true)
  assert.equal(result.errorCount, 0)
  assert.equal(result.warningCount, 0)
  assert.ok(!result.issues.some((entry) => entry.code === 'U001'), 'multi-codename distributions must parse')
  assert.ok(!result.issues.some((entry) => entry.code === 'U032'), 'Test-Command is valid DEP-8')
  assert.deepEqual(
    [...new Set(result.issues.map((entry) => entry.code))].sort(),
    ['U008', 'U013', 'U020', 'U021', 'U022', 'U029', 'U030', 'U039'],
  )
  for (const code of ['U013', 'U020', 'U021', 'U022', 'U029', 'U030']) {
    assert.equal(result.issues.find((entry) => entry.code === code).severity, 'info', code)
  }

  const summary = changelogSummary((await loadPackage(root)).parsed.changelog)
  assert.deepEqual(summary.distributions, ['resolute'])
})

test('DEP-8 Test-Command entries need neither Tests nor Depends', async (t) => {
  const root = await writePackage(t, {
    'debian/tests/control': [
      'Test-Command: hello',
      'Restrictions: superficial',
      '',
      'Tests: smoke',
      'Restrictions: superficial',
      '',
    ].join('\n'),
  })
  const pkg = await loadPackage(root)
  const result = await lintPackage({ path: root })
  assert.ok(!result.issues.some((entry) => entry.code === 'U032'))
  const summary = testsSummary(pkg)
  assert.deepEqual(summary.testCommands, ['hello'])
  assert.equal(summary.entries[0].testCommand, 'hello')
  assert.deepEqual(summary.entries[0].depends, [])

  // A Test-Command value is a shell command, never a script filename.
  const commandOnly = await writePackage(t, {
    'debian/tests/control': 'Test-Command: definitely-not-a-script\nRestrictions: superficial\n',
  })
  const commandCodes = codes(await lintPackage({ path: commandOnly }))
  assert.ok(!commandCodes.includes('U032'))
  assert.ok(!commandCodes.includes('U034'))
})

test('traditional copyright is informational while incomplete DEP-5 stays a warning', async (t) => {
  const traditional = await writePackage(t, { 'debian/copyright': HELLO_COPYRIGHT })
  const traditionalResult = await lintPackage({ path: traditional })
  for (const code of ['U020', 'U021', 'U022']) {
    const entry = traditionalResult.issues.find((issue) => issue.code === code)
    assert.ok(entry, code)
    assert.equal(entry.severity, 'info', code)
  }
  assert.equal(traditionalResult.warningCount, 0)

  const incomplete = await writePackage(t, {
    'debian/copyright': 'Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\nUpstream-Name: hello\n',
  })
  const incompleteResult = await lintPackage({ path: incomplete })
  for (const code of ['U021', 'U022']) {
    const entry = incompleteResult.issues.find((issue) => issue.code === code)
    assert.ok(entry, code)
    assert.equal(entry.severity, 'warning', code)
  }
})

test('a multi-codename distribution is legal and never raises U001/U004', async (t) => {
  const root = await writePackage(t, {
    'debian/changelog': CHANGELOG.replace('resolute;', 'frozen unstable;'),
  })
  const result = await lintPackage({ path: root })
  assert.ok(!result.issues.some((entry) => entry.code === 'U001'))
  assert.ok(!result.issues.some((entry) => entry.code === 'U004'))
  assert.equal(result.ok, true)
})

test('historical changelog formats never make the current package an error', async (t) => {
  const legacy = await writePackage(t, {
    'debian/changelog': CHANGELOG
      + '\nhello (1.3-6); priority=LOW\n\n  * Ancient entry.\n\n -- Old Maintainer <old@example.com>  Mon, 01 Jan 2001 00:00:00 +0000\n',
  })
  const legacyResult = await lintPackage({ path: legacy })
  assert.equal(legacyResult.ok, true)
  assert.equal(legacyResult.errorCount, 0)
  assert.equal(legacyResult.warningCount, 0)
  assert.ok(!legacyResult.issues.some((entry) => entry.code === 'U001'))
  assert.ok(!legacyResult.issues.some((entry) => entry.code === 'U004'))
  const pkg = await loadPackage(legacy)
  assert.equal(pkg.parsed.changelog.entries.length, 2)
  assert.deepEqual(pkg.parsed.changelog.entries[1].distributions, [])
  assert.equal(pkg.parsed.changelog.entries[1].distribution, '')

  const malformedHistory = await writePackage(t, {
    'debian/changelog': CHANGELOG
      + '\nnot a changelog header at all\n\n  * Ancient entry.\n\n -- Old Maintainer <old@example.com>  Mon, 01 Jan 2001 00:00:00 +0000\n',
  })
  const malformedHistoryResult = await lintPackage({ path: malformedHistory })
  assert.equal(malformedHistoryResult.ok, true)
  assert.equal(malformedHistoryResult.errorCount, 0)
  assert.ok(!malformedHistoryResult.issues.some((entry) => entry.code === 'U001'))

  const brokenCurrent = await writePackage(t, {
    'debian/changelog': 'this is not a changelog header\n\n  * Broken.\n',
  })
  const brokenCurrentResult = await lintPackage({ path: brokenCurrent })
  const u001 = brokenCurrentResult.issues.find((entry) => entry.code === 'U001')
  assert.ok(u001)
  assert.equal(u001.severity, 'error')
  assert.equal(brokenCurrentResult.errorCount, 1)
})
