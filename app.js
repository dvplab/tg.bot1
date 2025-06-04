import dotenv from 'dotenv';
dotenv.config();

import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import os from 'os';

// --- Конфиг ---
const { TELEGRAM_TOKEN, RAPIDAPI_KEY, MONGO_URI, FLYER_API_KEY } = process.env;
if (!TELEGRAM_TOKEN || !RAPIDAPI_KEY || !MONGO_URI || !FLYER_API_KEY) {
    console.error('❌ Проверьте, что все переменные окружения заданы');
    process.exit(1);
}

// --- MongoDB ---
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

// --- Телеграм-бот ---
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const MINI_APP_LINK = 'https://t.me/FlyWebTasksBot/app?startapp=3HkVHT';

// Загрузчик медиа
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

// --- /start: проверяем выполнение задач ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
        const { data } = await axios.post(
            'https://api.flyerservice.io/get_completed_tasks',
            { key: FLYER_API_KEY, user_id: userId },
            { headers: { 'Content-Type': 'application/json' } }
        );

        if (data.error) {
            console.warn('Flyer get_completed_tasks error:', data.error);
            // В случае любой ошибки API — всё равно даём ссылку на мини-апп
            return bot.sendMessage(
                chatId,
                `ℹ️ Не удалось получить статус заданий, попробуйте через мини-апп:\n${MINI_APP_LINK}\n\n` +
                    `После выполнения снова нажмите /start.`
            );
        }

        const completed = (data.result.completed_tasks || []).length;
        const total = data.result.count_all_tasks || 0;

        if (total === 0) {
            // Юзер ещё не получил задач — он не заходил в мини-апп
            return bot.sendMessage(
                chatId,
                `📋 Чтобы получить задания, перейдите по ссылке в мини-апп:\n${MINI_APP_LINK}\n\n` +
                    `После выполнения — нажмите /start.`
            );
        }

        if (completed === total) {
            // Все задачи выполнены
            if (!(await User.findOne({ userId }))) {
                await new User({ userId, chatId }).save();
            }
            return bot.sendMessage(
                chatId,
                '✅ Вы прошли все задания! Теперь просто отправьте ссылку для загрузки медиа.'
            );
        }

        // Есть задачи, но не все выполнены
        return bot.sendMessage(
            chatId,
            `🕒 Выполнено: ${completed} из ${total} заданий.\n` +
                `Завершите оставшиеся в мини-апп и снова нажмите /start:\n${MINI_APP_LINK}`
        );
    } catch (err) {
        console.error(
            'Ошибка get_completed_tasks:',
            err.response?.data || err.message
        );
        // Техническая ошибка — направляем в мини-апп
        return bot.sendMessage(
            chatId,
            `⚠️ В данный момент не могу проверить задания, попробуйте через мини-апп:\n${MINI_APP_LINK}\n\n` +
                `После выполнения — нажмите /start.`
        );
    }
});

// --- Обработка ссылок на медиа ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text?.trim();

    if (!text || text.startsWith('/')) return;

    // Проверяем, что пользователь прошёл все задания
    if (!(await User.findOne({ userId }))) {
        return bot.sendMessage(
            chatId,
            `🔒 У вас нет доступа. Сначала выполните задания:\n${MINI_APP_LINK}\n\n` +
                `Затем нажмите /start.`
        );
    }

    if (!/^https?:\/\//i.test(text)) {
        return bot.sendMessage(
            chatId,
            '📎 Пожалуйста, отправьте корректную ссылку.'
        );
    }

    try {
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
            return bot.sendMessage(chatId, '❌ Медиа не найдено.');
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
        bot.sendMessage(chatId, '❌ Ошибка при загрузке медиа.');
    }
});

bot.on('polling_error', console.error);
