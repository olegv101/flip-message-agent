import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const dbPath = `${process.env.HOME}/Library/Messages/chat.db`;
const OPEN_READONLY = sqlite3.OPEN_READONLY;

let db;
async function openDB() {
    if (db) return db;
    db = open({
        filename: dbPath,
        mode: OPEN_READONLY,
        driver: sqlite3.Database,
    });
    return db;
}

let isClosing;
function cleanUp() {
    if (db && db.driver.open && !isClosing) {
        isClosing = true;
        db.close();
    }
}
process.on('exit', cleanUp);
// process.on('uncaughtException', cleanUp);

export { openDB };
