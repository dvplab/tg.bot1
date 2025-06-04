import dotenv from 'dotenv';
dotenv.config();

import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const MONGO_URI = process.env.MONGO_URI;
const FLYER_API_KEY = process.env.FLYER_API_KEY;

if (!TELEGRAM_TOKEN || !RAPIDAPI_KEY || !MONGO_URI || !FLYER_API_KEY) {
    console.error('❌ Проверьте, что все переменные окружения заданы');
    process.exit(1);
}

mongoose
    .connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB подключена'))
    .catch((err) => console.error('❌ Ошибка подключения к MongoDB:', err));

const saveBotSchema = new mongoose.Schema({
    userId: { type: Number, required: true, unique: true },
    chatId: { type: Number, required: true },
});
const SaveBot = mongoose.model('SaveBot', saveBotSchema);

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Проверка и отображение заданий
async function checkFlyerTasks(userId, chatId) {
    try {
        const taskResponse = await axios.post(
            'https://api.flyerservice.io/get_tasks',
            {
                key: FLYER_API_KEY,
                user_id: userId,
                language_code: 'ru',
                limit: 10,
            },
            { headers: { 'Content-Type': 'application/json' } }
        );

        const tasks = taskResponse.data.result || [];

        if (tasks.length === 0) return true;

        let allComplete = true;

        for (const task of tasks) {
            const checkResponse = await axios.post(
                'https://api.flyerservice.io/check_task',
                {
                    key: FLYER_API_KEY,
                    user_id: userId,
                    signature: task.signature,
                },
                { headers: { 'Content-Type': 'application/json' } }
            );

            const status = checkResponse.data.result;
            if (status !== 'complete' && status !== 'waiting') {
                allComplete = false;

                await bot.sendMessage(
                    chatId,
                    `📌 Задание: ${task.task}\n💰 Оплата: ${task.price}₽\n📎 ${
                        task.links[0] || 'Нет ссылки'
                    }`
                );
            }
        }

        return allComplete;
    } catch (error) {
        console.error('❌ Ошибка при проверке заданий Flyer:', error);
        return false;
    }
}

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    try {
        const passed = await checkFlyerTasks(userId, chatId);

        if (!passed) {
            return bot.sendMessage(
                chatId,
                '📋 Выполните все задания выше, чтобы использовать бота.'
            );
        }

        const existingUser = await SaveBot.findOne({ userId });
        if (!existingUser) {
            await new SaveBot({ userId, chatId }).save();
            console.log('👤 Новый пользователь сохранён');
        }

        await bot.sendMessage(
            chatId,
            '✅ Доступ разрешён. Отправьте ссылку для загрузки медиа.'
        );
    } catch (err) {
        console.error('❌ Ошибка /start:', err);
        await bot.sendMessage(chatId, 'Произошла ошибка при запуске.');
    }
});

async function downloadMedia(url, filename, retries = 3, timeoutMs = 45000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios({
                method: 'GET',
                url,
                responseType: 'stream',
                headers: {
                    accept: 'video/mp4,video/webm,video/*,*/*;q=0.9',
                    referer: 'https://www.instagram.com/',
                    'user-agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/114.0.0.0 Safari/537.36',
                },
                timeout: timeoutMs,
            });

            const filepath = path.join(os.tmpdir(), filename);
            const writer = fs.createWriteStream(filepath);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            return filepath;
        } catch (err) {
            if (attempt === retries) throw err;
            console.warn(`Попытка ${attempt} не удалась: ${err.message}`);
            await new Promise((r) => setTimeout(r, 2000));
        }
    }
}

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (msg.text?.startsWith('/')) return;

    const passed = await checkFlyerTasks(userId, chatId);
    if (!passed) {
        return bot.sendMessage(
            chatId,
            '📋 Сначала выполните все задания, чтобы использовать бота.'
        );
    }

    if (!msg.text || !msg.text.trim().startsWith('http')) {
        return bot.sendMessage(
            chatId,
            '📎 Пожалуйста, отправьте ссылку для загрузки медиа.'
        );
    }

    const url = msg.text.trim();

    try {
        const apiUrl =
            'https://social-download-all-in-one.p.rapidapi.com/v1/social/autolink';
        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'x-rapidapi-key': RAPIDAPI_KEY,
                'x-rapidapi-host': 'social-download-all-in-one.p.rapidapi.com',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url }),
        });

        if (!apiResponse.ok)
            throw new Error(`API вернул статус ${apiResponse.status}`);

        const result = await apiResponse.json();

        if (result.error)
            return bot.sendMessage(chatId, `Ошибка от API: ${result.error}`);
        if (!Array.isArray(result.medias) || result.medias.length === 0)
            return bot.sendMessage(
                chatId,
                'Медиа не найдено. Проверьте ссылку.'
            );

        if (result.title) await bot.sendMessage(chatId, result.title);

        const mediaChunks = [];
        for (let i = 0; i < result.medias.length; i += 10) {
            mediaChunks.push(result.medias.slice(i, i + 10));
        }

        for (const chunk of mediaChunks) {
            const mediaGroup = [];

            for (let i = 0; i < chunk.length; i++) {
                const media = chunk[i];
                const ext =
                    media.type === 'video'
                        ? 'mp4'
                        : media.type === 'audio'
                        ? 'mp3'
                        : 'jpg';
                const filename = `media_${Date.now()}_${i}.${ext}`;

                try {
                    const filepath = await downloadMedia(media.url, filename);
                    mediaGroup.push({
                        type: media.type === 'video' ? 'video' : 'photo',
                        media: fs.createReadStream(filepath),
                        caption:
                            i === chunk.length - 1
                                ? 'Скачано через @DownloadVideoAllBot'
                                : undefined,
                        filepath,
                    });
                } catch (err) {
                    console.error('❌ Ошибка при скачивании:', err);
                    await bot.sendMessage(
                        chatId,
                        `Не удалось скачать файл: ${media.url}`
                    );
                }
            }

            if (mediaGroup.length > 0) {
                await bot.sendMediaGroup(chatId, mediaGroup);
                for (const media of mediaGroup) {
                    if (media.filepath) fs.unlink(media.filepath, () => {});
                }
            }

            if (chunk !== mediaChunks[mediaChunks.length - 1]) {
                await new Promise((r) => setTimeout(r, 2000));
            }
        }
    } catch (error) {
        console.error('❌ Ошибка API:', error);
        await bot.sendMessage(chatId, 'Произошла ошибка при запросе к API.');
    }
});

bot.on('polling_error', (error) => console.error('Polling error:', error));
