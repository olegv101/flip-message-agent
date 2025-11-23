#!/usr/bin/env node

import * as imessage from './index.js';
import chalk from 'chalk';
import { createAIChatHandler } from './lib/ai-chat-handler.js';

/**
 * Smart Message Listener - AI-powered iMessage handler
 * Routes incoming messages to LLM for intelligent responses
 */

class SmartMessageListener {
    constructor(options = {}) {
        try {
            this.aiHandler = createAIChatHandler(options.ai);
            this.aiAvailable = true;
        } catch (error) {
            console.error(chalk.red('❌ Failed to initialize AI handler:'), error.message);
            console.error(chalk.yellow('⚠️  AI features will be disabled'));
            this.aiHandler = null;
            this.aiAvailable = false;
        }
        
        this.enabled = options.enabled !== false && this.aiAvailable; // Default to enabled if AI available
        this.debugMode = options.debug || false;
        this.whitelist = options.whitelist || null; // Array of allowed handles
        this.blacklist = options.blacklist || []; // Array of blocked handles
        this.listener = null;
        
        console.log(chalk.blue.bold('🧠 Smart Message Listener Initialized'));
        console.log(chalk.gray(`AI Available: ${this.aiAvailable}`));
        console.log(chalk.gray(`AI Enabled: ${this.enabled}`));
        console.log(chalk.gray(`Debug Mode: ${this.debugMode}`));
    }

    /**
     * Start listening for messages
     */
    start() {
        console.log(chalk.green.bold('🎧 Starting Smart Message Listener...'));
        console.log(chalk.gray('Monitoring for incoming messages... Press Ctrl+C to stop\n'));

        // Start listening for messages
        this.listener = imessage.listen();

        // Handle new messages
        this.listener.on('message', async (message) => {
            await this.handleMessage(message);
        });

        // Handle errors
        this.listener.on('error', (error) => {
            console.error(chalk.red.bold('\n❌ Listener Error:'));
            console.error(chalk.red(error.message));
            console.error(chalk.gray('The listener will continue running...\n'));
        });

        // Keep the process running
        console.log(chalk.dim('🤖 AI assistant ready for incoming messages...'));
    }

    /**
     * Handle incoming message with AI processing
     */
    async handleMessage(message) {
        const timestamp = new Date().toLocaleString();
        
        // Skip messages sent by us (fromMe = true)
        if (message.fromMe) {
            if (this.debugMode) {
                console.log(chalk.dim(`[${timestamp}] Sent: "${message.text}" to ${message.handle}`));
            }
            return;
        }

        // Check if we should process this message
        if (!this.shouldProcessMessage(message)) {
            this.logMessageSkipped(message, timestamp);
            return;
        }

        // Log incoming message
        this.logIncomingMessage(message, timestamp);

        // Process with AI if enabled and available
        if (this.enabled && this.aiHandler) {
            try {
                await this.processWithAI(message);
            } catch (error) {
                console.error(chalk.red('❌ AI Processing Error:'), error.message);
                
                // Fallback: just log the message
                console.log(chalk.yellow('📝 Message logged without AI processing'));
            }
        } else {
            const reason = !this.aiAvailable ? 'AI not available' : 'AI processing disabled';
            console.log(chalk.yellow(`🤖 ${reason} - message logged only`));
        }

        console.log(chalk.gray('─'.repeat(60)));
    }

