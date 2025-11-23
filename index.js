import osa from 'osa2';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import {
    macOSVersion,
    isMacOSVersionGreaterThanOrEqualTo,
} from 'macos-version';
import versions from './macos_versions.json' with { 'type': 'json' };
import { openDB } from './lib/messages-db.js';

const currentVersion = macOSVersion();
const isParticipant = isMacOSVersionGreaterThanOrEqualTo('11.0') ? true : false;

function warn(str) {
    if (!process.env.SUPPRESS_OSA_IMESSAGE_WARNINGS) {
        console.error(str);
    }
}

if (versions.broken.includes(currentVersion)) {
    console.error(
        `This version of macOS \(${currentVersion}) is known to be incompatible with better-osa-imessage. Please upgrade either macOS or better-osa-imessage.`
    );
    process.exit(1);
}

if (!versions.working.includes(currentVersion)) {
    warn(
        `This version of macOS \(${currentVersion}) is currently untested with this version of better-osa-imessage. Proceed with caution.`
    );
}

// Instead of doing something reasonable, Apple stores dates as the number of
// seconds since 01-01-2001 00:00:00 GMT. DATE_OFFSET is the offset in seconds
// between their epoch and unix time
const DATE_OFFSET = 978307200;

// Gets the current Apple-style timestamp
function appleTimeNow() {
    return Math.floor(Date.now() / 1000) - DATE_OFFSET;
}

// Transforms an Apple-style timestamp to a proper unix timestamp
function fromAppleTime(ts) {
    if (ts == 0) {
        return null;
    }

    // unpackTime returns 0 if the timestamp wasn't packed
    // TODO: see `packTimeConditionally`'s comment
    if (unpackTime(ts) != 0) {
        ts = unpackTime(ts);
    }

    return new Date((ts + DATE_OFFSET) * 1000);
}

// Since macOS 10.13 High Sierra, some timestamps appear to have extra data
// packed. Dividing by 10^9 seems to get an Apple-style timestamp back.
// According to a StackOverflow user, timestamps now have nanosecond precision
function unpackTime(ts) {
    return Math.floor(ts / Math.pow(10, 9));
}

// TODO: Do some kind of database-based detection rather than relying on the
// operating system version
function packTimeConditionally(ts) {
    if (isMacOSVersionGreaterThanOrEqualTo('10.13')) {
        return ts * Math.pow(10, 9);
    } else {
        return ts;
    }
}

// Gets the proper handle string for a contact with the given name
function handleForName(name) {
    assert(typeof name == 'string', 'name must be a string');
    return osa((name, isParticipant) => {
        const Messages = Application('Messages');
        return isParticipant
            ? Messages.participants.whose({ name: name })[0].handle()
            : Messages.buddies.whose({ name: name })[0].handle();
    })(name, isParticipant);
}

// Gets the display name for a given handle
// TODO: support group chats
function nameForHandle(handle) {
    assert(typeof handle == 'string', 'handle must be a string');
    return osa((handle, isParticipant) => {
        const Messages = Application('Messages');
        return isParticipant
            ? Messages.participants.whose({ handle: handle })[0].name()
            : Messages.buddies.whose({ handle: handle })[0].name();
    })(handle, isParticipant);
}

// Sends a message to the given handle
function send(handle, message) {
    assert(typeof handle == 'string', 'handle must be a string');
    assert(typeof message == 'string', 'message must be a string');

    return sendMessageOrFile(handle, message);
}

// Sends the file at the filepath to the given handle
function sendFile(handle, filepath) {
    assert(typeof handle == 'string', 'handle must be a string');
    assert(typeof filepath == 'string', 'filepath must be a string');

    return sendMessageOrFile(handle, filepath, true);
}

