import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixes = [
  {
    file: 'src/components/VodProxyImage.tsx',
    replace: [
      { find: '/* eslint-disable react-hooks/exhaustive-deps */\\n/* eslint-disable react-hooks/set-state-in-effect */\\n', replace: '' },
      { find: 'setProxySrc(src);', replace: '// eslint-disable-next-line react-hooks/set-state-in-effect\\n      setProxySrc(src);' }
    ]
  },
  {
    file: 'src/components/layout/AppLayout.tsx',
    replace: [
       { find: '/* eslint-disable react-hooks/exhaustive-deps */\\n/* eslint-disable react-hooks/set-state-in-effect */\\n', replace: '' },
       { find: 'setCustomBgFailed(false);', replace: '// eslint-disable-next-line react-hooks/set-state-in-effect\\n    setCustomBgFailed(false);' }
    ]
  },
  {
    file: 'src/components/layout/FloatingPlayer.tsx',
    replace: [
       { find: '/* eslint-disable react-hooks/exhaustive-deps */\\n/* eslint-disable react-hooks/set-state-in-effect */\\n', replace: '' },
       { find: 'setFloatSettings(DEFAULT_FLOAT_SETTINGS);', replace: '// eslint-disable-next-line react-hooks/set-state-in-effect\\n      setFloatSettings(DEFAULT_FLOAT_SETTINGS);' }
    ]
  },
  {
    file: 'src/modules/music/hooks/useCoverDataUrl.ts',
    replace: [
       { find: '/* eslint-disable react-hooks/exhaustive-deps */\\n/* eslint-disable react-hooks/set-state-in-effect */\\n', replace: '' },
       { find: 'setDataUrl(null);', replace: '// eslint-disable-next-line react-hooks/set-state-in-effect\\n      setDataUrl(null);' }
    ]
  },
  {
    file: 'src/modules/music/hooks/useCurrentPlaying.ts',
    replace: [
       { find: '/* eslint-disable react-hooks/exhaustive-deps */\\n/* eslint-disable react-hooks/set-state-in-effect */\\n', replace: '' },
       { find: 'setSnapshot((prev)', replace: '// eslint-disable-next-line react-hooks/set-state-in-effect\\n      setSnapshot((prev)' }
    ]
  },
  {
    file: 'src/modules/music/hooks/usePlaybackClock.ts',
    replace: [
       { find: '/* eslint-disable react-hooks/exhaustive-deps */\\n/* eslint-disable react-hooks/set-state-in-effect */\\n', replace: '' },
       { find: 'setLivePosition(null);\\n      return;', replace: '// eslint-disable-next-line react-hooks/set-state-in-effect\\n      setLivePosition(null);\\n      return;' },
       { find: 'setLivePosition(null);\\n        return;', replace: '// eslint-disable-next-line react-hooks/set-state-in-effect\\n        setLivePosition(null);\\n        return;' }
    ]
  },
  {
    file: 'src/modules/updater/hooks/useUpdater.ts',
    replace: [
       { find: '/* eslint-disable react-hooks/exhaustive-deps */\\n/* eslint-disable react-hooks/set-state-in-effect */\\n', replace: '' },
       { find: 'void load();', replace: '// eslint-disable-next-line react-hooks/set-state-in-effect\\n    void load();' }
    ]
  },
  {
    file: 'src/pages/MiniPlayerPage.tsx',
    replace: [
       { find: '/* eslint-disable react-hooks/exhaustive-deps */\\n/* eslint-disable react-hooks/set-state-in-effect */\\n', replace: '' },
       { find: 'setMiniSettings(DEFAULT_MINI_SETTINGS);', replace: '// eslint-disable-next-line react-hooks/set-state-in-effect\\n      setMiniSettings(DEFAULT_MINI_SETTINGS);' }
    ]
  },
  {
    file: 'src/pages/HomePage.tsx',
    replace: [
      { find: 'import { clampPercent, formatUptime }', replace: 'import { formatUptime }' }
    ]
  },
  {
    file: 'src/modules/settings/hooks/useBackgroundSettings.ts',
    replace: [
      { find: 'let isDefault =', replace: 'let isDefault;' }
    ]
  }
];

for (const fix of fixes) {
  const filePath = path.join(__dirname, fix.file);
  if (!fs.existsSync(filePath)) continue;
  let content = fs.readFileSync(filePath, 'utf8');
  
  // also strip zero-width spaces or irregular whitespaces if present
  content = content.replace(/\\u3000/g, ' ').replace(/\\u200B/g, '').replace(/\\u00A0/g, ' ');

  for (const r of fix.replace) {
    const fstr = r.find.replace(/\\n/g, '\\n');
    const rstr = r.replace.replace(/\\n/g, '\\n');
    if (content.includes(fstr)) {
      content = content.replace(fstr, rstr);
    }
  }
  fs.writeFileSync(filePath, content, 'utf8');
}
console.log('Fixed linting.');
