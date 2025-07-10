const rekruterBot = require('./Rekruter/index');
const szkoleniaBot = require('./Szkolenia/index');
const stalkerLMEBot = require('./StalkerLME/index');
const muteuszBot = require('./Muteusz/index');
const endersEchoBot = require('./EndersEcho/index');

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

// Uruchomienie bota Stalker LME
console.log('🎯 Uruchamianie Stalker LME Bot...');
try {
    if (typeof stalkerLMEBot.start === 'function') {
        stalkerLMEBot.start();
    } else {
        console.log('✅ Stalker LME Bot został uruchomiony automatycznie');
    }
} catch (error) {
    console.error('❌ Błąd uruchomienia Stalker LME Bot:', error);
}

// Uruchomienie bota Muteusz
console.log('🤖 Uruchamianie Muteusz Bot...');
try {
    if (typeof muteuszBot.start === 'function') {
        muteuszBot.start();
    } else {
        console.log('✅ Muteusz Bot został uruchomiony automatycznie');
    }
} catch (error) {
    console.error('❌ Błąd uruchomienia Muteusz Bot:', error);
}

// Uruchomienie bota EndersEcho
console.log('🏆 Uruchamianie EndersEcho Bot...');
try {
    if (typeof endersEchoBot.start === 'function') {
        endersEchoBot.start();
    } else {
        console.log('✅ EndersEcho Bot został uruchomiony automatycznie');
    }
} catch (error) {
    console.error('❌ Błąd uruchomienia EndersEcho Bot:', error);
}

