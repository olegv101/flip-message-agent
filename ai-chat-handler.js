import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createConversationStore } from './conversation-store.js';
import { llmTools } from './llm-tools.js';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as imessage from '../index.js';
import { execSync } from 'child_process';

// Load environment variables
dotenv.config();

// Get the directory path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * AI Chat Handler - Main orchestrator for LLM-powered conversations
 * Uses AI SDK Core with function calling and conversation management
 */
class AIChatHandler {
    constructor(options = {}) {
        // Check for OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // Ensure we properly initialize the model
        const modelName =
            options.modelName || process.env.AI_MODEL || 'gpt-4o-mini';
        this.model = openai(modelName);
        this.conversationStore =
            options.conversationStore || createConversationStore();
        this.systemPrompt =
            options.systemPrompt || this.getDefaultSystemPrompt();
        this.maxSteps = options.maxSteps || 10; // Allow multi-step tool calling

        console.log(
            chalk.blue('🤖 AI Chat Handler initialized with model:', modelName)
        );
    }

    /**
     * Handle an incoming message and decide whether to respond or wait
     */
    async handleIncomingMessage(incomingMessage) {
        const { handle, text: messageText, group: isGroup } = incomingMessage;

        console.log(
            chalk.yellow(
                `\n🧠 AI processing message from ${handle}: "${messageText}"`
            )
        );

        try {
            // Set the current message handle for tools to use
            global.currentMessageHandle = handle;

            // Add the incoming message to conversation history
            await this.conversationStore.addMessage(
                handle,
                'user',
                messageText
            );

            // Get conversation history for context
            const conversation =
                await this.conversationStore.getConversation(handle);

            // Build messages array for AI SDK
            const messages = [
                {
                    role: 'system',
                    content: this.getSystemPromptWithContext(handle),
                },
                ...conversation.messages.map((msg) => ({
                    role: msg.role,
                    content: msg.content,
                    toolCalls: msg.toolCalls,
                    toolResults: msg.toolResults,
                })),
            ];

            // Generate response with tool calling
            const result = await generateText({
                model: this.model,
                messages,
                tools: llmTools,
                maxSteps: this.maxSteps,
                temperature: 0.7,
                maxTokens: 500,
            });

            // Log AI decision
            console.log(chalk.green('🤖 AI Response:'), result.text);

            if (result.toolCalls && result.toolCalls.length > 0) {
                console.log(
                    chalk.magenta('🔧 Tools called:'),
                    result.toolCalls
                        .map(
                            (call) =>
                                `${call.toolName}(${JSON.stringify(call.args)})`
                        )
                        .join(', ')
                );
            }

            // Save AI response to conversation history
            await this.conversationStore.addMessage(
                handle,
                'assistant',
                result.text,
                result.toolCalls,
                result.toolResults
            );

            // AUTO-SEND LOGIC: By default, send the AI's text response back to the user
            // Only skip if the AI explicitly called waitForMoreInput or skipResponse
            const shouldSkipResponse = result.toolCalls?.some(
                (call) => call.toolName === 'waitForMoreInput' || call.toolName === 'skipResponse'
            );

            if (!shouldSkipResponse && result.text && result.text.trim().length > 0) {
                try {
                    // Split response by line breaks to send multiple messages (texting style)
                    const messages = result.text
                        .split('\n')
                        .map(msg => msg.trim())
                        .filter(msg => msg.length > 0);
                    
                    console.log(chalk.blue(`📤 Auto-sending ${messages.length} message(s) to ${handle}`));
                    
                    // Send each message separately with delays for natural texting feel
                    for (let i = 0; i < messages.length; i++) {
                        const message = messages[i];
                        
                        // Add 2 second delay before each message
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        
                        // Use AppleScript with explicit iMessage service for consistent blue messages
                        // No "activate" command means it runs in background without switching windows
                        const appleScript = `
                        tell application "Messages"
                            set serviceID to id of 1st service whose service type = iMessage
                            send "${message.replace(/"/g, '\\"')}" to buddy "${handle}" of service id serviceID
                        end tell
                        `;
                        
                        execSync(`osascript -e '${appleScript}'`);
                        
                        console.log(chalk.green(`✅ Sent ${i + 1}/${messages.length}: "${message}"`));
                    }
                } catch (error) {
                    console.error(chalk.red('❌ Failed to auto-send response:'), error);
                }
            }

            // Calculate message count for logging
            let messageCount = 0;
            if (!shouldSkipResponse && result.text && result.text.trim().length > 0) {
                messageCount = result.text
                    .split('\n')
                    .map(msg => msg.trim())
                    .filter(msg => msg.length > 0).length;
            }

            return {
                success: true,
                aiResponse: result.text,
                toolCalls: result.toolCalls || [],
                toolResults: result.toolResults || [],
                conversationContinues: this.shouldContinueConversation(result),
                autoSent: !shouldSkipResponse,
                messageCount: messageCount,
                rawResult: result,
            };
        } catch (error) {
            console.error(chalk.red('❌ Error handling message:'), error);

            return {
                success: false,
                error: error.message,
                fallbackAction: 'Could not process message with AI',
            };
        } finally {
            // Clean up global state
            global.currentMessageHandle = null;
        }
    }

