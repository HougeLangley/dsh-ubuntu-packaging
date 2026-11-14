import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compareDottedVersions,
  fieldValue,
  formatRfc5322Date,
  isRfc5322Date,
  parseChangelog,
  parseCompat,
  parseControl,
  parseCopyright,
  parseDeb822,
  parseDep3,
  parseRules,
  parseSeries,
  parseSourceFormat,
  parseTestsControl,
  parseWatch,
  splitVersion,
} from '../lib/parse.js'

const CONTROL = [
  'Source: hello',
  'Section: devel',
  'Build-Depends: debhelper-compat (= 13),',
  ' texinfo,',
  ' libfoo-dev',
  'Description: Classic greeting program',
  ' .',
  ' Long description line.',
  'Homepage: https://www.gnu.org/software/hello/',
  '',
  'Package: hello',
  'Architecture: any',
  'Depends: ${misc:Depends}',
  'Description: Classic greeting program',
].join('\n')

test('parseDeb822 keeps field spelling, joins continuations and turns . into a blank line', () => {
  const parsed = parseDeb822(CONTROL)

  assert.equal(parsed.stanzas.length, 2)
  const source = parsed.stanzas[0]
  assert.equal(source.fields.get('Source'), 'hello')
  assert.equal(fieldValue(source, 'source'), 'hello', 'field lookup is case-insensitive')
  assert.equal(fieldValue(source, 'SOURCE'), 'hello')
  assert.deepEqual(source.order, ['Source', 'Section', 'Build-Depends', 'Description', 'Homepage'])
  assert.equal(
    fieldValue(source, 'Build-Depends'),
    'debhelper-compat (= 13),\ntexinfo,\nlibfoo-dev',
  )
  assert.equal(
    fieldValue(source, 'Description'),
    'Classic greeting program\n\nLong description line.',
  )
  assert.equal(source.lines.start, 1)
  assert.equal(source.lines.fields.get('Build-Depends'), 3)
  assert.equal(parsed.stanzas[1].lines.start, 11)
  assert.deepEqual(parsed.issues, [])
})

test('parseDeb822 reports malformed and orphan continuation lines with line numbers', () => {
  const parsed = parseDeb822('NotAField\n : orphan\nKey: value')
  assert.ok(parsed.issues.length >= 2)
  assert.equal(parsed.issues[0].code, 'deb822-malformed-line')
  assert.equal(parsed.issues[0].line, 1)
  assert.equal(parsed.issues[1].code, 'deb822-continuation-without-field')
  assert.equal(parsed.issues[1].line, 2)
  assert.equal(fieldValue(parsed.stanzas[0], 'Key'), 'value')
})

test('parseControl separates the Source and binary stanzas', () => {
  const parsed = parseControl(CONTROL)
  assert.equal(parsed.stanzas.length, 2)
  assert.equal(fieldValue(parsed.source, 'Source'), 'hello')
  assert.equal(parsed.packages.length, 1)
  assert.equal(fieldValue(parsed.packages[0], 'Package'), 'hello')
  assert.equal(fieldValue(parsed.packages[0], 'Architecture'), 'any')
})

const CHANGELOG = [
  'hello (2.10-0ubuntu2) resolute; urgency=high',
  '',
  '  * Second change.',
  '  * Another line',
  '',
  ' -- Jane Doe <jane@example.com>  Thu, 13 Nov 2026 10:00:00 +0800',
  '',
  'hello (2.10-0ubuntu1) resolute; urgency=medium',
  '',
  '  * First change.',
  '',
  ' -- Jane Doe <jane@example.com>  Wed, 12 Nov 2026 09:00:00 +0800',
  '',
].join('\n')

