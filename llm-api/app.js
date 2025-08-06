const express = require('express');
const Redis = require('ioredis');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const FormData = require('form-data');
const { Builder, By, Capabilities, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

const app = express();

const redis = new Redis({
    host: 'redis'
});

const PORT = process.env.PORT || 3000;

let driver = null; // Global variable to store the WebDriver instance

/**
 * Simple logger middleware for Express requests.
 */
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} from ${req.ip}`);
    next();
});

/**
 * Endpoint to list available APIs, specifically for Home Assistant.
 */
app.get('/apis', (req, res) => {
    let apiEndpoints = { message: "Available API Endpoints", endpoints: [] };
    try {
        const apiJsonPath = path.join(__dirname, 'apis.json');
        const rawData = fs.readFileSync(apiJsonPath, 'utf8');
        apiEndpoints = JSON.parse(rawData);
        console.log('Successfully loaded API endpoints from apis.json');
    } catch (error) {
        console.error('Error loading apis.json:', error.message);
    }

    const processedEndpoints = apiEndpoints.endpoints.map(endpoint => {
        return {
            ...endpoint,
            url: endpoint.url.replace('[YOUR_HOST]', req.headers.host)
        };
    });
    res.json({
        message: apiEndpoints.message,
        endpoints: processedEndpoints
    });
});


app.get('/docs', (req, res) => {
    let docs = { message: "Available Documents", documentations: [] };
    try {
        const apiJsonPath = path.join(__dirname, 'docs.json');
        const rawData = fs.readFileSync(apiJsonPath, 'utf8');
        docs2 = JSON.parse(rawData);
        docs.documentations = docs2;
    } catch (error) {
    }

    res.json(docs);
});


app.use('/kmb', require('./kmb/index'));
const OpenAI = require('openai');

app.get('/weather/hk', async (req, res) => {
    const weatherUrls = [
        'https://rss.weather.gov.hk/rss/WeatherWarningSummaryv2_uc.xml',
        'https://rss.weather.gov.hk/rss/LocalWeatherForecast_uc.xml',
        'https://rss.weather.gov.hk/rss/SeveralDaysWeatherForecast_uc.xml'
    ];

    try {
        const responses = await Promise.all(
            weatherUrls.map(url => axios.get(url))
        );

        const cleanHtml = (html) => {
            if (!html) return '';
            const $ = cheerio.load(html);
            return $.text();
        };

        const removeUnwantedWhitespace = (text) => {
            if (!text) return '';
            // Remove space between Chinese characters, then remove excessive general whitespace.
            return text.replace(/(\p{Script=Han})\s+(?=\p{Script=Han})/gu, '$1').replace(/\s+/g, ' ').trim();
        };

        const weatherData = responses.map((response, index) => {
            const $ = cheerio.load(response.data, { xmlMode: true });
            let description = $('item description').text().trim() || $('item title').text().trim() || '';

            // if (index === 2) { // Apply cleaning specifically for severalDaysWeatherForecast
            description = cleanHtml(description);
            description = removeUnwantedWhitespace(description);
            // }
            return description;
        });

        res.json({
            weatherWarningSummary: weatherData[0],
            localWeatherForecast: weatherData[1],
            severalDaysWeatherForecast: weatherData[2]
        });
    } catch (error) {
        console.error('Error fetching HK weather data:', error.message);
        res.status(500).json({ error: 'Failed to fetch HK weather data', details: error.message });
    }
});

app.get('/weather/hk/radar', async (req, res) => {
    try {
        const hkoRadarJsonUrl = 'https://www.hko.gov.hk/wxinfo/radars/temp_json/iradar_img.json';
        const radarData = (await axios.get(hkoRadarJsonUrl)).data;


        // Allow selecting range via query param (e.g., ?range=2), default to 2 (64km)
        const requestedRange = req.query.range || '2';
        const rangeKey = `range${requestedRange}`;
        if (!radarData?.radar?.[rangeKey]?.image) {
            const availableRanges = Object.keys(radarData?.radar || {}).filter(k => k.startsWith('range')).map(k => k.replace('range', ''));
            return res.status(404).json({
                error: `Invalid or missing radar data for '${rangeKey}'.`,
                message: `Please provide a 'range' query parameter. Available ranges are: ${availableRanges.join(', ') || 'none'}.`
            });
        }

        const rangeImages = radarData.radar[rangeKey].image;

        if (!Array.isArray(rangeImages) || rangeImages.length === 0) {
            return res.status(404).json({ error: `No radar images found for ${rangeKey}.` });
        }

        // The image string is like: picture[2][19]="rad_064_png/2d064iradar_...jpg";
        // We need to extract the path inside the quotes.
        const lastImageString = rangeImages[rangeImages.length - 1];
        const filenameMatch = lastImageString.match(/"(.*?)"/);

        if (!filenameMatch || filenameMatch.length < 2) {
            return res.status(500).json({ error: 'Could not parse radar image filename.' });
        }

        const radarImageRelativePath = filenameMatch[1];
        const fullImageUrl = `https://www.hko.gov.hk/wxinfo/radars/${radarImageRelativePath}`;

        // Download the image
        const imageResponse = await axios.get(fullImageUrl, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data);

        console.log(`Latest radar image for ${rangeKey}: ${fullImageUrl}`);

        // Send photo to Telegram (async)
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_GROUP_ID) {
            const telegramApiBaseUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
            const photoUrl = `${telegramApiBaseUrl}/sendPhoto`;
            const photoFormData = new FormData();
            photoFormData.append('chat_id', process.env.TELEGRAM_GROUP_ID);
            photoFormData.append('photo', imageBuffer, { filename: 'radar.jpg', contentType: 'image/jpeg' });
            photoFormData.append('caption', `HKO Radar Image (Range: ${requestedRange})`);
            try {
                axios.post(photoUrl, photoFormData, {
                    headers: photoFormData.getHeaders()
                }).then(() => console.log('Radar image sent to Telegram successfully.'))
                    .catch(telegramError => console.error('Error sending radar image to Telegram:', telegramError.response ? telegramError.response.data : telegramError.message));
            } catch (telegramError) {
                console.error('Error initiating Telegram photo send:', telegramError.message);
            }
        }

        // Let LLM analyze
        const openai = new OpenAI({
            apiKey: process.env.OPENROUTER_API_KEY, // Replace with your actual API key environment variable
            baseURL: "https://openrouter.ai/api/v1",
        });

        const chatCompletion = await openai.chat.completions.create({
            model: "google/gemini-2.5-pro",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Describe the Current Weather Conditions from this radar image. No need to describe legends." },
                        { type: "image_url", image_url: { url: fullImageUrl } },
                    ],
                },
            ],
        });

        let weatherDescription = chatCompletion.choices[0].message.content;

        // Return result to client
        res.json({
            range: requestedRange,
            radarImageUrl: fullImageUrl,
            weatherDescription: weatherDescription,
        });

        console.log({ weatherDescription })

        // Send description to Telegram (async)
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_GROUP_ID) {
            const telegramApiBaseUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
            const messageUrl = `${telegramApiBaseUrl}/sendMessage`;

            const textMessage = `Current Weather Conditions:\n\n${weatherDescription}`;
            try {
                axios.post(messageUrl, {
                    chat_id: process.env.TELEGRAM_GROUP_ID,
                    text: textMessage
                }).then(() => console.log('Weather description sent to Telegram successfully.'))
                    .catch(telegramError => console.error('Error sending weather description to Telegram:', telegramError.response ? telegramError.response.data : telegramError.message));
            } catch (telegramError) {
                console.error('Error initiating Telegram message send:', telegramError.message);
            }
        }

    } catch (error) {
        if (error instanceof SyntaxError) {
            console.error("Failed to parse HKO response as JSON:", error.message);
            return res.status(500).json({ error: 'Failed to parse radar data from HKO', details: error.message });
        }
        console.error('Error fetching HKO radar image or describing it:', error.message);
        res.status(500).json({ error: 'Failed to process radar image', details: error.message });
    }
});
// Constants for the weather warnings endpoint, defined at a higher scope
const warningImageMap = {
    'TC1': 'img/tc1.gif', 'TC3': 'img/tc3.gif', 'TC8NE': 'img/tc8ne.gif',
    'TC8NW': 'img/tc8nw.gif', 'TC8SE': 'img/tc8se.gif', 'TC8SW': 'img/tc8sw.gif',
    'TC9': 'img/tc9.gif', 'TC10': 'img/tc10.gif', 'WRAINA': 'img/raina.gif',
    'WRAINR': 'img/rainr.gif', 'WRAINB': 'img/rainb.gif', 'WTS': 'img/ts.gif',
    'WFNTSA': 'img/ntfl.gif', 'WL': 'img/landslip.gif', 'WMSGNL': 'img/sms.gif',
    'WFROST': 'img/frost.gif', 'WFIREY': 'img/firey.gif', 'WFIRER': 'img/firer.gif',
    'WCOLD': 'img/cold.gif', 'WHOT': 'img/vhot.gif', 'WTMW': 'img/tsunami-warn.gif'
};

