const fs = require('fs');
const path = require('path');

const targetPath = path.resolve(__dirname, '..', 'dist', 'index.js');
const shebang = '#!/usr/bin/env node\n';

const fileContent = fs.readFileSync(targetPath, 'utf8');

if (!fileContent.startsWith(shebang)) {
  fs.writeFileSync(targetPath, `${shebang}${fileContent}`, 'utf8');
}
