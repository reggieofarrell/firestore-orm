import { lstatSync } from 'node:fs';

/**
 * Prettier (and ESLint) error when a symlink is passed explicitly on the CLI. The `.claude/`
 * mirror symlinks command/skill files to `.cursor/` (the single source of truth), so filter
 * symlinks out here — their real targets under `.cursor/` are linted/formatted when edited
 * directly.
 */
const realFiles = files => files.filter(file => !lstatSync(file).isSymbolicLink());

export default {
  '*.{ts,js}': files => {
    const list = realFiles(files);
    if (list.length === 0) return [];
    const joined = list.join(' ');
    return [`eslint --fix ${joined}`, `prettier --write ${joined}`];
  },
  '*.{json,md,yml,yaml}': files => {
    const list = realFiles(files);
    if (list.length === 0) return [];
    return [`prettier --write --ignore-unknown ${list.join(' ')}`];
  },
};
