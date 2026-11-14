/**
 * Scaffold a `debian/` directory for an existing upstream source tree.
 *
 * All input validation happens before the first write: `prepareScaffoldInput`
 * collects every problem, and `scaffoldPackage` throws one Error whose message
 * joins them with ", ". The only placeholder marker we ever emit is the DEP-5
 * license TODO in `debian/copyright`, and it is reported in `warnings`.
 */

import { chmod, mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { formatRfc5322Date } from './parse.js'
import { lintPackage } from './lint.js'

export const BUILD_SYSTEMS = ['autotools', 'cmake', 'meson', 'python', 'rust', 'go', 'node', 'custom']

export const KNOWN_UBUNTU_RELEASES = [
  'resolute',
  'questing',
  'plucky',
  'oracular',
  'noble',
  'mantic',
  'lunar',
  'jammy',
  'kinetic',
  'impish',
  'hirsute',
  'groovy',
  'focal',
  'eoan',
  'disco',
  'cosmic',
  'bionic',
  'artful',
  'zesty',
  'yakkety',
  'xenial',
  'wily',
  'vivid',
  'utopic',
  'trusty',
]

export const PACKAGE_NAME_RE = /^[a-z0-9][a-z0-9+.-]+$/
export const VERSION_RE = /^\d[0-9A-Za-z.+~:-]*$/
const DEBIAN_REVISION_RE = /^[0-9A-Za-z.+~]+$/
const UBUNTU_REVISION_RE = /^ubuntu\d+(?:\.\d+)?$/
const UBUNTU_RELEASE_RE = /^[a-z][a-z0-9-]+$/
const MAINTAINER_RE = /^[^<>]+\s<[^<>\s]+@[^<>\s]+>$/
const ARCHITECTURE_RE = /^(?:any|all|[a-z0-9][a-z0-9-]*)$/
const HOMEPAGE_RE = /^https?:\/\/\S+$/i

const LICENSE_TODO = 'TODO: replace with the full license text'

/* ------------------------------------------------------------------- input */

function listOf(value) {
  if (value === undefined || value === null || value === '') return []
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter((entry) => entry !== '')
  }
  return String(value).split(/\s+/).filter((entry) => entry !== '')
}

/**
 * Validate scaffold input and return the normalised options.
 * Returns every problem at once; never throws.
 *
 * @returns {{errors: string[], options: object}}
 */
export function prepareScaffoldInput(input = {}) {
  const errors = []
  const options = {}

  const sourceDir = typeof input.sourceDir === 'string' ? input.sourceDir.trim() : ''
  if (sourceDir === '') {
    errors.push('sourceDir is required')
  } else {
    options.sourceDir = path.resolve(sourceDir)
  }

  const packageName = String(input.packageName ?? '').trim()
  if (!PACKAGE_NAME_RE.test(packageName)) {
    errors.push(`packageName "${packageName}" must match ${PACKAGE_NAME_RE}`)
  }
  options.packageName = packageName

  const upstreamVersion = String(input.upstreamVersion ?? '').trim()
  if (!VERSION_RE.test(upstreamVersion)) {
    errors.push(`upstreamVersion "${upstreamVersion}" must start with a digit and contain only version characters`)
  }
  options.upstreamVersion = upstreamVersion

  options.native = input.native === true
  options.tests = input.tests === true
  options.overwrite = input.overwrite === true

  const debianRevision = input.debianRevision === undefined || input.debianRevision === null
    ? '0'
    : String(input.debianRevision).trim()
  if (!options.native && !DEBIAN_REVISION_RE.test(debianRevision)) {
    errors.push(`debianRevision "${debianRevision}" must contain only alphanumerics and . + ~`)
  }
  options.debianRevision = debianRevision

  const ubuntuRevision = input.ubuntuRevision === undefined || input.ubuntuRevision === null
    ? 'ubuntu1'
    : String(input.ubuntuRevision).trim()
  if (!options.native && ubuntuRevision !== '' && !UBUNTU_REVISION_RE.test(ubuntuRevision)) {
    errors.push(`ubuntuRevision "${ubuntuRevision}" must look like ubuntu1 (or ubuntu1.2)`)
  }
  options.ubuntuRevision = ubuntuRevision

  const distribution = input.distribution === undefined || input.distribution === null
    ? 'resolute'
    : String(input.distribution).trim()
  if (!UBUNTU_RELEASE_RE.test(distribution)) {
    errors.push(`distribution "${distribution}" must be a lowercase Ubuntu codename such as resolute`)
  } else if (!KNOWN_UBUNTU_RELEASES.includes(distribution)) {
    errors.push(`distribution "${distribution}" is not a known Ubuntu codename (for example resolute, questing, noble)`)
  }
  options.distribution = distribution

  const maintainer = String(input.maintainer ?? '').trim()
  if (!MAINTAINER_RE.test(maintainer)) {
    errors.push(`maintainer "${maintainer}" must look like "Jane Doe <jane@example.com>"`)
  }
  options.maintainer = maintainer

  const license = String(input.license ?? '').trim()
  if (license === '') {
    errors.push('license is required (the short DEP-5 license name, for example GPL-3+)')
  } else if (/[\r\n]/.test(license)) {
    errors.push('license must be a single short name, not license text')
  }
  options.license = license

  const buildSystem = String(input.buildSystem ?? 'autotools').trim()
  if (!BUILD_SYSTEMS.includes(buildSystem)) {
    errors.push(`buildSystem "${buildSystem}" must be one of ${BUILD_SYSTEMS.join(', ')}`)
  }
  options.buildSystem = buildSystem

  const architecture = String(input.architecture ?? 'any').trim()
  if (!ARCHITECTURE_RE.test(architecture)) {
    errors.push(`architecture "${architecture}" must be any, all or an architecture name`)
  }
  options.architecture = architecture

  const homepage = input.homepage === undefined || input.homepage === null || input.homepage === ''
    ? null
    : String(input.homepage).trim()
  if (homepage !== null && !HOMEPAGE_RE.test(homepage)) {
    errors.push(`homepage "${homepage}" must be an http(s) URL`)
  }
  options.homepage = homepage

  const description = String(input.description ?? '').trim()
  if (description === '') {
    errors.push('description is required (the binary package synopsis)')
  } else if (/[\r\n]/.test(description)) {
    errors.push('description must be a single synopsis line without newlines')
  }
  options.description = description

  options.buildDepends = listOf(input.buildDepends)
  options.depends = listOf(input.depends)

  return { errors, options }
}

