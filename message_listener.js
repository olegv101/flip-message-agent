import * as imessage from './index.js';
import chalk from 'chalk';

// Add chalk as a dependency if not already installed
// This script will pretty-print incoming messages with colors

console.log(chalk.blue.bold('🎧 iMessage Listener Started'));
console.log(chalk.gray('Listening for new messages... Press Ctrl+C to stop\n'));

// Start listening for messages
const listener = imessage.listen();

// Handle new messages
listener.on('message', (message) => {
    const timestamp = new Date().toLocaleString();
    
    // Skip messages sent by us (fromMe = true) to only show incoming messages
    if (message.fromMe) {
        console.log(chalk.dim(`[${timestamp}] Sent: "${message.text}" to ${message.handle}`));
        return;
    }

    // Format incoming message display
    console.log(chalk.green.bold('\n📱 New Message Received:'));
    console.log(chalk.cyan(`  From: ${message.handle}`));
    console.log(chalk.white(`  Message: "${message.text}"`));
    console.log(chalk.gray(`  Time: ${message.date}`));
    console.log(chalk.gray(`  GUID: ${message.guid}`));
    
    // Handle group messages
    if (message.group) {
        console.log(chalk.yellow(`  Group: ${message.group}`));
    }
    
    // Handle file attachments
    if (message.file) {
        console.log(chalk.magenta(`  📎 Attachment: ${message.file}`));
        console.log(chalk.magenta(`  📄 File Type: ${message.fileType}`));
    }
    
    console.log(chalk.gray('─'.repeat(50)));
});

// Handle errors
listener.on('error', (error) => {
    console.error(chalk.red.bold('\n❌ Error occurred:'));
    console.error(chalk.red(error.message));
    console.error(chalk.gray('The listener will continue running...\n'));
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log(chalk.yellow.bold('\n\n👋 Stopping message listener...'));
    console.log(chalk.gray('Goodbye!'));
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log(chalk.yellow.bold('\n\n👋 Stopping message listener...'));
    console.log(chalk.gray('Goodbye!'));
    process.exit(0);
});

// Keep the process running
console.log(chalk.dim('Waiting for messages...')); 