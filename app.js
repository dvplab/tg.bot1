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
    console.error('❌ Проверь переменные окружения');
    process.exit(1);
}

mongoose.connect(MONGO_URI).then(() => console.log('✅ MongoDB подключена'));

const SaveBot = mongoose.model(
    'SaveBot',
    new mongoose.Schema({
        userId: { type: Number, required: true, unique: true },
        chatId: { type: Number, required: true },
    })
);

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const userTasks = new Map(); // Временное хранилище заданий

function createLinkButtons(links) {
    const buttons = [];
    for (let i = 0; i < links.length; i += 2) {
        const row = links.slice(i, i + 2).map((link) => ({
            text: '🔗 Перейти',
            url: link,
        }));
        buttons.push(row);
    }
    return buttons;
}

async function downloadMedia(url, filename) {
    const response = await axios.get(url, {
        responseType: 'stream',
        timeout: 30000,
        headers: {
            referer: 'https://www.instagram.com/',
            'user-agent': 'Mozilla/5.0',
        },
    });
    const filepath = path.join(os.tmpdir(), filename);
    const writer = fs.createWriteStream(filepath);
    response.data.pipe(writer);
    return new Promise((res, rej) => {
        writer.on('finish', () => res(filepath));
        writer.on('error', rej);
    });
}

// Старт — получаем задания
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!userId) return;

    try {
        const response = await axios.post(
            'https://api.flyerservice.io/get_tasks',
            {
                key: FLYER_API_KEY,
                user_id: userId,
                language_code: 'ru',
                limit: 10,
            }
        );
        console.log('get_tasks response:', response.data);

        const tasks = response.data.result;
        if (!tasks || tasks.length === 0) {
            return bot.sendMessage(chatId, '📭 Нет заданий для выполнения.');
        }

        userTasks.set(userId, tasks);
        for (const task of tasks) {
            const links = task.links || [];
            const keyboard = createLinkButtons(links);
            await bot.sendMessage(
                chatId,
                `📌 Задание: ${task.task}\n💰 Оплата: ${task.price}₽`,
                { reply_markup: { inline_keyboard: keyboard } }
            );
        }

        await bot.sendMessage(
            chatId,
            'Когда выполните все задания, нажмите "✅ Продолжить"',
            {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '✅ Продолжить',
                                callback_data: 'check_tasks',
                            },
                        ],
                    ],
                },
            }
        );
    } catch (err) {
        console.error(
            'Ошибка получения заданий:',
            err.response?.data || err.message
        );
        bot.sendMessage(chatId, '❌ Ошибка получения заданий.');
    }
});

// Обработка "✅ Продолжить"
bot.on('callback_query', async (query) => {
    const userId = query.from.id;
    const chatId = query.message?.chat.id;
    if (!chatId || !userTasks.has(userId)) return;

    if (query.data === 'check_tasks') {
        const tasks = userTasks.get(userId);
        let completed = 0;

        for (const task of tasks) {
            try {
                const check = await axios.post(
                    'https://api.flyerservice.io/check_task',
                    {
                        key: FLYER_API_KEY,
                        user_id: userId,
                        signature: task.signature,
                    }
                );
                if (['complete', 'waiting'].includes(check.data.result)) {
                    completed++;
                }
            } catch (err) {
                console.error(
                    'Ошибка проверки задания:',
                    err.response?.data || err.message
                );
            }
        }

        if (completed === tasks.length) {
            if (!(await SaveBot.findOne({ userId }))) {
                await new SaveBot({ userId, chatId }).save();
            }
            await bot.sendMessage(
                chatId,
                '✅ Доступ открыт. Отправьте ссылку для загрузки медиа.'
            );
        } else {
            await bot.sendMessage(
                chatId,
                `🕒 Выполнено: ${completed} из ${tasks.length} заданий.\nПожалуйста, завершите все задания и нажмите "Продолжить" снова.`
            );
        }
    }
});

// Обработка ссылок на медиа
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = msg.text?.trim();
    if (!text || text.startsWith('/')) return;

    const user = await SaveBot.findOne({ userId });
    if (!user) {
        return bot.sendMessage(
            chatId,
            '🔒 Сначала выполните задания и нажмите /start.'
        );
    }
    if (!/^https?:\/\//i.test(text)) {
        return bot.sendMessage(
            chatId,
            '📎 Пожалуйста, отправьте ссылку для загрузки.'
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

        if (!Array.isArray(result.medias) || !result.medias.length) {
            return bot.sendMessage(chatId, '❌ Медиа не найдено.');
        }

        const mediaGroup = [];
        for (let i = 0; i < result.medias.length && i < 10; i++) {
            const media = result.medias[i];
            const ext = media.type === 'video' ? 'mp4' : 'jpg';
            const filename = `media_${Date.now()}_${i}.${ext}`;
            const filePath = await downloadMedia(media.url, filename);

            mediaGroup.push({
                type: media.type === 'video' ? 'video' : 'photo',
                media: fs.createReadStream(filePath),
                caption: i === 0 ? '📥 Скачано через бота' : undefined,
            });
        }

        await bot.sendMediaGroup(chatId, mediaGroup);
    } catch (err) {
        console.error('Ошибка загрузки медиа:', err);
        bot.sendMessage(chatId, '❌ Ошибка при загрузке медиа.');
    }
});

bot.on('polling_error', console.error);
