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

// Умная ссылка на мини-апп
const MINI_APP_LINK = 'https://t.me/FlyWebTasksBot/app?startapp=3HkVHT';

// Загрузчик медиа (остался без изменений)
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

// --- /start: проверяем get_completed_tasks ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
        // Запрос списка выполненных заданий
        const { data } = await axios.post(
            'https://api.flyerservice.io/get_completed_tasks',
            { key: FLYER_API_KEY, user_id: userId },
            { headers: { 'Content-Type': 'application/json' } }
        );

        // Если API вернул ошибку/врапнинг
        if (data.error) {
            console.warn('Flyer get_completed_tasks error:', data.error);
            return bot.sendMessage(
                chatId,
                `❌ Ошибка при проверке заданий: ${data.error}`
            );
        }

        const completedCount = (data.result.completed_tasks || []).length;
        const totalCount = data.result.count_all_tasks || 0;

        // Если всё выполнено — сохраняем и открываем доступ
        if (totalCount > 0 && completedCount === totalCount) {
            if (!(await User.findOne({ userId }))) {
                await new User({ userId, chatId }).save();
            }
            return bot.sendMessage(
                chatId,
                '✅ Вы прошли задания! Теперь отправьте ссылку для загрузки медиа.'
            );
        }

        // Иначе — заново шлём ссылку на мини-апп
        return bot.sendMessage(
            chatId,
            `📋 Чтобы получить доступ, сначала выполните задания в мини-апп:\n${MINI_APP_LINK}\n\n` +
                `После завершения — снова нажмите /start.`
        );
    } catch (err) {
        console.error(
            'Ошибка get_completed_tasks:',
            err.response?.data || err.message
        );
        bot.sendMessage(
            chatId,
            '❌ Не удалось проверить выполнение заданий. Попробуйте позже.'
        );
    }
});

// --- Обработка любого другого сообщения: загрузка медиа ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text?.trim();

    // игнорируем команды и пустые
    if (!text || text.startsWith('/')) return;

    // проверяем, прошёл ли пользователь через задания
    if (!(await User.findOne({ userId }))) {
        return bot.sendMessage(
            chatId,
            `🔒 У вас нет доступа — сначала выполните задания:\n${MINI_APP_LINK}\n\n` +
                `Затем нажмите /start.`
        );
    }

    // проверяем формат ссылки
    if (!/^https?:\/\//i.test(text)) {
        return bot.sendMessage(
            chatId,
            '📎 Пожалуйста, отправьте корректную ссылку.'
        );
    }

    // делаем запрос к скачивателю
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
        console.error('Ошибка при скачивании медиа:', err);
        bot.sendMessage(chatId, '❌ Ошибка при загрузке медиа.');
    }
});

bot.on('polling_error', console.error);
