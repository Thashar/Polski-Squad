const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { EmbedBuilder } = require('discord.js');
const { formatMessage, isMediaFile } = require('../utils/helpers');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

class MediaService {
    constructor(config) {
        this.config = config;
        this.cacheDir = config.media.cacheDir;
        this.messageLinks = new Map(); // originalMessageId -> repostedMessageData
    }

    /**
     * Inicjalizuje serwis mediów
     */
    async initialize() {
        await this.ensureCacheDir();
        await this.cleanupCache();
        
        // Ustaw interwał czyszczenia cache co godzinę
        setInterval(() => this.cleanupCache(), 60 * 60 * 1000);
        
        
        // Ustaw cleanup starych linków co 24 godziny
        if (this.config.deletedMessageLogs?.enabled) {
            setInterval(() => this.cleanupOldMessageLinks(), 24 * 60 * 60 * 1000);
        }
    }

    /**
     * Zapewnia istnienie katalogu cache
     */
    async ensureCacheDir() {
        try {
            await fs.access(this.cacheDir);
        } catch {
            await fs.mkdir(this.cacheDir, { recursive: true });
            logger.info(`Utworzono folder cache: ${this.cacheDir}`);
        }
    }

    /**
     * Generuje nazwę pliku cache
     * @param {string} url - URL pliku
     * @param {string} originalName - Oryginalna nazwa pliku
     * @returns {string} Nazwa pliku cache
     */
    getCacheFileName(url, originalName) {
        const hash = crypto.createHash('md5').update(url).digest('hex');
        const ext = path.extname(originalName);
        return `${hash}${ext}`;
    }