const warningNameMap = {
    'TC1': '一號戒備信號', 'TC3': '三號強風信號', 'TC8NE': '八號東北烈風或暴風信號',
    'TC8NW': '八號西北烈风或暴风信号', 'TC8SE': '八號東南烈風或暴風信號',
    'TC8SW': '八號西南烈風或暴風信號', 'TC9': '九號烈風或暴風風力增強信號',
    'TC10': '十號颶風信號', 'WRAINA': '黃色暴雨警告信號', 'WRAINR': '紅色暴雨警告信號',
    'WRAINB': '黑色暴雨警告信號', 'WTS': '雷暴警告', 'WFNTSA': '新界北部水浸特別報告',
    'WL': '山泥傾瀉警告', 'WMSGNL': '強烈季候風信號', 'WFROST': '霜凍警告',
    'WFIREY': '黃色火災危險警告', 'WFIRER': '紅色火災危險警告', 'WCOLD': '寒冷天氣警告',
    'WHOT': '酷熱天氣警告', 'WTMW': '海嘯警告'
};
const HKO_WARNINGS_REDIS_KEY = 'hkwarnings:active';
const HKO_WARNINGS_LAST_UPDATE_KEY = 'hkwarnings:last_update';

/**
 * Fetches the latest weather warnings from HKO, processes them,
 * and stores the list of active warnings in Redis and a file.
 */
