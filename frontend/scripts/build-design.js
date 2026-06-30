const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  console.log('Building design tokens from DESIGN.md...');
  
  // Chạy npx designmd export thông qua cmd.exe (mặc định trên Windows của Node.js execSync)
  const stdout = execSync('npx -p @google/design.md designmd export --format json-tailwind ../DESIGN.md', {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf-8'
  });
  
  const outputPath = path.resolve(__dirname, '../tailwind.theme.json');
  fs.writeFileSync(outputPath, stdout);
  console.log('Design tokens successfully exported to tailwind.theme.json');
} catch (error) {
  console.error('Error building design tokens:', error.message);
  process.exit(1);
}