test('parseChangelog reads multiple entries, changes and the RFC 5322 trailer', () => {
  const parsed = parseChangelog(CHANGELOG)

  assert.equal(parsed.entries.length, 2)
  assert.equal(parsed.source, 'hello')
  assert.equal(parsed.version, '2.10-0ubuntu2')
  assert.equal(parsed.upstreamVersion, '2.10')
  assert.equal(parsed.debianRevision, '0')
  assert.equal(parsed.ubuntuRevision, 'ubuntu2')
  assert.equal(parsed.distribution, 'resolute')
  assert.equal(parsed.urgency, 'high')
  assert.equal(parsed.maintainer, 'Jane Doe <jane@example.com>')
  assert.match(parsed.date, /^Thu, 13 Nov 2026 10:00:00 \+0800$/)
  assert.equal(parsed.entries[0].changes.length, 2)
  assert.equal(parsed.entries[1].changes.length, 1)
  assert.equal(parsed.entries[0].headerLine, 1)
  assert.equal(parsed.entries[0].trailerLine, 6)
  assert.deepEqual(parsed.issues, [])
})

test('parseChangelog reports malformed headers and missing trailers instead of throwing', () => {
  const malformed = parseChangelog('this is not a changelog header')
  assert.equal(malformed.entries.length, 0)
  assert.equal(malformed.issues[0].code, 'changelog-malformed-header')
  assert.equal(malformed.issues[0].line, 1)

  const missingTrailer = parseChangelog('hello (1.0-1) resolute; urgency=medium\n\n  * Change.\n')
  assert.equal(missingTrailer.entries.length, 1)
  assert.equal(missingTrailer.maintainer, null)
  assert.ok(missingTrailer.issues.some((entry) => entry.code === 'changelog-missing-trailer'))
})

test('splitVersion splits epoch, upstream, Debian and Ubuntu revisions', () => {
  const ubuntu = splitVersion('2.10-0ubuntu1')
  assert.equal(ubuntu.epoch, null)
  assert.equal(ubuntu.upstreamVersion, '2.10')
  assert.equal(ubuntu.debianRevision, '0')
  assert.equal(ubuntu.ubuntuRevision, 'ubuntu1')
  assert.equal(ubuntu.native, false)

  const native = splitVersion('1.0')
  assert.equal(native.upstreamVersion, '1.0')
  assert.equal(native.debianRevision, null)
  assert.equal(native.ubuntuRevision, null)
  assert.equal(native.native, true)

  const dfsg = splitVersion('1.0+dfsg1-2')
  assert.equal(dfsg.upstreamVersion, '1.0+dfsg1')
  assert.equal(dfsg.debianRevision, '2')
  assert.equal(dfsg.ubuntuRevision, null)

  const epoch = splitVersion('1:2.10-0ubuntu1')
  assert.equal(epoch.epoch, '1')
  assert.equal(epoch.upstreamVersion, '2.10')
  assert.equal(epoch.debianRevision, '0')
  assert.equal(epoch.ubuntuRevision, 'ubuntu1')

  const tilde = splitVersion('2.0~rc1-0ubuntu1')
  assert.equal(tilde.upstreamVersion, '2.0~rc1')
  assert.equal(tilde.ubuntuRevision, 'ubuntu1')

  const dotted = splitVersion('3.1-1ubuntu2.1')
  assert.equal(dotted.debianRevision, '1')
  assert.equal(dotted.ubuntuRevision, 'ubuntu2.1')

  const ubuntuOnly = splitVersion('1.0-ubuntu1')
  assert.equal(ubuntuOnly.debianRevision, null)
  assert.equal(ubuntuOnly.ubuntuRevision, 'ubuntu1')
})

test('parseRules detects the dh sequencer, overrides, direct calls and the build system', () => {
  const rules = [
    '#!/usr/bin/make -f',
    '',
    'export DEB_BUILD_OPTIONS = nodoc',
    '',
    '%:',
    '\tdh $@',
    '',
    'override_dh_auto_configure:',
    '\tdh_auto_configure -- --buildsystem=cmake',
    '',
    'override_dh_clean:',
    '\tdh_clean -k',
    '',
    'build:',
    '\tdh_auto_build',
  ].join('\n')

  const parsed = parseRules(rules)
  assert.equal(parsed.present, true)
  assert.equal(parsed.shebang, '#!/usr/bin/make -f')
  assert.equal(parsed.dhSequencer, true)
  assert.equal(parsed.hasPercentTarget, true)
  assert.equal(parsed.dhCleanK, true)
  assert.equal(parsed.dhCleanKLine, 12)
  assert.deepEqual(parsed.overrides, ['dh_auto_configure', 'dh_clean'])
  assert.equal(parsed.buildsystem, 'cmake')
  assert.ok(parsed.directDhCalls.some((call) => call.name === 'dh_auto_build' && call.target === 'build'))
  assert.ok(parsed.directDhCalls.some((call) => call.name === 'dh_auto_configure' && call.target === 'override_dh_auto_configure'))
})

