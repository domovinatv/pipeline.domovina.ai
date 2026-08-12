import fs from 'fs';

function extractToken() {
  const content = fs.readFileSync('.magisterium_cookies.txt', 'utf-8');
  let cookies;
  try {
    cookies = JSON.parse(content);
  } catch (e) {
    console.error("Not a valid JSON file.");
    return;
  }
  
  const chunks = [];
  for (const cookie of cookies) {
    if (cookie.name && cookie.name.includes('auth-token.')) {
      const index = parseInt(cookie.name.split('.').pop());
      chunks[index] = cookie.value;
      console.log(`Found chunk ${index} (length: ${cookie.value.length})`);
    }
  }

  if (chunks.length === 0) {
    console.error("No auth-token chunks found.");
    return;
  }

  let fullTokenStr = chunks.join('');
  
  try {
    fullTokenStr = decodeURIComponent(fullTokenStr);
  } catch (e) {}
  
  if (fullTokenStr.startsWith('base64-')) {
    fullTokenStr = fullTokenStr.replace('base64-', '');
    fullTokenStr = Buffer.from(fullTokenStr, 'base64').toString('utf-8');
  }

  try {
    const session = JSON.parse(fullTokenStr);
    if (session.access_token) {
      fs.writeFileSync('.magisterium_token', session.access_token);
      console.log("Successfully extracted and saved access_token.");
    }
  } catch (e) {
    console.error("Failed to parse JSON:", e.message);
  }
}

extractToken();