/** Collect only the validation errors. */
export function validateScaffoldInput(input = {}) {
  return prepareScaffoldInput(input).errors
}

/* ---------------------------------------------------------------- generation */

function packageVersion(options) {
  if (options.native) return options.upstreamVersion
  const revision = `${options.debianRevision}${options.ubuntuRevision}`
  return `${options.upstreamVersion}-${revision}`
}

function controlText(options) {
  const buildDepends = ['debhelper-compat (= 13)', ...options.buildDepends]
  const depends = ['${misc:Depends}']
  if (options.architecture !== 'all') depends.push('${shlibs:Depends}')
  depends.push(...options.depends)
  const lines = [
    `Source: ${options.packageName}`,
    'Section: misc',
    'Priority: optional',
    `Maintainer: ${options.maintainer}`,
    `Build-Depends: ${buildDepends.join(', ')}`,
    'Standards-Version: 4.7.4',
    'Rules-Requires-Root: no',
  ]
  if (options.homepage) lines.push(`Homepage: ${options.homepage}`)
  lines.push(
    '',
    `Package: ${options.packageName}`,
    `Architecture: ${options.architecture}`,
    `Depends: ${depends.join(', ')}`,
    `Description: ${options.description}`,
    '',
  )
  return lines.join('\n')
}

function buildSystemStub(options) {
  switch (options.buildSystem) {
    case 'cmake':
      return ['# override_dh_auto_configure:', '#\tdh_auto_configure -- -DCMAKE_BUILD_TYPE=RelWithDebInfo']
    case 'meson':
      return ['# override_dh_auto_configure:', '#\tdh_auto_configure -- -Dbuildtype=release']
    case 'python':
      return [`# export PYBUILD_NAME=${options.packageName}`, '# override_dh_auto_configure:', '#\tdh_auto_configure -- --buildsystem=pybuild']
    case 'rust':
      return ['# override_dh_auto_build:', '#\tcargo build --release --offline']
    case 'go':
      return ['# override_dh_auto_build:', '#\tdh_auto_build --buildsystem=go']
    case 'node':
      return ['# override_dh_auto_build:', '#\tnpm run build']
    case 'custom':
      return ['# override_dh_auto_configure:', '#\t./configure --prefix=/usr']
    default:
      return []
  }
}

function rulesText(options) {
  const lines = ['#!/usr/bin/make -f', '', '%:', '\tdh $@']
  const stub = buildSystemStub(options)
  if (stub.length > 0) {
    lines.push('', `# Build system: ${options.buildSystem}. Uncomment and adapt when dh's autodetection is not enough.`)
    lines.push(...stub)
  }
  lines.push('')
  return lines.join('\n')
}

