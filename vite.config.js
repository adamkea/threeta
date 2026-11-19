import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Game version = <major>.<minor> from package.json + <patch> = number of the latest merged PR,
// so every merge bumps it automatically.
//
// The PR number is read from the newest first-parent commit subject that names one
// ("Merge pull request #14 from ..." or a squash merge's "Title (#14)"). That works in shallow
// clones (hosting providers often build from `--depth 10` or less), where counting merge commits
// would only count the ones inside the clone and report too low a version.
function gameVersion() {
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
  const [major, minor] = version.split('.');
  try {
    const git = (cmd) => execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const hash = git('rev-parse --short HEAD');
    const subjects = git('log --first-parent --format=%s -200').split('\n');
    for (const s of subjects) {
      const m = s.match(/^Merge pull request #(\d+)\b/) || s.match(/\(#(\d+)\)$/);
      if (m) return { version: `${major}.${minor}.${m[1]}`, hash };
    }
    // No PR-tagged commit in reach: fall back to counting merges.
    const merges = git('rev-list --count --merges --first-parent HEAD');
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
