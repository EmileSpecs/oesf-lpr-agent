/**
 * Bundle → standalone binaries (Windows + Linux x64).
 *
 *   node scripts/build.mjs
 *
 * Outputs:
 *   dist/bin/oesf-lpr-agent-win-x64.exe
 *   dist/bin/oesf-lpr-agent-linux-x64
 *   dist/oesf-lpr-agent-linux-x64.tar.gz
 *   dist/oesf-lpr-agent-win-x64.zip
 */

import { createWriteStream, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { execFileSync } from 'node:child_process'
import esbuild from 'esbuild'
import { exec as pkgExec } from '@yao-pkg/pkg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkgJson.version
const dist = join(root, 'dist')
const binDir = join(dist, 'bin')
const stage = join(dist, 'stage')

rmSync(dist, { recursive: true, force: true })
mkdirSync(binDir, { recursive: true })
mkdirSync(stage, { recursive: true })

const uiHtml = readFileSync(join(root, 'src', 'ui.html'), 'utf8')
const logoPath = join(root, 'assets', 'logo.png')
const logoDataUrl = existsSync(logoPath)
  ? `data:image/png;base64,${readFileSync(logoPath).toString('base64')}`
  : ''

console.log('→ esbuild bundle')
await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(root, 'src', 'index.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: join(stage, 'agent.cjs'),
  banner: {
    js: `globalThis.__OESF_UI_HTML__ = ${JSON.stringify(uiHtml)};\nglobalThis.__OESF_LOGO_DATA_URL__ = ${JSON.stringify(logoDataUrl)};\nglobalThis.__OESF_AGENT_VERSION__ = ${JSON.stringify(version)};\nprocess.env.OESF_LPR_AGENT_PACKAGED = process.env.OESF_LPR_AGENT_PACKAGED || '1';`
  },
  // Node 20+ has global fetch; digest-fetch only dynamically imports node-fetch as a fallback.
  plugins: [
    {
      name: 'stub-optional-node-fetch',
      setup (build) {
        build.onResolve({ filter: /^node-fetch$/ }, () => ({
          path: 'node-fetch',
          namespace: 'oesf-stub'
        }))
        build.onLoad({ filter: /.*/, namespace: 'oesf-stub' }, () => ({
          contents: 'module.exports = undefined;',
          loader: 'js'
        }))
      }
    }
  ],
  logLevel: 'info'
})

writeFileSync(
  join(stage, 'package.json'),
  JSON.stringify({ name: 'oesf-lpr-agent', version, bin: 'agent.cjs', pkg: { outputPath: binDir } }, null, 2)
)

console.log('→ pkg win-x64 + linux-x64 (node22)')
await pkgExec([
  join(stage, 'agent.cjs'),
  '--targets',
  'node22-win-x64,node22-linux-x64',
  '--output',
  join(binDir, 'oesf-lpr-agent'),
  '--compress',
  'GZip'
])

// pkg names outputs as oesf-lpr-agent-win.exe / oesf-lpr-agent-linux
const winSrc = [
  join(binDir, 'oesf-lpr-agent-win.exe'),
  join(binDir, 'oesf-lpr-agent.exe')
].find((p) => existsSync(p))
const linuxSrc = [
  join(binDir, 'oesf-lpr-agent-linux'),
  join(binDir, 'oesf-lpr-agent')
].find((p) => existsSync(p) && !p.endsWith('.exe'))

const winOut = join(binDir, 'oesf-lpr-agent-win-x64.exe')
const linuxOut = join(binDir, 'oesf-lpr-agent-linux-x64')

if (winSrc && winSrc !== winOut) {
  cpSync(winSrc, winOut)
}
if (linuxSrc && linuxSrc !== linuxOut) {
  cpSync(linuxSrc, linuxOut)
}

if (!existsSync(winOut)) console.warn('⚠ Windows binary not found — check pkg output in dist/bin')
else console.log('✓', winOut)

if (!existsSync(linuxOut)) console.warn('⚠ Linux binary not found — check pkg output in dist/bin')
else console.log('✓', linuxOut)

// Zip / tar for distribution
async function zipWin () {
  if (!existsSync(winOut)) return
  const zipDir = join(dist, 'win-portable')
  rmSync(zipDir, { recursive: true, force: true })
  mkdirSync(zipDir, { recursive: true })
  cpSync(winOut, join(zipDir, 'oesf-lpr-agent.exe'))
  cpSync(join(root, 'config.example.yaml'), join(zipDir, 'config.example.yaml'))
  cpSync(join(root, 'installer', 'windows', 'README-WINDOWS.txt'), join(zipDir, 'README.txt'))
  const zipPath = join(dist, `oesf-lpr-agent-${version}-win-x64.zip`)
  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `Compress-Archive -Path '${zipDir}\\*' -DestinationPath '${zipPath}' -Force`],
      { stdio: 'inherit' }
    )
    console.log('✓', zipPath)
  } catch (e) {
    console.warn('⚠ zip failed:', e.message)
  }
}

async function tarLinux () {
  if (!existsSync(linuxOut)) return
  const tarDir = join(dist, 'linux-portable')
  rmSync(tarDir, { recursive: true, force: true })
  mkdirSync(tarDir, { recursive: true })
  cpSync(linuxOut, join(tarDir, 'oesf-lpr-agent'))
  cpSync(join(root, 'config.example.yaml'), join(tarDir, 'config.example.yaml'))
  cpSync(join(root, 'installer', 'linux', 'install.sh'), join(tarDir, 'install.sh'))
  cpSync(join(root, 'installer', 'linux', 'README-LINUX.txt'), join(tarDir, 'README.txt'))
  const tarPath = join(dist, `oesf-lpr-agent-${version}-linux-x64.tar.gz`)
  // Prefer tar if available; else gzip a single stream via node
  try {
    execFileSync('tar', ['-czf', tarPath, '-C', tarDir, '.'], { stdio: 'inherit' })
    console.log('✓', tarPath)
  } catch {
    // Fallback: just leave the folder
    console.warn('⚠ tar not available — portable folder at', tarDir)
  }
}

await zipWin()
await tarLinux()

// Copy Inno script + exe into installer staging for ISCC
const issStage = join(dist, 'installer-win')
rmSync(issStage, { recursive: true, force: true })
mkdirSync(issStage, { recursive: true })
if (existsSync(winOut)) {
  cpSync(winOut, join(issStage, 'oesf-lpr-agent.exe'))
  cpSync(join(root, 'config.example.yaml'), join(issStage, 'config.example.yaml'))
  let iss = readFileSync(join(root, 'installer', 'windows', 'oesf-lpr-agent.iss'), 'utf8')
  iss = iss.replaceAll('{{VERSION}}', version)
  writeFileSync(join(issStage, 'oesf-lpr-agent.iss'), iss)
  console.log('→ Windows installer sources in', issStage)
  console.log('  Run: npm run build:installer   (requires Inno Setup)')
}

console.log('\nDone.')
