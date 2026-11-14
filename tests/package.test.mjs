import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

test('package metadata targets every DSH 0.2.x release', () => {
  assert.equal(pkg.name, 'dsh-ubuntu-packaging')
  assert.equal(pkg.version, '0.1.1')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.main, './lib/index.js')
  assert.equal(pkg.engines.node, '>=22')
  assert.equal(pkg.engines.dsh, '>=0.2.0-0 <0.3.0-0')
  assert.equal(
    pkg.peerDependencies['@deepseek-ai/dsh-tools'],
    '>=0.2.0-0 <0.3.0-0',
    'the peer range must match engines.dsh',
  )
  assert.equal(pkg.peerDependenciesMeta['@deepseek-ai/dsh-tools'].optional, true)
  assert.equal(pkg.scripts.test, 'node --test "tests/**/*.test.mjs"')
})

test('the bundle entry metadata is intact', () => {
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.repository.url, 'git+https://github.com/HougeLangley/dsh-ubuntu-packaging.git')
  assert.equal(pkg.license, 'MIT')
})
