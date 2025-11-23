import express from 'express';
import cors from 'cors';
import * as imessage from './index.js';
import { createGroupChat } from './createGroupChat.js';
import { execSync } from 'child_process';
import { createAIChatHandler } from './lib/ai-chat-handler.js';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const app = express();
const PORT = process.env.PORT || 5173;

// Create HTTP server from Express app
const server = createServer(app);

// Initialize AI handler for API endpoints (with error handling)
let aiHandler = null;
try {
    aiHandler = createAIChatHandler();
} catch (error) {
    console.warn('⚠️  AI Handler initialization failed:', error.message);
    console.warn('⚠️  AI endpoints will not be available');
}

// Middleware
app.use(cors());
app.use(express.json());

// WebSocket Server Setup
const wss = new WebSocketServer({ server });

console.log('🔌 WebSocket server initialized');

wss.on('connection', (ws, req) => {
    console.log('🔌 New WebSocket client connected');
    
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data.toString());
            console.log('📨 WebSocket message received:', message.type);
            
            if (message.type === 'process') {
                await handleWebSocketProcessing(ws, message.context);
            } else {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Unknown message type. Use "process" to process context.'
                }));
            }
        } catch (error) {
            console.error('❌ WebSocket message error:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid JSON message'
            }));
        }
    });
    
    ws.on('close', () => {
        console.log('🔌 WebSocket client disconnected');
    });
    
    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
    });
    
    // Send welcome message
    ws.send(JSON.stringify({
        type: 'connected',
        message: 'Connected to iMessage AI service',
        timestamp: new Date().toISOString()
    }));
});

/**
 * Handle WebSocket context processing with real-time streaming
 */
async function handleWebSocketProcessing(ws, context) {
    if (!aiHandler) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'AI handler not available - check OPENAI_API_KEY'
        }));
        return;
    }

    if (!context) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Context is required',
            example: {
                situation: 'urgent_notification',
                lawyer: { name: 'John Smith', phone: '+16503871302' },
                message: 'Client called about contract dispute'
            }
        }));
        return;
    }

    try {
        // Send processing started event
        ws.send(JSON.stringify({
            type: 'started',
            message: 'Processing context with AI...',
            context: context,
            timestamp: new Date().toISOString()
        }));

        // Process context with streaming callback
        const result = await aiHandler.processContextWithStreaming(context, (update) => {
            ws.send(JSON.stringify({
                ...update,
                timestamp: new Date().toISOString()
            }));
        });

        // Send final completion event
        ws.send(JSON.stringify({
            type: 'completed',
            success: result.success,
            reasoning: result.reasoning,
            actionsExecuted: result.actionsExecuted,
            thinkingSteps: result.thinkingSteps,
            timestamp: new Date().toISOString()
        }));

    } catch (error) {
        console.error('❌ WebSocket processing error:', error);
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to process context',
            details: error.message,
            timestamp: new Date().toISOString()
        }));
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'iMessage API server is running',
        ai: {
            enabled: process.env.AI_ENABLED !== 'false',
            model: process.env.AI_MODEL || 'gpt-4o-mini'
        }
    });
});

// AI Chat Endpoints

// Process a conversation manually
app.post('/ai/process-conversation', async (req, res) => {
    try {
        if (!aiHandler) {
            return res.status(503).json({
                error: 'AI handler not available - check OPENAI_API_KEY',
                details: 'AI features require a valid OpenAI API key'
            });
        }

        const { handle, customPrompt } = req.body;
        
        if (!handle) {
            return res.status(400).json({
                error: 'handle is required',
                example: {
                    handle: '+1234567890',
                    customPrompt: 'Optional custom prompt for this processing'
                }
            });
        }

        console.log(`🤖 API: Processing conversation for ${handle}`);
        
        const result = await aiHandler.processConversation(handle, customPrompt);
        
        res.json({
            success: true,
            handle,
            aiResponse: result.text,
            toolCalls: result.toolCalls || [],
            toolResults: result.toolResults || [],
            usage: result.usage
        });
        
    } catch (error) {
        console.error('Error processing conversation:', error);
        res.status(500).json({
            error: 'Failed to process conversation',
            details: error.message
        });
    }
});

