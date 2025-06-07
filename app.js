import dotenv from 'dotenv';
dotenv.config();

import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch';
import https from 'https';
const agent = new https.Agent({ family: 4 }); // только IPv4

const { TELEGRAM_TOKEN, RAPIDAPI_KEY, MONGO_URI, FLYER_API_KEY } = process.env;
if (!TELEGRAM_TOKEN || !RAPIDAPI_KEY || !MONGO_URI || !FLYER_API_KEY) {
    console.error('❌ Проверьте, что все переменные окружения заданы');
    process.exit(1);
}

mongoose
    .connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB подключена'))
    .catch((err) => console.error('❌ Ошибка MongoDB:', err));

const User = mongoose.model(
    'User',
    new mongoose.Schema({
        userId: { type: Number, required: true, unique: true },
        chatId: { type: Number, required: true },
    })
);

// Инициализация бота - Убедитесь, что это происходит до bot.on(...)
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const MINI_APP_LINK = 'https://t.me/FlyWebTasksBot/app?startapp=3HkVHT';

async function downloadMedia(url, filename) {
    const resp = await axios.get(url, {
        responseType: 'stream',
        timeout: 60000,
        httpsAgent: agent,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'ru,en;q=0.9',
            // 'Cookie': '...' // если нужно, можно скопировать cookie из браузера
        }
    });

    // Проверка типа контента
    const contentType = resp.headers['content-type'];
    if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) {
        throw new Error('Недопустимый Content-Type: ' + contentType);
    }

    const file = path.join(os.tmpdir(), filename);
    const w = fs.createWriteStream(file);
    resp.data.pipe(w);
    return new Promise((res, rej) => {
        w.on('finish', () => res(file));
        w.on('error', rej);
    });
}

// --- /start — проверка только через Flyer ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
        const { data } = await axios.post(
            'https://api.flyerservice.io/get_completed_tasks',
            { key: FLYER_API_KEY, user_id: userId },
            { headers: { 'Content-Type': 'application/json' } }
        );

        if (data.error || !data.result) {
            return bot.sendMessage(
                chatId,
                `📋 Чтобы использовать бота, сначала выполните задания:\n${MINI_APP_LINK}\n\nЗатем нажмите /start.`
            );
        }

        const completed = (data.result.completed_tasks || []).length;
        const total = data.result.count_all_tasks || 0;

        if (total === 0) {
            return bot.sendMessage(
                chatId,
                `📋 Чтобы использовать бота, сначала перейдите в мини-апп:\n${MINI_APP_LINK}\n\nПосле выполнения заданий нажмите /start.`
            );
        }

        if (completed < total) {
            return bot.sendMessage(
                chatId,
                `🕒 Выполнено: ${completed} из ${total} заданий.\nЗавершите остальные здесь:\n${MINI_APP_LINK}`
            );
        }

        if (!(await User.findOne({ userId }))) {
            await new User({ userId, chatId }).save();
        }

        return bot.sendMessage(
            chatId,
            '✅ Все задания выполнены! Теперь отправьте ссылку на медиа.'
        );
    } catch (err) {
        console.error('Flyer API error:', err.response?.data || err.message);
        return bot.sendMessage(
            chatId,
            `⚠️ Не удалось проверить задания. Попробуйте позже или пройдите по ссылке:\n${MINI_APP_LINK}`
        );
    }
});

