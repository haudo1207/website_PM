const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const outputPath = path.resolve(__dirname, '../tailwind.theme.json');

try {
  console.log('Building design tokens from DESIGN.md...');
  
  let designMdPath = 'DESIGN.md';
  const localPath = path.resolve(__dirname, '../DESIGN.md');
  const parentPath = path.resolve(__dirname, '../../DESIGN.md');
  
  if (fs.existsSync(localPath)) {
    designMdPath = 'DESIGN.md';
  } else if (fs.existsSync(parentPath)) {
    designMdPath = '../DESIGN.md';
  }

  console.log(`Using DESIGN.md path: ${designMdPath}`);

  const stdout = execSync(`npx --yes -p @google/design.md designmd export --format json-tailwind ${designMdPath}`, {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf-8',
    timeout: 15000
  });
  
  if (stdout && stdout.trim()) {
    fs.writeFileSync(outputPath, stdout);
    console.log('Design tokens successfully exported to tailwind.theme.json');
  }
} catch (error) {
  console.warn('Warning: Could not build design tokens from online package:', error.message);
  if (fs.existsSync(outputPath)) {
    console.log('Using existing tailwind.theme.json fallback.');
  } else {
    // Write fallback content if completely missing
    const fallbackTheme = {
      theme: {
        extend: {
          colors: {
            primary: "#0058be",
            secondary: "#565e74",
            background: "#f8f9ff",
            "app-bg": "#f0f2f5",
            "surface-white": "#ffffff",
            "outline-variant": "#c2c6d6",
            "on-background": "#0b1c30"
          }
        }
      }
    };
    fs.writeFileSync(outputPath, JSON.stringify(fallbackTheme, null, 2));
    console.log('Created default fallback tailwind.theme.json');
  }
}