async function updateActiveWarningsInRedis() {
    const hkoBaseUrl = 'https://rss.weather.gov.hk/';
    const apiUrl = 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc';

    try {
        console.log('Fetching latest weather warnings from HKO...');
        const response = await axios.get(apiUrl);
        const warningsData = response.data;
        const activeWarnings = [];
        const activeWarningCodes = [];

        if (warningsData && typeof warningsData === 'object') {
            for (const key in warningsData) {
                const warning = warningsData[key];
                // Ensure warning and warning.code are valid before proceeding
                if (warning && warning.code) {
                    let code = warning.code;

                    if (warning.subtype) {
                        code = warning.subtype;
                    }

                    if (warningImageMap[code] && warning.actionCode !== 'CANCEL') {
                        activeWarnings.push({
                            name: warningNameMap[code] || warning.name,
                            imgSrc: hkoBaseUrl + warningImageMap[code]
                        });
                        activeWarningCodes.push(code); // Collect active warning codes
                    }
                }
            }
        }

        // Store the result in Redis, even if it's an empty array
        await redis.set(HKO_WARNINGS_REDIS_KEY, JSON.stringify(activeWarnings));
        await redis.set(HKO_WARNINGS_LAST_UPDATE_KEY, new Date().toISOString()); // Store the fetch time
        console.log(`Updated active warnings in Redis. Found ${activeWarnings.length} warnings.`);

        // Save the active warning codes to /shared/warnings.txt
        const warningsFilePath = '/shared/warnings.txt';
        const warningsContent = activeWarningCodes.join(',');
        fs.writeFileSync(warningsFilePath, warningsContent);
        console.log(`Active warning codes saved to ${warningsFilePath}: ${warningsContent}`);

    } catch (error) {
        console.error('Failed to fetch or process weather warnings for Redis update:', error.message);
    }
}

// Initial fetch on startup, then update every 60 seconds.
// This background polling is separate from the page's refresh rate.
updateActiveWarningsInRedis();
setInterval(updateActiveWarningsInRedis, 60 * 1000); // Poll API every 60 seconds