// Get conversation status
app.get('/ai/conversation/:handle', async (req, res) => {
    try {
        const { handle } = req.params;
        
        console.log(`📊 API: Getting conversation status for ${handle}`);
        
        const status = await aiHandler.getConversationStatus(handle);
        
        res.json({
            success: true,
            ...status
        });
        
    } catch (error) {
        console.error('Error getting conversation status:', error);
        res.status(500).json({
            error: 'Failed to get conversation status',
            details: error.message
        });
    }
});

// Clear conversation history
app.delete('/ai/conversation/:handle', async (req, res) => {
    try {
        const { handle } = req.params;
        
        console.log(`🧹 API: Clearing conversation for ${handle}`);
        
        await aiHandler.clearConversation(handle);
        
        res.json({
            success: true,
            message: `Conversation history cleared for ${handle}`,
            handle
        });
        
    } catch (error) {
        console.error('Error clearing conversation:', error);
        res.status(500).json({
            error: 'Failed to clear conversation',
            details: error.message
        });
    }
});

// Get recent conversations
app.get('/ai/conversations', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        
        console.log(`📋 API: Getting recent conversations (limit: ${limit})`);
        
        const conversations = await aiHandler.getRecentConversations(limit);
        
        res.json({
            success: true,
            conversations,
            count: conversations.length
        });
        
    } catch (error) {
        console.error('Error getting recent conversations:', error);
        res.status(500).json({
            error: 'Failed to get recent conversations',
            details: error.message
        });
    }
});

// Manually send message through AI (for testing)
app.post('/ai/send-message', async (req, res) => {
    try {
        const { handle, message: messageText } = req.body;
        
        if (!handle || !messageText) {
            return res.status(400).json({
                error: 'Both handle and message are required',
                example: {
                    handle: '+1234567890',
                    message: 'Hello from AI!'
                }
            });
        }

        console.log(`🤖 API: AI sending message to ${handle}: "${messageText}"`);
        
        // Create a mock message object for AI processing
        const mockMessage = {
            handle,
            text: messageText,
            group: null,
            fromMe: false,
            date: new Date(),
            guid: `api-${Date.now()}`
        };

        const result = await aiHandler.handleIncomingMessage(mockMessage);
        
        res.json({
            success: true,
            message: 'Message processed by AI',
            handle,
            originalMessage: messageText,
            aiResponse: result.aiResponse,
            toolCalls: result.toolCalls || [],
            toolResults: result.toolResults || []
        });
        
    } catch (error) {
        console.error('Error sending message through AI:', error);
        res.status(500).json({
            error: 'Failed to send message through AI',
            details: error.message
        });
    }
});

// Update AI system prompt
app.post('/ai/system-prompt', async (req, res) => {
    try {
        const { prompt } = req.body;
        
        if (!prompt) {
            return res.status(400).json({
                error: 'prompt is required',
                example: {
                    prompt: 'You are a helpful assistant that manages iMessage conversations...'
                }
            });
        }

        console.log(`📝 API: Updating AI system prompt`);
        
        aiHandler.updateSystemPrompt(prompt);
        
        res.json({
            success: true,
            message: 'System prompt updated successfully',
            prompt
        });
        
    } catch (error) {
        console.error('Error updating system prompt:', error);
        res.status(500).json({
            error: 'Failed to update system prompt',
            details: error.message
        });
    }
});

// External LLM API Endpoints (recommended for external services)

