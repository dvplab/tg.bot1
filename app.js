import dotenv from 'dotenv';
dotenv.config();

import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch'; // <-- обязательно

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

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const MINI_APP_LINK = 'https://t.me/FlyWebTasksBot/app?startapp=3HkVHT';

async function downloadMedia(url, filename) {
    const resp = await axios.get(url, {
        responseType: 'stream',
        timeout: 30000,
    });
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

// --- Обработка ссылок на медиа ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text?.trim();

    if (!text || text.startsWith('/')) return;

    try {
        const user = await User.findOne({ userId });
        if (!user) {
            await bot.sendMessage(
                chatId,
                `🔒 У вас нет доступа. Сначала выполните задания:\n${MINI_APP_LINK}\n\nЗатем нажмите /start.`
            );
            await SendPostToChat(chatId);
            return;
        }

        if (!/^https?:\/\//i.test(text)) {
            await bot.sendMessage(
                chatId,
                '📎 Пожалуйста, отправьте корректную ссылку.'
            );
            await SendPostToChat(chatId);
            return;
        }

        const res = await fetch(
            'https://social-download-all-in-one.p.rapidapi.com/v1/social/autolink',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-rapidapi-key': RAPIDAPI_KEY,
                    'x-rapidapi-host':
                        'social-download-all-in-one.p.rapidapi.com',
                },
                body: JSON.stringify({ url: text }),
            }
        );

        const result = await res.json();

        if (!Array.isArray(result.medias) || result.medias.length === 0) {
            await bot.sendMessage(chatId, '❌ Медиа не найдено.');
            await SendPostToChat(chatId);
            return;
        }

        const mediaGroup = [];

        for (let i = 0; i < result.medias.length && i < 10; i++) {
            const m = result.medias[i];
            const ext = m.type === 'video' ? 'mp4' : 'jpg';
            const fn = `media_${Date.now()}_${i}.${ext}`;
            const filePath = await downloadMedia(m.url, fn);

            mediaGroup.push({
                type: m.type === 'video' ? 'video' : 'photo',
                media: fs.createReadStream(filePath),
            });
        }

        await bot.sendMediaGroup(chatId, mediaGroup);
    } catch (err) {
        console.error('Ошибка загрузки медиа:', err);
        await bot.sendMessage(chatId, '❌ Ошибка при загрузке медиа.');
    } finally {
        await SendPostToChat(chatId); // ✅ Показываем рекламу в любом случае
    }
});

bot.on('polling_error', console.error);

// --- Рекламная вставка ---
async function SendPostToChat(chatId) {
    const token =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyNzYzNyIsImp0aSI6ImQ2MDA3M2YwLTgxMTctNDc4Yy1hNjQ2LWEyNDQ4YjEyNWZkNiIsIm5hbWUiOiJEb3dubG9hZFZpZGVvQm90IiwiYm90aWQiOiIxNDgxNCIsImh0dHA6Ly9zY2hlbWFzLnhtbHNvYXAub3JnL3dzLzIwMDUvMDUvaWRlbnRpdHkvY2xhaW1zL25hbWVpZGVudGlmaWVyIjoiMjc2MzciLCJuYmYiOjE3NDkyMzQxMzAsImV4cCI6MTc0OTQ0MjkzMCwiaXNzIjoiU3R1Z25vdiIsImF1ZCI6IlVzZXJzIn0.MIVMoDtUIRSuIrpv9b9vqUOXoqwkioDtP0DnNnlo9m0';

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
