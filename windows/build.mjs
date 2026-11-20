import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') {
  throw new Error('Build the Windows launcher on Windows. Use npm run build for the browser files.')
}

const root = fileURLToPath(new URL('../', import.meta.url))
const framework = join(process.env.WINDIR, 'Microsoft.NET')
const compiler = ['Framework64', 'Framework'].map(directory =>
  join(framework, directory, 'v4.0.30319', 'csc.exe')
).find(existsSync)
if (!compiler) throw new Error('The Windows .NET Framework 4.x C# compiler (csc.exe) was not found.')

const options = { cwd: root, stdio: 'inherit' }
execFileSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], options)
execFileSync(compiler, [
  '/nologo', '/target:exe', '/platform:anycpu', '/optimize+',
  '/out:' + join(root, 'dist', 'Maskinverkstan.exe'),
  join(root, 'windows', 'Launcher.cs')
], options)
