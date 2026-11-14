/**
 * DSH plugin entry for dsh-ubuntu-packaging.
 *
 * Registers six Host tools plus the optional `ubuntu-packaging` runtime skill.
 * Every registration is owned by a single `ctx.effect`; the collected disposers
 * run in reverse order when the Host unloads the plugin. Tool schemas are
 * compiled by `@deepseek-ai/dsh-tools` when the Host provides it, and degrade
 * to plain definitions otherwise.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildPlan } from './buildplan.js'
import { diagnoseBuild } from './diagnose.js'
import {
  changelogSummary,
  controlSummary,
  DEFAULT_TARGET_RELEASE,
  lintLoadedPackage,
  lintPackage,
  loadPackage,
  rulesSummary,
  testsSummary,
} from './lint.js'
import { scaffoldPackage } from './scaffold.js'
import { testPlan } from './testplan.js'

export const name = 'dsh-ubuntu-packaging'
export const inject = ['tools']

const SKILL_DESCRIPTION =
  'Ubuntu packaging: debian/ source packages, dpkg-buildpackage, sbuild, lintian, autopkgtest and release checks.'
const SKILL_WHEN_TO_USE =
  'Use when inspecting, linting, scaffolding, building, testing or debugging Ubuntu/Debian source packages.'

/* ------------------------------------------------------------------ schemas */

const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }] }
const nullableInteger = { oneOf: [{ type: 'integer' }, { type: 'null' }] }

const issueSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', required: true, description: 'Lintian tag or U### rule code.' },
    severity: { type: 'string', enum: ['error', 'warning', 'info'], required: true },
    rule: { type: 'string', required: true, description: 'Stable slug for the rule.' },
    message: { type: 'string', required: true },
    file: { type: 'string', required: true, description: 'File path relative to the package root.' },
    line: { ...nullableInteger, required: true, description: '1-based line number, or null.' },
    fix: { type: 'string', required: true, description: 'One-line remediation.' },
  },
}

const lintSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    ok: { type: 'boolean', required: true },
    errorCount: { type: 'integer', required: true },
    warningCount: { type: 'integer', required: true },
    infoCount: { type: 'integer', required: true },
    issues: { type: 'array', required: true, items: issueSchema },
  },
}

const layoutSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    debian: { type: 'boolean', required: true },
    changelog: { type: 'boolean', required: true },
    control: { type: 'boolean', required: true },
    copyright: { type: 'boolean', required: true },
    rules: { type: 'boolean', required: true },
    sourceFormat: { ...nullableString, required: true },
    compat: { ...nullableString, required: true },
    debhelperCompat: { ...nullableString, required: true },
    watch: { type: 'boolean', required: true },
    patches: { type: 'integer', required: true, description: 'Number of patch files under debian/patches/.' },
    tests: { type: 'integer', required: true, description: 'DEP-8 test entries (or test files when no control file).' },
    installFiles: { type: 'array', required: true, items: { type: 'string' } },
    conffiles: { type: 'boolean', required: true },
    manpages: { type: 'boolean', required: true },
    native: { type: 'boolean', required: true },
  },
}

const changelogSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { ...nullableString, required: true },
    version: { ...nullableString, required: true },
    upstreamVersion: { ...nullableString, required: true },
    debianRevision: { ...nullableString, required: true },
    ubuntuRevision: { ...nullableString, required: true },
    distribution: { ...nullableString, required: true },
    distributions: { type: 'array', required: true, items: { type: 'string' } },
    urgency: { ...nullableString, required: true },
    maintainer: { ...nullableString, required: true },
    date: { ...nullableString, required: true },
    entries: { type: 'integer', required: true },
  },
}

const controlSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: {
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: {
        source: { ...nullableString, required: true },
        section: { ...nullableString, required: true },
        priority: { ...nullableString, required: true },
        maintainer: { ...nullableString, required: true },
        standardsVersion: { ...nullableString, required: true },
        buildDepends: { type: 'array', required: true, items: { type: 'string' } },
        homepage: { ...nullableString, required: true },
        rulesRequiresRoot: { ...nullableString, required: true },
        testsuite: { type: 'array', required: true, items: { type: 'string' } },
        vcs: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            'Vcs-Browser': { type: 'string' },
            'Vcs-Git': { type: 'string' },
          },
        },
      },
    },
    packages: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          package: { ...nullableString, required: true },
          architecture: { ...nullableString, required: true },
          depends: { type: 'array', required: true, items: { type: 'string' } },
          description: { ...nullableString, required: true },
        },
      },
    },
  },
}

const rulesSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    present: { type: 'boolean', required: true },
    executable: { type: 'boolean', required: true },
    dhSequencer: { type: 'boolean', required: true },
    overrides: { type: 'array', required: true, items: { type: 'string' } },
    buildsystem: { ...nullableString, required: true },
  },
}

const testsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    control: { type: 'boolean', required: true },
    entries: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tests: { type: 'array', required: true, items: { type: 'string' } },
          testCommand: { ...nullableString, required: true },
          depends: { type: 'array', required: true, items: { type: 'string' } },
          restrictions: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
    },
    testCommands: { type: 'array', required: true, items: { type: 'string' } },
    scripts: { type: 'array', required: true, items: { type: 'string' } },
  },
}

const patchesSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    series: { type: 'array', required: true, items: { type: 'string' } },
    files: { type: 'array', required: true, items: { type: 'string' } },
    dep3: {
      type: 'object',
      required: true,
      additionalProperties: true,
      description: 'Map of patch filename to DEP-3 header fields; empty object when a patch has no header.',
    },
  },
}

const inspectSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    layout: { ...layoutSchema, required: true },
    changelog: { oneOf: [{ type: 'null' }, changelogSchema], required: true },
    control: { oneOf: [{ type: 'null' }, controlSchema], required: true },
    rules: { ...rulesSchema, required: true },
    tests: { ...testsSchema, required: true },
    patches: { ...patchesSchema, required: true },
    issues: { type: 'array', required: true, items: issueSchema },
  },
}

const scaffoldFileNames = [
  'debian/control',
  'debian/rules',
  'debian/changelog',
  'debian/copyright',
  'debian/source/format',
  'debian/watch',
  'debian/tests/control',
  'debian/tests/smoke',
]

const scaffoldSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    packageDir: { type: 'string', required: true },
    created: { type: 'array', required: true, items: { type: 'string' } },
    files: {
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: Object.fromEntries(scaffoldFileNames.map((fileName) => [fileName, { type: 'string' }])),
    },
    lint: { ...lintSchema, required: true },
    warnings: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          code: { type: 'string', required: true },
          file: { type: 'string', required: true },
          message: { type: 'string', required: true },
        },
      },
    },
  },
}

const commandSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cmd: { type: 'string', required: true },
    purpose: { type: 'string', required: true },
    optional: { type: 'boolean', required: true },
  },
}

const planSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    prerequisites: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          command: { type: 'string', required: true },
          purpose: { type: 'string', required: true },
          required: { type: 'boolean', required: true },
        },
      },
    },
    phases: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          commands: { type: 'array', required: true, items: commandSchema },
        },
      },
    },
    notes: { type: 'array', required: true, items: { type: 'string' } },
    checklist: { type: 'array', required: true, items: { type: 'string' } },
  },
}

const testPlanSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    prerequisites: { ...planSchema.properties.prerequisites, required: true },
    phases: { ...planSchema.properties.phases, required: true },
    dep8: {
      oneOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            control: { type: 'string', required: true },
            script: { type: 'string', required: true },
          },
        },
      ],
      required: true,
    },
    failureTriage: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          symptom: { type: 'string', required: true },
          cause: { type: 'string', required: true },
          fix: { type: 'string', required: true },
        },
      },
    },
    checklist: { type: 'array', required: true, items: { type: 'string' } },
    notes: { type: 'array', required: true, items: { type: 'string' } },
  },
}

const diagnoseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: {
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: {
        lines: { type: 'integer', required: true },
        errors: { type: 'integer', required: true },
        warnings: { type: 'integer', required: true },
        phase: {
          type: 'string',
          enum: ['build', 'configure', 'test', 'install', 'package', 'unknown'],
          required: true,
        },
      },
    },
    findings: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          severity: { type: 'string', enum: ['error', 'warning', 'info'], required: true },
          evidence: { type: 'string', required: true },
          cause: { type: 'string', required: true },
          fix: { type: 'string', required: true },
          doc: { type: 'string', required: true },
        },
      },
    },
    nextActions: { type: 'array', required: true, items: { type: 'string' } },
  },
}

/* ------------------------------------------------------------------ helpers */