test('parseRules reports a recipe that appears before any target', () => {
  const parsed = parseRules('\tdh $@\n')
  assert.equal(parsed.dhSequencer, false)
  assert.equal(parsed.issues[0].code, 'rules-recipe-without-target')
  assert.equal(parsed.issues[0].line, 1)
})

test('parseRules infers python, rust and autotools build systems', () => {
  assert.equal(parseRules('#!/usr/bin/make -f\n%:\n\tdh $@ --buildsystem=pybuild\n').buildsystem, 'python')
  assert.equal(parseRules('#!/usr/bin/make -f\n%:\n\tdh $@\n\nbuild:\n\tcargo build --release\n').buildsystem, 'rust')
  assert.equal(parseRules('#!/usr/bin/make -f\n%:\n\tdh $@\n').buildsystem, 'autotools')
  assert.equal(parseRules('#!/usr/bin/make -f\nbuild:\n\tdh_auto_configure\n').buildsystem, 'autotools')
  assert.equal(parseRules('#!/usr/bin/make -f\nbuild:\n\tdh_auto_configure -- --buildsystem=cmake\n').buildsystem, 'cmake')
  assert.equal(parseRules('#!/usr/bin/make -f\n%:\n\tdh $@\n\nbuild:\n\tgo build ./...\n').buildsystem, 'go')
  assert.equal(parseRules('#!/usr/bin/make -f\n%:\n\tdh $@\n\nbuild:\n\tnpm run build\n').buildsystem, 'node')
  assert.equal(parseRules('#!/usr/bin/make -f\n%:\n\tdh $@\n\nbuild:\n\tmeson setup build\n').buildsystem, 'meson')
  assert.equal(parseRules('#!/usr/bin/make -f\nbuild:\n\t./configure\n').buildsystem, 'custom')
})

test('parseSeries ignores comments and reports entries containing whitespace', () => {
  const parsed = parseSeries('# quilt series\n0001-fix-build.patch\n\n0002-second.patch\n')
  assert.deepEqual(parsed.patches, ['0001-fix-build.patch', '0002-second.patch'])
  assert.equal(parsed.entries[0].line, 2)
  assert.equal(parsed.entries[1].line, 4)
  assert.deepEqual(parsed.issues, [])

  const bad = parseSeries('0001 a.patch\n')
  assert.deepEqual(bad.patches, [])
  assert.equal(bad.issues[0].code, 'series-line-has-whitespace')
})

test('parseDep3 reads Description, Origin, Forwarded, Author, Last-Update and Bug-*', () => {
  const patch = [
    'Description: Fix the build with GCC 15',
    ' Needed because the upstream Makefile hard-codes -Werror.',
    'Origin: upstream, https://example.org/commit/abc123',
    'Forwarded: not-needed',
    'Author: Jane Doe <jane@example.com>',
    'Last-Update: 2026-11-01',
    'Applied-Upstream: 2.11',
    'Bug-Ubuntu: https://bugs.launchpad.net/bugs/1234567',
    '',
    '--- a/Makefile',
    '+++ b/Makefile',
    '@@ -1 +1 @@',
  ].join('\n')

  const parsed = parseDep3(patch)
  assert.match(parsed.description, /^Fix the build with GCC 15\n/)
  assert.equal(parsed.origin, 'upstream, https://example.org/commit/abc123')
  assert.equal(parsed.forwarded, 'not-needed')
  assert.equal(parsed.author, 'Jane Doe <jane@example.com>')
  assert.equal(parsed.lastUpdate, '2026-11-01')
  assert.equal(parsed.appliedUpstream, '2.11')
  assert.equal(parsed.bugs.length, 1)
  assert.equal(parsed.bugs[0].name, 'Bug-Ubuntu')

  const empty = parseDep3('--- a/foo\n+++ b/foo\n')
  assert.equal(empty.description, null)
  assert.equal(empty.origin, null)
})

