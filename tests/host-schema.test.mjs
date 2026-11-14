/**
 * Guard the tool schemas against the real DSH schema compiler.
 *
 * DSH's `defineTool` does not accept raw JSON Schema: `output.schema` is written
 * in the `ValueSchemaSpec` authoring DSL, where every `type: 'object'` must
 * declare a boolean `additionalProperties`, `oneOf` cannot sit beside `type`,
 * and `required: true` is only allowed on property-map entries. A schema that
 * merely looks like JSON Schema fails during plugin activation.
 *
 * Two guards live here:
 * 1. a fast, host-independent audit of the definitions our plugin registers;
 * 2. a real-host compile through the `@deepseek-ai/dsh-tools` buried in the
 *    installed DeepSeek Harness asar (skipped when the host is absent).
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as plugin from '../lib/index.js'

const PLUGIN_ENTRY = fileURLToPath(new URL('../lib/index.js', import.meta.url))
const APP_ROOT = process.env.DSH_APP_ROOT ?? '/Applications/DeepSeek Harness.app'
const HOST_ELECTRON = join(APP_ROOT, 'Contents/MacOS/DeepSeek Harness')
const HOST_ASAR = join(APP_ROOT, 'Contents/Resources/app.asar')
const HOST_TOOLS_ENTRY = join(HOST_ASAR, 'dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js')
const RESULT_PREFIX = 'DSH_HOST_SCHEMA_RESULT '

const ANNOTATIONS = new Set(['description', 'title', 'default', 'examples'])
const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null'])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function collectDefinitions() {
  const definitions = []
  const disposers = []
  const ctx = {
    tools: {
      register(definition) {
        definitions.push(definition)
        return () => {}
      },
    },
    effect(callback) {
      disposers.push(callback())
      return disposers.at(-1)
    },
    get() {
      return undefined
    },
    logger: { warn() {} },
  }
  await plugin.apply(ctx)
  return definitions
}

function auditEnum(node, path, problems) {
  if (!Array.isArray(node.enum)) {
    problems.push(`${path}.enum must be an array`)
    return
  }
  const matches = node.enum.every((value) => {
    switch (node.type) {
      case 'string': return typeof value === 'string'
      case 'number': return typeof value === 'number' && Number.isFinite(value)
      case 'integer': return typeof value === 'number' && Number.isInteger(value)
      case 'boolean': return typeof value === 'boolean'
      case 'null': return value === null
      default: return false
    }
  })
  if (!matches) problems.push(`${path}.enum values must match type ${node.type}`)
}

function auditValueSpec(node, path, problems, propertyEntry = false) {
  if (!isPlainObject(node)) {
    problems.push(`${path} must be a value-schema object`)
    return
  }
  const allowed = new Set(['type', 'oneOf', 'properties', 'items', 'enum', 'const', 'additionalProperties', ...ANNOTATIONS])
  if (propertyEntry) allowed.add('required')
  for (const key of Object.keys(node)) {
    if (!allowed.has(key)) problems.push(`${path}.${key} is not supported by the value-schema DSL`)
  }
  if (!propertyEntry && Object.hasOwn(node, 'required')) {
    problems.push(`${path}.required is only allowed on a property entry`)
  }

  const hasType = Object.hasOwn(node, 'type')
  const hasOneOf = Object.hasOwn(node, 'oneOf')
  if (hasType && hasOneOf) {
    problems.push(`${path} cannot declare both type and oneOf`)
    return
  }
  if (hasOneOf) {
    for (const key of ['properties', 'additionalProperties', 'items', 'enum', 'const']) {
      if (Object.hasOwn(node, key)) problems.push(`${path}.${key} is not supported beside oneOf`)
    }
    if (!Array.isArray(node.oneOf) || node.oneOf.length < 2) {
      problems.push(`${path}.oneOf must have at least two branches`)
      return
    }
    node.oneOf.forEach((branch, index) => auditValueSpec(branch, `${path}.oneOf[${index}]`, problems))
    return
  }
  if (!hasType) {
    problems.push(`${path} must declare type or oneOf`)
    return
  }

  if (node.type === 'object') {
    if (typeof node.additionalProperties !== 'boolean') {
      problems.push(`${path}.additionalProperties must be explicitly true or false`)
    }
    for (const key of Object.keys(node)) {
      if (!['type', 'properties', 'additionalProperties', ...ANNOTATIONS, ...(propertyEntry ? ['required'] : [])].includes(key)) {
        problems.push(`${path}.${key} is not valid on an object schema`)
      }
    }
    if (Object.hasOwn(node, 'properties')) auditPropertyMap(node.properties, `${path}.properties`, problems)
    return
  }
  if (node.type === 'array') {
    for (const key of Object.keys(node)) {
      if (!['type', 'items', ...ANNOTATIONS, ...(propertyEntry ? ['required'] : [])].includes(key)) {
        problems.push(`${path}.${key} is not valid on an array schema`)
      }
    }
    if (Object.hasOwn(node, 'items')) auditValueSpec(node.items, `${path}.items`, problems)
    return
  }
  if (node.type === 'json') {
    for (const key of Object.keys(node)) {
      if (!['type', ...ANNOTATIONS, ...(propertyEntry ? ['required'] : [])].includes(key)) {
        problems.push(`${path}.${key} is not valid on a json schema`)
      }
    }
    return
  }
  if (!SCALAR_TYPES.has(node.type)) {
    problems.push(`${path}.type "${node.type}" is not supported by the value-schema DSL`)
    return
  }
  for (const key of Object.keys(node)) {
    if (!['type', 'enum', 'const', ...ANNOTATIONS, ...(propertyEntry ? ['required'] : [])].includes(key)) {
      problems.push(`${path}.${key} is not valid on a ${node.type} schema`)
    }
  }
  if (Object.hasOwn(node, 'enum')) auditEnum(node, path, problems)
}

function auditPropertyMap(map, path, problems) {
  if (!isPlainObject(map)) {
    problems.push(`${path} must be a property map`)
    return
  }
  for (const [key, entry] of Object.entries(map)) {
    if (!isPlainObject(entry)) {
      problems.push(`${path}.${key} must be a value-schema object`)
      continue
    }
    if (Object.hasOwn(entry, 'required') && entry.required !== true) {
      problems.push(`${path}.${key}.required must be true when present`)
    }
    auditValueSpec(entry, `${path}.${key}`, problems, true)
  }
}

/** Raw JSON Schema subset the host accepts after DSL compilation. */
function auditRawSchema(node, path, problems) {
  if (!isPlainObject(node)) {
    problems.push(`${path} must be a schema object`)
    return
  }
  if (Object.hasOwn(node, 'additionalProperties') && typeof node.additionalProperties !== 'boolean') {
    problems.push(`${path}.additionalProperties must be boolean`)
  }
  if (Object.hasOwn(node, 'type') && Object.hasOwn(node, 'oneOf')) {
    problems.push(`${path} cannot declare both type and oneOf`)
  }
  if (Object.hasOwn(node, 'required')
    && (!Array.isArray(node.required) || node.required.some((entry) => typeof entry !== 'string'))) {
    problems.push(`${path}.required must be an array of property names`)
  }
  if (isPlainObject(node.properties)) {
    for (const [key, child] of Object.entries(node.properties)) auditRawSchema(child, `${path}.properties.${key}`, problems)
  }
  if (Object.hasOwn(node, 'items')) auditRawSchema(node.items, `${path}.items`, problems)
  if (Array.isArray(node.oneOf)) {
    node.oneOf.forEach((branch, index) => auditRawSchema(branch, `${path}.oneOf[${index}]`, problems))
  }
}

