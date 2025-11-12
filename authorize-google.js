const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const readline = require('readline');
require('dotenv').config();

const SCOPES = ['https://www.googleapis.com/auth/drive'];
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json';

/**
 * Skrypt do autoryzacji Google Drive OAuth 2.0
 * Uruchom: node authorize-google.js
 */

async function authorize() {
    try {
        console.log('🔐 Rozpoczynam autoryzację Google Drive...\n');

        // Sprawdź czy plik credentials istnieje
        if (!fs.existsSync(CREDENTIALS_PATH)) {
            console.error(`❌ Błąd: Plik credentials nie istnieje: ${CREDENTIALS_PATH}`);
            console.log('\n📋 Instrukcja:');
            console.log('1. Wejdź na https://console.cloud.google.com/');
            console.log('2. Wybierz swój projekt (backup-polski-squad)');
            console.log('3. APIs & Services > Credentials');
            console.log('4. Create Credentials > OAuth 2.0 Client ID');
            console.log('5. Application type: Desktop app');
            console.log('6. Pobierz plik JSON i zapisz jako google-credentials.json\n');
            process.exit(1);
        }

        const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
        const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

        const oAuth2Client = new google.auth.OAuth2(
            client_id,
            client_secret,
            redirect_uris[0]
        );

        // Wygeneruj URL autoryzacji
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
        });

        console.log('📱 Otwórz ten URL w przeglądarce i autoryzuj aplikację:\n');
        console.log(authUrl);
        console.log('\n');

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        rl.question('📝 Wklej kod autoryzacji tutaj: ', async (code) => {
            rl.close();

            try {
                const { tokens } = await oAuth2Client.getToken(code);
                oAuth2Client.setCredentials(tokens);

                // Zapisz token do pliku
                fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

                console.log('\n✅ Token został zapisany do:', TOKEN_PATH);
                console.log('✅ Autoryzacja zakończona pomyślnie!');
                console.log('\n🚀 Możesz teraz uruchomić backup używając /data-archive w Discord');
                console.log('   lub uruchomić: npm run backup\n');

            } catch (error) {
                console.error('❌ Błąd pobierania tokena:', error.message);
                process.exit(1);
            }
        });

    } catch (error) {
        console.error('❌ Błąd autoryzacji:', error.message);
        process.exit(1);
    }
}

authorize();
