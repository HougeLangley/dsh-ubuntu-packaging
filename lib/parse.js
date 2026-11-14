/**
 * Pure parsers for Debian/Ubuntu source-package metadata.
 *
 * Every parser is total: malformed input produces an `issue` with a 1-based
 * line number instead of throwing. File-system access lives in `lib/lint.js`;
 * this module only ever sees text.
 *
 * Issue shape (parse level, distinct from lint issues):
 *   { code: string, message: string, file: string | null, line: number | null }
 */

/* ------------------------------------------------------------------ helpers */

/** Split text into lines, normalising CRLF/CR without losing empty lines. */
export function splitLines(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
}

/** Build a parse issue. */
export function parseIssue(code, message, file, line) {
  return { code, message, file: file ?? null, line: line ?? null }
}

/** Read a deb822 field case-insensitively from a parsed stanza. */
export function fieldValue(stanza, name) {
  if (!stanza || !(stanza.fields instanceof Map)) return undefined
  const wanted = String(name).toLowerCase()
  for (const [key, value] of stanza.fields) {
    if (key.toLowerCase() === wanted) return value
  }
  return undefined
}

/** True when the stanza carries a field with this name (case-insensitive). */
export function hasField(stanza, name) {
  return fieldValue(stanza, name) !== undefined
}