    /**
     * Process message with AI handler
     */
    async processWithAI(message) {
        console.log(chalk.blue('🧠 Processing with AI...'));
        
        const startTime = Date.now();
        const result = await this.aiHandler.handleIncomingMessage(message);
        const processingTime = Date.now() - startTime;

        if (result.success) {
            console.log(chalk.green(`✅ AI processed in ${processingTime}ms`));
            
            if (this.debugMode) {
                console.log(chalk.cyan('🔍 AI Response:'), result.aiResponse);
                
                if (result.toolCalls.length > 0) {
                    console.log(chalk.magenta('🔧 Tools used:'));
                    result.toolCalls.forEach(call => {
                        console.log(chalk.magenta(`  - ${call.toolName}: ${JSON.stringify(call.args)}`));
                    });
                }
            }

            // Check auto-send status
            if (result.autoSent) {
                const msgCount = result.messageCount || 1;
                if (msgCount > 1) {
                    console.log(chalk.green.bold(`📤 Auto-sent ${msgCount} messages (texting style!)`));
                } else {
                    console.log(chalk.green.bold(`📤 Auto-sent message: "${result.aiResponse}"`));
                }
            } else if (result.toolCalls.some(tc => tc.toolName === 'waitForMoreInput')) {
                console.log(chalk.yellow('⏳ AI decided to wait for more input (response not sent)'));
            } else if (result.toolCalls.some(tc => tc.toolName === 'skipResponse')) {
                console.log(chalk.yellow('⏭️  AI decided to skip response (not sent)'));
            }

            // Check if any special actions were taken (messages to other people, etc.)
            const specialActions = result.toolResults?.filter(tr => 
                tr.result?.action === 'new_contact_messaged' || 
                tr.result?.action === 'group_chat_created' ||
                tr.result?.action === 'scheduling_link_sent'
            ) || [];

            if (specialActions.length > 0) {
                console.log(chalk.blue.bold(`🔧 Special actions taken:`));
                specialActions.forEach((action) => {
                    console.log(chalk.blue(`   - ${action.result.action}: ${JSON.stringify(action.result)}`));
                });
            }

        } else {
            console.log(chalk.red('❌ AI processing failed:'), result.error);
        }
    }

    /**
     * Check if we should process this message
     */
    shouldProcessMessage(message) {
        // Add detailed debugging for null text issues
        if (message.text === null) {
            console.log(chalk.red(`🐛 DEBUG: Message text is null for ${message.handle}`));
            console.log(chalk.red(`🐛 Full message object:`, JSON.stringify(message, null, 2)));
            return false;
        }

        if (message.text === undefined) {
            console.log(chalk.red(`🐛 DEBUG: Message text is undefined for ${message.handle}`));
            console.log(chalk.red(`🐛 Full message object:`, JSON.stringify(message, null, 2)));
            return false;
        }

        // Check blacklist
        if (this.blacklist.includes(message.handle)) {
            console.log(chalk.yellow(`🚫 Message from ${message.handle} blocked by blacklist`));
            return false;
        }

        // Check whitelist (if enabled)
        if (this.whitelist && !this.whitelist.includes(message.handle)) {
            console.log(chalk.yellow(`🚫 Message from ${message.handle} not in whitelist`));
            console.log(chalk.yellow(`🚫 Current whitelist: ${this.whitelist.join(', ')}`));
            return false;
        }

        // Skip empty messages (after null checks)
        if (!message.text || message.text.trim().length === 0) {
            console.log(chalk.yellow(`🚫 Empty message from ${message.handle}: "${message.text}"`));
            return false;
        }

        return true;
    }

    /**
     * Log incoming message
     */
    logIncomingMessage(message, timestamp) {
        console.log(chalk.green.bold(`\n📨 [${timestamp}] Message from ${message.handle}`));
        console.log(chalk.white(`💬 "${message.text}"`));
        
        if (message.group) {
            console.log(chalk.blue(`👥 Group: ${message.group}`));
        }
        
        if (message.file) {
            console.log(chalk.magenta(`  📎 Attachment: ${message.file}`));
            console.log(chalk.magenta(`  📄 File Type: ${message.fileType}`));
        }
    }

    /**
     * Log skipped message
     */
    logMessageSkipped(message, timestamp) {
        // Always log skipped messages (not just in debug mode) to help with debugging
        console.log(chalk.dim(`[${timestamp}] Skipped message from ${message.handle}: "${message.text}"`));
        
        // Add extra debugging info
        if (this.debugMode) {
            console.log(chalk.red(`🐛 DEBUG: Skipped message details:`));
            console.log(chalk.red(`  - Text: "${message.text}"`));
            console.log(chalk.red(`  - Text type: ${typeof message.text}`));
            console.log(chalk.red(`  - Text === null: ${message.text === null}`));
            console.log(chalk.red(`  - Text === undefined: ${message.text === undefined}`));
            console.log(chalk.red(`  - Handle: ${message.handle}`));
            console.log(chalk.red(`  - Handle in whitelist: ${this.whitelist ? this.whitelist.includes(message.handle) : 'no whitelist'}`));
            console.log(chalk.red(`  - Current whitelist: ${this.whitelist ? this.whitelist.join(', ') : 'none'}`));
        }
    }

