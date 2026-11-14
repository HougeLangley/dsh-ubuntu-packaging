import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as plugin from '../lib/index.js'

const TOOL_NAMES = [
  'ubuntu_build_plan',
  'ubuntu_diagnose_build',
  'ubuntu_inspect_package',
  'ubuntu_lint_package',
  'ubuntu_scaffold_package',
  'ubuntu_test_plan',
]

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

const VALID = {
  'debian/changelog': [
    'hello (2.10-0ubuntu1) resolute; urgency=medium',
    '',
    '  * Initial packaging.',
    '',
    ' -- Jane Doe <jane@example.com>  Thu, 13 Nov 2026 10:00:00 +0800',
    '',
  ].join('\n'),
  'debian/control': CONTROL,
  'debian/copyright': [
    'Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/',
    'Upstream-Name: hello',
    'Source: https://www.gnu.org/software/hello/',
    '',
    'Files: *',
    'Copyright: 2026 Jane Doe <jane@example.com>',
    'License: GPL-3+',
    ' License text.',
    '',
  ].join('\n'),
  'debian/rules': '#!/usr/bin/make -f\n\n%:\n\tdh $@\n',
  'debian/source/format': '3.0 (quilt)\n',
  'debian/watch': 'version=4\nhttps://ftp.gnu.org/gnu/hello/ hello-([\\d.]+)\\.tar\\.gz\n',
  'debian/patches/series': '0001-fix-build.patch\n',
  'debian/patches/0001-fix-build.patch': [
    'Description: Fix the build',
    'Origin: upstream, https://example.org/commit/abc',
    'Forwarded: not-needed',
    '',
    '--- a/Makefile',
    '+++ b/Makefile',
    '',
  ].join('\n'),
  'debian/tests/control': 'Tests: smoke\nDepends: @\nRestrictions: superficial\n',
  'debian/tests/smoke': '#!/bin/sh\nset -eu\ncommand -v hello\n',
}

