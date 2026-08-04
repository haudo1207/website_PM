const fs = require('fs');
const filePath = 'c:\\Tích hợp\\ai-marketing\\app\\admin\\employee-profiles\\EmployeeProfileClient.tsx';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log('Search for Table Headers and Rows:');
lines.forEach((line, index) => {
  if (line.includes('Họ và tên') || line.includes('Ngày sinh') || line.includes('Email cá nhân') || line.includes('profile.full_name') || line.includes('profile.dob')) {
    if (index > 150) {
      console.log(`L${index + 1}: ${line.trim()}`);
    }
  }
});