    /**
     * Enable/disable AI processing
     */
    setAIEnabled(enabled) {
        this.enabled = enabled;
        console.log(chalk.blue(`🤖 AI processing ${enabled ? 'enabled' : 'disabled'}`));
    }

    /**
     * Update whitelist
     */
    setWhitelist(handles) {
        this.whitelist = handles;
        console.log(chalk.blue('📝 Updated whitelist:'), handles);
    }

    /**
     * Update blacklist
     */
    setBlacklist(handles) {
        this.blacklist = handles;
        console.log(chalk.blue('🚫 Updated blacklist:'), handles);
    }

    /**
     * Get AI handler for direct access
     */
    getAIHandler() {
        return this.aiHandler;
    }

    /**
     * Manually process a conversation
     */
    async processConversation(handle) {
        console.log(chalk.blue(`🔄 Manually processing conversation for ${handle}`));
        return await this.aiHandler.processConversation(handle);
    }

    /**
     * Get conversation status
     */
    async getConversationStatus(handle) {
        return await this.aiHandler.getConversationStatus(handle);
    }

    /**
     * Stop the listener
     */
    stop() {
        console.log(chalk.yellow.bold('\n👋 Stopping Smart Message Listener...'));
        // Note: The original listener doesn't have a stop method, so we just log
        console.log(chalk.gray('Process will exit...'));
    }
}

// Create and configure listener from environment/options
function createSmartListener(options = {}) {
    const config = {
        enabled: process.env.AI_ENABLED !== 'false',
        debug: process.env.DEBUG_MODE === 'true',
        whitelist: process.env.AI_WHITELIST ? process.env.AI_WHITELIST.split(',') : null,
        blacklist: process.env.AI_BLACKLIST ? process.env.AI_BLACKLIST.split(',') : [],
        ai: {
            model: process.env.AI_MODEL || 'gpt-4o-mini'
        },
        ...options
    };

    return new SmartMessageListener(config);
}

// Handle graceful shutdown
function setupShutdownHandlers(listener) {
    process.on('SIGINT', () => {
        listener.stop();
        console.log(chalk.yellow.bold('\n\n👋 Goodbye!'));
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        listener.stop();
        console.log(chalk.yellow.bold('\n\n👋 Goodbye!'));
        process.exit(0);
    });
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    console.log(chalk.blue.bold('🚀 Smart Message Listener Starting...'));
    console.log('═'.repeat(50));
    
    console.log(chalk.gray('Environment Configuration:'));
    console.log(chalk.gray(`  AI Model: ${process.env.AI_MODEL || 'gpt-4o-mini'}`));
    console.log(chalk.gray(`  AI Enabled: ${process.env.AI_ENABLED !== 'false'}`));
    console.log(chalk.gray(`  Debug Mode: ${process.env.DEBUG_MODE === 'true'}`));
    console.log(chalk.gray(`  Storage: ${process.env.CONVERSATION_STORE_TYPE || 'memory'}`));
    console.log('');
    
    const listener = createSmartListener();
    setupShutdownHandlers(listener);
    
    // Add some helpful commands
    console.log(chalk.dim('💡 Pro Tips:'));
    console.log(chalk.dim('  - Set AI_ENABLED=false to disable AI responses'));
    console.log(chalk.dim('  - Set DEBUG_MODE=true for detailed logging'));
    console.log(chalk.dim('  - Set AI_WHITELIST=+1234567890,+1987654321 to limit who can trigger AI'));
    console.log(chalk.dim('  - Set OPENAI_API_KEY in your environment'));
    console.log('');
    
    listener.start();
}

export { SmartMessageListener, createSmartListener }; 