async function writeFiles(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'ubuntu-index-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const [relative, content] of Object.entries(files)) {
    if (content === null) continue
    const target = join(root, ...relative.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  for (const relative of ['debian/rules', 'debian/tests/smoke']) {
    if (files[relative] === undefined || files[relative] === null) continue
    await chmod(join(root, ...relative.split('/')), 0o755)
  }
  return root
}

function makeContext({ skillMode = 'capture' } = {}) {
  const tools = []
  const effects = []
  const warnings = []
  let skill = null
  let disposed = 0
  const order = []
  const ctx = {
    tools: {
      register(definition) {
        tools.push(definition)
        return () => {
          disposed += 1
          order.push(definition.name)
        }
      },
    },
    effect(callback) {
      effects.push(callback())
      return effects.at(-1)
    },
    get(service) {
      if (service !== 'skills') return undefined
      if (skillMode === 'none') return undefined
      return {
        register(definition) {
          if (skillMode === 'throw') throw new Error('skill service rejected the registration')
          skill = definition
          return () => {
            disposed += 1
            order.push('skill')
          }
        },
      }
    },
    logger: {
      warn(message) {
        warnings.push(message)
      },
    },
  }
  return { ctx, tools, effects, warnings, order, disposed: () => disposed, skill: () => skill }
}

function find(tools, name) {
  const tool = tools.find((candidate) => candidate.name === name)
  assert.ok(tool, `missing tool ${name}`)
  return tool
}

test('the entry exposes the frozen plugin shape', () => {
  assert.equal(plugin.name, 'dsh-ubuntu-packaging')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal(typeof plugin.apply, 'function')
})

test('apply registers six strict tools, one effect and the optional skill', async (t) => {
  const { ctx, tools, effects, warnings, order, disposed, skill } = makeContext()
  await plugin.apply(ctx)

  assert.deepEqual(tools.map((tool) => tool.name).sort(), TOOL_NAMES)
  for (const tool of tools) {
    assert.equal(typeof tool.execute, 'function', `${tool.name} execute`)
    assert.equal(typeof tool.output.render, 'function', `${tool.name} render`)
    assert.equal(tool.output.schema.type, 'object', `${tool.name} root schema`)
    assert.equal(tool.output.schema.additionalProperties, false, `${tool.name} strict schema`)
    assert.equal(typeof tool.description, 'string')
    assert.ok(tool.description.length > 20, `${tool.name} description`)
  }
  assert.equal(find(tools, 'ubuntu_inspect_package').parameters.path.required, true)
  assert.equal(find(tools, 'ubuntu_lint_package').parameters.path.required, true)
  assert.equal(find(tools, 'ubuntu_build_plan').parameters.packageDir.required, true)
  assert.equal(find(tools, 'ubuntu_test_plan').parameters.packageDir.required, true)
  assert.equal(find(tools, 'ubuntu_diagnose_build').parameters.log.required, undefined)
  for (const parameter of ['sourceDir', 'packageName', 'upstreamVersion', 'maintainer', 'license', 'description']) {
    assert.equal(find(tools, 'ubuntu_scaffold_package').parameters[parameter].required, true, parameter)
  }
  assert.equal(effects.length, 1)
  assert.equal(disposed(), 0)

  effects[0]()
  assert.equal(disposed(), skill() ? 7 : 6)
  const expectedOrder = [
    'ubuntu_diagnose_build',
    'ubuntu_test_plan',
    'ubuntu_build_plan',
    'ubuntu_scaffold_package',
    'ubuntu_lint_package',
    'ubuntu_inspect_package',
  ]
  if (skill()) expectedOrder.unshift('skill')
  assert.deepEqual(order, expectedOrder, 'disposers run in reverse registration order')
  assert.ok(warnings.length === 0 || warnings.every((warning) => typeof warning === 'string'))
})

test('a failing or absent skill service only warns and keeps the tools alive', async () => {
  const throwing = makeContext({ skillMode: 'throw' })
  await assert.doesNotReject(() => plugin.apply(throwing.ctx))
  assert.equal(throwing.tools.length, 6)
  assert.ok(throwing.warnings.some((warning) => /skill/.test(warning)))
  assert.doesNotThrow(() => throwing.effects[0]())

  const absent = makeContext({ skillMode: 'none' })
  await assert.doesNotReject(() => plugin.apply(absent.ctx))
  assert.equal(absent.tools.length, 6)
  assert.doesNotThrow(() => absent.effects[0]())
})

test('inspect executes against a real package and renders a summary', async (t) => {
  const root = await writeFiles(t, VALID)
  const { ctx, tools } = makeContext()
  await plugin.apply(ctx)
  const inspect = find(tools, 'ubuntu_inspect_package')
  const execution = { signal: new AbortController().signal }

  const result = await inspect.execute({ path: root }, execution)
  assert.equal(result.path, root)
  assert.equal(result.layout.changelog, true)
  assert.equal(result.layout.sourceFormat, '3.0 (quilt)')
  assert.equal(result.layout.debhelperCompat, '13')
  assert.equal(result.changelog.source, 'hello')
  assert.equal(result.changelog.ubuntuRevision, 'ubuntu1')
  assert.deepEqual(result.changelog.distributions, ['resolute'])
  assert.equal(result.control.packages[0].package, 'hello')
  assert.equal(result.rules.dhSequencer, true)
  assert.equal(result.tests.scripts[0], 'smoke')
  assert.deepEqual(result.tests.testCommands, [])
  assert.deepEqual(result.patches.series, ['0001-fix-build.patch'])
  assert.equal(result.patches.dep3['0001-fix-build.patch'].Description, 'Fix the build')
  assert.equal(result.issues.length, 1)
  assert.equal(result.issues[0].code, 'U039')

  const rendered = inspect.output.render({ path: root }, result)
  assert.equal(rendered[0].type, 'text')
  assert.match(rendered[0].text, /issues: 1/)
  assert.match(rendered[0].text, /debian\/: changelog=true/)
})

test('lint executes and renders failures', async (t) => {
  const empty = await mkdtemp(join(tmpdir(), 'ubuntu-index-empty-'))
  t.after(() => rm(empty, { recursive: true, force: true }))
  const { ctx, tools } = makeContext()
  await plugin.apply(ctx)
  const lint = find(tools, 'ubuntu_lint_package')

  const failing = await lint.execute({ path: empty }, {})
  assert.equal(failing.ok, false)
  assert.equal(failing.errorCount, 4)
  assert.match(lint.output.render({}, failing)[0].text, /FAILED/)
  assert.match(lint.output.render({}, failing)[0].text, /no-debian-changelog/)

  const root = await writeFiles(t, VALID)
  const passing = await lint.execute({ path: root, strict: false }, {})
  assert.equal(passing.ok, true)
  assert.match(lint.output.render({}, passing)[0].text, /OK/)

  await assert.rejects(
    () => lint.execute({ path: join(empty, 'nope') }, {}),
    (error) => error.message.includes('not found'),
  )
  await assert.rejects(
    () => lint.execute({}, {}),
    (error) => error instanceof Error && error.message.includes('"path"'),
  )
})

test('scaffold executes through the tool and rejects invalid input', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'ubuntu-index-scaffold-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const sourceDir = join(base, 'hello-2.10')
  await mkdir(sourceDir)
  const { ctx, tools } = makeContext()
  await plugin.apply(ctx)
  const scaffold = find(tools, 'ubuntu_scaffold_package')

  await assert.rejects(
    () => scaffold.execute({ sourceDir }, {}),
    (error) => error.message.includes('invalid input') && error.message.includes('packageName'),
  )

  const result = await scaffold.execute({
    sourceDir,
    packageName: 'hello',
    upstreamVersion: '2.10',
    maintainer: 'Jane Doe <jane@example.com>',
    license: 'GPL-3+',
    description: 'Classic greeting program',
    tests: false,
  }, {})
  assert.equal(result.packageDir, sourceDir)
  assert.equal(result.created.length, 5)
  assert.equal(result.lint.errorCount, 0)
  assert.ok(result.files['debian/control'].includes('Standards-Version: 4.7.4'))
  const rendered = scaffold.output.render({}, result)[0].text
  assert.match(rendered, /created in/)
  assert.match(rendered, /copyright-license-placeholder/)
})

