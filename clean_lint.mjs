import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixes = [
  { file: 'src/components/VodProxyImage.tsx' },
  { file: 'src/components/layout/AppLayout.tsx' },
  { file: 'src/components/layout/FloatingPlayer.tsx' },
  { file: 'src/modules/music/hooks/useCoverDataUrl.ts' },
  { file: 'src/modules/music/hooks/useCurrentPlaying.ts' },
  { file: 'src/modules/music/hooks/usePlaybackClock.ts' },
  { file: 'src/modules/updater/hooks/useUpdater.ts' },
  { file: 'src/pages/MiniPlayerPage.tsx' },
  { file: 'src/modules/settings/hooks/useBackgroundSettings.ts' },
  { file: 'src/pages/HomePage.tsx' }
];

for (const fix of fixes) {
  const filePath = path.join(__dirname, fix.file);
  if (!fs.existsSync(filePath)) continue;
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Clean all stacked eslint-disable-next-line comments and literal \n strings
  content = content.replace(/(?:\/\/\s*eslint-disable-next-line\s+react-hooks\/set-state-in-effect(?:\\n|\n)\s*)+/g, '// eslint-disable-next-line react-hooks/set-state-in-effect\n');
  
  fs.writeFileSync(filePath, content, 'utf8');
}
console.log('Cleaned up stacked lint comments.');