function isCompiledDefinition(definition) {
  return isPlainObject(definition.parameters)
    && definition.parameters.type === 'object'
    && isPlainObject(definition.parameters.properties)
}

test('every authored tool schema obeys the DSH value-schema DSL', async () => {
  const definitions = await collectDefinitions()
  assert.equal(definitions.length, 6)
  assert.deepEqual(
    definitions.map((definition) => definition.name).sort(),
    [
      'ubuntu_build_plan',
      'ubuntu_diagnose_build',
      'ubuntu_inspect_package',
      'ubuntu_lint_package',
      'ubuntu_scaffold_package',
      'ubuntu_test_plan',
    ],
  )

  for (const definition of definitions) {
    const problems = []
    if (isCompiledDefinition(definition)) {
      auditRawSchema(definition.parameters, `${definition.name}.parameters`, problems)
      auditRawSchema(definition.output.schema, `${definition.name}.output.schema`, problems)
    } else {
      auditPropertyMap(definition.parameters, `${definition.name}.parameters`, problems)
      auditValueSpec(definition.output.schema, `${definition.name}.output.schema`, problems)
    }
    assert.deepEqual(problems, [], `${definition.name}: ${problems.join('; ')}`)
  }
  assert.ok(!JSON.stringify(definitions).includes('"additionalProperties":{}'))
})

test('the reported patches.dep3 schema regression stays fixed', async () => {
  const definitions = await collectDefinitions()
  const inspect = definitions.find((definition) => definition.name === 'ubuntu_inspect_package')
  assert.ok(inspect)
  const dep3 = inspect.output.schema.properties.patches.properties.dep3
  assert.equal(dep3.type, 'object')
  assert.equal(dep3.additionalProperties, true, 'dep3 must stay an explicitly open object')
  assert.equal(typeof dep3.description, 'string')
  assert.match(dep3.description, /DEP-3/)
})

/**
 * Child process that loads the real dsh-tools from the installed Harness asar
 * (plain Node cannot read inside an asar). It registers our plugin against a
 * capturing context and compiles every definition with the real `defineTool`.
 */
