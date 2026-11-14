/**
 * Ubuntu/Debian source-package scanning and lint rules.
 *
 * `loadPackage()` is the only file-system reader in the tool: it collects the
 * raw `debian/` texts, parses them with `lib/parse.js`, and precomputes the
 * facts that lint rules need (executable bits, script existence, patch files).
 * `lintLoadedPackage()` is then pure and synchronous.
 *
 * Rule code mapping (frozen by CONTRACT.md §5.2):
 * - real lintian tags are used verbatim as `code` and `rule`:
 *   no-debian-changelog, no-control-file, no-copyright-file, no-debian-rules,
 *   debian-rules-not-executable, missing-debian-source-format,
 *   source-format-1.0, no-section-field, no-priority-field,
 *   no-standards-version-field,
 *   build-depends-on-essential-package-without-using-version,
 *   debhelper-compat-file-is-missing, package-uses-old-debhelper-compat-version,
 *   rules-requires-root-missing, debian-watch-file-is-missing
 * - rules without a matching lintian tag use `U###` codes with a stable slug
 *   in `rule`; the numbers are fixed by the contract table.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import {
  compareDottedVersions,
  compatFromBuildDepends,
  dep3Summary,
  fieldValue,
  isRfc5322Date,
  parseChangelog,
  parseCompat,
  parseControl,
  parseCopyright,
  parseDep3,
  parseRules,
  parseSeries,
  parseSourceFormat,
  parseTestsControl,
  parseWatch,
  splitLines,
  splitList,
  splitVersion,
} from './parse.js'

export const DEFAULT_TARGET_RELEASE = 'resolute'
export const CURRENT_STANDARDS_VERSION = '4.7.4'
export const CURRENT_DEBHELPER_COMPAT = 13

export const KNOWN_URGENCIES = ['low', 'medium', 'high', 'emergency', 'critical']
export const KNOWN_FORMATS = ['3.0 (quilt)', '3.0 (native)', '1.0']
export const KNOWN_DEP8_RESTRICTIONS = [
  'breaks-testbed',
  'isolation-machine',
  'isolation-container',
  'needs-reboot',
  'needs-root',
  'skippable',
  'flaky',
  'superficial',
  'build-needed',
  'allow-stderr',
  'rw-build-tree',
  'big-parallel',
]

const ESSENTIAL_PACKAGES = ['build-essential', 'dpkg-dev']
/**
 * POSIX execute bits are meaningless on Windows: `chmod` there only toggles
 * the read-only attribute and `stat().mode` never reports S_IXUSR/S_IXGRP/
 * S_IXOTH. Enforcing the mode-bit rules on Windows would flag every
 * `debian/rules` and DEP-8 test script as non-executable, so they are
 * POSIX-only. File presence, shebangs and everything else are still checked.
 */
export const CAN_CHECK_EXECUTABLE_BITS = process.platform !== 'win32'

const ARCHITECTURE_TOKEN = /^(?:any|all|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/

/* ------------------------------------------------------------------ helpers */

async function statOrNull(file) {
  try {
    return await stat(file)
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null
    throw error
  }
}

async function isDirectory(file) {
  const info = await statOrNull(file)
  return Boolean(info && info.isDirectory())
}

async function readOptional(file, tool) {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null
    throw new Error(`${tool}: cannot read ${file}: ${error.message}`)
  }
}

async function readdirOrEmpty(dir) {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return []
    throw error
  }
}

/** True when at least one candidate path exists (file or symlink). */
async function anyExists(candidates) {
  for (const candidate of candidates) {
    if (await statOrNull(candidate)) return true
  }
  return false
}

function debianRelative(name) {
  return `debian/${name}`
}

/* --------------------------------------------------------------- loadPackage */

/**
 * Read and parse a source package.
 *
 * @param {string} inputPath source package root or its `debian/` directory
 * @param {{tool?: string}} [options]
 * @returns {Promise<object>}
 */
