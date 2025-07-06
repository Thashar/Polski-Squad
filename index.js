const rekruterBot = require('./Rekruter/index');
const lmeStalkerBot = require('./LME Stalker/index');

// Funkcja do uruchomienia bota Rekruter
async function startRekruterBot() {
    console.log('🚀 Uruchamianie Rekruter Bot...');
    
    return new Promise((resolve, reject) => {
        try {
            // Jeśli bot eksportuje funkcję start()
            if (typeof rekruterBot.start === 'function') {
                const result = rekruterBot.start();
                // Jeśli start() zwraca Promise
                if (result && typeof result.then === 'function') {
                    result.then(resolve).catch(reject);
                } else {
                    resolve();
                }
            }
            // Jeśli bot eksportuje funkcję login() 
            else if (typeof rekruterBot.login === 'function') {
                const result = rekruterBot.login();
                // Jeśli login() zwraca Promise
                if (result && typeof result.then === 'function') {
                    result.then(resolve).catch(reject);
                } else {
                    resolve();
                }
            }
            // Jeśli bot się uruchamia automatycznie po zaimportowaniu
            else {
                console.log('✅ Rekruter Bot został uruchomiony automatycznie');
                resolve();
            }
        } catch (error) {
            reject(error);
        }
    });
}

// Funkcja do uruchomienia bota LME Stalker
async function startLmeStalkerBot() {
    console.log('🚀 Uruchamianie LME Stalker Bot...');
    
    return new Promise((resolve, reject) => {
        try {
            // Jeśli bot eksportuje funkcję start()
            if (typeof lmeStalkerBot.start === 'function') {
                const result = lmeStalkerBot.start();
                // Jeśli start() zwraca Promise
                if (result && typeof result.then === 'function') {
                    result.then(resolve).catch(reject);
                } else {
                    resolve();
                }
            }
            // Jeśli bot eksportuje funkcję login() 
            else if (typeof lmeStalkerBot.login === 'function') {
                const result = lmeStalkerBot.login();
                // Jeśli login() zwraca Promise
                if (result && typeof result.then === 'function') {
                    result.then(resolve).catch(reject);
                } else {
                    resolve();
                }
            }
            // Jeśli bot się uruchamia automatycznie po zaimportowaniu
            else {
                console.log('✅ LME Stalker Bot został uruchomiony automatycznie');
                resolve();
            }
        } catch (error) {
            reject(error);
        }
    });
}

// Główna funkcja uruchamiająca boty sekwencyjnie
async function startAllBots() {
    try {
        // Uruchom pierwszy bot (Rekruter)
        await startRekruterBot();
        console.log('✅ Rekruter Bot uruchomiony pomyślnie');
        
        // Po zakończeniu pierwszego bota, uruchom drugi (LME Stalker)
        await startLmeStalkerBot();
        console.log('✅ LME Stalker Bot uruchomiony pomyślnie');
        
        console.log('🎉 Wszystkie boty zostały uruchomione sekwencyjnie');
        
    } catch (error) {
        console.error('❌ Błąd uruchomienia bota:', error);
    }
}

// Uruchomienie sekwencji
startAllBots();