const CHILD_SOURCE = [
  "import { pathToFileURL } from 'node:url'",
  '',
  'const toolsModule = await import(pathToFileURL(process.env.DSH_TOOLS_ENTRY).href)',
  'const plugin = await import(pathToFileURL(process.env.PLUGIN_ENTRY).href)',
  '',
  'const definitions = []',
  'const disposers = []',
  'const ctx = {',
  '  tools: { register(definition) { definitions.push(definition); return () => {} } },',
  '  effect(callback) { disposers.push(callback()); return disposers[disposers.length - 1] },',
  '  get() { return undefined },',
  '  logger: { warn() {} },',
  '}',
  'await plugin.apply(ctx)',
  '',
  'const precompiled = definitions.length > 0',
  '  && definitions[0].parameters !== null',
  '  && typeof definitions[0].parameters === "object"',
  '  && definitions[0].parameters.type === "object"',
  '  && typeof definitions[0].parameters.properties === "object"',
  '',
  'const compiledTools = []',
  'const results = []',
  'for (const definition of definitions) {',
  '  if (precompiled) {',
  '    compiledTools.push(definition)',
  '    results.push({ name: definition.name, ok: true, precompiled: true })',
  '    continue',
  '  }',
  '  try {',
  '    compiledTools.push(toolsModule.defineTool(definition))',
  '    results.push({ name: definition.name, ok: true })',
  '  } catch (error) {',
  '    results.push({',
  '      name: definition.name,',
  '      ok: false,',
  '      message: error && error.message ? error.message : String(error),',
  '      violations: error && Array.isArray(error.violations) ? error.violations : [],',
  '    })',
  '  }',
  '}',
  '',
  'const problems = []',
  'function walk(node, path) {',
  '  if (node === null || typeof node !== "object") return',
  '  if (Array.isArray(node)) {',
  '    node.forEach(function (value, index) { walk(value, path + "[" + index + "]") })',
  '    return',
  '  }',
  '  if (Object.hasOwn(node, "additionalProperties") && typeof node.additionalProperties !== "boolean") {',
  '    problems.push(path + ".additionalProperties is not boolean")',
  '  }',
  '  if (Object.hasOwn(node, "type") && Object.hasOwn(node, "oneOf")) {',
  '    problems.push(path + " declares both type and oneOf")',
  '  }',
  '  if (node.properties !== null && typeof node.properties === "object") {',
  '    Object.keys(node.properties).forEach(function (key) {',
  '      walk(node.properties[key], path + ".properties." + key)',
  '    })',
  '  }',
  '  if (Object.hasOwn(node, "items")) walk(node.items, path + ".items")',
  '  if (Array.isArray(node.oneOf)) {',
  '    node.oneOf.forEach(function (value, index) { walk(value, path + ".oneOf[" + index + "]") })',
  '  }',
  '}',
  'for (let index = 0; index < compiledTools.length; index += 1) {',
  '  walk(compiledTools[index].parameters, "tool[" + index + "].parameters")',
  '  walk(compiledTools[index].output.schema, "tool[" + index + "].output.schema")',
  '}',
  'const serialized = JSON.stringify(compiledTools)',
  'if (serialized.includes(\'"additionalProperties":{}\')) {',
  '  problems.push("compiled schema contains an empty additionalProperties object")',
  '}',
  'console.log(process.env.DSH_RESULT_PREFIX + JSON.stringify({',
  '  count: definitions.length,',
  '  precompiled: precompiled,',
  '  results: results,',
  '  problems: problems,',
  '}))',
  '',
].join('\n')

test('all six tool definitions compile with the real host defineTool', async (t) => {
  if (!existsSync(HOST_ELECTRON) || !existsSync(HOST_ASAR)) {
    t.skip(`no installed DSH host at ${APP_ROOT}; the real-host compile check is skipped`)
    return
  }

  const root = await mkdtemp(join(tmpdir(), 'dsh-host-schema-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const script = join(root, 'probe.mjs')
  await writeFile(script, CHILD_SOURCE, 'utf8')

  const result = spawnSync(HOST_ELECTRON, [script], {
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      DSH_TOOLS_ENTRY: HOST_TOOLS_ENTRY,
      PLUGIN_ENTRY,
      DSH_RESULT_PREFIX: RESULT_PREFIX,
    },
  })
  assert.equal(result.error, undefined, `failed to spawn the host: ${result.error?.message}`)
  assert.equal(result.status, 0, `host probe exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)

  const line = String(result.stdout).split('\n').find((entry) => entry.startsWith(RESULT_PREFIX))
  assert.ok(line, `host probe printed no result\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  const payload = JSON.parse(line.slice(RESULT_PREFIX.length))

  assert.equal(payload.count, 6)
  assert.deepEqual(
    payload.results.map((entry) => entry.ok),
    [true, true, true, true, true, true],
    `real-host compile failures: ${JSON.stringify(payload.results, null, 2)}`,
  )
  assert.deepEqual(payload.problems, [])
  assert.ok(!JSON.stringify(payload).includes('"additionalProperties":{}'))
})