export async function loadPackage(inputPath, options = {}) {
  const tool = options.tool ?? 'ubuntu_inspect_package'
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw new Error(`${tool}: "path" is required and must be a non-empty string`)
  }

  const requested = path.resolve(inputPath)
  const requestedInfo = await statOrNull(requested)
  if (!requestedInfo) throw new Error(`${tool}: package path not found: ${requested}`)
  if (!requestedInfo.isDirectory()) {
    throw new Error(`${tool}: package path is not a directory: ${requested}`)
  }

  const nestedDebian = await isDirectory(path.join(requested, 'debian'))
  const useDebianDir = path.basename(requested) === 'debian' && !nestedDebian
  const root = useDebianDir ? path.dirname(requested) : requested
  const debianDir = useDebianDir ? requested : path.join(root, 'debian')
  const debian = await isDirectory(debianDir)

  const readRel = async (relative) => ({
    relative,
    text: await readOptional(path.join(debianDir, ...relative.split('/')), tool),
  })

  const [changelogText, controlText, copyrightText, rulesText, watchText, compatText, formatText, seriesText, testsControlText] =
    await Promise.all([
      readRel('changelog'),
      readRel('control'),
      readRel('copyright'),
      readRel('rules'),
      readRel('watch'),
      readRel('compat'),
      readRel('source/format'),
      readRel('patches/series'),
      readRel('tests/control'),
    ])

  const rulesInfo = rulesText.text === null ? null : await statOrNull(path.join(debianDir, 'rules'))

  const changelog = changelogText.text === null
    ? null
    : parseChangelog(changelogText.text, { file: debianRelative('changelog') })
  const control = controlText.text === null
    ? null
    : parseControl(controlText.text, { file: debianRelative('control') })
  const copyright = copyrightText.text === null
    ? null
    : parseCopyright(copyrightText.text, { file: debianRelative('copyright') })
  const rules = rulesText.text === null
    ? { present: false, executable: false, shebang: null, dhSequencer: false, dhCleanK: false, overrides: [], directDhCalls: [], buildsystem: null, issues: [] }
    : parseRules(rulesText.text, {
      file: debianRelative('rules'),
      executable: rulesInfo ? (rulesInfo.mode & 0o111) !== 0 : false,
    })
  const watch = watchText.text === null ? null : parseWatch(watchText.text, { file: debianRelative('watch') })
  const tests = testsControlText.text === null ? null : parseTestsControl(testsControlText.text)
  const series = seriesText.text === null ? null : parseSeries(seriesText.text)
  const sourceFormat = formatText.text === null ? null : parseSourceFormat(formatText.text)
  const compat = compatText.text === null ? null : parseCompat(compatText.text)

  const sourceStanza = control?.source ?? null
  const packages = control?.packages ?? []
  const buildDepends = sourceStanza ? splitList(fieldValue(sourceStanza, 'Build-Depends')) : []
  const compatFromControl = compatFromBuildDepends(buildDepends)
  const debhelperCompat = compat || compatFromControl

  /* patches */
  const patchDirents = await readdirOrEmpty(path.join(debianDir, 'patches'))
  const patchFiles = patchDirents
    .filter((dirent) => dirent.name !== 'series' && !dirent.name.startsWith('.') && (dirent.isFile() || dirent.isSymbolicLink()))
    .map((dirent) => dirent.name)
    .sort()
  const dep3 = {}
  for (const patch of patchFiles) {
    const text = await readOptional(path.join(debianDir, 'patches', patch), tool)
    if (text !== null) {
      dep3[patch] = dep3Summary(parseDep3(text, { file: `debian/patches/${patch}` }))
    }
  }
  const seriesPatches = series?.patches ?? []
  const missingFromSeries = seriesPatches.filter((patch) => !patchFiles.includes(patch))
  const unlistedPatches = patchFiles.filter((patch) => !seriesPatches.includes(patch))

  /* tests */
  const testDirents = await readdirOrEmpty(path.join(debianDir, 'tests'))
  const testFiles = testDirents
    .filter((dirent) => dirent.name !== 'control' && !dirent.name.startsWith('.'))
    .map((dirent) => dirent.name)
    .sort()
  const testNames = []
  for (const entry of tests?.entries ?? []) {
    for (const name of entry.tests) {
      if (!testNames.includes(name)) testNames.push(name)
    }
  }
  const testScripts = []
  for (const name of testNames) {
    const scriptPath = path.join(debianDir, 'tests', name)
    const info = await statOrNull(scriptPath)
    const script = {
      name,
      exists: Boolean(info && info.isFile()),
      executable: Boolean(info && (info.mode & 0o111) !== 0),
      shebang: null,
    }
    if (script.exists) {
      const text = await readOptional(scriptPath, tool)
      script.shebang = text === null ? null : (splitLines(text)[0] ?? null)
    }
    testScripts.push(script)
  }

  /* install files and debian/ extras */
  const debianDirents = await readdirOrEmpty(debianDir)
  const debianNames = debianDirents.map((dirent) => dirent.name)
  const installFiles = []
  for (const name of debianNames.filter((entry) => entry.endsWith('.install')).sort()) {
    const content = await readOptional(path.join(debianDir, name), tool) ?? ''
    const lines = []
    splitLines(content).forEach((raw, index) => {
      const text = raw.trim()
      if (text === '' || text.startsWith('#')) return
      const target = text.split(/\s+/)[0]
      const checkable = !/[*?$]/.test(target) && !target.startsWith('debian/')
      lines.push({ line: index + 1, text, target, checkable, exists: null })
    })
    installFiles.push({ name, content, lines })
  }
  for (const install of installFiles) {
    for (const line of install.lines) {
      const relative = line.target.replace(/^\.?\//, '')
      line.exists = line.checkable
        ? await anyExists([
          path.join(root, relative),
          path.join(debianDir, 'tmp', relative),
          path.join(root, 'debian', 'tmp', relative),
        ])
        : null
    }
  }

  const split = splitVersion(changelog?.version ?? '')
  const native = sourceFormat === '3.0 (native)' || (sourceFormat === null && split.native)

  const layout = {
    debian,
    changelog: changelogText.text !== null,
    control: controlText.text !== null,
    copyright: copyrightText.text !== null,
    rules: rulesText.text !== null,
    sourceFormat,
    compat,
    debhelperCompat: debhelperCompat ?? null,
    watch: watchText.text !== null,
    patches: patchFiles.length,
    tests: tests ? tests.entries.length : testFiles.length,
    installFiles: installFiles.map((install) => install.name).sort(),
    conffiles: debianNames.some((name) => /(?:^|\.)conffiles$/.test(name)),
    manpages: debianNames.some((name) => name === 'manpages' || name.endsWith('.manpages')),
    native,
  }

  return {
    path: root,
    debianDir,
    debian,
    layout,
    texts: {
      changelog: changelogText.text,
      control: controlText.text,
      copyright: copyrightText.text,
      rules: rulesText.text,
      watch: watchText.text,
      compat: compatText.text,
      sourceFormat: formatText.text,
      series: seriesText.text,
      testsControl: testsControlText.text,
    },
    parsed: {
      changelog,
      control,
      copyright,
      rules,
      watch,
      tests,
      series,
      sourceFormat,
      compat,
    },
    sourceStanza,
    packages,
    buildDepends,
    patches: {
      series: seriesPatches,
      files: patchFiles,
      dep3,
      missingFromSeries,
      unlistedPatches,
    },
    tests: {
      control: tests !== null,
      entries: tests?.entries ?? [],
      scripts: testScripts,
      files: testFiles,
    },
    installFiles,
    native,
  }
}

