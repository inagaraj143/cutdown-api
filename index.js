const express = require('express');
const cors = require('cors');
const fileMiddleware = require('express-multipart-file-parser');

const app = express();
app.use(express.json());
app.use(cors());
app.use(fileMiddleware);

require('dotenv').config({ path: __dirname + '/.env' });

// Logger
if (process.env.ENV === "DEV") {
    // console.log("Will Start Logging");
    const logger = require('morgan');
    app.use(logger('dev'));
}

app.use(express.static('./downloads'));

const ytdlControllers = require('./src/controllers/ytdl.controller');
app.use(ytdlControllers)

const port = process.env.PORT;

const server = app.listen(port, () => {
    console.log(`listening on port ${port}`);
})

server.timeout = 60000;