const rekruterBot = require('./Rekruter/index');

// Uruchomienie bota
console.log('🚀 Uruchamianie Rekruter Bot...');

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
        console.log('✅ Bot został uruchomiony automatycznie');
    }
} catch (error) {
    console.error('❌ Błąd uruchomienia bota:', error);
}