/* ----------------------------------------------------------- lint utilities */

/** Short self-contained lint issue. */
function issue(code, severity, rule, message, file, line, fix) {
  return {
    code,
    severity,
    rule,
    message,
    file,
    line: Number.isInteger(line) ? line : null,
    fix,
  }
}

function compareIssues(left, right) {
  const file = left.file.localeCompare(right.file)
  if (file !== 0) return file
  const leftLine = left.line ?? Number.MAX_SAFE_INTEGER
  const rightLine = right.line ?? Number.MAX_SAFE_INTEGER
  if (leftLine !== rightLine) return leftLine - rightLine
  const code = left.code.localeCompare(right.code)
  if (code !== 0) return code
  return left.message.localeCompare(right.message)
}

/* --------------------------------------------------------------------- lint */

/**
 * Lint an already loaded package (pure, synchronous).
 *
 * @param {object} pkg result of `loadPackage()`
 * @param {{strict?: boolean, targetRelease?: string}} [options]
 */
export function lintLoadedPackage(pkg, options = {}) {
  const strict = options.strict === true
  const targetRelease = options.targetRelease ?? DEFAULT_TARGET_RELEASE
  const issues = []

  const {
    layout,
    parsed,
    texts,
  } = pkg
  const changelog = parsed.changelog
  const control = parsed.control
  const copyright = parsed.copyright
  const rules = parsed.rules
  const watch = parsed.watch
  const tests = parsed.tests

  /* ---------- missing mandatory files ---------- */
  if (texts.changelog === null) {
    issues.push(issue('no-debian-changelog', 'error', 'no-debian-changelog',
      'debian/changelog is missing', debianRelative('changelog'), null,
      'Create debian/changelog with dch --create or debchange, then add a release entry.'))
  }
  if (texts.control === null) {
    issues.push(issue('no-control-file', 'error', 'no-control-file',
      'debian/control is missing', debianRelative('control'), null,
      'Create debian/control with a Source stanza and at least one Package stanza.'))
  }
  if (texts.copyright === null) {
    issues.push(issue('no-copyright-file', 'error', 'no-copyright-file',
      'debian/copyright is missing', debianRelative('copyright'), null,
      'Create a DEP-5 debian/copyright with Format, Files and License stanzas.'))
  }
  if (texts.rules === null) {
    issues.push(issue('no-debian-rules', 'error', 'no-debian-rules',
      'debian/rules is missing', debianRelative('rules'), null,
      'Create debian/rules starting with #!/usr/bin/make -f and a %: target that runs dh $@.'))
  } else if (CAN_CHECK_EXECUTABLE_BITS && !rules.executable) {
    issues.push(issue('debian-rules-not-executable', 'error', 'debian-rules-not-executable',
      'debian/rules is not executable', debianRelative('rules'), 1,
      'chmod +x debian/rules and commit the executable bit.'))
  }
  if (layout.sourceFormat === null) {
    issues.push(issue('missing-debian-source-format', 'warning', 'missing-debian-source-format',
      'debian/source/format is missing', debianRelative('source/format'), null,
      'Write 3.0 (quilt) into debian/source/format; use 3.0 (native) only for native packages.'))
  } else if (layout.sourceFormat === '1.0') {
    issues.push(issue('source-format-1.0', 'warning', 'source-format-1.0',
      'source format 1.0 is deprecated', debianRelative('source/format'), 1,
      'Migrate to 3.0 (quilt) (or 3.0 (native) for native packages).'))
  }

  /* ---------- changelog ---------- */
  if (changelog) {
    const first = changelog.entries[0] ?? null
    const changelogFile = debianRelative('changelog')
    const headerLine = first?.headerLine ?? 1
    const headerIssues = (changelog.issues ?? []).filter((entry) =>
      entry.code === 'changelog-malformed-header' || entry.code === 'changelog-empty')
    for (const entry of headerIssues) {
      issues.push(issue('U001', 'error', 'changelog-malformed-header',
        entry.message, changelogFile, entry.line,
        'The header must read "source (version) distribution; urgency=medium" followed by the changes and the trailer.'))
    }

    const controlSource = control?.source ? fieldValue(control.source, 'Source') : null
    if (first && controlSource && first.source !== controlSource) {
      issues.push(issue('U002', 'error', 'changelog-source-mismatch',
        `changelog names "${first.source}" but debian/control has Source "${controlSource}"`,
        changelogFile, headerLine,
        'Rename the package consistently in debian/changelog and debian/control.'))
    }
    if (first && layout.sourceFormat === '3.0 (quilt)' && changelog.debianRevision === null) {
      issues.push(issue('U003', 'warning', 'version-without-debian-revision',
        `version "${first.version}" has no Debian revision while the source format is 3.0 (quilt)`,
        changelogFile, headerLine,
        'Use a version such as 1.0-0ubuntu1: the last dash separates the Debian revision.'))
    }
    if (first) {
      if (!first.distribution || first.distribution === 'unstable' || first.distribution === 'UNRELEASED') {
        issues.push(issue('U004', 'warning', 'changelog-bad-distribution',
          `distribution "${first.distribution ?? ''}" is not a release codename`,
          changelogFile, headerLine,
          `Set the distribution to the target codename (current target: ${targetRelease}); use UNRELEASED only in an unreleased branch.`))
      }
      if (!KNOWN_URGENCIES.includes(first.urgency)) {
        issues.push(issue('U005', 'warning', 'changelog-bad-urgency',
          `urgency "${first.urgency}" is not one of ${KNOWN_URGENCIES.join(', ')}`,
          changelogFile, headerLine,
          'Use urgency=medium unless the upload fixes a release-critical bug.'))
      }
      if (!first.maintainer || !first.date || first.complete === false) {
        issues.push(issue('U007', 'warning', 'changelog-trailer-shape',
          'changelog trailer is not in the " -- Name <email>  Date" shape',
          changelogFile, first.missingTrailerLine ?? first.trailerLine ?? headerLine,
          'End the entry with " -- Your Name <you@example.com>  " and the output of date -R.'))
      } else if (!isRfc5322Date(first.date)) {
        issues.push(issue('U006', 'warning', 'changelog-trailer-date',
          `changelog date "${first.date}" is not in RFC 5322 (date -R) form`,
          changelogFile, first.trailerLine ?? headerLine,
          'Refresh the trailer date with dch -r or paste date -R output.'))
      }
    }
  }

  /* ---------- control ---------- */
  const controlFile = debianRelative('control')
  if (control) {
    const source = control.source
    if (!source) {
      issues.push(issue('U010', 'error', 'control-no-source-stanza',
        'debian/control has no Source stanza', controlFile, 1,
        'The first stanza must declare Source, Section, Priority, Maintainer, Build-Depends and Standards-Version.'))
    } else {
      const stanzaLine = source.lines.start
      const fieldLine = (name) => source.lines.fields.get(name) ?? stanzaLine
      if (!fieldValue(source, 'Section')) {
        issues.push(issue('no-section-field', 'warning', 'no-section-field',
          'source stanza has no Section field', controlFile, stanzaLine,
          'Add Section: misc (or the archive section this package belongs to).'))
      }
      if (!fieldValue(source, 'Priority')) {
        issues.push(issue('no-priority-field', 'warning', 'no-priority-field',
          'source stanza has no Priority field', controlFile, stanzaLine,
          'Add Priority: optional.'))
      }
      const standardsVersion = fieldValue(source, 'Standards-Version')
      if (!standardsVersion) {
        issues.push(issue('no-standards-version-field', 'error', 'no-standards-version-field',
          'source stanza has no Standards-Version field', controlFile, stanzaLine,
          `Add Standards-Version: ${CURRENT_STANDARDS_VERSION}.`))
      } else if (compareDottedVersions(standardsVersion, CURRENT_STANDARDS_VERSION) < 0) {
        issues.push(issue('U008', 'info', 'standards-version-outdated',
          `Standards-Version ${standardsVersion} is older than ${CURRENT_STANDARDS_VERSION}`,
          controlFile, fieldLine('Standards-Version'),
          `Update to ${CURRENT_STANDARDS_VERSION} after checking debian-policy for new requirements.`))
      }
      if (layout.debian && (layout.compat === null) && !compatFromBuildDepends(pkg.buildDepends)) {
        issues.push(issue('debhelper-compat-file-is-missing', 'error', 'debhelper-compat-file-is-missing',
          'neither debian/compat nor "debhelper-compat (= N)" in Build-Depends is present',
          controlFile, fieldLine('Build-Depends'),
          `Add Build-Depends: debhelper-compat (= ${CURRENT_DEBHELPER_COMPAT}).`))
      }
      if (layout.debian && layout.compat !== null && compatFromBuildDepends(pkg.buildDepends) !== null) {
        issues.push(issue('U009', 'warning', 'debhelper-compat-duplicated',
          'both debian/compat and debhelper-compat (= N) are present',
          controlFile, fieldLine('Build-Depends'),
          'Keep only debhelper-compat (= 13) in Build-Depends and delete debian/compat.'))
      }
      if (layout.debhelperCompat !== null && Number.parseInt(layout.debhelperCompat, 10) < CURRENT_DEBHELPER_COMPAT) {
        const compatFile = layout.compat !== null ? debianRelative('compat') : controlFile
        issues.push(issue('package-uses-old-debhelper-compat-version', 'warning', 'old-debhelper-compat',
          `debhelper compat ${layout.debhelperCompat} is older than ${CURRENT_DEBHELPER_COMPAT}`,
          compatFile, layout.compat !== null ? 1 : fieldLine('Build-Depends'),
          `Raise the compat level to ${CURRENT_DEBHELPER_COMPAT} and rebuild.`))
      }
      if (!fieldValue(source, 'Rules-Requires-Root')) {
        issues.push(issue('rules-requires-root-missing', 'warning', 'rules-requires-root-missing',
          'source stanza has no Rules-Requires-Root field', controlFile, stanzaLine,
          'Add Rules-Requires-Root: no unless the build genuinely needs root.'))
      }
      for (const entry of pkg.buildDepends) {
        for (const alternative of String(entry).split('|')) {
          const match = alternative.trim().match(/^([a-z0-9][a-z0-9+.-]*)(?:[ \t]*\(([^)]*)\))?/)
          if (!match) continue
          if (ESSENTIAL_PACKAGES.includes(match[1]) && !match[2]) {
            issues.push(issue('build-depends-on-essential-package-without-using-version', 'warning',
              'build-depends-essential-package',
              `Build-Depends on essential package "${match[1]}" without a version`,
              controlFile, fieldLine('Build-Depends'),
              'Drop the dependency (it is already essential) or add an explicit version.'))

          }
        }
      }
      const homepage = fieldValue(source, 'Homepage')
      if (!homepage || !/^https?:\/\//i.test(homepage.trim())) {
        issues.push(issue('U014', 'info', 'homepage-missing',
          homepage ? `Homepage "${homepage}" is not an http(s) URL` : 'source stanza has no Homepage field',
          controlFile, fieldLine('Homepage') || stanzaLine,
          'Add Homepage: https://… for the upstream project.'))
      }
      if (!fieldValue(source, 'Vcs-Git') && !fieldValue(source, 'Vcs-Browser')) {
        issues.push(issue('U015', 'info', 'vcs-fields-missing',
          'source stanza has no Vcs-Git/Vcs-Browser fields', controlFile, stanzaLine,
          'Add Vcs-Git and Vcs-Browser so reviewers can find the packaging repository.'))
      }
    }

    if (pkg.packages.length === 0) {
      issues.push(issue('U010', 'error', 'control-no-binary-stanza',
        'debian/control has no binary package stanza', controlFile, control.stanzas[0]?.lines.start ?? 1,
        'Add a Package stanza with Architecture, Depends and Description.'))
    }

    for (const stanza of pkg.packages) {
      const name = fieldValue(stanza, 'Package') ?? '(unnamed)'
      const stanzaLine = stanza.lines.start
      const fieldLine = (field) => stanza.lines.fields.get(field) ?? stanzaLine
      const architecture = fieldValue(stanza, 'Architecture')
      const architectureTokens = String(architecture ?? '').trim().split(/\s+/).filter(Boolean)
      const architectureOk = architectureTokens.length > 0
        && architectureTokens.every((token) => ARCHITECTURE_TOKEN.test(token))
      if (!architectureOk) {
        issues.push(issue('U011', 'warning', 'binary-architecture-odd',
          architecture ? `package "${name}" has an odd Architecture "${architecture}"` : `package "${name}" has no Architecture field`,
          controlFile, fieldLine('Architecture'),
          'Use Architecture: any (or all for architecture-independent packages).'))
      }
      const depends = fieldValue(stanza, 'Depends')
      if (!String(depends ?? '').includes('${misc:Depends}')) {
        issues.push(issue('U012', 'info', 'binary-depends-misc',
          `package "${name}" Depends does not include \${misc:Depends}`, controlFile, fieldLine('Depends'),
          'Add ${misc:Depends} so debhelper-generated dependencies are preserved.'))
      }
      const description = fieldValue(stanza, 'Description')
      if (description) {
        const synopsis = description.split('\n')[0].trim()
        if (/^[a-z]/.test(synopsis) || synopsis.endsWith('.')) {
          issues.push(issue('U013', 'warning', 'description-synopsis',
            `package "${name}" Description synopsis must start uppercase and must not end with a period`,
            controlFile, fieldLine('Description'),
            'Rewrite the synopsis as a short noun phrase without a trailing period.'))
        }
      }
    }
  }

  /* ---------- rules ---------- */
  if (texts.rules !== null) {
    const rulesFile = debianRelative('rules')
    if (!rules.dhSequencer) {
      issues.push(issue('U016', 'warning', 'rules-no-dh-sequencer',
        'debian/rules does not run "dh $@"', rulesFile, 1,
        'Use the dh sequencer: a "%:" target that runs "dh $@".'))
    }
    const direct = (rules.directDhCalls ?? []).filter((call) => !String(call.target ?? '').startsWith('override_'))
    for (const call of direct) {
      issues.push(issue('U017', 'warning', 'rules-direct-dh-call',
        `direct ${call.name} call outside an override_* target`, rulesFile, call.line,
        `Move ${call.name} into an override_${call.name} target (or remove it and rely on dh $@).`))
    }
    if (rules.dhCleanK) {
      issues.push(issue('U018', 'warning', 'rules-dh-clean-k',
        'debian/rules uses the deprecated "dh_clean -k"', rulesFile, rules.dhCleanKLine ?? 1,
        'Replace "dh_clean -k" with "dh_clean" inside an override_dh_clean target if trimming is still needed.'))
    }
    if (rules.shebang !== '#!/usr/bin/make -f') {
      issues.push(issue('U019', 'warning', 'rules-shebang',
        rules.shebang ? `debian/rules has an unexpected shebang "${rules.shebang}"` : 'debian/rules has no shebang',
        rulesFile, 1,
        'Start debian/rules with #!/usr/bin/make -f.'))
    }
    if (!/DEB_BUILD_OPTIONS|dpkg-buildflags/.test(texts.rules)) {
      issues.push(issue('U039', 'info', 'rules-hardening-not-referenced',
        'debian/rules does not reference DEB_BUILD_OPTIONS or dpkg-buildflags',
        rulesFile, 1,
        'dh reads both automatically; only add explicit handling if the build must override hardening flags.'))
    }
  }

  /* ---------- copyright ---------- */
  if (copyright) {
    const copyrightFile = debianRelative('copyright')
    if (!copyright.format) {
      issues.push(issue('U020', 'warning', 'copyright-no-format',
        'debian/copyright has no DEP-5 Format field', copyrightFile, 1,
        'Start debian/copyright with Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/.'))
    }
    if (!copyright.hasFiles) {
      issues.push(issue('U021', 'warning', 'copyright-no-files',
        'debian/copyright has no Files stanza', copyrightFile, 1,
        'Add a "Files: *" stanza describing the upstream license.'))
    }
    if (!copyright.hasLicense) {
      issues.push(issue('U022', 'warning', 'copyright-no-license',
        'debian/copyright has no License stanza', copyrightFile, 1,
        'Add a License field with the full license text and copyright holders.'))
    }
  }

  /* ---------- watch ---------- */
  if (watch === null) {
    issues.push(issue('debian-watch-file-is-missing', 'info', 'debian-watch-file-is-missing',
      'debian/watch is missing', debianRelative('watch'), null,
      'Add a version=4 watch file so uscan can detect new upstream releases.'))
  } else {
    const watchFile = debianRelative('watch')
    if (watch.version !== 4) {
      issues.push(issue('U023', 'warning', 'watch-version',
        'debian/watch does not declare version=4', watchFile, watch.versionLine ?? 1,
        'Start debian/watch with version=4.'))
    }
    for (const entry of watch.entries) {
      if (/^http:\/\//i.test(entry.url)) {
        issues.push(issue('U024', 'warning', 'watch-insecure-url',
          `debian/watch downloads over http: ${entry.url}`, watchFile, entry.line,
          'Use https:// for the watch URL.'))
      }
      if (!entry.captureGroup) {
        const checked = entry.pattern ?? entry.url
        issues.push(issue('U025', 'warning', 'watch-no-capture-group',
          `debian/watch entry has no (...) capture group: ${checked}`, watchFile, entry.line,
          'Add a (...) version capture group to the URL or the filename pattern, for example "hello-([\\d.]+)\\.tar\\.gz".'))
      }
    }
  }

  /* ---------- patches ---------- */
  const patches = pkg.patches
  if (patches.missingFromSeries.length > 0 || patches.unlistedPatches.length > 0 || patches.files.length > 0) {
    const seriesFile = debianRelative('patches/series')
    const seriesEntries = parsed.series?.entries ?? []
    for (const missing of patches.missingFromSeries) {
      const entry = seriesEntries.find((candidate) => candidate.name === missing)
      issues.push(issue('U026', 'error', 'patch-missing',
        `debian/patches/series lists "${missing}" but debian/patches/${missing} does not exist`,
        seriesFile, entry?.line ?? 1,
        `Add debian/patches/${missing} or remove it from the series file.`))
    }
    for (const unlisted of patches.unlistedPatches) {
      issues.push(issue('U027', 'warning', 'patch-unlisted',
        `debian/patches/${unlisted} exists but is not listed in series`,
        `debian/patches/${unlisted}`, 1,
        'List the patch in debian/patches/series (quilt only applies listed patches).'))
    }
    for (const patchName of patches.series) {
      if (!patches.files.includes(patchName)) continue
      const summary = patches.dep3[patchName] ?? {}
      const patchFile = `debian/patches/${patchName}`
      if (!summary.Description) {
        issues.push(issue('U028', 'warning', 'patch-no-description',
          `patch "${patchName}" has no DEP-3 Description header`, patchFile, 1,
          'Add "Description: <what the patch does>" as the first header line.'))
      }
      if (!summary.Origin && !summary.Forwarded) {
        issues.push(issue('U029', 'warning', 'patch-no-origin',
          `patch "${patchName}" has neither Origin nor Forwarded`, patchFile, 1,
          'Add Origin and Forwarded so reviewers know where the patch came from.'))
      }
      if (!/^\d{4}-/.test(patchName)) {
        issues.push(issue('U030', 'info', 'patch-numbering',
          `patch "${patchName}" does not start with NNNN-`, patchFile, 1,
          'Rename the patch to 0001-short-description.patch.'))
      }
    }
  }

  /* ---------- DEP-8 tests ---------- */
  const testsFile = debianRelative('tests/control')
  if (pkg.layout.debian) {
    const testsuite = fieldValue(pkg.sourceStanza ?? {}, 'Testsuite') ?? ''
    if (/\bautopkgtest\b/.test(testsuite) && !pkg.tests.control) {
      issues.push(issue('U031', 'warning', 'testsuite-without-tests',
        'Testsuite: autopkgtest is declared but debian/tests/control is missing',
        testsFile, null,
        'Add debian/tests/control with at least Tests and Depends, or drop Testsuite: autopkgtest.'))
    }
  }
  for (const entry of pkg.tests.entries) {
    if (entry.tests.length === 0 || entry.depends.length === 0) {
      issues.push(issue('U032', 'error', 'dep8-missing-fields',
        'debian/tests/control entry is missing Tests or Depends', testsFile, entry.line,
        'Every entry needs "Tests: <script>" and "Depends: @[, ...]".'))
    }
    for (const restriction of entry.restrictions) {
      if (!KNOWN_DEP8_RESTRICTIONS.includes(restriction)) {
        issues.push(issue('U033', 'error', 'dep8-unknown-restriction',
          `unknown DEP-8 restriction "${restriction}"`, testsFile, entry.line,
          `Use one of ${KNOWN_DEP8_RESTRICTIONS.join(', ')}.`))
      }
    }
    const hasBuildEssential = entry.depends.some((dependency) => dependency === 'build-essential' || dependency.startsWith('build-essential '))
    if (entry.tests.includes('build') && !hasBuildEssential) {
      issues.push(issue('U037', 'info', 'dep8-build-without-build-essential',
        'Tests: build does not list build-essential in Depends', testsFile, entry.line,
        'Add build-essential to Depends when the test runs the package build.'))
    }
  }
  for (const script of pkg.tests.scripts) {
    const scriptFile = `debian/tests/${script.name}`
    if (!script.exists) {
      issues.push(issue('U034', 'warning', 'dep8-script-missing',
        `test script "${script.name}" is listed but does not exist`, scriptFile, null,
        `Add ${scriptFile} or fix the Tests: field.`))
      continue
    }
    if (CAN_CHECK_EXECUTABLE_BITS && !script.executable) {
      issues.push(issue('U035', 'warning', 'dep8-script-not-executable',
        `test script "${script.name}" is not executable`, scriptFile, 1,
        'chmod +x the test script and commit the executable bit.'))
    }
    if (!script.shebang || !script.shebang.startsWith('#!')) {
      issues.push(issue('U036', 'info', 'dep8-script-shebang',
        `test script "${script.name}" has no shebang`, scriptFile, 1,
        'Start the test script with #!/bin/sh and set -eu.'))
    }
  }

  /* ---------- debian/*.install ---------- */
  for (const install of pkg.installFiles) {
    for (const line of install.lines) {
      if (line.exists === false) {
        issues.push(issue('U038', 'warning', 'install-path-missing',
          `debian/${install.name} references "${line.target}", which does not exist in the source tree`,
          debianRelative(install.name), line.line,
          'Fix the path (paths are relative to the staged tree, e.g. usr/bin/hello) or remove the line.'))
      }
    }
  }

  issues.sort(compareIssues)
  const errorCount = issues.filter((entry) => entry.severity === 'error').length
  const warningCount = issues.filter((entry) => entry.severity === 'warning').length
  const infoCount = issues.filter((entry) => entry.severity === 'info').length
  return {
    path: pkg.path,
    ok: errorCount === 0 && (!strict || warningCount === 0),
    errorCount,
    warningCount,
    infoCount,
    issues,
  }
}