async function loadDefineTool(ctx) {
  try {
    const module = await import('@deepseek-ai/dsh-tools')
    if (typeof module.defineTool === 'function') return module.defineTool
  } catch (error) {
    const warn = ctx?.logger?.warn
    if (typeof warn === 'function') {
      warn.call(ctx.logger, `dsh-ubuntu-packaging: @deepseek-ai/dsh-tools is unavailable (${error.message}); tool schemas stay uncompiled`)
    }
  }
  return (definition) => definition
}

function resolveUserPath(value, execution, field = 'path') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`dsh-ubuntu-packaging: "${field}" is required and must be a non-empty string`)
  }
  const base = typeof execution?.cwd === 'string'
    ? execution.cwd
    : typeof execution?.workingDirectory === 'string'
      ? execution.workingDirectory
      : process.cwd()
  return path.resolve(base, value)
}

function renderIssues(issues) {
  if (!Array.isArray(issues) || issues.length === 0) return 'issues: none'
  return [
    `issues: ${issues.length}`,
    ...issues.map((issue) => `  [${issue.severity}] ${issue.code} ${issue.file}${issue.line ? `:${issue.line}` : ''} ${issue.message}`),
  ].join('\n')
}

function renderPhases(phases, intro) {
  return [
    intro,
    ...phases.flatMap((phase) => [
      `## ${phase.name}`,
      ...phase.commands.map((entry) => `  $ ${entry.cmd}${entry.optional ? '   (optional)' : ''}`),
    ]),
  ].join('\n')
}

/* --------------------------------------------------------------------- apply */