    /**
     * Manually trigger AI to process a conversation (for testing/admin)
     */
    async processConversation(handle, customPrompt = null) {
        console.log(
            chalk.blue(`🔄 Manually processing conversation for ${handle}`)
        );

        const conversation =
            await this.conversationStore.getConversation(handle);

        const messages = [
            { role: 'system', content: customPrompt || this.systemPrompt },
            ...conversation.messages.map((msg) => ({
                role: msg.role,
                content: msg.content,
                toolCalls: msg.toolCalls,
                toolResults: msg.toolResults,
            })),
            {
                role: 'user',
                content:
                    'Please analyze this conversation and decide if any action is needed.',
            },
        ];

        const result = await generateText({
            model: this.model,
            messages,
            tools: llmTools,
            maxSteps: this.maxSteps,
            temperature: 0.7,
        });

        return result;
    }

    /**
     * Clear conversation history for a user
     */
    async clearConversation(handle) {
        await this.conversationStore.clearConversation(handle);
        console.log(
            chalk.yellow(`🧹 Cleared conversation history for ${handle}`)
        );
    }

    /**
     * Get conversation status for debugging
     */
    async getConversationStatus(handle) {
        const conversation =
            await this.conversationStore.getConversation(handle);
        return {
            handle,
            messageCount: conversation.messages.length,
            lastActivity: conversation.lastActivity,
            context: conversation.context,
            recentMessages: conversation.messages.slice(-5), // Last 5 messages
        };
    }

    /**
     * Update AI system prompt
     */
    updateSystemPrompt(newPrompt) {
        this.systemPrompt = newPrompt;
        console.log(chalk.blue('📝 Updated AI system prompt'));
    }

    /**
     * Get list of recent conversations
     */
    async getRecentConversations(limit = 10) {
        return await this.conversationStore.getRecentConversations(limit);
    }

    /**
     * Process contextual situations and determine appropriate messaging actions
     */
    async processContext(contextData) {
        console.log(
            chalk.yellow(
                `\n🧠 AI processing context:`,
                JSON.stringify(contextData, null, 2)
            )
        );

        try {
            // Build the context prompt
            const contextPrompt = this.buildContextPrompt(contextData);

            const messages = [
                { role: 'system', content: this.getContextProcessingPrompt() },
                { role: 'user', content: contextPrompt },
            ];

            // Generate response with tool calling
            const result = await generateText({
                model: this.model,
                messages,
                tools: llmTools,
                maxSteps: this.maxSteps,
                temperature: 0.7,
                maxTokens: 1000,
            });

            // Log AI decision
            console.log(chalk.green('🤖 Context Analysis:'), result.text);

            if (result.toolCalls && result.toolCalls.length > 0) {
                console.log(
                    chalk.magenta('🔧 Actions executed:'),
                    result.toolCalls
                        .map(
                            (call) =>
                                `${call.toolName}(${JSON.stringify(call.args)})`
                        )
                        .join(', ')
                );
            }

            return {
                success: true,
                reasoning: result.text,
                toolCalls: result.toolCalls || [],
                toolResults: result.toolResults || [],
                thinkingSteps: this.extractThinkingSteps(result),
                actionsExecuted: this.formatExecutedActions(
                    result.toolCalls,
                    result.toolResults
                ),
                rawResult: result,
            };
        } catch (error) {
            console.error(chalk.red('❌ Error processing context:'), error);

            return {
                success: false,
                error: error.message,
                fallbackAction: 'Could not process context with AI',
            };
        }
    }

