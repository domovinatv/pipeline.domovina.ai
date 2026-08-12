import puppeteer from 'puppeteer';
import fs from 'fs';

async function main() {
  console.log("Pokrećem preglednik... Molim te, ulogiraj se u Magisterium u prozoru koji će se otvoriti.");
  
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: null
  });
  
  const page = await browser.newPage();
  await page.goto('https://www.magisterium.com/login', { waitUntil: 'networkidle2' });

  console.log("Čekam uspješnu prijavu (pratim Local Storage i kolačiće)...");

  let token = null;
  while (!token) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Provjeri LocalStorage
    const lsToken = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.toLowerCase().includes('token') || key.toLowerCase().includes('auth'))) {
          const val = localStorage.getItem(key);
          try {
            const parsed = JSON.parse(val);
            if (parsed.access_token) return parsed.access_token;
            if (parsed.token) return parsed.token;
          } catch (e) {}
          if (typeof val === 'string' && val.length > 20 && (val.startsWith('ey') || val.includes('Bearer'))) {
            return val;
          }
        }
      }
      return null;
    });

    if (lsToken) {
      token = lsToken;
      break;
    }
    
    const pages = await browser.pages();
    if (pages.length === 0) {
      console.log("Preglednik je zatvoren prije prijave.");
      break;
    }
  }

  if (token) {
    console.log("\n=======================================================");
    console.log("USPJESNO PRONADEN TOKEN!");
    console.log("Spremam token u .magisterium_token");
    console.log("=======================================================\n");
    fs.writeFileSync('/Users/ms/git/domovinatv/pipeline.domovina.ai/.magisterium_token', token);
  } else {
    console.log("Nisam uspio pronaći token.");
  }

  setTimeout(async () => {
    await browser.close();
    process.exit(0);
  }, 3000);
}

main().catch(console.error);
