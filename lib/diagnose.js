/**
 * Diagnose an Ubuntu/Debian build or test log.
 *
 * The pattern table is ordered most-specific-first and every finding names a
 * concrete next edit (a `debian/control` field, a `debian/rules` override or a
 * quilt patch) plus a documentation URL. Output is de-duplicated by
 * `id + evidence` and capped at 40 findings.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { splitLines } from './parse.js'

export const MAX_FINDINGS = 40
export const EVIDENCE_LIMIT = 300

const DOC = {
  deps: 'https://www.debian.org/doc/debian-policy/ch-relationships.html',
  guide: 'https://documentation.ubuntu.com/ubuntu-packaging-guide/',
  debhelper: 'https://manpages.debian.org/unstable/debhelper/dh.1.en.html',
  shlibdeps: 'https://manpages.debian.org/unstable/dpkg-dev/dpkg-shlibdeps.1.en.html',
  source: 'https://manpages.debian.org/unstable/dpkg-dev/dpkg-source.1.en.html',
  policySource: 'https://www.debian.org/doc/debian-policy/ch-source.html',
  python: 'https://www.debian.org/doc/packaging-manuals/python-policy/',
  rust: 'https://wiki.debian.org/Teams/RustPackaging',
  go: 'https://wiki.debian.org/Golang',
  sharedlibs: 'https://www.debian.org/doc/debian-policy/ch-sharedlibs.html',
  buildpackage: 'https://manpages.debian.org/unstable/dpkg-dev/dpkg-buildpackage.1.en.html',
  autopkgtest: 'https://manpages.debian.org/unstable/autopkgtest/autopkgtest.1.en.html',
  lintian: 'https://lintian.debian.org/',
}

const PATTERNS = [
  {
    id: 'missing-build-dep',
    severity: 'error',
    test: /^dpkg-checkbuilddeps:\s*(?:error|warning|错误|警告)[:：]\s*(?:Unmet build[- ]dependencies|未满足的构建依赖)[:：]\s*(.+)$/i,
    cause: 'debian/control Build-Depends is missing one or more packages the build needs.',
    fix: 'Copy the listed names into Build-Depends in debian/control (with versions where apt asks), then run sudo apt build-dep .',
    doc: DOC.deps,
  },
  {
    id: 'missing-build-dep',
    severity: 'error',
    test: /^dpkg-checkbuilddeps:\s*(?:error|warning|错误|警告)[:：]\s*(?:Unmet build[- ]dependencies|未满足的构建依赖)/i,
    cause: 'debian/control Build-Depends is missing one or more packages the build needs.',
    fix: 'Read the dependency list above the failure, add every package to Build-Depends in debian/control, and re-run.',
    doc: DOC.deps,
  },
  {
    id: 'missing-pkg-config',
    severity: 'error',
    test: /No package '([^']+)' found/,
    cause: 'pkg-config cannot find the .pc file for a build dependency, so configure stops.',
    fix: 'Add the -dev package that ships the .pc file (often lib$1-dev) to Build-Depends in debian/control.',
    doc: DOC.guide,
  },
  {
    id: 'missing-pkg-config',
    severity: 'error',
    test: /未找到包[：:\s]*['"]?([^'"\s]+)['"]?/,
    cause: 'pkg-config cannot find the .pc file for a build dependency, so configure stops.',
    fix: 'Add the -dev package that ships the .pc file (often lib$1-dev) to Build-Depends in debian/control.',
    doc: DOC.guide,
  },
  {
    id: 'missing-header',
    severity: 'error',
    test: /fatal error:\s*([^:\s]+\.h):\s*(?:No such file or directory|没有那个文件或目录)/i,
    cause: 'The compiler cannot find a header that a Build-Depends package should provide.',
    fix: 'Add the matching -dev package to Build-Depends in debian/control; if it is already there, check that the include path is not Debian-internal.',
    doc: DOC.deps,
  },
  {
    id: 'missing-header',
    severity: 'error',
    test: /致命错误[：:]\s*([^：:\s]+\.h)[：:]\s*没有那个文件或目录/,
    cause: 'The compiler cannot find a header that a Build-Depends package should provide.',
    fix: 'Add the matching -dev package to Build-Depends in debian/control; if it is already there, check that the include path is not Debian-internal.',
    doc: DOC.deps,
  },
  {
    id: 'missing-library',
    severity: 'error',
    test: /cannot find -l(\S+)/,
    cause: 'The linker cannot find a library the build links against.',
    fix: 'Add lib$1-dev to Build-Depends in debian/control, or fix the -L path in debian/rules.',
    doc: DOC.deps,
  },
  {
    id: 'missing-library',
    severity: 'error',
    test: /找不到\s*-l(\S+)/,
    cause: 'The linker cannot find a library the build links against.',
    fix: 'Add lib$1-dev to Build-Depends in debian/control, or fix the -L path in debian/rules.',
    doc: DOC.deps,
  },
  {
    id: 'debhelper-compat',
    severity: 'error',
    test: /dh:\s*(?:command not found|未找到命令)|dh_[a-z0-9_]+:\s*(?:unknown|invalid|unrecognized) option/,
    cause: 'debhelper is missing or the compat level is lower than the options the rules file uses.',
    fix: 'Install debhelper and raise the compat level: Build-Depends: debhelper-compat (= 13) in debian/control (delete debian/compat when present).',
    doc: DOC.debhelper,
  },
  {
    id: 'command-not-found',
    severity: 'error',
    test: /command not found|未找到命令/,
    cause: 'A command required by the build or test step is not installed or not on PATH.',
    fix: 'Install the package that ships the command (Build-Depends for builds, debian/tests/control Depends for tests) and re-run.',
    doc: DOC.buildpackage,
  },
  {
    id: 'dh-install-missing-files',
    severity: 'error',
    test: /dh_install:\s*(?:error|.*not found|.*missing files)/i,
    cause: 'A debian/*.install file lists a path that the build did not produce, or the install file is missing for a built artifact.',
    fix: 'Fix the path in debian/<package>.install (paths are relative to the staged tree) or add the missing install file.',
    doc: DOC.debhelper,
  },
  {
    id: 'dh-failure',
    severity: 'error',
    test: /dh_(auto_configure|auto_build|auto_test|auto_install|install|builddeb):\s*.*(?:error|failed|exit code|Error|错误|失败)/,
    cause: 'A debhelper helper failed; the real error is usually a few lines above this one.',
    fix: 'Add an override_<helper> target to debian/rules for the failing step and fix the underlying dependency or option.',
    doc: DOC.debhelper,
  },
  {
    id: 'shlibdeps',
    severity: 'error',
    test: /dpkg-shlibdeps:\s*(?:error|错误)[:：]\s*(?:no dependency information found|.*unable to find|.*依赖信息)/,
    cause: 'A binary links against a library that no package in Build-Depends provides, or the files are installed outside the package.',
    fix: 'Add the -dev package to Build-Depends and make sure the shared object is installed inside the package; check debian/*.install.',
    doc: DOC.shlibdeps,
  },
  {
    id: 'dpkg-source-error',
    severity: 'error',
    test: /dpkg-source:\s*(?:error|错误)[:：]\s*(.+)/,
    cause: 'The source package could not be built: bad patch, tarball or source-format state.',
    fix: 'Read the message, refresh the quilt series with quilt push/pop or git-archive, and check debian/source/format.',
    doc: DOC.source,
  },
  {
    id: 'rules-permission',
    severity: 'error',
    test: /debian\/rules.*(?:Permission denied|权限不够)/,
    cause: 'debian/rules is not executable or not reachable by the build user.',
    fix: 'Run chmod +x debian/rules and commit the executable bit (git update-index --chmod=+x debian/rules).',
    doc: DOC.policySource,
  },
  {
    id: 'permission-denied',
    severity: 'error',
    test: /Permission denied|权限不够/,
    cause: 'A file or directory needed by the build is not readable, writable or executable by the build user.',
    fix: 'Fix the file mode or ownership (chmod/chown), commit executable bits for scripts, and re-run.',
    doc: DOC.policySource,
  },
  {
    id: 'python-import',
    severity: 'error',
    test: /(?:ModuleNotFoundError|ImportError):\s*(?:No module named\s+)?['"]?([\w.]+)/,
    cause: 'A Python module used by the build or the tests is not installed in the build environment.',
    fix: 'Add the python3-$1 package to Build-Depends (or to the DEP-8 Depends in debian/tests/control for test-only imports).',
    doc: DOC.python,
  },
  {
    id: 'rust-vendoring',
    severity: 'error',
    test: /error: failed to select a version|no matching package named [`']([^`']+)[`'] found/,
    cause: 'Cargo cannot resolve a crate version, usually because the crate is missing from the vendored source or the lockfile is stale.',
    fix: 'Regenerate Cargo.lock with the vendored crates and check debian/cargo-checksum.json / the debcargo packaging.',
    doc: DOC.rust,
  },
  {
    id: 'go-vendoring',
    severity: 'error',
    test: /missing go\.sum entry|unrecognized import path|cannot find module providing package/,
    cause: 'Go module resolution reached the network or the module cache is incomplete.',
    fix: 'Vendor the modules (go mod vendor) and build with -mod=vendor, or add the missing golang-*-dev packages to Build-Depends.',
    doc: DOC.go,
  },
  {
    id: 'link-error',
    severity: 'error',
    test: /undefined reference to [`']([^`']+)[`']/,
    cause: 'The final link is missing a symbol, usually a library that was not linked.',
    fix: 'Add the providing -dev package to Build-Depends and fix the link order or -l flags in debian/rules.',
    doc: DOC.sharedlibs,
  },
  {
    id: 'link-error',
    severity: 'error',
    test: /collect2: error: ld returned 1 exit status/,
    cause: 'The linker failed; the undefined reference / cannot find -l line above names the missing library.',
    fix: 'Look up the first linker error above this line and add the matching -dev package to Build-Depends.',
    doc: DOC.sharedlibs,
  },
  {
    id: 'configure-error',
    severity: 'error',
    test: /configure[：:]\s*(?:error|错误)[：:]\s*(.+)/,
    cause: 'The upstream configure script rejected the environment or an option.',
    fix: 'Fix the configure options in debian/rules override_dh_auto_configure, or add the missing dependency to Build-Depends.',
    doc: DOC.guide,
  },
  {
    id: 'autopkgtest-failure',
    severity: 'error',
    test: /autopkgtest \[[^\]]*\]:.*\b(?:FAIL|ERROR|Regression)\b|^\s*\*\*\* (?:FAIL|ERROR)\b/,
    cause: 'A DEP-8 test failed or regressed inside autopkgtest.',
    fix: 'Re-run with --shell-fail, add the missing Depends entries to debian/tests/control, and fix the test script or the package.',
    doc: DOC.autopkgtest,
  },
  {
    id: 'test-failure',
    severity: 'error',
    test: /^(?:FAIL|not ok)\b|\bAssertionError\b|Error: Process completed with exit code|^\s*\S+\s+(?:FAIL|ERROR)\s*$/,
    cause: 'The upstream test suite or a CI step failed.',
    fix: 'Run the test outside the build (dh_auto_test or the upstream harness), fix the code/test, and add a quilt patch if the fix is not upstreamable.',
    doc: DOC.autopkgtest,
  },
  {
    id: 'lintian-error',
    severity: 'error',
    test: /^E:\s+([^:]+):\s+(.+)$/,
    cause: 'lintian found an error-level packaging problem.',
    fix: 'Fix the named test (dpkg -I / control / copyright / rules) or add a justified lintian override in debian/lintian-overrides.',
    doc: DOC.lintian,
  },
  {
    id: 'out-of-space',
    severity: 'error',
    test: /No space left on device/,
    cause: 'The build ran out of disk space, usually in /tmp or the sbuild chroot.',
    fix: 'Free space, raise the sbuild --chroot-dir or TMPDIR volume, and remove stale build trees.',
    doc: DOC.buildpackage,
  },
  {
    id: 'build-command-failed',
    severity: 'error',
    test: /^dpkg-buildpackage:\s*(?:error|错误)[:：]\s*(.+)/,
    cause: 'A dpkg-buildpackage step failed; this line is the summary, not the root cause.',
    fix: 'Scroll up to the first error in the log and fix the underlying build step before re-running.',
    doc: DOC.buildpackage,
  },
  {
    id: 'build-warning',
    severity: 'warning',
    test: /^(?:dh_[a-z0-9_]+|configure|make(?:\[\d+\])?):\s*warning:\s*(.+)/,
    cause: 'The build emits a warning that often precedes an FTBFS or a lintian error.',
    fix: 'Read the warning and fix the option, missing dependency or generated file it names before uploading.',
    doc: DOC.guide,
  },
]

const PHASE_MARKERS = [
  { phase: 'configure', test: /dh_auto_configure|(?:^|\/)configure:|^-- Configuring done|^-- Detecting .* compiler|^-- The C compiler identification|^CMake Error/ },
  { phase: 'build', test: /dh_auto_build|^make(?:\[\d+\])?:|^\[\s*\d+%\]|^Building (?:C|CXX|ASM) object|^cargo build/ },
  { phase: 'test', test: /dh_auto_test|^make .*\bcheck\b|^(?:PASS|FAIL):|^Test suite|^ok \d+|^not ok \d+|^\s*\S+\s+(?:PASS|FAIL)\s*$/ },
  { phase: 'install', test: /dh_auto_install|^dh_install|^Install the project/ },
  { phase: 'package', test: /dh_builddeb|^dpkg-deb: |^dpkg-gencontrol|^dpkg-source: info: building/ },
]

function truncate(text) {
  return String(text).trim().slice(0, EVIDENCE_LIMIT)
}

function detectPhase(lines) {
  let phase = 'unknown'
  for (const raw of lines) {
    for (const marker of PHASE_MARKERS) {
      if (marker.test.test(raw)) {
        phase = marker.phase
        break
      }
    }
  }
  return phase
}

function expandFix(fix, match) {
  return String(fix).replace(/\$(\d)/g, (whole, index) => {
    const value = match?.[Number(index)]
    return value === undefined ? whole : value
  })
}

/**
 * Analyse log text.
 *
 * @param {string} log raw build/test log
 * @returns {{summary: object, findings: object[], nextActions: string[]}}
 */