    /**
     * Pobiera plik do cache
     * @param {string} url - URL pliku
     * @param {string} fileName - Nazwa pliku
     * @param {number} fileSize - Rozmiar pliku
     * @returns {string} Ścieżka do pliku w cache
     */
    async downloadFileToCache(url, fileName, fileSize = 0) {
        const filePath = path.join(this.cacheDir, fileName);
        
        try {
            const stats = await fs.stat(filePath);
            const age = Date.now() - stats.mtime.getTime();
            
            if (age < this.config.media.cacheLifetime) {
                return filePath;
            } else {
                await fs.unlink(filePath);
            }
        } catch {
            // Plik nie istnieje, pobierz go
        }
        
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https:') ? https : http;
            const file = require('fs').createWriteStream(filePath);
            
            let downloadedBytes = 0;
            
            const request = protocol.get(url, (response) => {
                if (response.statusCode !== 200) {
                    file.close();
                    fs.unlink(filePath).catch(() => {});
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }
                
                response.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                });
                
                response.pipe(file);
                
                file.on('finish', () => {
                    file.close();
                    resolve(filePath);
                });
                
                file.on('error', (err) => {
                    file.close();
                    fs.unlink(filePath).catch(() => {});
                    reject(err);
                });
            });
            
            request.on('error', (err) => {
                file.close();
                fs.unlink(filePath).catch(() => {});
                reject(err);
            });
            
            // Zwiększony timeout dla większych plików (5 minut)
            request.setTimeout(300000, () => {
                request.destroy();
                file.close();
                fs.unlink(filePath).catch(() => {});
                reject(new Error('Timeout podczas pobierania pliku'));
            });
        });
    }

    /**
     * Czyści cache
     */
    async cleanupCache() {
        try {
            const files = await fs.readdir(this.cacheDir);
            let totalSize = 0;
            const fileStats = [];
            
            for (const file of files) {
                const filePath = path.join(this.cacheDir, file);
                const stats = await fs.stat(filePath);
                totalSize += stats.size;
                fileStats.push({
                    path: filePath,
                    name: file,
                    size: stats.size,
                    mtime: stats.mtime.getTime()
                });
            }
            
            const now = Date.now();
            let cleanedFiles = 0;
            let cleanedSize = 0;
            
            for (const file of fileStats) {
                const age = now - file.mtime;
                if (age > this.config.media.cacheLifetime) {
                    await fs.unlink(file.path);
                    cleanedFiles++;
                    cleanedSize += file.size;
                    totalSize -= file.size;
                }
            }
            
            if (totalSize > this.config.media.maxCacheSize) {
                const sortedFiles = fileStats
                    .filter(f => (now - f.mtime) <= this.config.media.cacheLifetime)
                    .sort((a, b) => a.mtime - b.mtime);
                
                for (const file of sortedFiles) {
                    if (totalSize <= this.config.media.maxCacheSize) break;
                    
                    await fs.unlink(file.path);
                    totalSize -= file.size;
                    cleanedFiles++;
                    cleanedSize += file.size;
                }
            }
            
            if (cleanedFiles > 0) {
                logger.info(`Wyczyszczono ${cleanedFiles} plików cache (${(cleanedSize / 1024 / 1024).toFixed(2)} MB)`);
            }
            
        } catch (error) {
            const errorMessage = error?.message || 'Nieznany błąd';
            logger.error(`Błąd podczas czyszczenia cache: ${errorMessage}`);
        }
    }

    /**
     * Repostuje media z wiadomości
     * @param {Message} message - Wiadomość z mediami
     * @param {Client} client - Klient Discord
     */
    async repostMedia(message, client) {
        try {
            const targetChannel = client.channels.cache.get(this.config.media.targetChannelId);
            if (!targetChannel) {
                logger.error(formatMessage(this.config.messages.channelNotFound, { 
                    channelId: this.config.media.targetChannelId 
                }));
                return;
            }

            const mediaAttachments = message.attachments.filter(att => 
                isMediaFile(att.name, this.config.media.supportedExtensions)
            );
            
            if (mediaAttachments.size === 0) return;

            const author = message.author;
            const guild = message.guild;
            const channel = message.channel;

            for (const [id, attachment] of mediaAttachments) {
                let cachedFilePath = null;
                
                try {
                    // Sprawdź rozmiar pliku
                    if (attachment.size > this.config.media.maxFileSize) {
                        logger.warn(formatMessage(this.config.messages.fileTooLarge, {
                            fileName: attachment.name,
                            size: (attachment.size / 1024 / 1024).toFixed(2)
                        }));
                        continue;
                    }
                    
                    const cacheFileName = this.getCacheFileName(attachment.url, attachment.name);
                    cachedFilePath = await this.downloadFileToCache(attachment.url, cacheFileName, attachment.size);
                    
                    const messageLink = `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`;
                    
                    const embed = new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('📸 Repost Media')
                        .setDescription(message.content || '*Brak tekstu*')
                        .addFields(
                            { name: '👤 Autor', value: `${author.tag} (${author.id})`, inline: true },
                            { name: '📺 Kanał', value: `#${channel.name}`, inline: true },
                            { name: '🏠 Serwer', value: guild.name, inline: true },
                            { name: '📅 Data', value: `<t:${Math.floor(message.createdTimestamp / 1000)}:F>`, inline: false },
                            { name: '📎 Plik', value: `${attachment.name} (${(attachment.size / 1024 / 1024).toFixed(2)} MB)`, inline: true },
                            { name: '🔗 Link', value: `[Przejdź do oryginalnej wiadomości](${messageLink})`, inline: true }
                        )
                        .setThumbnail(author.displayAvatarURL())
                        .setFooter({ 
                            text: `ID: ${message.id} | Cache: ${cacheFileName}`,
                            iconURL: guild.iconURL() 
                        })
                        .setTimestamp();

                    // Dla dużych plików dodaj informację o rozmiarze w tytule
                    if (attachment.size > 50 * 1024 * 1024) {
                        embed.setTitle(`📸 Repost Media (Duży plik: ${(attachment.size / 1024 / 1024).toFixed(1)} MB)`);
                    }

                    const repostedMessage = await targetChannel.send({
                        embeds: [embed],
                        files: [{ 
                            attachment: cachedFilePath, 
                            name: attachment.name,
                            description: `Repost od ${author.tag}`
                        }]
                    });

                    // Zapisz powiązanie dla trackowania usuniętych wiadomości
                    if (this.config.deletedMessageLogs?.trackMessageLinks && repostedMessage) {
                        this.messageLinks.set(message.id, {
                            originalChannelId: channel.id,
                            originalAuthorId: author.id,
                            originalAuthorTag: author.tag,
                            repostedMessageId: repostedMessage.id,
                            repostedChannelId: targetChannel.id,
                            timestamp: Date.now(),
                            hasMedia: true
                        });
                    }
                    
                    if (this.config.media.autoCleanup) {
                        await fs.unlink(cachedFilePath);
                        cachedFilePath = null;
                    }

                } catch (error) {
                    const errorMessage = error?.message || 'Nieznany błąd';
                    logger.error(formatMessage(this.config.messages.downloadError, {
                        fileName: attachment.name,
                        error: errorMessage
                    }));
                    
                    if (cachedFilePath) {
                        try {
                            await fs.unlink(cachedFilePath);
                        } catch {}
                    }
                }
            }

        } catch (error) {
            const errorMessage = error?.message || 'Nieznany błąd';
            logger.error(`Błąd w repostMedia: ${errorMessage}`);
        }
    }

    /**
     * Czyści wszystkie pliki cache przy zamykaniu
     */
    async cleanupAllCache() {
        try {
            const files = await fs.readdir(this.cacheDir);
            for (const file of files) {
                await fs.unlink(path.join(this.cacheDir, file));
            }
            await fs.rmdir(this.cacheDir);
            logger.info('Wyczyszczono wszystkie pliki cache');
        } catch (error) {
            const errorMessage = error?.message || 'Nieznany błąd';
            logger.error(`Błąd czyszczenia cache: ${errorMessage}`);
        }
    }

    /**
     * Obsługuje usunięte wiadomości
     * @param {Message} deletedMessage - Usunięta wiadomość
     * @param {Client} client - Klient Discord
     */
    async handleDeletedMessage(deletedMessage, client) {
        if (!this.config.deletedMessageLogs?.enabled) {
            return;
        }
        
        // Ignoruj wiadomości zaczynające się od ! (komendy)
        if (deletedMessage.content && deletedMessage.content.trim().startsWith('!')) {
            return;
        }
        
        const logChannel = client.channels.cache.get(this.config.deletedMessageLogs.logChannelId);
        if (!logChannel) {
            return;
        }

        // Sprawdź audit logs aby znaleźć kto usunął wiadomość
        let deletedBy = null;
        try {
            const auditLogs = await deletedMessage.guild.fetchAuditLogs({
                type: 72, // MESSAGE_DELETE
                limit: 10
            });
            
            // Weź najświeższy audit log MESSAGE_DELETE (max 30 sekund)
            for (const auditEntry of auditLogs.entries.values()) {
                const timeDiff = Date.now() - auditEntry.createdTimestamp;
                if (timeDiff < 30000) { // Max 30 sekund
                    deletedBy = auditEntry.executor;
                    
                    // Jeśli executor to autor wiadomości, to samoukasowanie - ignoruj
                    if (deletedBy?.id === deletedMessage.author?.id) {
                        deletedBy = null;
                    }
                    break;
                }
            }
            
            // Teraz nie ignorujemy automatycznie - pokazujemy wszystko oprócz komend !
            
        } catch (error) {
            logger.warn(`Błąd sprawdzania audit logs: ${error.message}`);
        }

        const linkData = this.messageLinks.get(deletedMessage.id);
        
        const embed = new EmbedBuilder()
            .setTitle('🗑️ Usunięta wiadomość')
            .setColor(0xFF0000) // Czerwony
            .addFields(
                { name: '👤 Autor', value: `${deletedMessage.member?.displayName || deletedMessage.author?.username || 'Nieznany'} (${deletedMessage.author?.tag || 'Nieznany'})`, inline: true },
                { name: '📺 Kanał', value: `<#${deletedMessage.channel.id}>`, inline: true },
                { name: '📅 Usunięto', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
            )
            .setTimestamp();

        // Dodaj awatar autora wiadomości
        if (deletedMessage.author?.displayAvatarURL) {
            embed.setThumbnail(deletedMessage.author.displayAvatarURL({ dynamic: true, size: 128 }));
        }

        // Dodaj informację o tym kto usunął (jeśli znamy)
        if (deletedBy) {
            // Pobierz member żeby uzyskać nick na serwerze
            let deleterDisplayName = deletedBy.username;
            try {
                const deleterMember = await deletedMessage.guild.members.fetch(deletedBy.id);
                deleterDisplayName = deleterMember.displayName;
            } catch (error) {
                // Użyj username jeśli nie można pobrać member
            }
            
            embed.addFields({ 
                name: '🚮 Usunięta przez', 
                value: `${deleterDisplayName} (${deletedBy.tag})`, 
                inline: true 
            });
        }

        // Dodaj treść wiadomości jeśli istnieje
        if (deletedMessage.content) {
            embed.addFields({ 
                name: '💬 Treść', 
                value: deletedMessage.content.length > 1024 ? 
                    deletedMessage.content.substring(0, 1021) + '...' : 
                    deletedMessage.content, 
                inline: false 
            });
        }

        // Jeśli mamy powiązanie z repostowanym media
        if (linkData && linkData.hasMedia) {
            try {
                const repostedChannel = client.channels.cache.get(linkData.repostedChannelId);
                const repostedMessage = await repostedChannel?.messages.fetch(linkData.repostedMessageId);
                
                if (repostedMessage) {
                    // Zachowaj czerwony kolor dla usuniętych plików
                    embed.setColor(0xFF0000); // Czerwony dla usuniętych mediów
                    
                    embed.addFields({ 
                        name: '📸 Backup mediów', 
                        value: `[Zobacz repostowane media](${repostedMessage.url})`, 
                        inline: false 
                    });
                    
                    // Repostuj pliki z oryginalnego repostu na kanał logów
                    const filesToRepost = [];
                    for (const attachment of repostedMessage.attachments.values()) {
                        filesToRepost.push({
                            attachment: attachment.url,
                            name: attachment.name
                        });
                    }
                    
                    // Wyślij embed z plikami na kanał logów
                    if (filesToRepost.length > 0) {
                        await logChannel.send({
                            embeds: [embed],
                            files: filesToRepost
                        });
                        
                        // Oznacz repost jako usunięty
                        const updatedEmbed = EmbedBuilder.from(repostedMessage.embeds[0])
                            .setTitle('🗑️ [USUNIĘTE] Repost Media')
                            .setColor(0xFF0000);
                        
                        await repostedMessage.edit({ embeds: [updatedEmbed] });
                        
                        // Nie wysyłaj standardowego embeda - już wysłany z plikami
                        if (linkData) {
                            this.messageLinks.delete(deletedMessage.id);
                        }
                        return;
                    }
                }
            } catch (error) {
                logger.error(`Błąd podczas repostowania plików: ${error.message}`);
            }
        }

        // Dodaj załączniki jeśli były
        if (deletedMessage.attachments?.size > 0) {
            const attachmentList = deletedMessage.attachments.map(att => 
                `• ${att.name} (${(att.size / 1024 / 1024).toFixed(2)} MB)`
            ).join('\n');
            
            embed.addFields({ 
                name: '📎 Załączniki', 
                value: attachmentList.length > 1024 ? 
                    attachmentList.substring(0, 1021) + '...' : 
                    attachmentList, 
                inline: false 
            });
        }

        await logChannel.send({ embeds: [embed] });
        
        // Usuń powiązanie po przetworzeniu
        if (linkData) {
            this.messageLinks.delete(deletedMessage.id);
        }
    }

    /**
     * Obsługuje edytowane wiadomości
     * @param {Message} oldMessage - Stara wiadomość
     * @param {Message} newMessage - Nowa wiadomość
     * @param {Client} client - Klient Discord
     */
    async handleEditedMessage(oldMessage, newMessage, client) {
        if (!this.config.deletedMessageLogs?.enabled) return;
        if (newMessage.author?.bot) return;
        if (oldMessage.content === newMessage.content) return; // Tylko zmiany treści

        const logChannel = client.channels.cache.get(this.config.deletedMessageLogs.logChannelId);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setTitle('✏️ Edytowana wiadomość')
            .setColor(0xFF6600) // Pomarańczowy
            .addFields(
                { name: '👤 Autor', value: `${newMessage.member?.displayName || newMessage.author?.username || 'Nieznany'} (${newMessage.author.tag})`, inline: true },
                { name: '📺 Kanał', value: `<#${newMessage.channel.id}>`, inline: true },
                { name: '📅 Edytowano', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
                { name: '🔗 Link', value: `[Przejdź do wiadomości](${newMessage.url})`, inline: false }
            )
            .setTimestamp();

        // Dodaj awatar autora wiadomości
        if (newMessage.author?.displayAvatarURL) {
            embed.setThumbnail(newMessage.author.displayAvatarURL({ dynamic: true, size: 128 }));
        }

        // Dodaj treść przed i po edycji
        if (oldMessage.content) {
            embed.addFields({ 
                name: '📝 Przed', 
                value: oldMessage.content.length > 1024 ? 
                    oldMessage.content.substring(0, 1021) + '...' : 
                    oldMessage.content, 
                inline: false 
            });
        }

        if (newMessage.content) {
            embed.addFields({ 
                name: '✨ Po', 
                value: newMessage.content.length > 1024 ? 
                    newMessage.content.substring(0, 1021) + '...' : 
                    newMessage.content, 
                inline: false 
            });
        }

        await logChannel.send({ embeds: [embed] });
    }

    /**
     * Czyści stare powiązania wiadomości
     */
    cleanupOldMessageLinks() {
        if (!this.config.deletedMessageLogs?.linkRetentionDays) return;
        
        const cutoff = Date.now() - (this.config.deletedMessageLogs.linkRetentionDays * 24 * 60 * 60 * 1000);
        let cleaned = 0;
        
        for (const [messageId, data] of this.messageLinks) {
            if (data.timestamp < cutoff) {
                this.messageLinks.delete(messageId);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            logger.info(`Wyczyszczono ${cleaned} starych powiązań wiadomości`);
        }
    }
}

module.exports = MediaService;