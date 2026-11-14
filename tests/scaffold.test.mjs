import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { LICENSE_TODO, scaffoldPackage, validateScaffoldInput } from '../lib/scaffold.js'

const BASE_INPUT = {
  packageName: 'hello',
  upstreamVersion: '2.10',
  debianRevision: '0',
  ubuntuRevision: 'ubuntu1',
  distribution: 'resolute',
  maintainer: 'Jane Doe <jane@example.com>',
  homepage: 'https://www.gnu.org/software/hello/',
  license: 'GPL-3+',
  buildSystem: 'autotools',
  architecture: 'any',
  description: 'Classic greeting program',
  buildDepends: ['texinfo'],
  depends: [],
  tests: true,
  native: false,
}

async function makeSource(t, name = 'hello-2.10') {
  const base = await mkdtemp(join(tmpdir(), 'ubuntu-scaffold-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const sourceDir = join(base, name)
  await mkdir(sourceDir)
  return sourceDir
}

test('scaffold writes all seven file classes with contract content', async (t) => {
  const sourceDir = await makeSource(t)
  const result = await scaffoldPackage({ ...BASE_INPUT, sourceDir })

  assert.equal(result.packageDir, sourceDir)
  assert.equal(result.created.length, 8)
  assert.deepEqual(result.created.sort(), [
    'debian/changelog',
    'debian/control',
    'debian/copyright',
    'debian/rules',
    'debian/source/format',
    'debian/tests/control',
    'debian/tests/smoke',
    'debian/watch',
  ])

  const control = result.files['debian/control']
  assert.match(control, /^Source: hello$/m)
  assert.match(control, /^Section: misc$/m)
  assert.match(control, /^Priority: optional$/m)
  assert.match(control, /^Maintainer: Jane Doe <jane@example\.com>$/m)
  assert.match(control, /^Build-Depends: debhelper-compat \(= 13\), texinfo$/m)
  assert.match(control, /^Standards-Version: 4\.7\.4$/m)
  assert.match(control, /^Rules-Requires-Root: no$/m)
  assert.match(control, /^Homepage: https:\/\/www\.gnu\.org\/software\/hello\/$/m)
  assert.match(control, /^Package: hello$/m)
  assert.match(control, /^Architecture: any$/m)
  assert.match(control, /^Depends: \$\{misc:Depends\}, \$\{shlibs:Depends\}$/m)
  assert.match(control, /^Description: Classic greeting program$/m)

  assert.match(result.files['debian/rules'], /^#!\/usr\/bin\/make -f\n/)
  assert.match(result.files['debian/rules'], /%:\n\tdh \$@/)
  assert.equal((await stat(join(sourceDir, 'debian/rules'))).mode & 0o111, 0o111)
  assert.equal(result.files['debian/source/format'], '3.0 (quilt)\n')
  assert.equal(result.files['debian/changelog'].split('\n')[0], 'hello (2.10-0ubuntu1) resolute; urgency=medium')
  assert.match(
    result.files['debian/changelog'],
    / -- Jane Doe <jane@example\.com>  [A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}/,
  )
  assert.match(result.files['debian/copyright'], /^Format: https:\/\/www\.debian\.org\//m)
  assert.match(result.files['debian/copyright'], /^Files: \*$/m)
  assert.match(result.files['debian/copyright'], /^License: GPL-3\+$/m)
  assert.match(result.files['debian/copyright'], new RegExp(LICENSE_TODO))
  assert.match(result.files['debian/watch'], /^version=4$/m)
  assert.match(result.files['debian/watch'], /hello\//)
  assert.match(result.files['debian/watch'], /\(\.\+\)/)
  assert.match(result.files['debian/tests/control'], /^Tests: smoke$/m)
  assert.match(result.files['debian/tests/control'], /^Depends: @$/m)
  assert.match(result.files['debian/tests/control'], /^Restrictions: superficial$/m)
  assert.match(result.files['debian/tests/smoke'], /^#!\/bin\/sh$/m)
  assert.match(result.files['debian/tests/smoke'], /command -v hello/)
  assert.equal((await stat(join(sourceDir, 'debian/tests/smoke'))).mode & 0o111, 0o111)

  assert.equal(result.lint.errorCount, 0)
  assert.equal(result.lint.ok, true)
  assert.equal(result.warnings.length, 1)
  assert.equal(result.warnings[0].code, 'copyright-license-placeholder')
  assert.equal(
    await readFile(join(sourceDir, 'debian/control'), 'utf8'),
    result.files['debian/control'],
  )
})

test('an existing debian/ is refused unless overwrite is true', async (t) => {
  const sourceDir = await makeSource(t)
  await scaffoldPackage({ ...BASE_INPUT, sourceDir })

  await assert.rejects(
    () => scaffoldPackage({ ...BASE_INPUT, sourceDir }),
    (error) => error.message.includes('debian') && error.message.includes('overwrite'),
  )

  const overwritten = await scaffoldPackage({ ...BASE_INPUT, sourceDir, overwrite: true })
  assert.equal(overwritten.created.length, 8)
  assert.ok(overwritten.warnings.some((warning) => warning.code === 'scaffold-overwrote-debian'))
})

test('native packages use a native version and 3.0 (native)', async (t) => {
  const sourceDir = await makeSource(t, 'hello-2.10')
  const result = await scaffoldPackage({
    ...BASE_INPUT,
    sourceDir,
    homepage: null,
    tests: false,
    native: true,
    architecture: 'all',
  })

  assert.equal(result.created.length, 5)
  assert.equal(result.files['debian/source/format'], '3.0 (native)\n')
  assert.equal(result.files['debian/changelog'].split('\n')[0], 'hello (2.10) resolute; urgency=medium')
  assert.equal(result.files['debian/watch'], undefined)
  assert.equal(result.files['debian/tests/control'], undefined)
  assert.match(result.files['debian/control'], /^Depends: \$\{misc:Depends\}$/m)
  assert.ok(result.warnings.some((warning) => warning.code === 'copyright-source-missing'))
  assert.equal(result.lint.errorCount, 0)
})

test('a non-autotools build system gets a commented override stub', async (t) => {
  const sourceDir = await makeSource(t)
  const result = await scaffoldPackage({ ...BASE_INPUT, sourceDir, buildSystem: 'cmake' })

  assert.match(result.files['debian/rules'], /# Build system: cmake/)
  assert.match(result.files['debian/rules'], /# override_dh_auto_configure:/)
  assert.match(result.files['debian/rules'], /#\tdh_auto_configure -- -DCMAKE_BUILD_TYPE=RelWithDebInfo/)
  assert.match(result.files['debian/rules'], /%:\n\tdh \$@/)
})

test('validation collects every input error at once', () => {
  const errors = validateScaffoldInput({})
  assert.ok(Array.isArray(errors))
  assert.ok(errors.length >= 6)
  const joined = errors.join('\n')
  for (const field of ['sourceDir', 'packageName', 'upstreamVersion', 'maintainer', 'license', 'description']) {
    assert.match(joined, new RegExp(field))
  }

  const bad = validateScaffoldInput({
    ...BASE_INPUT,
    sourceDir: tmpdir(),
    packageName: 'Hello',
    upstreamVersion: 'v2.10',
    maintainer: 'Jane Doe',
    buildSystem: 'nix',
    distribution: 'UNRELEASED',
    ubuntuRevision: 'ubuntu',
  }).join('\n')
  assert.match(bad, /packageName/)
  assert.match(bad, /upstreamVersion/)
  assert.match(bad, /maintainer/)
  assert.match(bad, /buildSystem/)
  assert.match(bad, /distribution/)
  assert.match(bad, /ubuntuRevision/)

  const unknownCodename = validateScaffoldInput({
    ...BASE_INPUT,
    sourceDir: tmpdir(),
    distribution: 'atlantis',
  }).join('\n')
  assert.match(unknownCodename, /known Ubuntu codename/)
})

test('scaffoldPackage throws one comma-joined validation error before writing', async (t) => {
  const sourceDir = await makeSource(t)
  await assert.rejects(
    () => scaffoldPackage({ sourceDir, packageName: 'hello' }),
    (error) => error.message.includes('invalid input') && error.message.includes(', ') && error.message.includes('maintainer'),
  )
  await assert.rejects(() => stat(join(sourceDir, 'debian')), (error) => error.code === 'ENOENT')
})

test('a missing sourceDir is reported clearly', async () => {
  await assert.rejects(
    () => scaffoldPackage({ ...BASE_INPUT, sourceDir: join(tmpdir(), 'ubuntu-scaffold-missing-dir') }),
    (error) => error.message.includes('sourceDir does not exist'),
  )
})