export function diagnoseLog(log) {
  const rawText = typeof log === 'string' ? log : String(log ?? '')
  // Build logs are frequently colourised; strip ANSI SGR sequences so the
  // anchored patterns still match the first character of the line.
  const text = rawText.replace(/\u001b\[[0-9;]*m/g, '')
  const lines = text === '' ? [] : splitLines(text)
  const findings = []
  const seen = new Set()

  for (const raw of lines) {
    if (raw.trim() === '') continue
    for (const pattern of PATTERNS) {
      const match = raw.match(pattern.test)
      if (!match) continue
      const evidence = truncate(raw)
      const key = `${pattern.id}\u0000${evidence}`
      if (seen.has(key)) break
      seen.add(key)
      findings.push({
        id: pattern.id,
        severity: pattern.severity,
        evidence,
        cause: pattern.cause,
        fix: expandFix(pattern.fix, match),
        doc: pattern.doc,
      })
      if (findings.length >= MAX_FINDINGS) break
      // The first matching pattern owns this line.
      break
    }
    if (findings.length >= MAX_FINDINGS) break
  }

  const summary = {
    lines: lines.length,
    errors: findings.filter((entry) => entry.severity === 'error').length,
    warnings: findings.filter((entry) => entry.severity === 'warning').length,
    phase: detectPhase(lines),
  }

  const nextActions = []
  for (const finding of findings) {
    if (nextActions.length >= 6) break
    if (!nextActions.includes(finding.fix)) nextActions.push(finding.fix)
  }
  const generic = [
    'Read the first error in the log, not the last: rerun and grep for the earliest "error:" or "Error 1" line.',
    'Run dpkg-checkbuilddeps in the source tree and install every package it lists.',
    'Re-run the failing step with dpkg-buildpackage --no-pre-clean so the tree is preserved for inspection.',
  ]
  for (const action of generic) {
    if (nextActions.length >= 3) break
    if (!nextActions.includes(action)) nextActions.push(action)
  }

  return { summary, findings, nextActions: nextActions.slice(0, 6) }
}

/**
 * Diagnose a log given either raw text or a file path (exactly one).
 *
 * @param {{log?: string, path?: string}} input
 */
export async function diagnoseBuild(input = {}) {
  const hasLog = typeof input.log === 'string'
  const hasPath = typeof input.path === 'string' && input.path.trim() !== ''
  if (hasLog && hasPath) {
    throw new Error('ubuntu_diagnose_build: pass exactly one of "log" (raw text) or "path" (log file), not both')
  }
  if (!hasLog && !hasPath) {
    throw new Error('ubuntu_diagnose_build: pass exactly one of "log" (raw text) or "path" (log file)')
  }
  if (hasLog) return diagnoseLog(input.log)

  const target = path.resolve(input.path)
  try {
    const text = await readFile(target, 'utf8')
    return diagnoseLog(text)
  } catch (error) {
    throw new Error(`ubuntu_diagnose_build: cannot read log ${target}: ${error.message}`)
  }
}
