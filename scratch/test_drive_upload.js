const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

// Load .env.local
const envPath = 'c:\\Tích hợp\\ai-marketing\\.env.local';
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    }
    env[match[1]] = value;
  }
});

const serviceAccountEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = (env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const folderId = env.GOOGLE_DRIVE_ONBOARDING_FOLDER_ID || env.GOOGLE_DRIVE_FOLDER_ID;

console.log('Service Account Email:', serviceAccountEmail);
console.log('Target Folder ID:', folderId);

if (!serviceAccountEmail || !privateKey || !folderId) {
  console.error('ERROR: Missing credentials or folder ID in .env.local!');
  process.exit(1);
}

const auth = new google.auth.JWT({
  email: serviceAccountEmail,
  key: privateKey,
  scopes: ['https://www.googleapis.com/auth/drive'],
});

const drive = google.drive({ version: 'v3', auth });

async function runTest() {
  console.log('Attempting to upload a dummy file to Google Drive...');
  try {
    const response = await drive.files.create({
      requestBody: {
        name: 'Markee-Test-Upload.txt',
        mimeType: 'text/plain',
        parents: [folderId],
      },
      media: {
        mimeType: 'text/plain',
        body: Readable.from('Hello Markee API Test Upload!'),
      },
      fields: 'id, webViewLink',
      supportsAllDrives: true,
    });
    console.log('SUCCESS! File uploaded successfully.');
    console.log('File ID:', response.data.id);
    console.log('View Link:', response.data.webViewLink);
  } catch (error) {
    console.error('API Error details:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
  }
}

runTest();