// SMART SEND - Auto-detects new vs existing contact and handles appropriately
app.post('/api/smart-send', async (req, res) => {
    try {
        const { phoneNumber, message, forceNewContact = false } = req.body;
        
        // Validate input
        if (!phoneNumber || !message) {
            return res.status(400).json({
                error: 'Both phoneNumber and message are required',
                example: {
                    phoneNumber: '+1234567890',
                    message: 'Hello from external API!',
                    forceNewContact: false
                }
            });
        }

        console.log(`🚀 API: Smart sending message to ${phoneNumber}: "${message}"`);
        
        let method;
        let success = false;
        
        if (forceNewContact) {
            // Force new contact method
            console.log('📞 Using new contact method (forced)');
            const appleScript = `
            tell application "Messages"
                set serviceID to id of 1st service whose service type = iMessage
                send "" to buddy "${phoneNumber}" of service id serviceID
                send "${message.replace(/"/g, '\\"')}" to buddy "${phoneNumber}" of service id serviceID
            end tell
            `;
            
            execSync(`osascript -e '${appleScript}'`);
            method = 'new-contact-forced';
            success = true;
        } else {
            // Always use AppleScript with explicit iMessage service for consistent blue messages
            console.log('📱 Using AppleScript method with explicit iMessage service...');
            const appleScript = `
            tell application "Messages"
                set serviceID to id of 1st service whose service type = iMessage
                send "${message.replace(/"/g, '\\"')}" to buddy "${phoneNumber}" of service id serviceID
            end tell
            `;
            
            execSync(`osascript -e '${appleScript}'`);
            method = 'existing-contact-applescript';
            success = true;
        }
        
        res.json({
            success: true,
            message: 'Message sent successfully',
            to: phoneNumber,
            content: message,
            method,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Error in smart send:', error);
        res.status(500).json({
            error: 'Failed to send message',
            details: error.message
        });
    }
});

// TALENT SEARCH - Find experts and professionals
app.post('/api/search-talent', async (req, res) => {
    try {
        const { query, topResults = 3 } = req.body;
        
        if (!query) {
            return res.status(400).json({
                error: 'query is required',
                example: {
                    query: 'Chinese manufacturing partners',
                    topResults: 3
                }
            });
        }

        console.log(`🔍 API: Searching for talent: "${query}"`);
        
        const apiUrl = 'https://connectus-backend-1092093853782.us-central1.run.app/api/talent/search';
        const requestBody = {
            query: query,
            userEmail: 'alex.chen@citrussqueeze.com',
            top_k: Math.min(Math.max(topResults, 1), 10)
        };
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            throw new Error(`Talent search API failed: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.success && data.results && data.results.length > 0) {
            const formattedResults = data.results.map(person => ({
                name: person.name,
                title: person.title,
                company: person.company,
                industry: person.industry,
                location: person.location,
                email: person.email,
                phone: person.phone,
                expertise: person.profileContext?.substring(0, 200) + '...',
                connectionContext: person.connectionContext || person.connection_context || 'Connection details not available'
            }));
            
            console.log(`✅ Found ${formattedResults.length} talent matches`);
            
            res.json({
                success: true,
                query,
                results: formattedResults,
                count: formattedResults.length,
                timestamp: new Date().toISOString()
            });
        } else {
            res.json({
                success: true,
                query,
                results: [],
                count: 0,
                message: `No experts found matching "${query}"`,
                timestamp: new Date().toISOString()
            });
        }
        
    } catch (error) {
        console.error('❌ Error searching for talent:', error);
        res.status(500).json({
            error: 'Failed to search for talent',
            details: error.message
        });
    }
});

// PROCESS CONTEXT - Analyze situational context and execute appropriate messaging actions
app.post('/api/process-context', async (req, res) => {
    try {
        if (!aiHandler) {
            return res.status(503).json({
                error: 'AI handler not available - check OPENAI_API_KEY',
                details: 'AI features require a valid OpenAI API key'
            });
        }

        const { context } = req.body;
        
        if (!context) {
            return res.status(400).json({
                error: 'context is required',
                example: {
                    context: {
                        situation: 'client_call_completed',
                        lawyer: { name: 'John Smith', phone: '+16503871302' },
                        client: { name: 'Sarah Johnson', phone: '+15551234567' },
                        summary: 'Contract dispute needs urgent review',
                        actionPoints: ['Review contract by Friday', 'Schedule follow-up']
                    }
                }
            });
        }

        console.log(`🚀 API: Processing context for situational messaging`);
        
        const result = await aiHandler.processContext(context);
        
        res.json({
            success: result.success,
            context: context,
            reasoning: result.reasoning,
            thinkingSteps: result.thinkingSteps || [],
            actionsExecuted: result.actionsExecuted || [],
            timestamp: new Date().toISOString(),
            ...(result.error && { error: result.error })
        });
        
    } catch (error) {
        console.error('❌ Error processing context:', error);
        res.status(500).json({
            error: 'Failed to process context',
            details: error.message
        });
    }
});

// Regular Message Endpoints (existing)

// Send message to NEW phone number (no existing thread) - uses empty string workaround
app.post('/send-to-new-number', async (req, res) => {
    try {
        const { phoneNumber, message } = req.body;
        
        // Validate input
        if (!phoneNumber || !message) {
            return res.status(400).json({
                error: 'Both phoneNumber and message are required',
                example: {
                    phoneNumber: '+1234567890',
                    message: 'Hello from API!'
                }
            });
        }

        console.log(`Sending message to NEW number ${phoneNumber}: ${message}`);
        
        // Use the empty string workaround method for new contacts
        const appleScript = `
        tell application "Messages"
            set serviceID to id of 1st service whose service type = iMessage
            send "" to buddy "${phoneNumber}" of service id serviceID
            send "${message.replace(/"/g, '\\"')}" to buddy "${phoneNumber}" of service id serviceID
        end tell
        `;
        
        execSync(`osascript -e '${appleScript}'`);
        
        res.json({
            success: true,
            message: 'Message sent successfully to new number',
            to: phoneNumber,
            content: message,
            method: 'empty-string-workaround'
        });
        
    } catch (error) {
        console.error('Error sending message to new number:', error);
        res.status(500).json({
            error: 'Failed to send message to new number',
            details: error.message
        });
    }
});

// Send message to EXISTING contact/thread - uses standard library method
app.post('/send-message', async (req, res) => {
    try {
        const { phoneNumber, message } = req.body;
        
        // Validate input
        if (!phoneNumber || !message) {
            return res.status(400).json({
                error: 'Both phoneNumber and message are required',
                example: {
                    phoneNumber: '+1234567890',
                    message: 'Hello from API!'
                }
            });
        }

        console.log(`Sending message to existing contact ${phoneNumber}: ${message}`);
        
        await imessage.send(phoneNumber, message);
        
        res.json({
            success: true,
            message: 'Message sent successfully to existing contact',
            to: phoneNumber,
            content: message,
            method: 'standard-library'
        });
        
    } catch (error) {
        console.error('Error sending message to existing contact:', error);
        res.status(500).json({
            error: 'Failed to send message to existing contact',
            details: error.message
        });
    }
});

// Create new group chat endpoint
app.post('/create-group-chat', async (req, res) => {
    try {
        const { phoneNumber1, phoneNumber2, message } = req.body;
        
        // Validate input
        if (!phoneNumber1 || !phoneNumber2 || !message) {
            return res.status(400).json({
                error: 'phoneNumber1, phoneNumber2, and message are all required',
                example: {
                    phoneNumber1: '+19166930389',
                    phoneNumber2: '+15127918242',
                    message: 'Welcome to our new group chat!'
                }
            });
        }

        // Validate that phone numbers are different
        if (phoneNumber1 === phoneNumber2) {
            return res.status(400).json({
                error: 'Phone numbers must be different',
                provided: {
                    phoneNumber1,
                    phoneNumber2
                }
            });
        }

        console.log(`Creating group chat with ${phoneNumber1} and ${phoneNumber2}: ${message}`);
        
        const result = await createGroupChat(phoneNumber1, phoneNumber2, message);
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Group chat created successfully',
                phoneNumber1: result.phoneNumber1,
                phoneNumber2: result.phoneNumber2,
                messageText: result.messageText,
                method: 'system-control-macros'
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to create group chat',
                details: result.message
            });
        }
        
    } catch (error) {
        console.error('Error creating group chat:', error);
        res.status(500).json({
            error: 'Failed to create group chat',
            details: error.message
        });
    }
});

// Send file endpoint
app.post('/send-file', async (req, res) => {
    try {
        const { handle, filepath } = req.body;
        
        if (!handle || !filepath) {
            return res.status(400).json({
                error: 'Both handle and filepath are required',
                example: {
                    handle: '+1234567890',
                    filepath: '/path/to/file.jpg'
                }
            });
        }

        console.log(`Sending file to ${handle}: ${filepath}`);
        
        await imessage.sendFile(handle, filepath);
        
        res.json({
            success: true,
            message: 'File sent successfully',
            to: handle,
            file: filepath
        });
        
    } catch (error) {
        console.error('Error sending file:', error);
        res.status(500).json({
            error: 'Failed to send file',
            details: error.message
        });
    }
});

// Get name for handle endpoint
app.get('/name/:handle', async (req, res) => {
    try {
        const { handle } = req.params;
        
        const name = await imessage.nameForHandle(handle);
        
        res.json({
            handle,
            name
        });
        
    } catch (error) {
        console.error('Error getting name for handle:', error);
        res.status(500).json({
            error: 'Failed to get name for handle',
            details: error.message
        });
    }
});

// Get handle for name endpoint
app.get('/handle/:name', async (req, res) => {
    try {
        const { name } = req.params;
        
        const handle = await imessage.handleForName(name);
        
        res.json({
            name,
            handle
        });
        
    } catch (error) {
        console.error('Error getting handle for name:', error);
        res.status(500).json({
            error: 'Failed to get handle for name',
            details: error.message
        });
    }
});

// Get recent chats endpoint
app.get('/recent-chats', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        
        const chats = await imessage.getRecentChats(limit);
        
        res.json({
            chats,
            count: chats.length
        });
        
    } catch (error) {
        console.error('Error getting recent chats:', error);
        res.status(500).json({
            error: 'Failed to get recent chats',
            details: error.message
        });
    }
});

// API documentation endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'iMessage API Server with AI',
        version: '2.0.0',
        endpoints: {
            // External LLM API Endpoints (RECOMMENDED for external services)
            'POST /api/smart-send': 'Smart send - Auto-detects new vs existing contact',
            'POST /api/search-talent': 'Search for experts and professionals',
            'POST /api/process-context': 'Process situational context for messaging',
            
            // AI Endpoints
            'POST /ai/process-conversation': 'Manually process a conversation with AI',
            'GET /ai/conversation/:handle': 'Get conversation status and history',
            'DELETE /ai/conversation/:handle': 'Clear conversation history',
            'GET /ai/conversations?limit=10': 'Get recent conversations',
            'POST /ai/send-message': 'Send message through AI processing',
            'POST /ai/system-prompt': 'Update AI system prompt',
            
            // Regular Endpoints
            'GET /health': 'Health check with AI status',
            'POST /send-to-new-number': 'Send message to NEW phone number (no existing thread)',
            'POST /send-message': 'Send message to EXISTING contact/thread',
            'POST /create-group-chat': 'Create new group chat with 2 other people',
            'POST /send-file': 'Send file to contact',
            'GET /name/:handle': 'Get display name for handle',
            'GET /handle/:name': 'Get handle for display name',
            'GET /recent-chats?limit=10': 'Get recent chats'
        },
        examples: {
            // RECOMMENDED for external LLMs
            smartSend: {
                url: 'POST /api/smart-send',
                body: {
                    phoneNumber: '+1234567890',
                    message: 'Urgent: Please call me about the contract ASAP!'
                }
            },
            searchTalent: {
                url: 'POST /api/search-talent',
                body: {
                    query: 'Chinese manufacturing partners',
                    topResults: 3
                }
            },
            processContext: {
                url: 'POST /api/process-context',
                body: {
                    context: {
                        situation: 'client_call_completed',
                        lawyer: { name: 'John Smith', phone: '+16503871302' }, // emilies number
                        client: { name: 'Sarah Johnson', phone: '+16465483808' }, // jesse's number
                        summary: 'Contract dispute needs urgent review',
                        actionPoints: ['Review contract by Friday', 'Schedule follow-up']
                    }
                }
            },
            
            // AI endpoints
            aiProcessConversation: {
                url: 'POST /ai/process-conversation',
                body: {
                    handle: '+1234567890',
                    customPrompt: 'Review this conversation and send a follow-up if needed'
                }
            },
            aiSendMessage: {
                url: 'POST /ai/send-message',
                body: {
                    handle: '+1234567890',
                    message: 'Hey, how are you?'
                }
            },
            sendToNewNumber: {
                url: 'POST /send-to-new-number',
                body: {
                    phoneNumber: '+1234567890',
                    message: 'Hello! First message to this new number.'
                }
            },
            sendToExisting: {
                url: 'POST /send-message',
                body: {
                    phoneNumber: '+1234567890',
                    message: 'Hello again! Message to existing contact.'
                }
            },
            createGroupChat: {
                url: 'POST /create-group-chat',
                body: {
                    phoneNumber1: '+19166930389',
                    phoneNumber2: '+15127918242',
                    message: 'Welcome to our new group chat!'
                }
            }
        },
        ai: {
            enabled: process.env.AI_ENABLED !== 'false',
            model: process.env.AI_MODEL || 'gpt-4o-mini',
            storage: process.env.CONVERSATION_STORE_TYPE || 'memory'
        }
    });
});

// Start server with WebSocket support
server.listen(PORT, () => {
    console.log(`iMessage API server with AI running on port ${PORT}`);
    console.log(`HTTP API: http://localhost:${PORT}`);
    console.log(`WebSocket: ws://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`API documentation: http://localhost:${PORT}/`);
    console.log(`AI enabled: ${process.env.AI_ENABLED !== 'false'}`);
    console.log(`🔌 WebSocket server ready for connections`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    process.exit(0);
}); 