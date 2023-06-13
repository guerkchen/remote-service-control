const express = require('express');
const winston = require('winston');
const fs = require('fs');
const write = require('write');
const crypto = require("crypto");
const nosql = require('nosql');
var config = require('config');
const { exec } = require('child_process');
const dotenv = require('dotenv');

dotenv.config();
var logger = winston.createLogger({
    level: config.get("log.level"),
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({ 'timestamp': true }),
        new winston.transports.File({ 'filename': config.get("log.file") }),
    ],
});

const keyDB = nosql.load(config.get("keyDB"));

function reload_config() {
    logger.verbose("reload_config()");
    // read config
    config = require('config');

    // iterate entries
    config.get("set").forEach(ele => {
        if (ele.name == "reload_config") {
            logger.warn("Skipping reload_config, reserves keyword");
        } else {
            // search for the entry by name
            keyDB.find().make(filter => {
                filter.where("name", "=", ele["name"]);
                filter.callback((err, res) => {
                    if (err) {
                        logger.error(`Fehler beim Suchen des Eintrags ${ele["name"]} `, err);
                    } else {
                        if (res.length > 1) {
                            // delete all entries
                            logger.warn(`Mehr als ein Eintrag wurde für den Namen ${ele.name} gefunden. Ich lösche alle.`);

                            keyDB.remove().make(function (builder) {
                                builder.search("name", ele["name"]);
                                builder.callback(function (err, count) {
                                    if (err) {
                                        logger.error(`Fehler beim Löschen der Einträge für den Namen ${ele.name}`);
                                    } else {
                                        logger.info(`Für den Namen ${ele.name} wurden ${count} Einträge entfernt.`);
                                    }
                                });
                            });
                        }

                        if (res.length == 0) {
                            // create entry
                            logger.info(`Eintag ${ele.name} nicht gefunden. Ich lege ihn an.`);
                            logger.info("Generate API key");
                            const apiKey = crypto.randomBytes(32).toString('hex');

                            keyDB.insert({
                                "name": ele["name"],
                                "apiKey": apiKey
                            }).callback(err => {
                                if (err) {
                                    logger.error(`Eintrag für ${ele.name} konnte nicht erfolgreich angelegt werden.`, err);
                                } else {
                                    logger.info(`Eintrag ${ele.name} wurde erfolgreich angelegt.`);
                                }
                            });
                        }

                        // if exactly one entrie is found, no action is performed
                    }
                });
            });
        }
    });
}

const app = express();
app.get('/reload_config/:apiKey', (req, resApp) => {
    const apiKey = req.params.apiKey;
    if(apiKey == process.env.reload_key){
        reload_config();
        resApp.status(200);
	resApp.send("config neu geladen");
    } else {
	resApp.status(403);
	resApp.send("fehlerhafter API Key");
    }   
});

app.get("/command/:apiKey", (req, resApp) => {
    const apiKey = req.params.apiKey;
    logger.debug(`Anfrage für APIKey ${apiKey}`);

    keyDB.find().make(filter => {
        filter.where("apiKey", "=", apiKey);
        filter.callback((err, resDB) => {
            if (err) {
                logger.error(`Fehler beim Suchen des Eintrags ${apiKey}`, err);
            } else {
                if (resDB.length > 1) {
                    logger.error(`Mehr als ein Eintrag gerfunden für ${apiKey}. Breche Verarbeitung ab.`);
                    resApp.status(500);
                    resApp.send("Internal Servererror");
                } else if (resDB.length == 0) {
                    resApp.status(403);
                    resApp.send("Unkown API Key");
                } else {
                    const entry = resDB[0];
                    logger.info(`valide Anfrage für API Key ${apiKey}`);
                    // find entry in config
                    config.get("set").forEach(ele => {
                        if (ele.name == entry.name) {
                            logger.debug(`execute command ${ele.command}`);
                            exec(ele.command, (err, stdout, stderr) => {
                                if (err) {
                                    logger.error(`Fehler beim Ausführen des Kommandos ${ele.command}`, err);
                                    resApp.status(500);
                                    resApp.send("Internal Servererror");
                                } else {
                                    logger.info(`Kommando ${ele.command} erfolgreich ausgeführt`);
                                    logger.debug(`stdout ${stdout}`);
                                    logger.debug(`stderr ${stderr}`);
                                    resApp.status(200);
                                    resApp.send("Kommando ausgeführt");
                                }
                            });
                        }
                    });
                }
            }
        });
    });
});

app.listen(3010, "localhost", () => logger.info('Webserver running on port 3010'));