function changelogText(options) {
  const date = formatRfc5322Date(new Date())
  return [
    `${options.packageName} (${packageVersion(options)}) ${options.distribution}; urgency=medium`,
    '',
    '  * Initial packaging.',
    '',
    ` -- ${options.maintainer}  ${date}`,
    '',
  ].join('\n')
}

function copyrightText(options) {
  const year = new Date().getFullYear()
  const lines = [
    'Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/',
    `Upstream-Name: ${options.packageName}`,
  ]
  if (options.homepage) lines.push(`Source: ${options.homepage}`)
  lines.push(
    '',
    'Files: *',
    `Copyright: ${year} ${options.maintainer}`,
    `License: ${options.license}`,
    ` ${LICENSE_TODO}`,
    '',
  )
  return lines.join('\n')
}

function watchText(options) {
  const base = options.homepage.replace(/\/+$/, '')
  return [
    'version=4',
    `${base}/ (.+)\\.tar\\.gz`,
    '',
  ].join('\n')
}

function testsControlText() {
  return ['Tests: smoke', 'Depends: @', 'Restrictions: superficial', ''].join('\n')
}

function testsScriptText(packageName) {
  return [
    '#!/bin/sh',
    'set -eu',
    '',
    `command -v ${packageName}`,
    `${packageName} --version`,
    '',
  ].join('\n')
}

/** Build the full relative-path -> text map for one scaffold run. */
export function scaffoldFiles(options) {
  const files = {
    'debian/control': controlText(options),
    'debian/rules': rulesText(options),
    'debian/changelog': changelogText(options),
    'debian/copyright': copyrightText(options),
    'debian/source/format': `${options.native ? '3.0 (native)' : '3.0 (quilt)'}\n`,
  }
  if (options.homepage) files['debian/watch'] = watchText(options)
  if (options.tests) {
    files['debian/tests/control'] = testsControlText()
    files['debian/tests/smoke'] = testsScriptText(options.packageName)
  }
  return files
}

function copyrightWarnings(options) {
  const warnings = [{
    code: 'copyright-license-placeholder',
    file: 'debian/copyright',
    message: `debian/copyright contains "${LICENSE_TODO}"; replace it with the full license text before uploading.`,
  }]
  if (!options.homepage) {
    warnings.push({
      code: 'copyright-source-missing',
      file: 'debian/copyright',
      message: 'no homepage was supplied, so debian/copyright has no Source field; add the upstream URL.',
    })
  }
  return warnings
}

async function statOrNull(target) {
  try {
    return await stat(target)
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null
    throw error
  }
}

/* --------------------------------------------------------------- scaffold */

/**
 * Create the `debian/` directory and return the generated texts plus lint.
 *
 * @param {object} input see CONTRACT.md §5.3
 */
export async function scaffoldPackage(input = {}) {
  const { errors, options } = prepareScaffoldInput(input)
  if (errors.length > 0) {
    throw new Error(`ubuntu_scaffold_package: invalid input: ${errors.join(', ')}`)
  }

  const sourceInfo = await statOrNull(options.sourceDir)
  if (!sourceInfo) {
    throw new Error(`ubuntu_scaffold_package: sourceDir does not exist: ${options.sourceDir}`)
  }
  if (!sourceInfo.isDirectory()) {
    throw new Error(`ubuntu_scaffold_package: sourceDir is not a directory: ${options.sourceDir}`)
  }

  const debianDir = path.join(options.sourceDir, 'debian')
  const existing = await statOrNull(debianDir)
  if (existing && !existing.isDirectory()) {
    throw new Error(`ubuntu_scaffold_package: ${debianDir} exists but is not a directory`)
  }
  if (existing && !options.overwrite) {
    throw new Error(`ubuntu_scaffold_package: ${debianDir} already exists; pass overwrite: true to rewrite the generated files`)
  }

  const files = scaffoldFiles(options)
  const created = Object.keys(files)
  const warnings = copyrightWarnings(options)
  if (existing && options.overwrite) {
    warnings.push({
      code: 'scaffold-overwrote-debian',
      file: 'debian',
      message: 'debian/ already existed; only the generated files were rewritten, other files were left untouched.',
    })
  }

  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(options.sourceDir, ...relative.split('/'))
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  await chmod(path.join(options.sourceDir, 'debian', 'rules'), 0o755)
  if (options.tests) {
    await chmod(path.join(options.sourceDir, 'debian', 'tests', 'smoke'), 0o755)
  }

  const lint = await lintPackage({
    path: options.sourceDir,
    tool: 'ubuntu_scaffold_package',
    strict: false,
  })

  return {
    packageDir: options.sourceDir,
    created,
    files,
    lint,
    warnings,
  }
}

/** Re-exported for tests that want the generated text without a file system. */
export { LICENSE_TODO }