export async function apply(ctx) {
  const defineTool = await loadDefineTool(ctx)
  /** @type {Array<() => void>} */
  const disposers = []

  disposers.push(ctx.tools.register(defineTool({
    name: 'ubuntu_inspect_package',
    description: 'Inspect a Debian/Ubuntu source package and report its debian/ layout, parsed metadata and lint issues.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Source package root (contains debian/) or the debian/ directory itself; absolute or cwd-relative.',
      },
    },
    output: {
      schema: inspectSchema,
      render: (_args, value) => [{
        type: 'text',
        text: [
          `${value.path}`,
          `debian/: changelog=${value.layout.changelog} control=${value.layout.control} copyright=${value.layout.copyright} rules=${value.layout.rules} format=${value.layout.sourceFormat ?? '(missing)'} compat=${value.layout.debhelperCompat ?? '(missing)'}`,
          `changelog: ${value.changelog ? `${value.changelog.source} ${value.changelog.version} -> ${value.changelog.distribution} (${value.changelog.entries} entry)` : '(missing)'}`,
          `control: ${value.control ? `${value.control.packages.length} binary package(s)` : '(missing)'}`,
          `rules: dh=${value.rules.dhSequencer} overrides=[${value.rules.overrides.join(', ')}] buildsystem=${value.rules.buildsystem ?? '(none)'}`,
          `patches: ${value.patches.files.length} file(s), series=[${value.patches.series.join(', ')}]`,
          `tests: control=${value.tests.control} entries=${value.tests.entries.length} scripts=[${value.tests.scripts.join(', ')}]`,
          renderIssues(value.issues),
        ].join('\n'),
      }],
    },
    execute: async (args, execution) => {
      const pkg = await loadPackage(resolveUserPath(args.path, execution), { tool: 'ubuntu_inspect_package' })
      const lint = lintLoadedPackage(pkg, { strict: false })
      return {
        path: pkg.path,
        layout: pkg.layout,
        changelog: changelogSummary(pkg.parsed.changelog),
        control: controlSummary(pkg),
        rules: rulesSummary(pkg.parsed.rules),
        tests: testsSummary(pkg),
        patches: {
          series: pkg.patches.series,
          files: pkg.patches.files,
          dep3: pkg.patches.dep3,
        },
        issues: lint.issues,
      }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'ubuntu_lint_package',
    description: 'Lint a Debian/Ubuntu source package against packaging rules and return ordered, fixable issues.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Source package root or its debian/ directory; absolute or cwd-relative.',
      },
      strict: {
        type: 'boolean',
        description: 'Treat warnings as failing (default false).',
      },
      targetRelease: {
        type: 'string',
        description: `Ubuntu release codename used in remediation text; defaults to ${DEFAULT_TARGET_RELEASE}.`,
      },
    },
    output: {
      schema: lintSchema,
      render: (_args, value) => [{
        type: 'text',
        text: [
          `${value.path}: ${value.ok ? 'OK' : 'FAILED'} (${value.errorCount} error(s), ${value.warningCount} warning(s), ${value.infoCount} info)`,
          renderIssues(value.issues),
        ].join('\n'),
      }],
    },
    execute: async (args, execution) => lintPackage({
      path: resolveUserPath(args.path, execution),
      strict: args.strict === true,
      targetRelease: args.targetRelease ?? DEFAULT_TARGET_RELEASE,
      tool: 'ubuntu_lint_package',
    }),
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'ubuntu_scaffold_package',
    description: 'Create a debian/ directory (control, rules, changelog, copyright, source/format, watch, DEP-8 tests) in an unpacked source tree and lint it.',
    parameters: {
      sourceDir: {
        type: 'string',
        required: true,
        description: 'Existing unpacked upstream source directory; absolute or cwd-relative.',
      },
      packageName: { type: 'string', required: true, description: 'Lowercase Debian source/binary package name.' },
      upstreamVersion: { type: 'string', required: true, description: 'Upstream version; must start with a digit.' },
      maintainer: { type: 'string', required: true, description: 'Maintainer in "Name <email>" form.' },
      license: { type: 'string', required: true, description: 'Short DEP-5 license name, for example GPL-3+.' },
      description: { type: 'string', required: true, description: 'Binary package synopsis (one line, starts uppercase).' },
      debianRevision: { type: 'string', description: 'Debian revision; defaults to 0.' },
      ubuntuRevision: { type: 'string', description: 'Ubuntu revision; defaults to ubuntu1.' },
      distribution: { type: 'string', description: 'Ubuntu codename; defaults to resolute.' },
      homepage: { type: 'string', description: 'Upstream http(s) URL; also enables debian/watch.' },
      buildSystem: {
        type: 'string',
        enum: ['autotools', 'cmake', 'meson', 'python', 'rust', 'go', 'node', 'custom'],
        description: 'Upstream build system; defaults to autotools.',
      },
      architecture: { type: 'string', description: 'Binary Architecture; defaults to any (use all for architecture-independent packages).' },
      buildDepends: { type: 'array', items: { type: 'string' }, description: 'Extra Build-Depends besides debhelper-compat.' },
      depends: { type: 'array', items: { type: 'string' }, description: 'Extra binary Depends besides ${misc:Depends}/${shlibs:Depends}.' },
      tests: { type: 'boolean', description: 'Generate debian/tests/control and debian/tests/smoke (DEP-8).' },
      native: { type: 'boolean', description: 'Use a native version and 3.0 (native) source format.' },
      overwrite: { type: 'boolean', description: 'Rewrite the generated files when debian/ already exists.' },
    },
    output: {
      schema: scaffoldSchema,
      render: (_args, value) => [{
        type: 'text',
        text: [
          `created in ${value.packageDir}: ${value.created.join(', ')}`,
          `lint: ${value.lint.ok ? 'OK' : 'FAILED'} (${value.lint.errorCount} error(s), ${value.lint.warningCount} warning(s), ${value.lint.infoCount} info)`,
          ...value.warnings.map((warning) => `warning: ${warning.code} ${warning.file}: ${warning.message}`),
        ].join('\n'),
      }],
    },
    execute: async (args, execution) => scaffoldPackage({
      ...args,
      sourceDir: resolveUserPath(args.sourceDir, execution, 'sourceDir'),
    }),
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'ubuntu_build_plan',
    description: 'Plan local source/binary builds with dpkg-buildpackage, sbuild or debuild, plus lintian checks and a PPA upload.',
    parameters: {
      packageDir: { type: 'string', required: true, description: 'Source package directory; absolute or cwd-relative.' },
      release: { type: 'string', description: 'Target Ubuntu codename; defaults to resolute.' },
      arch: { type: 'string', description: 'Target architecture; defaults to amd64.' },
      mode: {
        type: 'string',
        enum: ['binary', 'source', 'source+binary'],
        description: 'What to build; defaults to binary.',
      },
      tool: {
        type: 'string',
        enum: ['sbuild', 'dpkg-buildpackage', 'debuild'],
        description: 'Build tool; defaults to sbuild.',
      },
      sign: { type: 'boolean', description: 'Include debsign commands (default false).' },
      ppa: { type: 'string', description: 'PPA as "user/archive"; adds dput and ppa upload commands.' },
    },
    output: {
      schema: planSchema,
      render: (_args, value) => [{
        type: 'text',
        text: [
          renderPhases(value.phases, 'build plan:'),
          '',
          'notes:',
          ...value.notes.map((note) => `- ${note}`),
        ].join('\n'),
      }],
    },
    execute: async (args, execution) => buildPlan({
      ...args,
      packageDir: resolveUserPath(args.packageDir, execution, 'packageDir'),
    }),
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'ubuntu_test_plan',
    description: 'Plan static checks, install/upgrade/purge, DEP-8 tests, autopkgtest (local/LXD/QEMU) and PPA validation.',
    parameters: {
      packageDir: { type: 'string', required: true, description: 'Source package directory; absolute or cwd-relative.' },
      release: { type: 'string', description: 'Target Ubuntu codename; defaults to resolute.' },
      arch: { type: 'string', description: 'Target architecture; defaults to amd64.' },
      mode: {
        type: 'string',
        enum: ['local', 'lxd', 'qemu', 'ppa'],
        description: 'Test backend; defaults to lxd.',
      },
      ppa: { type: 'string', description: 'PPA as "user/archive"; required when mode is ppa.' },
      packageName: { type: 'string', description: 'Binary package name to install/smoke-test; defaults to the changelog source name.' },
    },
    output: {
      schema: testPlanSchema,
      render: (_args, value) => [{
        type: 'text',
        text: [
          renderPhases(value.phases, 'test plan:'),
          '',
          value.dep8
            ? `no debian/tests/control: add\n${value.dep8.control}and a script:\n${value.dep8.script}`
            : 'DEP-8: debian/tests/control is present',
          `failure triage: ${value.failureTriage.length} entries`,
          '',
          'notes:',
          ...value.notes.map((note) => `- ${note}`),
        ].join('\n'),
      }],
    },
    execute: async (args, execution) => testPlan({
      ...args,
      packageDir: resolveUserPath(args.packageDir, execution, 'packageDir'),
    }),
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'ubuntu_diagnose_build',
    description: 'Diagnose an Ubuntu/Debian build or autopkgtest log: recognise the failure class, cite the evidence line and name the next edit.',
    parameters: {
      log: { type: 'string', description: 'Raw log text. Pass exactly one of log or path.' },
      path: { type: 'string', description: 'Path to a log file. Pass exactly one of log or path.' },
    },
    output: {
      schema: diagnoseSchema,
      render: (_args, value) => [{
        type: 'text',
        text: [
          `phase=${value.summary.phase} lines=${value.summary.lines} errors=${value.summary.errors} warnings=${value.summary.warnings}`,
          ...(value.findings.length === 0
            ? ['findings: none']
            : value.findings.map((finding) => `  [${finding.severity}] ${finding.id}: ${finding.evidence}`)),
          'next actions:',
          ...value.nextActions.map((action) => `  - ${action}`),
        ].join('\n'),
      }],
    },
    execute: async (args, execution) => diagnoseBuild({
      ...(typeof args.log === 'string' ? { log: args.log } : {}),
      ...(typeof args.path === 'string' && args.path.trim() !== '' ? { path: resolveUserPath(args.path, execution) } : {}),
    }),
  })))

  // Optional runtime skill: old Hosts may not provide `skills`, and a missing
  // skill file must only warn — never fail activation.
  try {
    const skills = typeof ctx.get === 'function' ? ctx.get('skills') : undefined
    if (skills) {
      const content = await readFile(new URL('../skills/ubuntu-packaging/SKILL.md', import.meta.url), 'utf8')
      disposers.push(skills.register({
        name: 'ubuntu-packaging',
        description: SKILL_DESCRIPTION,
        whenToUse: SKILL_WHEN_TO_USE,
        content,
        source: 'runtime',
        resourceBase: {
          kind: 'directory',
          path: fileURLToPath(new URL('../skills/ubuntu-packaging/', import.meta.url)),
        },
      }))
    }
  } catch (error) {
    const warn = ctx?.logger?.warn
    if (typeof warn === 'function') {
      warn.call(ctx.logger, `dsh-ubuntu-packaging: runtime skill was not registered (${error.message}); the tools remain available`)
    }
  }

  ctx.effect(() => () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {
        // A failing disposer must not prevent the remaining ones from running.
      }
    }
  })
}