    /**
     * Process contextual situations with real-time streaming updates
     */
    async processContextWithStreaming(contextData, streamCallback) {
        console.log(chalk.yellow(`\n🧠 AI processing context with streaming:`, JSON.stringify(contextData, null, 2)));
        
        try {
            // Send initial thinking update
            streamCallback({
                type: 'thinking',
                message: 'Building context prompt and preparing AI processing...'
            });

            // Build the context prompt
            const contextPrompt = this.buildContextPrompt(contextData);
            
            streamCallback({
                type: 'thinking', 
                message: 'Sending context to AI for analysis and action planning...'
            });

            const messages = [
                { role: 'system', content: this.getContextProcessingPrompt() },
                { role: 'user', content: contextPrompt }
            ];

            // Generate response with tool calling
            const result = await generateText({
                model: this.model,
                messages,
                tools: llmTools,
                maxSteps: this.maxSteps,
                temperature: 0.7,
                maxTokens: 1000
            });

            // Stream AI reasoning
            streamCallback({
                type: 'thinking',
                message: `AI Analysis: ${result.text}`
            });

            // Stream tool execution updates
            if (result.toolCalls && result.toolCalls.length > 0) {
                for (let i = 0; i < result.toolCalls.length; i++) {
                    const call = result.toolCalls[i];
                    const toolResult = result.toolResults?.[i];
                    
                    streamCallback({
                        type: 'action',
                        message: `Executing ${call.toolName}: ${call.args.reasoning || 'Processing action...'}`
                    });

                    // Small delay to make it feel more natural
                    await new Promise(resolve => setTimeout(resolve, 500));

                    if (toolResult?.success) {
                        streamCallback({
                            type: 'action_result',
                            message: `✅ ${call.toolName} completed successfully`,
                            details: toolResult
                        });
                    } else {
                        streamCallback({
                            type: 'action_result', 
                            message: `❌ ${call.toolName} failed: ${toolResult?.error || 'Unknown error'}`,
                            details: toolResult
                        });
                    }
                }

                console.log(chalk.magenta('🔧 Actions executed:'), 
                    result.toolCalls.map(call => `${call.toolName}(${JSON.stringify(call.args)})`).join(', ')
                );
            } else {
                streamCallback({
                    type: 'thinking',
                    message: 'AI analysis completed, but no actions were needed for this context.'
                });
            }

            // Log AI decision
            console.log(chalk.green('🤖 Context Analysis:'), result.text);

            return {
                success: true,
                reasoning: result.text,
                toolCalls: result.toolCalls || [],
                toolResults: result.toolResults || [],
                thinkingSteps: this.extractThinkingSteps(result),
                actionsExecuted: this.formatExecutedActions(result.toolCalls, result.toolResults),
                rawResult: result
            };

        } catch (error) {
            console.error(chalk.red('❌ Error processing context:'), error);
            
            streamCallback({
                type: 'error',
                message: `Processing failed: ${error.message}`
            });
            
            return {
                success: false,
                error: error.message,
                fallbackAction: 'Could not process context with AI'
            };
        }
    }

    /**
     * Build context prompt from structured data
     */
    buildContextPrompt(contextData) {
        // Extract key information from context for easier tool use
        let actionInstruction = '';

        if (
            contextData.situation === 'urgent_notification' ||
            contextData.event === 'investor_call_completed' ||
            contextData.event === 'market_alert'
        ) {
            // Extract investor and contact info
            const primaryContact = contextData.primaryContact || contextData.investor;
            const secondaryContact = contextData.secondaryContact || contextData.partner;
            const message = contextData.message || contextData.summary;
            const transcript = contextData.transcript;
            const actionPoints = contextData.actionPoints;

            actionInstruction = `URGENT: I need you to send messages based on this situation:

SITUATION: ${contextData.situation || contextData.event}
${message ? `SUMMARY: ${message}` : ''}
${transcript ? `CALL TRANSCRIPT: ${transcript}` : ''}
${actionPoints ? `ACTION POINTS: ${Array.isArray(actionPoints) ? actionPoints.join(', ') : actionPoints}` : ''}

PEOPLE TO NOTIFY:`;

            if (primaryContact) {
                actionInstruction += `\n- ${primaryContact.name} (Investor) at ${primaryContact.phone}`;
            }

            if (secondaryContact) {
                actionInstruction += `\n- ${secondaryContact.name} (Partner) at ${secondaryContact.phone}`;
            }

            actionInstruction += `\n\nPlease send appropriate messages to these people immediately. Use sendToSpecificContact for each person.`;
        } else {
            // Fallback for other context types
            const contextStr =
                typeof contextData === 'string'
                    ? contextData
                    : JSON.stringify(contextData, null, 2);
            actionInstruction = `I need you to take action based on this context:

${contextStr}

Please analyze who needs to be messaged and send the appropriate messages using sendToSpecificContact.`;
        }

        return actionInstruction;
    }