// Sends a message to the given handle
function sendMessageOrFile(handle, messageOrFilepath, isFile) {
    return osa((handle, messageOrFilepath, isParticipant, isFile) => {
        const Messages = Application('Messages');

        let target;

        try {
            target = isParticipant
                ? Messages.participants.whose({ handle: handle })[0]
                : Messages.buddies.whose({ handle: handle })[0];
        } catch (e) {}

        try {
            target = Messages.textChats.byId('iMessage;+;' + handle)();
        } catch (e) {}

        let message = messageOrFilepath;

        // If a string filepath was provided, we need to convert it to an
        // osascript file object.
        // This must be done in the osa context to have acess to Path
        if (isFile) {
            message = Path(messageOrFilepath);
        }

        try {
            Messages.send(message, { to: target });
        } catch (e) {
            throw new Error(`no thread with handle '${handle}'`);
        }
    })(handle, messageOrFilepath, isParticipant, isFile);
}

let emitter = null;
let emittedMsgs = [];

function listen() {
    // If listen has already been run, return the existing emitter
    if (emitter != null) {
        return emitter;
    }

    // Create an EventEmitter
    emitter = new EventEmitter();

    let last = packTimeConditionally(appleTimeNow() - 5);
    let bail = false;

    const dbPromise = openDB();

    async function check() {
        const db = await dbPromise;
        const query = `
            SELECT
                m.guid,
                id as handle,
                COALESCE(text, '') as text,
                date,
                date_read,
                is_from_me,
                cache_roomnames,
		CASE cache_has_attachments
		    WHEN 0 THEN Null
		    WHEN 1 THEN filename
		END AS attachment,
		CASE cache_has_attachments
		    WHEN 0 THEN Null
		    WHEN 1 THEN mime_type
		END AS mime_type
            FROM message AS m
	    LEFT JOIN message_attachment_join AS maj ON message_id = m.ROWID
	    LEFT JOIN attachment AS a ON a.ROWID = maj.attachment_id
            LEFT JOIN handle AS h ON h.ROWID = m.handle_id
            WHERE date >= ${last}
        `;
        last = packTimeConditionally(appleTimeNow() - 5);

        try {
            const messages = await db.all(query);
            messages.forEach((msg) => {
                if (emittedMsgs[msg.guid]) return;
                emittedMsgs[msg.guid] = true;
                
                // Additional debugging for null text issues
                if (msg.text === null || msg.text === undefined) {
                    console.log(`🐛 DEBUG: Null text detected in database for message ${msg.guid}`);
                    console.log(`🐛 Raw message from DB:`, JSON.stringify(msg, null, 2));
                }
                
                emitter.emit('message', {
                    guid: msg.guid,
                    text: msg.text || '', // Ensure text is never null
                    handle: msg.handle,
                    group: msg.cache_roomnames,
                    fromMe: !!msg.is_from_me,
                    date: fromAppleTime(msg.date),
                    dateRead: fromAppleTime(msg.date_read),
                    file:
                        msg.attachment !== null
                            ? msg.attachment.replace('~', process.env.HOME)
                            : null,
                    fileType: msg.mime_type,
                });
            });
            setTimeout(check, 5000);
        } catch (err) {
            bail = true;
            emitter.emit('error', err);
            warn(`sqlite returned an error while polling for new messages!
                  bailing out of poll routine for safety. new messages will
                  not be detected`);
        }
    }

    if (bail) return;
    check();

    return emitter;
}

async function getRecentChats(limit = 10) {
    const db = await openDB();

    const query = `
        SELECT
            guid as id,
            chat_identifier as recipientId,
            service_name as serviceName,
            room_name as roomName,
            display_name as displayName
        FROM chat
        JOIN chat_handle_join ON chat_handle_join.chat_id = chat.ROWID
        JOIN handle ON handle.ROWID = chat_handle_join.handle_id
        ORDER BY handle.rowid DESC
        LIMIT ${limit};
    `;

    const chats = await db.all(query);
    return chats;
}

export { send, sendFile, listen, handleForName, nameForHandle, getRecentChats };