test('parseWatch reads version, URL lines, patterns and capture groups', () => {
  const parsed = parseWatch([
    'version=4',
    'https://ftp.gnu.org/gnu/hello/ hello-([\\d.]+)\\.tar\\.gz',
    'http://insecure.example.org/ (.+)\\.tar\\.gz',
    'opts=filenamemangle=s/.*/hello.tar.gz/',
  ].join('\n'))

  assert.equal(parsed.version, 4)
  assert.equal(parsed.entries.length, 2)
  assert.equal(parsed.entries[0].url, 'https://ftp.gnu.org/gnu/hello/')
  assert.equal(parsed.entries[0].captureGroup, '[\\d.]+')
  assert.equal(parsed.entries[0].captureGroups, 1)
  assert.equal(parsed.entries[1].url, 'http://insecure.example.org/')
  assert.deepEqual(parsed.issues, [])

  // Watch v4 allows the version capture group in the URL itself.
  const urlCapture = parseWatch('version=4\nhttps://ftp.gnu.org/gnu/hello/hello-(.+)\\.tar\\.gz\n')
  assert.equal(urlCapture.entries[0].pattern, null)
  assert.equal(urlCapture.entries[0].captureGroup, '.+')
  assert.equal(urlCapture.entries[0].captureGroups, 1)
  assert.equal(urlCapture.entries[0].line, 2)
  assert.equal(urlCapture.versionLine, 1)

  // An explicit filename pattern is checked instead of the URL.
  const patternWins = parseWatch('version=4\nhttps://example.org/(.+)/ hello.tar.gz\n')
  assert.equal(patternWins.entries[0].pattern, 'hello.tar.gz')
  assert.equal(patternWins.entries[0].captureGroup, null)
  assert.equal(patternWins.entries[0].captureGroups, 0)

  const oldVersion = parseWatch('# comment\nversion=3\nhttps://example.org/ (.+)\\.tar\\.gz\n')
  assert.equal(oldVersion.version, 3)
  assert.equal(oldVersion.versionLine, 2)
  assert.equal(oldVersion.entries[0].line, 3)

  const missing = parseWatch('https://example.org/ (.+)\\.tar\\.gz\n')
  assert.equal(missing.version, null)
  assert.ok(missing.issues.some((entry) => entry.code === 'watch-missing-version'))

  const malformed = parseWatch('not-a-url foo\n')
  assert.equal(malformed.entries.length, 0)
  assert.equal(malformed.issues[0].code, 'watch-malformed-line')
})

test('parseTestsControl returns DEP-8 entries with Tests, Depends and Restrictions', () => {
  const parsed = parseTestsControl([
    'Tests: smoke',
    'Depends: @, python3-pytest',
    'Restrictions: superficial, needs-root',
    '',
    'Tests: build',
    'Depends: @, build-essential',
    'Restrictions: breaks-testbed',
  ].join('\n'))

  assert.equal(parsed.entries.length, 2)
  assert.deepEqual(parsed.entries[0].tests, ['smoke'])
  assert.deepEqual(parsed.entries[0].depends, ['@', 'python3-pytest'])
  assert.deepEqual(parsed.entries[0].restrictions, ['superficial', 'needs-root'])
  assert.equal(parsed.entries[1].line, 5)
  assert.deepEqual(parsed.issues, [])
})

test('parseCopyright answers the DEP-5 questions and parseCompat/parseSourceFormat read one line', () => {
  const copyright = parseCopyright([
    'Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/',
    'Upstream-Name: hello',
    '',
    'Files: *',
    'Copyright: 2026 Jane Doe',
    'License: GPL-3+',
    ' License text.',
  ].join('\n'))
  assert.match(copyright.format, /copyright-format\/1\.0/)
  assert.equal(copyright.hasFiles, true)
  assert.equal(copyright.hasLicense, true)

  const missing = parseCopyright('Upstream-Name: hello\n\nFiles: *\nLicense: MIT\n')
  assert.equal(missing.format, null)

  assert.equal(parseCompat('# comment\n13\n'), '13')
  assert.equal(parseSourceFormat('# comment\n3.0 (quilt)\n'), '3.0 (quilt)')
})

