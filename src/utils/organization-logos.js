import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Accept only existing image filenames, never user-supplied paths or URLs.
export const organizationLogos = readdirSync(fileURLToPath(new URL('../../public/images', import.meta.url)))
  .filter((name) => /^[a-zA-Z0-9_-]+\.(svg|png|jpe?g|webp)$/i.test(name))
  .sort();
