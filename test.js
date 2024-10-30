const TelegramBot = require('node-telegram-bot-api');
const https = require('https');
const fs = require('fs');
const url = require('url');

// Замените на ваш токен
const token = '7927813451:AAGxQbdLC9PRahY9EzNSJpYA10ywd6JD2cI';
const bot = new TelegramBot(token, { polling: true });

// Функция для получения короткого кода из URL
function extractShortcode(instaUrl) {
    const parsedUrl = new URL(instaUrl);
    return parsedUrl.pathname.split('/')[2];
}

// Функция для скачивания видео по короткому коду
function downloadVideo(shortcode, chatId) {
    const options = {
        method: 'GET',
        hostname: 'instagram-bulk-scraper-latest.p.rapidapi.com',
        port: null,
        path: `/media_download_by_shortcode/${shortcode}`,
        headers: {
            'x-rapidapi-key':
                'acfd6b6cf4mshf0d04ae3dde86a6p1855e8jsn6a715c2c667d',
            'x-rapidapi-host': 'instagram-bulk-scraper-latest.p.rapidapi.com',
        },
    };

    const req = https.request(options, (res) => {
        let chunks = [];

        res.on('data', (chunk) => {
            chunks.push(chunk);
        });

        res.on('end', () => {
            const body = Buffer.concat(chunks);
            const data = JSON.parse(body.toString());
            const videoUrl = data.data.main_media_hd;

            // Скачивание видео
            const videoReq = https.get(videoUrl, (videoRes) => {
                const filePath = `video_${shortcode}.mp4`;
                const writeStream = fs.createWriteStream(filePath);

                videoRes.pipe(writeStream);

                writeStream.on('finish', () => {
                    writeStream.close();
                    bot.sendVideo(chatId, filePath)
                        .then(() => {
                            fs.unlinkSync(filePath); // Удалить файл после отправки
                        })
                        .catch((error) => {
                            console.error('Ошибка отправки видео:', error);
                        });
                });
            });

            videoReq.on('error', (error) => {
                console.error('Ошибка скачивания видео:', error);
                bot.sendMessage(chatId, 'Ошибка при скачивании видео.');
            });
        });
    });

    req.on('error', (error) => {
        console.error('Ошибка при запросе:', error);
        bot.sendMessage(chatId, 'Ошибка при запросе к API.');
    });

    req.end();
}

// Слушаем сообщения
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(
        chatId,
        'Привет! Отправьте ссылку на Instagram Reels, чтобы скачать видео.'
    );
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;

    if (msg.text && msg.text.startsWith('https://www.instagram.com/reel/')) {
        const shortcode = extractShortcode(msg.text);
        downloadVideo(shortcode, chatId);
    } else {
        bot.sendMessage(
            chatId,
            'Пожалуйста, отправьте корректную ссылку на Instagram Reels.'
        );
    }
});
