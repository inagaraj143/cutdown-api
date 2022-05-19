const ytdl = require('ytdl-core');
const Downloader = require('nodejs-file-downloader');
const path = require('path');
const ffmpeg = require('ffmpeg');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const { exec } = require('child_process');

const downloadThreshold = 100000000;

const getVideoMetadata = async (url) => {
    try {
        if (ytdl.validateURL(url)) {
            let info = await ytdl.getInfo(url);
            return info;
        } else {
            return null;
        }
    } catch (error) {
        throw error;
    }
}

const generateInfo = (metadata) => {
    let basicInfo = {
        title: metadata.videoDetails.title,
        description: metadata.videoDetails.description,
        lengthInSeconds: metadata.videoDetails.lengthSeconds,
        viewCount: metadata.videoDetails.viewCount,
        category: metadata.videoDetails.category,
        publishedDate: metadata.videoDetails.publishDate,
        channelName: metadata.videoDetails.ownerChannelName,
        averageRating: metadata.videoDetails.averageRating,
        likes: metadata.videoDetails.likes,
        dislikes: metadata.videoDetails.dislikes,
        ageRestricted: metadata.videoDetails.age_restricted,
        thumbnails: metadata.videoDetails.thumbnails,
        owner: {
            name: metadata.videoDetails.author.name,
            username: metadata.videoDetails.author.user,
            channelUrl: metadata.videoDetails.author.channel_url,
            userUrl: metadata.videoDetails.author.user_url
        },
        embedOptions: metadata.videoDetails.embed
    }
    return basicInfo;
}

const generateDownloadLinks = (metadata) => {
    let downloadFormats = {
        video: [],
        videoOnly: [],
        audio: []
    }
    let formats = metadata.formats;

    formats.forEach(format => {
        let type = format.mimeType;

        type = type.split(';');
        type = type[0].split('/');

        if (type[0] === 'video') {
            if (format.audioQuality && format.audioSampleRate) {
                let videoFormat = {
                    quality: format.qualityLabel,
                    type: format.mimeType,
                    downloadUrl: format.url,
                    width: format.width,
                    height: format.height,
                    fps: format.fps,
                    itag: format.itag,
                    extension: format.container
                }
                downloadFormats.video.push(videoFormat);
            } else {
                let videoFormat = {
                    quality: format.qualityLabel,
                    type: format.mimeType,
                    downloadUrl: format.url,
                    width: format.width,
                    height: format.height,
                    fps: format.fps,
                    itag: format.itag,
                    extension: format.container
                }
                downloadFormats.videoOnly.push(videoFormat);
            }
        } else if (type[0] === 'audio') {
            let audioFormat = {
                type: format.mimeType,
                audioBitRate: format.audioBitrate,
                downloadUrl: format.url,
                itag: format.itag,
                extension: format.container
            }
            downloadFormats.audio.push(audioFormat);
        }
    });

    return downloadFormats
}

const trimYTFormatVideo = async (filename, format, startTime, endTime) => {
    try {
        let extension;
        if (format.container) {
            extension = format.container;
        } else {
            extension = 'mp4';
        }

        let fileNameToStoreDownloaded = 'downloaded' + '.' + extension;
        let fileNameToStoreTrimmed = 'trimmed' + '.' + extension;

        const downloadDirectory = await getDownloadDirectory();
        let isDownloadCancelled = false;
        const downloader = new Downloader({
            url: format.url,
            directory: downloadDirectory,
            fileName: fileNameToStoreDownloaded,
            onProgress: function (percentage, chunk, remainingSize) {
                // console.log('% ', percentage);
                // console.log('Remaining bytes: ', remainingSize)
                if (remainingSize > downloadThreshold) {
                    downloader.cancel();
                    isDownloadCancelled = true;
                }
            }
        })


        console.log("Download started");
        await downloader.download();
        console.log("Download finished");
        console.log("Download directory is " + downloadDirectory);

        if (!isDownloadCancelled) {
            let filePath = downloadDirectory + fileNameToStoreDownloaded;
            let trimmedFilePath = path.join(downloadDirectory + fileNameToStoreTrimmed);
            let file;
            let videoProcess = await new ffmpeg(filePath).then(
                async (video) => {
                    video.setVideoStartTime(startTime),
                        video.setVideoDuration(endTime - startTime);
                    console.log("Trimming started");
                    file = await video.save(trimmedFilePath);
                    console.log("Trimming finished");
                }
            )

            let pathArray = trimmedFilePath.split(path.sep);
            pathArray = pathArray.slice(pathArray.indexOf('downloads') + 1, pathArray.length);
            let downloadLink = pathArray.join('/');

            return {
                apiStatus: "SUCCESS",
                data: {
                    file,
                    downloadLink: downloadLink
                }
            }
        } else {
            return {
                status: "FAILURE",
                data: {
                    message: "File size larger than threshold limit"
                }
            }
        }
    } catch (error) {
        throw error
    }
}

const getDownloadDirectory = async () => {
    // clear  downloads
    // await removeDownloadDirectory();
    let timeStamp = Date.now();
    await mkdirp(path.join(__dirname, '../../downloads'));
    const downloadDirectory = path.join(__dirname, '../../downloads/' + timeStamp + '/');
    await mkdirp(path.join(downloadDirectory));
    return downloadDirectory;
}

const removeDownloadDirectory = async () => {
    await rimraf(path.join(__dirname, '../../downloads/*'), (result) => { });
}

const downloadFile = async (url, filename, destination) => {
    let isDownloadCancelled = false;
    const downloader = new Downloader({
        url: url,
        directory: destination,
        fileName: filename,
        onProgress: function (percentage, chunk, remainingSize) {
            // console.log('% ', percentage);
            // console.log('Remaining bytes: ', remainingSize)
            if (remainingSize > downloadThreshold) {
                downloader.cancel();
                isDownloadCancelled = true;
            }
        }
    })

    console.log("Download started");
    await downloader.download();
    console.log("Download finished");

    if (!isDownloadCancelled) {
        return destination + filename;
    } else {
        return null;
    }
}

const trimVideo = async (videoPath, destination, startTime, endTime) => {
    try {
        // let videoProcess = await new ffmpeg(videoPath).then(
        //     async (video) => {
        //         video.setVideoStartTime(startTime);
        //         video.setVideoDuration(endTime - startTime);
        //         console.log("Trimming started");
        //         file = await video.save(destination);
        //         console.log("Trimming finished");
        //     }
        // )

        let cmd = `ffmpeg -i ${videoPath} -ss ${startTime} -t ${endTime} -crf 25 -preset ultrafast ${destination}`
        //    // let cmd = `ffmpeg -i ${videoPath} -vf trim=${startTime}:${endTime} -crf 27 -preset ultrafast ${destination}`
            exec(cmd, function(err, stdout, stderr) {
                if(err) throw err;
               console.log("Trimming finished");
                })
        return true;
    } catch (error) {
        console.log(error);
        return false;
    }
}

module.exports = {
    generateInfo,
    getVideoMetadata,
    generateDownloadLinks,
    trimYTFormatVideo,
    downloadFile,
    trimVideo,
    getDownloadDirectory,
    removeDownloadDirectory,
}