/**
 * Endpoint to display a simple HTML page with active weather warnings.
 * Data is read from Redis, and the page auto-refreshes every 30 seconds.
 */
app.get('/weather/hk/warnings-page', async (req, res) => {
    try {
        const storedWarningsJson = await redis.get(HKO_WARNINGS_REDIS_KEY);
        const lastUpdateIso = await redis.get(HKO_WARNINGS_LAST_UPDATE_KEY);

        // If Redis is empty or the key hasn't been set yet, default to an empty array.
        const activeWarnings = storedWarningsJson ? JSON.parse(storedWarningsJson) : [];
        const lastUpdate = lastUpdateIso ? new Date(lastUpdateIso).toLocaleString('en-HK', { timeZone: 'Asia/Hong_Kong' }) : 'N/A';


        // Generate HTML response based on data from Redis
        let imageGridHtml = '<p style="font-size: 1.2em;">No active weather warnings.</p>';
        if (activeWarnings.length > 0) {
            imageGridHtml = activeWarnings.map(warning =>
                `<img src="${warning.imgSrc}" alt="${warning.name}" title="${warning.name}" style="max-width: 150px; margin: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">`
            ).join('');
        }

        const html = `
            <!DOCTYPE html>
            <html lang="zh-HK">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="refresh" content="30">
                <title>HKO Active Weather Warnings</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                        background-color: transparent; /* For embedding in iframes etc. */
                        margin: 0;
                        padding: 0;
                        text-align: center;
                        color: #333;
                    }
                    #warnings-grid {
                        display: flex;
                        flex-wrap: wrap;
                        justify-content: center;
                        align-items: center;
                        gap: 15px;
                        margin-top: 5px;
                    }
                    p {
                        font-size: 0.8em;
                        color: #555;
                        margin-top: 10px;
                    }
                </style>
            </head>
            <body>
                <div id="warnings-grid">
                    ${imageGridHtml}
                </div>
                <p>最後更新: ${lastUpdate}.</p>
            </body>
            </html>
        `;

        res.setHeader('Content-Type', 'text/html');
        res.send(html);

    } catch (error) {
        console.error('Failed to generate weather warnings page from Redis data:', error.message);
        res.status(500).send('<h1>Error</h1><p>Failed to retrieve weather warnings. Please try again later.</p>');
    }
});

app.get('/rthk/news', async (req, res) => {
    const newsUrls = {
        local: 'https://rthk.hk/rthk/news/rss/c_expressnews_clocal.xml',
        greaterchina: 'https://rthk.hk/rthk/news/rss/c_expressnews_greaterchina.xml',
        international: 'https://rthk.hk/rthk/news/rss/c_expressnews_cinternational.xml',
        finance: 'https://rthk.hk/rthk/news/rss/c_expressnews_cfinance.xml',
        sport: 'https://rthk.hk/rthk/news/rss/c_expressnews_csport.xml'
    };

    let requestedSections = req.query.section ? req.query.section.split(',') : Object.keys(newsUrls);

    // Filter to ensure only valid sections are requested
    requestedSections = requestedSections.filter(section => newsUrls[section]);

    if (requestedSections.length === 0) {
        return res.status(400).json({ error: 'No valid sections specified. Available sections: local, greaterchina, international, finance, sport.' });
    }

    try {
        const fetchPromises = requestedSections.map(section =>
            axios.get(newsUrls[section]).then(response => ({ section, data: response.data }))
        );

        const results = await Promise.all(fetchPromises);

        const newsData = {};
        results.forEach(item => {
            newsData[item.section] = item.data;
        });

        res.json(newsData);

    } catch (error) {
        console.error('Error fetching RTHK news data:', error.message);
        res.status(500).json({ error: 'Failed to fetch RTHK news data', details: error.message });
    }
});

/**
 * Initializes the Selenium WebDriver for headless Chrome.
 * Ensures only one instance is active at a time and handles potential crashes.
 * @returns {Promise<WebDriver>} The Selenium WebDriver instance.
 */
