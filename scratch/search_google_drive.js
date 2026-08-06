const fs = require('fs');
const filePath = 'c:\\Tích hợp\\ai-marketing\\lib\\google-drive.ts';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log('Exported functions in google-drive.ts:');
lines.forEach((line, index) => {
  if (line.includes('export async function') || line.includes('export const')) {
    console.log(`L${index + 1}: ${line.trim()}`);
  }
});