test('build and test plan tools execute and render their phases', async (t) => {
  const root = await writeFiles(t, VALID)
  const { ctx, tools } = makeContext()
  await plugin.apply(ctx)
  const execution = {}

  const build = await find(tools, 'ubuntu_build_plan').execute({ packageDir: root, mode: 'source+binary', tool: 'sbuild' }, execution)
  assert.equal(build.phases.length, 6)
  assert.equal(build.phases[0].name, 'Install tooling')
  assert.match(
    find(tools, 'ubuntu_build_plan').output.render({}, build)[0].text,
    /## Install tooling/,
  )

  const testPlan = await find(tools, 'ubuntu_test_plan').execute({ packageDir: root, mode: 'qemu' }, execution)
  assert.equal(testPlan.phases.length, 6)
  assert.equal(testPlan.dep8, null)
  assert.match(testPlan.notes.join('\n'), /LC_ALL=C/)
  const rendered = find(tools, 'ubuntu_test_plan').output.render({}, testPlan)[0].text
  assert.match(rendered, /## autopkgtest/)
  assert.match(rendered, /failure triage/)
})

test('test plan exposes a DEP-8 skeleton when tests are missing', async (t) => {
  const root = await writeFiles(t, { 'debian/changelog': VALID['debian/changelog'] })
  const { ctx, tools } = makeContext()
  await plugin.apply(ctx)

  const plan = await find(tools, 'ubuntu_test_plan').execute({ packageDir: root }, {})
  assert.ok(plan.dep8)
  assert.match(plan.dep8.control, /Tests: smoke/)
  assert.match(plan.dep8.script, /hello --version/)
  assert.match(find(tools, 'ubuntu_test_plan').output.render({}, plan)[0].text, /no debian\/tests\/control/)
})

test('diagnose executes from raw text and enforces the input contract', async (t) => {
  const { ctx, tools } = makeContext()
  await plugin.apply(ctx)
  const diagnose = find(tools, 'ubuntu_diagnose_build')
  const result = await diagnose.execute({ log: 'dpkg-checkbuilddeps: error: Unmet build dependencies: libssl-dev' }, {})
  assert.equal(result.findings[0].id, 'missing-build-dep')
  assert.equal(result.summary.phase, 'unknown')
  const rendered = diagnose.output.render({}, result)[0].text
  assert.match(rendered, /phase=unknown/)
  assert.match(rendered, /next actions:/)

  await assert.rejects(() => diagnose.execute({}, {}), /exactly one/)
  await assert.rejects(
    () => diagnose.execute({ log: 'x', path: '/tmp/also-x' }, {}),
    /exactly one/,
  )
})

test('rendered output of every tool is a single text block', async (t) => {
  const root = await writeFiles(t, VALID)
  const { ctx, tools } = makeContext()
  await plugin.apply(ctx)
  const execution = {}

  const calls = {
    ubuntu_inspect_package: { path: root },
    ubuntu_lint_package: { path: root },
    ubuntu_build_plan: { packageDir: root },
    ubuntu_test_plan: { packageDir: root },
    ubuntu_diagnose_build: { log: 'FAIL: test_x' },
  }
  for (const [name, args] of Object.entries(calls)) {
    const tool = find(tools, name)
    const value = await tool.execute(args, execution)
    const rendered = tool.output.render(args, value)
    assert.equal(rendered.length, 1, `${name} render length`)
    assert.equal(rendered[0].type, 'text', `${name} render type`)
    assert.ok(rendered[0].text.length > 10, `${name} render text`)
  }
})

test('the runtime skill registers with the frozen metadata when SKILL.md exists', async (t) => {
  const skillPath = fileURLToPath(new URL('../skills/ubuntu-packaging/SKILL.md', import.meta.url))
  try {
    await stat(skillPath)
  } catch {
    t.skip('skills/ubuntu-packaging/SKILL.md is owned by another worker and is not present yet')
    return
  }

  const content = await readFile(skillPath, 'utf8')
  const { ctx, tools, effects, disposed, skill } = makeContext()
  await plugin.apply(ctx)

  assert.equal(tools.length, 6)
  assert.ok(skill())
  assert.equal(skill().name, 'ubuntu-packaging')
  assert.equal(skill().description, 'Ubuntu packaging: debian/ source packages, dpkg-buildpackage, sbuild, lintian, autopkgtest and release checks.')
  assert.equal(skill().whenToUse, 'Use when inspecting, linting, scaffolding, building, testing or debugging Ubuntu/Debian source packages.')
  assert.equal(skill().source, 'runtime')
  assert.equal(skill().content, content)
  assert.equal(skill().resourceBase.kind, 'directory')
  assert.equal(
    resolve(skill().resourceBase.path),
    resolve(fileURLToPath(new URL('../skills/ubuntu-packaging/', import.meta.url))),
  )
  effects[0]()
  assert.equal(disposed(), 7)
})