async function getBrowserInstance() {
    if (driver) {
        try {
            // Check if the existing driver is still alive
            await driver.getCurrentUrl(); // This will throw an error if the browser is closed
            console.log('Reusing existing browser instance.');
            return driver;
        } catch (error) {
            console.warn('Existing browser instance is unhealthy or crashed. Reinitializing...');
            try {
                await driver.quit(); // Attempt to quit the unhealthy driver
                console.log('Unhealthy browser instance quit successfully.');
            } catch (quitError) {
                console.error('Error quitting unhealthy browser instance:', quitError.message);
            }
            driver = null; // Mark as null to create a new one
        }
    }
    console.log('Initializing new headless Chrome browser instance...');
    const chromeOptions = new chrome.Options();
    chromeOptions.setPageLoadStrategy('eager');
    chromeOptions.addArguments('--headless');
    chromeOptions.addArguments('--disable-gpu');
    chromeOptions.addArguments('--no-sandbox');
    chromeOptions.addArguments('--disable-dev-shm-usage');
    chromeOptions.addArguments('--window-size=1920,1080');
    chromeOptions.addArguments('--disable-setuid-sandbox');
    // Specify the path to chromedriver
    let service = new chrome.ServiceBuilder('/usr/bin/chromedriver');
    driver = new Builder()
        .forBrowser('chrome')
        .setChromeOptions(chromeOptions)
        .setChromeService(service) // Use the service builder
        .build();

    console.log('New headless Chrome browser instance initialized.');
    return driver;
}

// Ensure the browser is closed when the Node.js process exits
process.on('exit', async () => {
    if (driver) {
        console.log('Closing Selenium WebDriver...');
        await driver.quit();
        console.log('Selenium WebDriver closed.');
    }
});

process.on('SIGINT', async () => {
    console.log('Received SIGINT. Shutting down browser...');
    if (driver) {
        await driver.quit();
    }
    process.exit(0);
});
app.get('/stock/:ticker', async (req, res) => {
    const ticker = req.params.ticker;
    if (!ticker) {
        return res.status(400).json({ error: 'Stock ticker is required.' });
    }

    const searchUrl = `https://finance.yahoo.com/quote/${ticker}/`;
    try {
        const pageSource = await browseAndExtractText(searchUrl);
        // Return JSON to LLM
        res.json({
            ticker: ticker,
            sourceUrl: searchUrl,
            results: pageSource
        });

    } catch (error) {
        console.error('Error during Yahoo Finance search with Selenium:', error);
        res.status(500).json({ error: `Failed to retrieve stock data: ${error.message}` });
    }
});

app.get('/browse', async (req, res) => {
    const url = req.query.url;
    if (!url) {
        return res.status(400).json({ error: 'URL is required.' });
    }

    try {
        const pageSource = await browseAndExtractText(url);
        res.json({
            url: url,
            results: pageSource
        });
    } catch (error) {
        console.error(`Error during browser visit to ${url}:`, error);
        res.status(500).json({ error: `Failed to browse URL: ${error.message}` });
    }
});

/**
 * Navigates to a URL using Selenium and extracts the innerText of the body.
 * Handles browser instance management (reusing or reinitializing).
 * @param {string} url The URL to navigate to.
 * @returns {Promise<string>} The innerText of the body.
 */
async function browseAndExtractText(url) {
    let browser;
    try {
        browser = await getBrowserInstance();
        console.log(`Navigating to: ${url}`);

        await browser.get(url);

        // Wait for the body element to be present (indicating page load)
        await browser.wait(until.elementLocated(By.tagName('body')), 10000);

        // Get the innerHTML of the body as plain text
        const pageSource = await browser.executeScript(() => document.body.innerText);
        return pageSource;
    } catch (error) {
        // If an error occurs, it might mean the browser instance is dead.
        // Set driver to null so a new one is created on next request.
        if (browser && driver === browser) { // Only nullify if it's the global instance that failed
            console.warn('Browser instance failed. Marking for reinitialization.');
            try {
                await browser.quit(); // Attempt to quit the unhealthy driver
                console.log('Unhealthy browser instance quit successfully.');
            } catch (quitError) {
                console.error('Error quitting failed browser:', quitError.message);
            }
            driver = null;
        }
        throw error; // Re-throw the error to be caught by the caller
    }
}

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
