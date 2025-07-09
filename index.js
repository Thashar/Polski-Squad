const rekruterBot = require('./Rekruter/index');
const szkoleniaBot = require('./Szkolenia/index');

console.log('🚀 Uruchamianie botów...');

// Uruchomienie bota Rekruter
console.log('🎯 Uruchamianie Rekruter Bot...');
try {
    // Jeśli bot eksportuje funkcję start()
    if (typeof rekruterBot.start === 'function') {
        rekruterBot.start();
    }
    // Jeśli bot eksportuje funkcję login() 
    else if (typeof rekruterBot.login === 'function') {
        rekruterBot.login();
    }
    // Jeśli bot się uruchamia automatycznie po zaimportowaniu
    else {
        console.log('✅ Rekruter Bot został uruchomiony automatycznie');
    }
} catch (error) {
    console.error('❌ Błąd uruchomienia Rekruter Bot:', error);
}

// Uruchomienie bota Szkolenia
console.log('🎓 Uruchamianie Szkolenia Bot...');
try {
    if (typeof szkoleniaBot.start === 'function') {
        szkoleniaBot.start();
    } else {
        console.log('✅ Szkolenia Bot został uruchomiony automatycznie');
    }
} catch (error) {
    console.error('❌ Błąd uruchomienia Szkolenia Bot:', error);
}