test('date and version helpers accept the canonical forms', () => {
  assert.equal(isRfc5322Date('Thu, 13 Nov 2026 10:00:00 +0800'), true)
  assert.equal(isRfc5322Date('2026-11-13T10:00:00+0800'), false)
  assert.equal(isRfc5322Date('Thu, 32 Nov 2026 10:00:00 +0800'), false)
  assert.match(formatRfc5322Date(new Date('2026-11-13T02:00:00Z')), /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}$/)
  assert.equal(compareDottedVersions('4.7.4', '4.7.4'), 0)
  assert.equal(compareDottedVersions('4.6.2', '4.7.4'), -1)
  assert.equal(compareDottedVersions('4.8.0', '4.7.4'), 1)
})

test('parseChangelog accepts multi-codename distributions and records distributions', () => {
  const text = [
    'hello (2.10-2ubuntu1) resolute; urgency=medium',
    '',
    '  * Current entry.',
    '',
    ' -- Jane Doe <jane@example.com>  Thu, 13 Nov 2026 10:00:00 +0800',
    '',
    'hello-debhelper (1.3-17) frozen unstable; urgency=low',
    '',
    '  * Historical Debian entry.',
    '',
    ' -- Old Maintainer <old@example.com>  Mon, 01 Jan 2001 00:00:00 +0000',
    '',
  ].join('\n')

  const parsed = parseChangelog(text)
  assert.equal(parsed.entries.length, 2)
  assert.equal(parsed.issues.length, 0, 'a space-separated distribution list is legal')
  assert.deepEqual(parsed.entries[0].distributions, ['resolute'])
  assert.deepEqual(parsed.entries[1].distributions, ['frozen', 'unstable'])
  assert.equal(parsed.entries[1].distribution, 'frozen unstable')
  assert.deepEqual(parsed.distributions, ['resolute'])
})

test('parseTestsControl parses the Test-Command shorthand', () => {
  const parsed = parseTestsControl([
    'Test-Command: hello',
    'Restrictions: superficial',
    '',
    'Tests: upstream',
    'Restrictions: superficial',
  ].join('\n'))

  assert.equal(parsed.entries[0].testCommand, 'hello')
  assert.deepEqual(parsed.entries[0].tests, [])
  assert.deepEqual(parsed.entries[0].depends, [])
  assert.equal(parsed.entries[1].testCommand, null)
  assert.deepEqual(parsed.entries[1].tests, ['upstream'])
  assert.deepEqual(parsed.issues, [])
})

test('parseChangelog best-effort parses early Debian priority= headers', () => {
  const text = [
    'hello (2.10-2ubuntu1) resolute; urgency=medium',
    '',
    '  * Current entry.',
    '',
    ' -- Jane Doe <jane@example.com>  Thu, 13 Nov 2026 10:00:00 +0800',
    '',
    'hello (1.3-6); priority=LOW',
    '',
    '  * Early Debian entry without a distribution.',
    '',
    ' -- Old Maintainer <old@example.com>  Mon, 01 Jan 2001 00:00:00 +0000',
    '',
  ].join('\n')

  const parsed = parseChangelog(text)
  assert.equal(parsed.entries.length, 2)
  assert.equal(parsed.issues.length, 0)
  assert.equal(parsed.entries[1].version, '1.3-6')
  assert.deepEqual(parsed.entries[1].distributions, [])
  assert.equal(parsed.entries[1].distribution, '')
  assert.equal(parsed.entries[1].urgency, 'LOW')
  assert.equal(parsed.distribution, 'resolute')

  const withDistribution = parseChangelog(
    'hello (1.2-3) unstable; priority=low\n\n  * Old.\n\n -- Old <old@example.com>  Mon, 01 Jan 2001 00:00:00 +0000\n',
  )
  assert.equal(withDistribution.entries[0].distribution, 'unstable')
  assert.equal(withDistribution.entries[0].urgency, 'low')
  assert.equal(withDistribution.issues.length, 0)
})