/** Split a deb822 list value ("a, b, c") into trimmed entries. */
export function splitList(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/** First non-empty, non-comment line of a small single-value file. */
export function firstContentLine(text) {
  for (const raw of splitLines(text)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    return line
  }
  return null
}

function stripTrailing(value) {
  return String(value ?? '').replace(/\s+$/g, '')
}

/* ------------------------------------------------------------------- deb822 */

/**
 * Parse a deb822 file (`debian/control`, `debian/tests/control`, the DEP-5
 * copyright header, a DEP-3 patch header).
 *
 * Rules implemented:
 * - stanzas are separated by one or more blank lines;
 * - a field line is `Name: value`; field spelling is preserved in `fields`;
 * - continuation lines start with a space or tab and are joined with `\n`;
 * - a continuation line whose content is exactly `.` means "blank line".
 *
 * @returns {{ stanzas: Array<{fields: Map<string,string>, order: string[], lines: {start:number,end:number,fields:Map<string,number>}}>, issues: Array<object> }}
 */
export function parseDeb822(text, options = {}) {
  const file = options.file ?? null
  const startLine = Number.isInteger(options.startLine) ? options.startLine : 1
  const lines = splitLines(text)
  const stanzas = []
  const issues = []

  /** @type {null | {fields: Map<string,string>, order: string[], lines: object, field: string|null}} */
  let stanza = null

  const startStanza = (line) => ({
    fields: new Map(),
    order: [],
    lines: { start: line, end: line, fields: new Map() },
    field: null,
  })

  const flush = () => {
    if (stanza) {
      delete stanza.field
      stanzas.push(stanza)
      stanza = null
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    const line = startLine + index

    if (raw.trim() === '') {
      flush()
      continue
    }

    if (raw.startsWith(' ') || raw.startsWith('\t')) {
      if (!stanza || !stanza.field) {
        issues.push(parseIssue(
          'deb822-continuation-without-field',
          'continuation line appears before any field',
          file,
          line,
        ))
        continue
      }
      const content = raw.replace(/^[ \t]+/, '')
      const value = content === '.' ? '' : content
      stanza.fields.set(stanza.field, `${stanza.fields.get(stanza.field)}\n${value}`)
      stanza.lines.end = line
      continue
    }

    const match = raw.match(/^([^\s:][^:]*):(?:[ \t]*(.*))?$/)
    if (!match) {
      issues.push(parseIssue(
        'deb822-malformed-line',
        `malformed deb822 line: ${raw.trim().slice(0, 80)}`,
        file,
        line,
      ))
      continue
    }

    if (!stanza) stanza = startStanza(line)
    const name = match[1]
    const value = match[2] ?? ''
    if (stanza.fields.has(name)) {
      issues.push(parseIssue(
        'deb822-duplicate-field',
        `duplicate field "${name}" in one stanza`,
        file,
        line,
      ))
    }
    stanza.fields.set(name, value)
    stanza.order.push(name)
    if (!stanza.lines.fields.has(name)) stanza.lines.fields.set(name, line)
    stanza.field = name
    stanza.lines.end = line
  }

  flush()
  return { stanzas, issues }
}

/** Parse `debian/control` into the source stanza plus every binary stanza. */
export function parseControl(text, options = {}) {
  const parsed = parseDeb822(text, options)
  const source = parsed.stanzas.find((stanza) => hasField(stanza, 'Source')) ?? parsed.stanzas[0] ?? null
  const packages = parsed.stanzas.filter((stanza) => stanza !== source && hasField(stanza, 'Package'))
  return { stanzas: parsed.stanzas, source, packages, issues: parsed.issues }
}

/* ------------------------------------------------------------------ versions */

/**
 * Split a Debian version into epoch / upstream / Debian revision / Ubuntu
 * revision. The last `-` separates the Debian revision; a trailing
 * `ubuntuN` (or `ubuntuN.M`) is additionally reported as the Ubuntu revision,
 * leaving the Debian revision in front of it (`2.10-0ubuntu1` -> `0`).
 *
 * Native versions (no `-` at all) report `native: true` and no revision.
 * `+dfsg` stays part of the upstream version and `~` is never normalised.
 */
export function splitVersion(version) {
  const raw = String(version ?? '').trim()
  const result = {
    epoch: null,
    upstreamVersion: raw,
    debianRevision: null,
    ubuntuRevision: null,
    native: false,
  }
  if (raw === '') return result

  let rest = raw
  const epochMatch = rest.match(/^(\d+):(.*)$/)
  if (epochMatch) {
    result.epoch = epochMatch[1]
    rest = epochMatch[2]
  }

  const dash = rest.lastIndexOf('-')
  if (dash <= 0) {
    result.upstreamVersion = rest
    result.native = true
    return result
  }

  result.upstreamVersion = rest.slice(0, dash)
  let revision = rest.slice(dash + 1)
  const ubuntuMatch = revision.match(/ubuntu\d+(?:\.\d+)?$/)
  if (ubuntuMatch) {
    result.ubuntuRevision = ubuntuMatch[0]
    revision = revision.slice(0, revision.length - ubuntuMatch[0].length)
  }
  result.debianRevision = revision === '' ? null : revision
  return result
}

const CHANGELOG_HEADER_RE = /^(\S+)[ \t]+\(([^()]+)\)[ \t]+([^;]+?)[ \t]*;[ \t]*(?:urgency|priority)[ \t]*=[ \t]*([^\s;]*)[ \t]*$/i
// Early Debian changelogs omitted the distribution and used priority=.
const CHANGELOG_LEGACY_HEADER_RE = /^(\S+)[ \t]+\(([^()]+)\)[ \t]*;[ \t]*(?:urgency|priority)[ \t]*=[ \t]*([^\s;]*)[ \t]*$/i

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** True when a changelog trailer date matches the `date -R` (RFC 5322) shape. */
export function isRfc5322Date(value) {
  const match = String(value ?? '').trim().match(
    /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), ([0-9]{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([0-9]{4}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) ([+-])([0-9]{2})([0-9]{2})$/,
  )
  if (!match) return false
  const day = Number(match[1])
  const month = MONTHS.indexOf(match[2])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  return month >= 0 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59 && second <= 60
}

/** Format a Date as an RFC 5322 (`date -R`) changelog trailer timestamp. */
export function formatRfc5322Date(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const absolute = Math.abs(offset)
  const zone = `${sign}${pad(Math.floor(absolute / 60))}${pad(absolute % 60)}`
  return `${DAYS[date.getDay()]}, ${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${zone}`
}

/** Extract a trailer ` -- Name <email>  Date` split into maintainer and date. */
export function parseTrailer(body) {
  const text = String(body ?? '')
  const shaped = text.match(/^(\S.*?<[^<>]+>)[ \t]{2,}(.+)$/)
  if (shaped) return { maintainer: shaped[1].trim(), date: shaped[2].trim(), complete: true }
  const loose = text.match(/^(\S.*?<[^<>]+>)[ \t]+(.+)$/)
  if (loose) return { maintainer: loose[1].trim(), date: loose[2].trim(), complete: false }
  return { maintainer: text.trim() || null, date: null, complete: false }
}

/* ---------------------------------------------------------------- changelog */

/**
 * Parse a Debian changelog into its entries.
 *
 * @returns {{
 *   source: string|null, version: string|null, upstreamVersion: string|null,
 *   debianRevision: string|null, ubuntuRevision: string|null, epoch: string|null,
 *   native: boolean, distribution: string|null, urgency: string|null,
 *   maintainer: string|null, date: string|null,
 *   entries: Array<object>, changes: string[], issues: Array<object>
 * }}
 */
export function parseChangelog(text, options = {}) {
  const file = options.file ?? null
  const lines = splitLines(text)
  const issues = []
  const entries = []

  let index = 0
  while (index < lines.length) {
    while (index < lines.length && lines[index].trim() === '') index += 1
    if (index >= lines.length) break

    const headerLine = index + 1
    const header = lines[index]
    // The distribution field may list several space-separated codenames
    // (for example `frozen unstable` in historical Debian changelogs).
    let match = header.match(CHANGELOG_HEADER_RE)
    let legacy = false
    if (!match) {
      match = header.match(CHANGELOG_LEGACY_HEADER_RE)
      legacy = true
    }
    if (!match) {
      issues.push(parseIssue(
        'changelog-malformed-header',
        `malformed changelog header: ${header.trim().slice(0, 120)}`,
        file,
        headerLine,
      ))
      // The current (first) entry is authoritative: stop there. Historical
      // entries are best-effort, so skip to the next plausible header instead
      // of aborting the whole changelog.
      if (entries.length === 0) break
      let next = index + 1
      while (next < lines.length && !/^\S+[ \t]+\([^()]+\)/.test(lines[next])) next += 1
      index = next
      continue
    }

    const distributions = legacy ? [] : match[3].trim().split(/\s+/).filter(Boolean)
    const entry = {
      source: match[1],
      version: match[2],
      distribution: distributions.join(' '),
      distributions,
      legacy,
      urgency: legacy ? match[3] : match[4],
      changes: [],
      maintainer: null,
      date: null,
      headerLine,
      trailerLine: null,
      complete: false,
    }
    index += 1

    let sawTrailer = false
    while (index < lines.length) {
      const raw = lines[index]
      const trailer = raw.match(/^ -- (.*)$/)
      if (trailer) {
        entry.trailerLine = index + 1
        const parsed = parseTrailer(trailer[1])
        entry.maintainer = parsed.maintainer
        entry.date = parsed.date
        entry.complete = parsed.complete
        if (!parsed.complete) {
          issues.push(parseIssue(
            'changelog-incomplete-trailer',
            'changelog trailer is not in the " -- Name <email>  Date" shape',
            file,
            entry.trailerLine,
          ))
        }
        index += 1
        sawTrailer = true
        break
      }
      if (raw.trim() === '') {
        index += 1
        continue
      }
      if (raw.startsWith(' ') || raw.startsWith('\t')) {
        entry.changes.push(stripTrailing(raw))
        index += 1
        continue
      }
      entry.missingTrailerLine = index + 1
      break
    }

    if (!sawTrailer) {
      issues.push(parseIssue(
        'changelog-missing-trailer',
        'changelog entry is not closed by a " -- Name <email>  Date" trailer',
        file,
        entry.missingTrailerLine ?? entry.headerLine,
      ))
    }
    entries.push(entry)
  }

  if (entries.length === 0 && issues.length === 0) {
    issues.push(parseIssue('changelog-empty', 'no changelog entry found', file, 1))
  }

  const first = entries[0] ?? null
  const split = splitVersion(first?.version ?? '')
  return {
    source: first?.source ?? null,
    version: first?.version ?? null,
    epoch: split.epoch,
    upstreamVersion: split.upstreamVersion || null,
    debianRevision: split.debianRevision,
    ubuntuRevision: split.ubuntuRevision,
    native: split.native,
    distribution: first?.distribution ?? null,
    distributions: first?.distributions ?? [],
    urgency: first?.urgency ?? null,
    maintainer: first?.maintainer ?? null,
    date: first?.date ?? null,
    changes: first?.changes ?? [],
    entries,
    issues,
  }
}

/* --------------------------------------------------------------------- rules */

const BUILD_SYSTEM_PATTERNS = [
  { name: 'python', test: /\bpybuild\b|\bPYBUILD_/ },
  { name: 'rust', test: /\bcargo\b|\bdeb-cargo\b/ },
  { name: 'go', test: /\bgo build\b|\bgolang\b|--buildsystem=go\b/ },
  { name: 'node', test: /\bnpm\b|\bnode-gyp\b|--buildsystem=node\b/ },
  { name: 'meson', test: /\bmeson\b|--buildsystem=meson\b/ },
  { name: 'cmake', test: /\bcmake\b|--buildsystem=cmake\b/ },
]

/**
 * Parse `debian/rules`.
 *
 * Detects the shebang, `dh $@` sequencer use, `override_dh_*` targets, direct
 * `dh_*` calls made outside an override (a lint warning), the deprecated
 * `dh_clean -k` idiom and the inferred build system.
 */
export function parseRules(text, options = {}) {
  const file = options.file ?? 'debian/rules'
  const executable = options.executable ?? null
  const lines = splitLines(text)
  const issues = []
  const overrides = []
  const directDhCalls = []
  const codeLines = []

  let shebang = null
  let dhSequencer = false
  let dhCleanK = false
  let dhCleanKLine = null
  let hasPercentTarget = false
  let currentTarget = null

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    const line = index + 1

    if (index === 0 && raw.startsWith('#!')) {
      shebang = raw.trim()
      continue
    }
    if (raw.trim() === '') continue
    const isComment = /^[ \t]*#/.test(raw)
    if (isComment) continue
    codeLines.push(raw)

    const targetMatch = raw.match(/^([^\s:#=][^:#=]*):(?![:=])/)
    if (targetMatch && !raw.startsWith('\t') && !raw.startsWith(' ')) {
      currentTarget = targetMatch[1].trim()
      if (currentTarget === '%' || currentTarget.includes('%')) hasPercentTarget = true
      if (currentTarget.startsWith('override_')) {
        const name = currentTarget.slice('override_'.length)
        if (name.startsWith('dh_') && !overrides.includes(name)) overrides.push(name)
      }
      continue
    }

    if (raw.startsWith('\t') || raw.startsWith(' ')) {
      if (!currentTarget) {
        issues.push(parseIssue(
          'rules-recipe-without-target',
          'recipe line appears before any make target',
          file,
          line,
        ))
        continue
      }
      const recipe = raw.trim()
      if (/\bdh[ \t]+\$@/.test(recipe)) dhSequencer = true
      if (/\bdh_clean[ \t]+-k\b/.test(recipe)) {
        dhCleanK = true
        if (dhCleanKLine === null) dhCleanKLine = line
      }
      const commands = recipe.split(/;|&&|\|\|/).map((entry) => entry.trim()).filter(Boolean)
      for (const command of commands) {
        const cleaned = command.replace(/^[@-]+/, '').trim()
        const call = cleaned.match(/^(dh_[a-z0-9_]+)\b/)
        if (!call) continue
        directDhCalls.push({ name: call[1], line, target: currentTarget })
      }
    } else if (/\bdh[ \t]+\$@/.test(raw)) {
      dhSequencer = true
    }
  }

  const code = codeLines.join('\n')
  let buildsystem = dhSequencer ? 'autotools' : 'custom'
  let inferred = false
  for (const pattern of BUILD_SYSTEM_PATTERNS) {
    if (pattern.test.test(code)) {
      buildsystem = pattern.name
      inferred = true
      break
    }
  }
  if (!inferred && /dh_auto_configure/.test(code)) buildsystem = 'autotools'

  return {
    present: true,
    executable,
    shebang,
    hasPercentTarget,
    dhSequencer,
    dhCleanK,
    dhCleanKLine,
    overrides,
    directDhCalls,
    buildsystem,
    lineCount: lines.length,
    issues,
  }
}

/* ------------------------------------------------------------------- patches */

/** Parse `debian/patches/series`; comments and blank lines are ignored. */
export function parseSeries(text, options = {}) {
  const file = options.file ?? 'debian/patches/series'
  const patches = []
  const entries = []
  const issues = []
  splitLines(text).forEach((raw, index) => {
    const line = raw.replace(/(^|\s)#.*$/, '').trim()
    if (line === '') return
    if (/\s/.test(line)) {
      issues.push(parseIssue(
        'series-line-has-whitespace',
        `series entry contains whitespace: ${line}`,
        file,
        index + 1,
      ))
      return
    }
    patches.push(line)
    entries.push({ name: line, line: index + 1 })
  })
  return { patches, entries, issues }
}

const DEP3_KNOWN = [
  'Description',
  'Origin',
  'Forwarded',
  'Author',
  'Last-Update',
  'Applied-Upstream',
]
const DEP3_KNOWN_LOWER = new Map(DEP3_KNOWN.map((name) => [name.toLowerCase(), name]))

/**
 * Parse a DEP-3 patch header (the first RFC 822 paragraph of a patch).
 *
 * @returns {{
 *   fields: Map<string,string>, values: object, description: string|null,
 *   origin: string|null, forwarded: string|null, author: string|null,
 *   lastUpdate: string|null, appliedUpstream: string|null,
 *   bugs: Array<{name: string, value: string}>, issues: Array<object>
 * }}
 */
export function parseDep3(text, options = {}) {
  const file = options.file ?? null
  const parsed = parseDeb822(text, { file })
  const stanza = parsed.stanzas[0] ?? null
  const fields = stanza ? stanza.fields : new Map()
  const values = {}
  const bugs = []

  if (stanza) {
    for (const [name, value] of fields) {
      const canonical = DEP3_KNOWN_LOWER.get(name.toLowerCase())
      if (canonical) {
        values[canonical] = value
      } else if (/^bug-/i.test(name)) {
        bugs.push({ name, value })
      }
    }
  }

  return {
    fields,
    values,
    description: values.Description ?? null,
    origin: values.Origin ?? null,
    forwarded: values.Forwarded ?? null,
    author: values.Author ?? null,
    lastUpdate: values['Last-Update'] ?? null,
    appliedUpstream: values['Applied-Upstream'] ?? null,
    bugs,
    issues: parsed.issues,
  }
}

/** Render the DEP-3 fields that the inspect tool reports for one patch. */
export function dep3Summary(parsed) {
  const summary = {}
  for (const name of DEP3_KNOWN) {
    if (parsed.values[name] !== undefined) summary[name] = parsed.values[name]
  }
  return summary
}

/* --------------------------------------------------------------------- watch */

/**
 * Parse `debian/watch` (version 4 style).
 * Each non-comment entry is `<url> [<pattern> [opts=...]]`.
 */
export function parseWatch(text, options = {}) {
  const file = options.file ?? 'debian/watch'
  const issues = []
  const entries = []
  let version = null
  let versionLine = null

  splitLines(text).forEach((raw, index) => {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) return
    const lineNo = index + 1
    const versionMatch = line.match(/^version\s*=\s*(\d+)$/)
    if (versionMatch) {
      version = Number(versionMatch[1])
      versionLine = lineNo
      return
    }
    if (/^opts\s*=/.test(line)) return

    const tokens = line.split(/\s+/)
    const url = tokens[0]
    if (!/^(?:https?|ftp|file):\/\//i.test(url)) {
      issues.push(parseIssue('watch-malformed-line', `watch line does not start with a URL: ${line.slice(0, 80)}`, file, lineNo))
      return
    }
    const patternTokens = []
    for (const token of tokens.slice(1)) {
      if (/^opts=/.test(token)) break
      patternTokens.push(token)
    }
    const pattern = patternTokens.length > 0 ? patternTokens.join(' ') : null
    // Watch v4 allows the version capture group in the URL itself (for example
    // `hello-(.+)\.tar\.gz`); an explicit filename pattern still wins.
    const captureTarget = pattern ?? url
    const captureMatches = captureTarget.match(/\(([^()]*)\)/g) ?? []
    const capture = captureMatches[0]?.match(/\(([^()]*)\)/)
    entries.push({
      url,
      pattern,
      captureGroup: capture ? capture[1] : null,
      captureGroups: captureMatches.length,
      line: lineNo,
    })
  })

  if (version === null) {
    issues.push(parseIssue('watch-missing-version', 'watch file does not declare "version=4"', file, 1))
  }
  if (entries.length === 0) {
    issues.push(parseIssue('watch-no-entries', 'watch file declares no download entry', file, 1))
  }

  return { version, versionLine, entries, issues }
}

/* ------------------------------------------------------- tests/control, DEP-8 */

/** Parse `debian/tests/control` into DEP-8 test entries. */
export function parseTestsControl(text, options = {}) {
  const file = options.file ?? 'debian/tests/control'
  const parsed = parseDeb822(text, { file })
  const entries = parsed.stanzas.map((stanza) => ({
    fields: stanza.fields,
    line: stanza.lines.start,
    tests: splitList(fieldValue(stanza, 'Tests')),
    depends: splitList(fieldValue(stanza, 'Depends')),
    testCommand: (fieldValue(stanza, 'Test-Command') ?? '').trim() || null,
    restrictions: splitList(fieldValue(stanza, 'Restrictions')),
    features: splitList(fieldValue(stanza, 'Features')),
    classes: splitList(fieldValue(stanza, 'Classes')),
  }))
  return { entries, issues: parsed.issues }
}

/* ------------------------------------------------------ format, compat, copyright */

/** `debian/source/format`: first non-comment, non-blank line. */
export function parseSourceFormat(text) {
  return firstContentLine(text)
}

/** `debian/compat`: first non-comment, non-blank line. */
export function parseCompat(text) {
  return firstContentLine(text)
}

/**
 * Parse `debian/copyright` as DEP-5: a deb822 header plus stanza list.
 * Also answers the three questions the lint rules need.
 */
export function parseCopyright(text, options = {}) {
  const parsed = parseDeb822(text, options)
  const format = parsed.stanzas.length > 0 ? (fieldValue(parsed.stanzas[0], 'Format') ?? null) : null
  const filesStanzas = parsed.stanzas.filter((stanza) => hasField(stanza, 'Files'))
  const licenseStanzas = parsed.stanzas.filter((stanza) => hasField(stanza, 'License'))
  return {
    stanzas: parsed.stanzas,
    format,
    files: filesStanzas,
    hasFiles: filesStanzas.length > 0,
    hasLicense: licenseStanzas.length > 0,
    issues: parsed.issues,
  }
}

/** Extract `debhelper-compat (= N)` from a Build-Depends list. */
export function compatFromBuildDepends(buildDepends) {
  for (const entry of buildDepends ?? []) {
    const match = String(entry).match(/^debhelper-compat[ \t]*(?:\([ \t]*(?:=|>=|>>)[ \t]*([0-9]+)[ \t]*\))?/)
    if (match && match[1]) return match[1]
  }
  return null
}

/** Compare dotted versions numerically (`4.7.4` vs `4.6.2`). */
export function compareDottedVersions(left, right) {
  const parse = (value) => String(value ?? '')
    .replace(/[^0-9.].*$/, '')
    .split('.')
    .map((part) => Number(part) || 0)
  const a = parse(left)
  const b = parse(right)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}
