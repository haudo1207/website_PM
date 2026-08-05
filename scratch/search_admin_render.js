const fs = require('fs');
const filePath = 'c:\\Tích hợp\\ai-marketing\\app\\admin\\employee-profiles\\[id]\\EmployeeProfileDetailClient.tsx';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log('Rendering search in details client:');
lines.forEach((line, index) => {
  if (line.includes('other_docs') || line.includes('cccd_front') || line.includes('cccd_back')) {
    if (index > 400) {
      console.log(`L${index + 1}: ${line.trim()}`);
    }
  }
});
