const axios = require('axios');
const https = require('https');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('NetTest');

async function testConnections() {
    const testConfigs = [
        {
            name: "Standard axios",
            config: {
                timeout: 20000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }
        },
        {
            name: "Relaxed SSL",
            config: {
                timeout: 20000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false,
                    timeout: 15000
                })
            }
        },
        {
            name: "Shorter timeout",
            config: {
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }
        },
        {
            name: "Different User-Agent",
            config: {
                timeout: 20000,
                headers: {
                    'User-Agent': 'curl/7.68.0',
                    'Accept': '*/*'
                }
            }
        }
    ];

    const urls = [
        'https://garrytools.com/rank/clans',
        'https://garrytools.com/rank/players', 
        'https://garrytools.com/rank/enderecho'
    ];

    for (const testConfig of testConfigs) {
        logger.info(`\n🧪 Testing: ${testConfig.name}`);
        
        for (const url of urls) {
            try {
                const startTime = Date.now();
                const axiosInstance = axios.create(testConfig.config);
                const response = await axiosInstance.get(url);
                const endTime = Date.now();
                
                logger.info(`  ✅ ${url}: ${response.status} (${endTime - startTime}ms, ${response.data.length} bytes)`);
                
                // Quick check if data looks right
                if (url.includes('/players') || url.includes('/enderecho')) {
                    const hasTableData = response.data.includes('<tbody>') && response.data.includes('<tr>') && !response.data.includes('<tbody>\n                    </tbody>');
                    logger.info(`     Data quality: ${hasTableData ? '✅ Has table data' : '❌ Empty table'}`);
                } else if (url.includes('/clans')) {
                    const hasTableData = response.data.includes('<tbody>') && response.data.includes('<tr>') && !response.data.includes('<tbody>\n                    </tbody>');
                    logger.info(`     Data quality: ${hasTableData ? '✅ Has table data' : '❌ Empty table (expected for clans)'}`);
                }
                
            } catch (error) {
                logger.error(`  ❌ ${url}: ${error.code || 'UNKNOWN_ERROR'} - ${error.message}`);
                if (error.response) {
                    logger.error(`     Status: ${error.response.status}, Headers: ${JSON.stringify(error.response.headers)}`);
                }
                if (error.request && !error.response) {
                    logger.error(`     Request timeout or network error`);
                }
            }
        }
    }
}

testConnections().catch(console.error);