// --- Обработка ссылок на медиа (с использованием Social Download All-in-One API) ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text?.trim();

    // Игнорируем команды и пустые сообщения
    if (!text || text.startsWith('/')) return;

    try {
        // Проверка доступа пользователя
        const user = await User.findOne({ userId });
        if (!user) {
            await bot.sendMessage(
                chatId,
                `🔒 У вас нет доступа. Сначала выполните задания:\n${MINI_APP_LINK}\n\nЗатем нажмите /start.`
            );
            await SendPostToChat(chatId);
            return;
        }

        // Проверка формата ссылки
        if (!/^https?:\/\//i.test(text)) {
            await bot.sendMessage(
                chatId,
                '📎 Пожалуйста, отправьте корректную ссылку.'
            );
            await SendPostToChat(chatId);
            return;
        }

        // --- Запрос к Social Download All-in-One API ---
        const apiUrl =
            'https://social-download-all-in-one.p.rapidapi.com/v1/social/autolink';
        const options = {
            method: 'POST',
            headers: {
                'x-rapidapi-key': RAPIDAPI_KEY,
                'x-rapidapi-host': 'social-download-all-in-one.p.rapidapi.com',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url: text }),
        };

        await bot.sendMessage(chatId, '⏳ Загружаю медиа...');

        const res = await fetch(apiUrl, options);
        const result = await res.json();

        console.log('API result:', result);
        const postText = result.text || result.title || '';
        console.log('postText:', postText, 'length:', postText.length);

        if (
            result.error ||
            !Array.isArray(result.medias) ||
            result.medias.length === 0
        ) {
            await bot.sendMessage(
                chatId,
                '❌ Не удалось получить медиа из API.'
            );
            console.error('API Error or no medias found:', result);
            await SendPostToChat(chatId);
            return;
        }

        // --- Скачиваем и фильтруем медиа ---
        const mediaFiles = [];
        for (let i = 0; i < result.medias.length; i++) {
            const mediaItem = result.medias[i];
            if (!mediaItem.url || !mediaItem.type) continue;

            const telegramMediaType = mediaItem.type === 'video' ? 'video' : 'photo';
            const urlObj = new URL(mediaItem.url);
            const fileExtension = path.extname(urlObj.pathname).toLowerCase() || (mediaItem.type === 'video' ? '.mp4' : '.jpg');
            const fn = `media_${Date.now()}_${i}${fileExtension}`;

            let filePath;
            let contentType;
            try {
                const resp = await axios.get(mediaItem.url, {
                    responseType: 'stream',
                    timeout: 60000,
                    httpsAgent: agent,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'ru,en;q=0.9',
                    }
                });
                contentType = resp.headers['content-type'];
                filePath = path.join(os.tmpdir(), fn);
                const w = fs.createWriteStream(filePath);
                resp.data.pipe(w);
                await new Promise((res, rej) => {
                    w.on('finish', res);
                    w.on('error', rej);
                });
            } catch (e) {
                console.warn('Ошибка скачивания:', e.message);
                continue;
            }

            // Проверка типа
            if (telegramMediaType === 'photo' && !contentType.startsWith('image/')) continue;
            if (telegramMediaType === 'video' && !contentType.startsWith('video/')) continue;

            // Проверка размера
            const stats = fs.statSync(filePath);
            if (stats.size < 1000) continue;

            mediaFiles.push({
                type: telegramMediaType,
                media: fs.createReadStream(filePath),
            });
        }

        // --- Отправляем медиа группами по 10 ---
        for (let i = 0; i < mediaFiles.length; i += 10) {
            const group = mediaFiles.slice(i, i + 10);

            // Добавляем подпись к последнему элементу группы
            if (group.length > 0) {
                const lastIndex = group.length - 1;
                group[lastIndex] = {
                    ...group[lastIndex],
                    caption: 'Скачано при помощи @DownloadVideoBot',
                };
            }

            await bot.sendMediaGroup(chatId, group);
        }

        // --- После всех медиа отправляем текст поста, если он есть ---
        if (postText.length > 4096) {
            try {
                console.log('Отправляю текст поста (4096):', postText.slice(0, 4096));
                await bot.sendMessage(chatId, postText.slice(0, 4096));
            } catch (e) {
                console.error('Ошибка при отправке текста поста (4096):', e);
            }
        } else if (postText) {
            try {
                console.log('Отправляю текст поста:', postText);
                await bot.sendMessage(chatId, postText);
            } catch (e) {
                console.error('Ошибка при отправке текста поста:', e);
            }
        }
    } catch (err) {
        console.error('Ошибка при запросе или обработке медиа:', err);
        await bot.sendMessage(chatId, '❌ Ошибка при загрузке медиа.');
    } finally {
        await SendPostToChat(chatId);
    }
});

bot.on('polling_error', console.error);

// --- Рекламная вставка ---
async function SendPostToChat(chatId) {
    // ВНИМАНИЕ: Этот токен может быть устаревшим или недействительным.
    // Используйте свой актуальный токен для GramAds.
    const token =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyNzYzNyIsImp0aSI6ImQ2MDA3M2YwLTgxMTctNDc4Yy1hNjQ2LWEyNDQ4YjEyNWZkNiIsIm5hbWUiOiJEb3dubG9hZFVpZGVvQm90IiwiYm90aWQiOiIxNDgxNCIsImh0dHA6Ly9zY2hlbWFzLnhtbHNvYXAub3JnL3dzLzIwMDUvMDUvaWRlbnRpdHkvY2xhaW1zL25hbWVpZGVudGlmaWVyIjoiMjc2MzciLCJuYmYiOjE3NDkyMzQxMzAsImV4cCI6MTc0OTQ0MjkzMCwiaXNzIjoiU3R1Z25vdiIsImF1ZCI6IlVzZXJzIn0.MIVMoDtUIRSuIrpv9b9vqUOXoqwkioDtP0DnNnlo9m0';

    try {
        const res = await fetch('https://api.gramads.net/ad/SendPost', {
            method: 'POST',
            headers: {
                Authorization: `bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ SendToChatId: chatId }),
        });

        if (!res.ok) {
            console.warn(`⚠️ Реклама не отправлена: ${res.statusText}`);
            return;
        }

        const result = await res.text();
        console.log(`📢 Реклама отправлена в чат ${chatId}`);
    } catch (err) {
        console.warn('❌ Ошибка при отправке рекламы:', err.message);
    }
}
