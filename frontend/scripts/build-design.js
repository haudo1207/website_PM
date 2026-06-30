const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  console.log('Building design tokens from DESIGN.md...');
  
  // Kiểm tra xem DESIGN.md ở thư mục hiện tại (frontend/) hay thư mục cha
  let designMdPath = 'DESIGN.md';
  const localPath = path.resolve(__dirname, '../DESIGN.md');
  const parentPath = path.resolve(__dirname, '../../DESIGN.md');
  
  if (fs.existsSync(localPath)) {
    designMdPath = 'DESIGN.md';
  } else if (fs.existsSync(parentPath)) {
    designMdPath = '../DESIGN.md';
  } else {
    // Dự phòng mặc định nếu không thấy file nào
    designMdPath = 'DESIGN.md';
  }

  console.log(`Using DESIGN.md path: ${designMdPath}`);

  const stdout = execSync(`npx -p @google/design.md designmd export --format json-tailwind ${designMdPath}`, {
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
