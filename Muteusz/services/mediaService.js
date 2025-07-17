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
    }

    /**
     * Inicjalizuje serwis mediów
     */
    async initialize() {
        await this.ensureCacheDir();
        await this.cleanupCache();
        
        // Ustaw interwał czyszczenia cache co godzinę
        setInterval(() => this.cleanupCache(), 60 * 60 * 1000);
        
        logger.info('Serwis mediów został zainicjalizowany');
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
            logger.error(`Błąd podczas czyszczenia cache: ${error.message}`);
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

                    await targetChannel.send({
                        embeds: [embed],
                        files: [{ 
                            attachment: cachedFilePath, 
                            name: attachment.name,
                            description: `Repost od ${author.tag}`
                        }]
                    });
                    
                    if (this.config.media.autoCleanup) {
                        await fs.unlink(cachedFilePath);
                        cachedFilePath = null;
                    }

                } catch (error) {
                    logger.error(formatMessage(this.config.messages.downloadError, {
                        fileName: attachment.name,
                        error: error.message
                    }));
                    
                    if (cachedFilePath) {
                        try {
                            await fs.unlink(cachedFilePath);
                        } catch {}
                    }
                }
            }

        } catch (error) {
            logger.error(`Błąd w repostMedia: ${error.message}`);
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
            logger.error(`Błąd czyszczenia cache: ${error.message}`);
        }
    }
}

module.exports = MediaService;