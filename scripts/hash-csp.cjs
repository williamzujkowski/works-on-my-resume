const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hashCsp() {
  const distDir = path.join(__dirname, '../dist');
  const indexHtmlPath = path.join(distDir, 'index.html');

  if (!fs.existsSync(indexHtmlPath)) {
    console.error(`Could not find ${indexHtmlPath}`);
    process.exit(1);
  }

  let html = fs.readFileSync(indexHtmlPath, 'utf8');

  // Find all <script>...</script> (excluding external src scripts)
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

  const scriptHashes = [];
  const styleHashes = [];

  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    if (match[1].trim().length > 0) {
      const hash = crypto.createHash('sha256').update(match[1]).digest('base64');
      scriptHashes.push(`'sha256-${hash}'`);
    }
  }

  while ((match = styleRegex.exec(html)) !== null) {
    if (match[1].trim().length > 0) {
      const hash = crypto.createHash('sha256').update(match[1]).digest('base64');
      styleHashes.push(`'sha256-${hash}'`);
    }
  }

  // Update CSP meta tag
  const cspRegex = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/i;
  
  html = html.replace(cspRegex, (fullMatch, cspContent) => {
    let newCsp = cspContent;
    
    // Add script hashes to script-src
    if (scriptHashes.length > 0) {
      newCsp = newCsp.replace(/script-src\s+'self'/, `script-src 'self' ${scriptHashes.join(' ')}`);
    }
    
    // Add style hashes to style-src
    if (styleHashes.length > 0) {
      newCsp = newCsp.replace(/style-src\s+'self'/, `style-src 'self' ${styleHashes.join(' ')}`);
    }

    return `<meta http-equiv="Content-Security-Policy" content="${newCsp}" />`;
  });

  fs.writeFileSync(indexHtmlPath, html);
  console.log('CSP hashes injected into dist/index.html');
  console.log('Script hashes:', scriptHashes.length);
  console.log('Style hashes:', styleHashes.length);
}

hashCsp();
