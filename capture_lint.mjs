import { execSync } from 'child_process';
import fs from 'fs';

try {
  const output = execSync('npm run lint', { encoding: 'utf8', stdio: 'pipe' });
  fs.writeFileSync('lint_output.txt', output, 'utf8');
} catch (e) {
  fs.writeFileSync('lint_output.txt', e.stdout || e.message, 'utf8');
}
console.log('done capturing lint output');
