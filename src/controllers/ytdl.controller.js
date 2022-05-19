const rimraf = require('rimraf');
const path = require('path');
const router = require('express').Router();
const ytdl = require('ytdl-core');
const cp = require('child_process');
const readline = require('readline');
const ffmpeg = require('ffmpeg-static');

const {
    getVideoMetadata,
    generateInfo,
    generateDownloadLinks,
    trimYTFormatVideo,
    getDownloadDirectory,
    downloadFile,
    trimVideo
} = require('../services/ytdl.service');
const { response } = require('express');
const { url } = require('inspector');


const getInfo = async (req, res, next) => {
    try {
        let url = req.query.url;
        let dataReturned = await getVideoMetadata(url);
        if (dataReturned) {
            let basicInfo = generateInfo(dataReturned);
            let downloadFormats = generateDownloadLinks(dataReturned);
            res.status(200).json({
                apiStatus: "SUCCESS",
                data: dataReturned
            });
        } else {
            res.status(500).json({
                apiStatus: "FAILURE",
                data: {
                    message: "Invalid video URL"
                }
            });
        }
    } catch (error) {
        console.error("ERROR IN getInfo", error);
        res.status(500).json({
            apiStatus: "FAILURE",
            data: {
                message: "Internal Server Error"
            }
        });
    }
}
router.get('/info', getInfo);

const download = async (req, res) => {
    // Body contents
    let videoId = req.query.videoId;
    let itag = req.query.itag;
    let type = req.query.type;
    let fileName = req.query.fileName;
    let size;
    if (req.query.size) {
        size = req.query.size
    }

    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);

    if (type === "normal") {
        try {
            if (size) {
                res.setHeader("Content-Length", size);
            }
            await ytdl(`http://www.youtube.com/watch?v=${videoId}`, { itag: itag }).pipe(res);
        } catch (error) {
            console.log(error);
        }
    } else if (type === "merge") {
        let audioSize = 0;
        let videoSize = 0;

        // Global constants
        const ref = 'https://www.youtube.com/watch?v=' + videoId;
        const tracker = {
            start: Date.now(),
            audio: { downloaded: 0, total: Infinity },
            video: { downloaded: 0, total: Infinity },
            merged: { frame: 0, speed: '0x', fps: 0 },
        };

        // Get audio and video streams
        const audio = ytdl(ref, { quality: 'highestaudio' })
            .on('progress', (_, downloaded, total) => {
                tracker.audio = { downloaded, total };
            });
        const video = ytdl(ref, { quality: itag })
            .on('progress', (_, downloaded, total) => {
                tracker.video = { downloaded, total };
            });

        // Prepare the progress bar
        let progressbarHandle = null;
        const progressbarInterval = 1000;
        const showProgress = () => {
            // readline.cursorTo(process.stdout, 0);
            // const toMB = i => (i / 1024 / 1024).toFixed(2);

            // process.stdout.write(`Audio  | ${(tracker.audio.downloaded / tracker.audio.total * 100).toFixed(2)}% processed `);
            // process.stdout.write(`(${toMB(tracker.audio.downloaded)}MB of ${toMB(tracker.audio.total)}MB).${' '.repeat(10)}\n`);

            // process.stdout.write(`Video  | ${(tracker.video.downloaded / tracker.video.total * 100).toFixed(2)}% processed `);
            // process.stdout.write(`(${toMB(tracker.video.downloaded)}MB of ${toMB(tracker.video.total)}MB).${' '.repeat(10)}\n`);

            // process.stdout.write(`Merged | processing frame ${tracker.merged.frame} `);
            // process.stdout.write(`(at ${tracker.merged.fps} fps => ${tracker.merged.speed}).${' '.repeat(10)}\n`);

            // process.stdout.write(`running for: ${((Date.now() - tracker.start) / 1000 / 60).toFixed(2)} Minutes.`);
            // readline.moveCursor(process.stdout, 0, -3);
        };

        // Start the ffmpeg child process
        const ffmpegProcess = cp.spawn(ffmpeg, [
            // Remove ffmpeg's console spamming
            '-loglevel', '8', '-hide_banner',
            // Redirect/Enable progress messages
            '-progress', 'pipe:3',
            // Set inputs
            '-i', 'pipe:4',
            '-i', 'pipe:5',
            // Map audio & video from streams
            '-map', '0:a',
            '-map', '1:v',
            // Keep encoding
            '-c:v', 'copy',
            // Define output file
            '-f', 'matroska', 'pipe:6',
        ], {
            windowsHide: true,
            stdio: [
                /* Standard: stdin, stdout, stderr */
                'inherit', 'inherit', 'inherit',
                /* Custom: pipe:3, pipe:4, pipe:5 */
                'pipe', 'pipe', 'pipe', 'pipe',
            ],
        });
        ffmpegProcess.on('close', () => {
            console.log('done');
            // Cleanup
            process.stdout.write('\n\n\n\n');
            clearInterval(progressbarHandle);
        });

        // Link streams
        // FFmpeg creates the transformer streams and we just have to insert / read data
        ffmpegProcess.stdio[3].on('data', chunk => {
            // Start the progress bar
            if (!progressbarHandle) progressbarHandle = setInterval(showProgress, progressbarInterval);
            // Parse the param=value list returned by ffmpeg
            const lines = chunk.toString().trim().split('\n');
            const args = {};
            for (const l of lines) {
                const [key, value] = l.split('=');
                args[key.trim()] = value.trim();
            }
            tracker.merged = args;
        });
        audio.pipe(ffmpegProcess.stdio[4]);
        video.pipe(ffmpegProcess.stdio[5]);
        ffmpegProcess.stdio[6].pipe(res);
    }
}
router.get('/download', download);