/** Load and lint one source package. */
export async function lintPackage(input = {}) {
  const tool = input.tool ?? 'ubuntu_lint_package'
  const pkg = await loadPackage(input.path, { tool })
  return lintLoadedPackage(pkg, {
    strict: input.strict === true,
    targetRelease: input.targetRelease ?? DEFAULT_TARGET_RELEASE,
  })
}

/** Public changelog summary used by the inspect tool. */
export function changelogSummary(parsed) {
  if (!parsed) return null
  return {
    source: parsed.source,
    version: parsed.version,
    upstreamVersion: parsed.upstreamVersion,
    debianRevision: parsed.debianRevision,
    ubuntuRevision: parsed.ubuntuRevision,
    distribution: parsed.distribution,
    urgency: parsed.urgency,
    maintainer: parsed.maintainer,
    date: parsed.date,
    entries: parsed.entries.length,
  }
}

/** Public control summary used by the inspect tool. */
export function controlSummary(pkg) {
  if (!pkg.parsed.control || !pkg.sourceStanza) return null
  const source = pkg.sourceStanza
  const vcs = {}
  for (const name of ['Vcs-Browser', 'Vcs-Git']) {
    const value = fieldValue(source, name)
    if (value !== undefined) vcs[name] = value
  }
  return {
    source: {
      source: fieldValue(source, 'Source') ?? null,
      section: fieldValue(source, 'Section') ?? null,
      priority: fieldValue(source, 'Priority') ?? null,
      maintainer: fieldValue(source, 'Maintainer') ?? null,
      standardsVersion: fieldValue(source, 'Standards-Version') ?? null,
      buildDepends: splitList(fieldValue(source, 'Build-Depends')),
      homepage: fieldValue(source, 'Homepage') ?? null,
      rulesRequiresRoot: fieldValue(source, 'Rules-Requires-Root') ?? null,
      testsuite: splitList(fieldValue(source, 'Testsuite')),
      vcs,
    },
    packages: pkg.packages.map((stanza) => ({
      package: fieldValue(stanza, 'Package') ?? null,
      architecture: fieldValue(stanza, 'Architecture') ?? null,
      depends: splitList(fieldValue(stanza, 'Depends')),
      description: (fieldValue(stanza, 'Description') ?? '').split('\n')[0] || null,
    })),
  }
}

/** Public rules summary used by the inspect tool. */
export function rulesSummary(rules) {
  return {
    present: rules.present === true,
    executable: rules.executable === true,
    dhSequencer: rules.dhSequencer === true,
    overrides: rules.overrides ?? [],
    buildsystem: rules.buildsystem ?? null,
  }
}

/** Public tests summary used by the inspect tool. */
export function testsSummary(pkg) {
  return {
    control: pkg.tests.control,
    entries: pkg.tests.entries.map((entry) => ({
      tests: entry.tests,
      depends: entry.depends,
      restrictions: entry.restrictions,
    })),
    scripts: pkg.tests.scripts.filter((script) => script.exists).map((script) => script.name),
  }
}
