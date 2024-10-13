// bilibili_video_download_v3.js

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const readline = require('readline');

// Function to format size from bytes to KB, MB, or GB
function formatSize(bytes) {
    let kb = bytes / 1024;
    if (kb >= 1024) {
        let mb = kb / 1024;
        return mb >= 1024 ? `${(mb / 1024).toFixed(3)}G` : `${mb.toFixed(3)}M`;
    } else {
        return `${kb.toFixed(3)}K`;
    }
}

// Function to create a directory if it does not exist
function createDirectory(dir) {
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir, { recursive: true });
    }
}

// Function to get video playlist
async function getPlayList(aid, cid, quality) {
    const urlApi = `https://api.bilibili.com/x/player/playurl?cid=${cid}&avid=${aid}&qn=${quality}`;
    console.log(`[获取视频清晰度${quality}的播放列表] : ${urlApi}`);
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/55.0.2883.87 Safari/537.36',
    };
    const response = await axios.get(urlApi, { headers });
    return response.data.data.durl.map(item => item.url);
}

// Function to download video
async function downVideo(videoList, title, startUrl, page) {
    // Create video path
    const currentVideoPath = path.join(__dirname, 'bilibili_video', title);
    createDirectory(currentVideoPath);
    
    const startTime = Date.now(); // Start time for speed calculation

    for (let [num, url] of videoList.entries()) {
        //console.log(`Downloading from: ${url}`);
        const filePath = path.join(currentVideoPath, `${title}-${num + 1}.flv`);

        try {
            const response = await axios.get(url, {
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/55.0.2883.87 Safari/537.36',
                    'Accept': '*/*',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Referer': startUrl, // Important for Bilibili
                    'Origin': 'https://www.bilibili.com', // Necessary for CORS
                    'Connection': 'keep-alive',
                    // Add your cookie here if needed
                    // 'Cookie': 'YOUR_COOKIE_HERE',
                }
            });

            const totalSize = parseInt(response.headers['content-length'], 10);
            const writeStream = fs.createWriteStream(filePath);
            response.data.pipe(writeStream);

            let downloaded = 0;

            // Monitor download progress
            response.data.on('data', (chunk) => {
                downloaded += chunk.length;
                const percent = (downloaded / totalSize) * 100;
                const speed = formatSize(downloaded / ((Date.now() - startTime) / 1000));
                const progressBar = '#'.repeat(Math.round(percent / 2)).padEnd(50, '-');

                process.stdout.write(`\r${percent.toFixed(2)}% [${progressBar}] Speed: ${speed}`);
            });

            await new Promise((resolve, reject) => {
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
            });

            console.log(`Finished downloading: ${filePath}`);
        } catch (error) {
            console.error(`Download failed for ${url}: ${error.message}`);
        }
    }
}

// Function to combine videos
async function combineVideos(titleList) {
    const videoPath = path.join(__dirname, 'bilibili_video');

    for (let title of titleList) {
        const currentVideoPath = path.join(videoPath, title);
        const videoFiles = fs.readdirSync(currentVideoPath).filter(file => file.endsWith('.flv'));

        if (videoFiles.length >= 2) {
            console.log(`[下载完成,正在合并视频...] : ${title}`);
            const inputFiles = videoFiles.map(file => path.join(currentVideoPath, file)).join(' ');
            const outputFilePath = path.join(currentVideoPath, `${title}.mp4`);
            child_process.execSync(`ffmpeg -i "concat:${inputFiles}" -c copy ${outputFilePath}`);
            console.log(`[视频合并完成] : ${title}`);
        } else {
            console.log(`[视频合并完成] : ${title}`);
        }
    }
}

// Function to read user input
function readInput(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

// Main function
(async () => {
    const startTime = Date.now();
    console.log('*'.repeat(30) + 'B站视频下载小助手' + '*'.repeat(30));
    
    const start = await readInput('请输入您要下载的B站av号或者视频链接地址: ');
    let startUrl;

    if (!isNaN(start)) {
        startUrl = `https://api.bilibili.com/x/web-interface/view?aid=${start}`;
    } else if (start.includes('/BV')) {
        const bvid = start.match(/BV(\S+)/)?.[1];
        startUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
        console.log(`您输入的链接为视频链接地址, 将自动获取视频BV号: ${bvid}`);
    } else {
        const aid = start.match(/\/av(\d+)/)?.[1];
        startUrl = `https://api.bilibili.com/x/web-interface/view?aid=${aid}`;
        console.log(`您输入的链接为视频链接地址, 将自动获取视频av号: ${aid}`);
    }

    const quality = await readInput('请输入您要下载视频的清晰度(1080p:80;720p:64;480p:32;360p:16)(填写80或64或32或16): ');

    try {
        const response = await axios.get(startUrl);
        //console.log(startUrl);
        const data = response.data.data;
        const cidList = data.pages;

        const threadPool = [];
        const titleList = [];

        for (let item of cidList) {
            const cid = item.cid.toString();
            const aid = data.aid.toString();
            const title = item.part.replace(/[\/\\:*?"<>|]/g, '');
            console.log(`[下载视频的cid]: ${cid}`);
            console.log(`[下载视频的标题]: ${title}`);
            titleList.push(title);

            const videoList = await getPlayList(aid, cid, quality);
            const page = item.page.toString();
            threadPool.push(downVideo(videoList, title, startUrl, page));
        }
        
        await Promise.all(threadPool);
        await combineVideos(titleList);

        const endTime = Date.now();
        console.log(`下载总耗时${((endTime - startTime) / 1000).toFixed(2)}秒, 约${(((endTime - startTime) / 1000) / 60).toFixed(2)}分钟`);

        if (process.platform === 'win32') {
            child_process.execSync(`start ${path.join(__dirname, 'bilibili_video')}`);
        }
    } catch (error) {
        console.error(`请求失败: ${error}`);
    }
})();
