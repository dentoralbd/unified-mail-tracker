const puppeteer = require('puppeteer-core');

async function inspectRequestPayload(id) {
    console.log(`=== INSPECTING PARCELSAPP REQUEST PAYLOAD FOR ${id} ===`);
    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    page.on('request', req => {
        const url = req.url();
        if (url.includes('/api/v2/parcels') || url.includes('/api/v1/parcels')) {
            console.log(`\nURL: ${url}`);
            console.log(`Method: ${req.method()}`);
            console.log(`Headers:`, req.headers());
            console.log(`PostData:`, req.postData());
        }
    });

    try {
        await page.goto(`https://parcelsapp.com/en/tracking/${id}`, {
            waitUntil: 'networkidle2',
            timeout: 25000
        });
    } catch(e) {
        console.log('Navigation notice:', e.message);
    }

    await new Promise(r => setTimeout(r, 6000));
    await browser.close();
}

inspectRequestPayload('UG251083645MV');