const downloadTrimmedVideo = async (req, res, next) => {
    try {
        // console.log(JSON.stringify(req.body));
        let { filename, format, startTime, endTime } = req.body;
        filename = filename.split(' ').join('_');
        filename = filename.split('|').join('I');
        filename = filename.split('(').join('');
        filename = filename.split(')').join('');
        filename = filename.split('#').join('');
        // console.log("request body", req.body);
        startTime = Number(startTime);
        endTime = Number(endTime);

        let downloadResult = await trimYTFormatVideo(filename, format, startTime, endTime);

        if (downloadResult.apiStatus === "SUCCESS") {
            res.status(200).json({
                apiStatus: "SUCCESS",
                data: downloadResult.data
            });

            // await res.sendFile(downloadResult.data.file
            // await res.download(downloadResult.data.file, `trimmed.${format.extension}`, (err) => {
            //     if(err) {
            //         console.error("ERROR IN SENDING A TRIMMED FILE...", err);
            //     }
            // })
        } else {
            res.status(500).json({
                apiStatus: "FAILURE",
                data: downloadResult.data
            });
        }


    } catch (error) {
        console.error("ERROR IN downloadTrimmedVideo");
        console.error(error)
        if (error.code === "ERR_REQUEST_CANCELLED") {
            res.status(500).json({
                apiStatus: "FAILURE",
                data: {
                    message: "File size greater than Threshold limit"
                }
            });
        } else {
            res.status(statusCode).json({
                apiStatus: "FAILURE",
                data: {
                    message: "Internal Server Error"
                }
            });
        }
    }
}
router.post('/downloadTrimmedFile', downloadTrimmedVideo);

const downloadMergedTrimmedVideo = async (req, res, next) => {
    try {
        let videoId = req.body.videoId;
        let itag = req.body.itag;
        let startTime = req.body.startTime;
        let endTime = req.body.endTime;

        let downloadPath = await getDownloadDirectory();

        let videoInfo = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);

        let videoFormat = videoInfo.formats.find((format) => {
            if (format.itag === Number(itag)) {
                return format;
            }
        })

        let audioFormat = videoInfo.formats.find((format) => {
            let mimeType = format.mimeType;
            mimeType = mimeType.split(';');
            mimeType = mimeType[0].split('/');
            if (mimeType[0].toUpperCase() === "AUDIO" && format.container === "mp4") {
                return format;
            }
        })

        let videoPath = await downloadFile(videoFormat.url, `video.${videoFormat.container}`, downloadPath);
        if (!videoPath) {
            res.status(500).json({
                apiStatus: "FAILURE",
                data: {
                    message: "File size greater than Threshold limit"
                }
            });
        }

        let audioPath = await downloadFile(audioFormat.url, `audio.${audioFormat.container}`, downloadPath);
        if (!audioPath) {
            res.status(500).json({
                apiStatus: "FAILURE",
                data: {
                    message: "File size greater than Threshold limit"
                }
            });
        }

        let outputFilename = "output." + videoFormat.container;
        let trimmedFilename = "trimmed." + videoFormat.container;
        let audioVideoMergeCommand = `ffmpeg -i ${videoPath} -i ${audioPath} -c:v copy -c:a aac ${downloadPath}${outputFilename}`;

        cp.exec(audioVideoMergeCommand, async () => {
            let mergedFilePath = downloadPath + outputFilename;
            let trimmedFilePath = downloadPath + trimmedFilename;
            await trimVideo(mergedFilePath, trimmedFilePath, startTime, endTime);

            let pathArray = trimmedFilePath.split(path.sep);
            pathArray = pathArray.slice(pathArray.indexOf('downloads')+1, pathArray.length);
            let downloadLink = pathArray.join('/');

            res.status(200).json({
                apiStatus: "SUCCESS",
                data: {
                    downloadLink: downloadLink
                }
            });
        });
    } catch (error) {
        console.error("ERROR IN downloadTrimmedVideo");
        console.error(error)
        if (error.code === "ERR_REQUEST_CANCELLED") {
            res.status(500).json({
                apiStatus: "FAILURE",
                data: {
                    message: "File size greater than Threshold limit"
                }
            });
        } else {
            res.status(500).json({
                apiStatus: "FAILURE",
                data: {
                    message: "Internal Server Error"
                }
            });
        }
    }
}
router.post('/downloadMergedTrimmedVideo', downloadMergedTrimmedVideo);

module.exports = router;