    /**
     * Extract thinking steps from AI result
     */
    extractThinkingSteps(result) {
        const steps = [];

        // Add main reasoning
        if (result.text) {
            steps.push(`Analysis: ${result.text}`);
        }

        // Add tool decisions
        if (result.toolCalls) {
            result.toolCalls.forEach((call, index) => {
                steps.push(
                    `Action ${index + 1}: ${call.toolName} - ${call.args.reasoning || 'Executing action'}`
                );
            });
        }

        return steps;
    }

    /**
     * Format executed actions for response
     */
    formatExecutedActions(toolCalls = [], toolResults = []) {
        return toolCalls.map((call, index) => {
            const result = toolResults[index];

            return {
                action: call.toolName,
                parameters: call.args,
                result: result?.success ? 'success' : 'failed',
                details: result,
            };
        });
    }

    /**
     * Get system prompt for context processing
     */
    getContextProcessingPrompt() {
        return `You are a messaging action specialist. When given a situation context, you MUST take immediate action by sending messages.

CRITICAL INSTRUCTIONS:
- You MUST use sendToSpecificContact tool to send actual messages
- Do NOT just explain what should be sent - ACTUALLY SEND THE MESSAGES
- Always include a "reasoning" parameter explaining why you're sending each message
- For urgent situations, start messages with "Urgent:"
- Be professional and concise

Available tools (USE THESE NOW):
- sendToSpecificContact: Send message to specific phone number (PRIMARY TOOL)
- sendLink: Whenever someone asks you to schedule a meeting or anything along the lines of scheduling to meet or finding a time to meet, use this tool to send the link.
- createGroupChat: Create group conversations between two people if needed

Your workflow:
1. Read the situation context
2. Identify who needs to be messaged
3. Craft appropriate message content
4. IMMEDIATELY call sendToSpecificContact for each message
5. Include clear reasoning for each action

Example:
If told "notify investor Sarah (+1234567890) about market opportunity", you would immediately call:
sendToSpecificContact(phoneNumber: "+1234567890", message: "Market Alert: ETH price movement detected. Opportunity to review our DeFi positions.", reasoning: "Notifying investor about significant market movement")

IMPORTANT: Execute actions immediately - don't describe what you would do, DO IT.

*SUPER IMPORTANT*
You must break down longer paragraphs of text into multiple messages,
For example:
Instead of "Market Update: Bitcoin just broke through $45k resistance. This aligns with our technical analysis from yesterday. I recommend reviewing your portfolio allocation and considering the DeFi positions we discussed."
You must break it down into multiple messages:
1. "Market Update: Bitcoin just broke through $45k resistance."
2. "This aligns with our technical analysis from yesterday."
3. "I recommend reviewing your portfolio allocation and considering the DeFi positions we discussed."
and use sendMessage to send each message.

`;
    }

    // Private methods
    getSystemPromptWithContext(handle) {
        return `${this.getDefaultSystemPrompt()}

CURRENT USER CONTEXT:
- You are currently talking to: ${handle}
- This is their phone number/handle: ${handle}
- Remember this context when making decisions about tools and responses
- Use this information when making introductions or referencing the user`;
    }

    getDefaultSystemPrompt() {
        try {
            const systemPromptPath = join(__dirname, 'system-prompt.md');
            const systemPrompt = readFileSync(systemPromptPath, 'utf-8');
            return systemPrompt;
        } catch (error) {
            console.error('Error reading system-prompt.md:', error);
            // Fallback to a minimal prompt if file can't be read
            return `You are Flip, a friendly crypto assistant. You help users with blockchain and cryptocurrency questions.

IMPORTANT: When you want to respond, you MUST use the sendMessage tool - do not just generate text responses.

Available tools:
1. sendMessage - Send a reply back to the current user
2. sendToSpecificContact - Send message to a specific phone number
3. createGroupChat - Create group conversations
4. searchTalent - Find experts or specialists when needed
5. sendLink - Send scheduling link
6. analyzeMessage - Understand message context and urgency
7. waitForMoreInput - Wait when you need more specific information

Current time: ${new Date().toLocaleString()}`;
        }
    }

    shouldContinueConversation(result) {
        // Check if AI used waitForMoreInput tool
        if (result.toolCalls) {
            return !result.toolCalls.some(
                (call) => call.toolName === 'waitForMoreInput'
            );
        }
        return true;
    }
}

// Factory function for easy initialization
export function createAIChatHandler(options = {}) {
    // Setup model name based on environment
    const modelName = process.env.AI_MODEL || 'gpt-4.1';

    return new AIChatHandler({
        modelName,
        conversationStore: createConversationStore(),
        ...options,
    });
}

export default AIChatHandler;
