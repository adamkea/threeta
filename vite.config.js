import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Game version = <major>.<minor> from package.json + <patch> = number of merged PRs
// (merge commits on the first-parent history), so every merge bumps it automatically.
function gameVersion() {
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
  const [major, minor] = version.split('.');
  try {
    const git = (cmd) => execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const merges = git('rev-list --count --merges --first-parent HEAD');
    const hash = git('rev-parse --short HEAD');
    return { version: `${major}.${minor}.${merges}`, hash };
  } catch {
    return { version, hash: '' }; // no git (e.g. downloaded zip): fall back to package.json
  }
}

const { version, hash } = gameVersion();

export default defineConfig({
  define: {
    __GAME_VERSION__: JSON.stringify(version),
    __GAME_COMMIT__: JSON.stringify(hash),
  },
});
