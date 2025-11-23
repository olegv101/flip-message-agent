import { MongoClient } from 'mongodb';
import chalk from 'chalk';

/**
 * MongoDB Conversation Store - Manages chat history and context per user
 * Stores conversations in MongoDB with phone number as the key
 */
class ConversationStore {
    constructor(options = {}) {
        this.type = options.type || 'mongodb';
        this.conversations = new Map(); // In-memory fallback/cache
        this.client = null;
        this.db = null;
        this.collection = null;
        this.isConnected = false;
        
        // MongoDB connection settings
        this.connectionString = options.mongoUrl || process.env.MONGO_URL || 'mongodb://localhost:27017';
        this.databaseName = options.databaseName || 'connectus_chats';
        this.collectionName = options.collectionName || 'chats';
        
        // Initialize MongoDB connection
        this.initMongoDB();
    }

    /**
     * Initialize MongoDB connection
     */
    async initMongoDB() {
        try {
            console.log(chalk.blue('🔄 Attempting MongoDB connection...'));
            console.log(chalk.blue(`📍 Connection string: ${this.connectionString.replace(/:[^:@]*@/, ':****@')}`));
            console.log(chalk.blue(`📍 Database: ${this.databaseName}, Collection: ${this.collectionName}`));
            
            this.client = new MongoClient(this.connectionString);
            await this.client.connect();
            this.db = this.client.db(this.databaseName);
            this.collection = this.db.collection(this.collectionName);
            this.isConnected = true;
            
            // Create index on handle for better performance
            await this.collection.createIndex({ handle: 1 }, { unique: true });
            
            console.log(chalk.green('✅ MongoDB connected successfully'));
            console.log(chalk.blue(`📍 Database: ${this.databaseName}, Collection: ${this.collectionName}`));
        } catch (error) {
            console.error(chalk.red('❌ MongoDB connection failed:'), error.message);
            console.error(chalk.red('❌ Full error:'), error);
            console.warn(chalk.yellow('🔄 Falling back to memory storage'));
            this.isConnected = false;
        }
    }

    /**
     * Get conversation history for a user (phone number)
     */
    async getConversation(handle) {
        if (this.isConnected) {
            try {
                const doc = await this.collection.findOne({ handle });
                
                if (doc) {
                    return {
                        messages: doc.messages || [],
                        context: doc.context || {},
                        lastActivity: new Date(doc.lastActivity)
                    };
                }
                
                return this._createEmptyConversation();
            } catch (error) {
                console.warn(chalk.yellow('⚠️ MongoDB read error, using memory:'), error.message);
                return this._getMemoryConversation(handle);
            }
        }
        
        return this._getMemoryConversation(handle);
    }

    /**
     * Save conversation history for a user
     */
    async saveConversation(handle, messages, context = {}) {
        const conversationData = {
            handle,
            messages,
            context,
            lastActivity: new Date(),
            updatedAt: new Date()
        };

        // Always update memory cache
        this.conversations.set(handle, conversationData);

        if (this.isConnected) {
            try {
                await this.collection.replaceOne(
                    { handle },
                    conversationData,
                    { upsert: true }
                );
                
                console.log(chalk.green(`💾 Saved conversation for ${handle} (${messages.length} messages)`));
            } catch (error) {
                console.warn(chalk.yellow('⚠️ MongoDB save error:'), error.message);
            }
        }

        return conversationData;
    }

    /**
     * Add a new message to the conversation
     */
    async addMessage(handle, role, content, toolCalls = null, toolResults = null) {
        const conversation = await this.getConversation(handle);
        
        const message = {
            role,
            content,
            timestamp: new Date().toISOString()
        };

        if (toolCalls) message.toolCalls = toolCalls;
        if (toolResults) message.toolResults = toolResults;

        conversation.messages.push(message);

        // Keep last 100 messages to prevent unlimited growth
        if (conversation.messages.length > 100) {
            conversation.messages = conversation.messages.slice(-100);
        }

        console.log(chalk.blue(`📨 Adding ${role} message for ${handle}: "${content.substring(0, 50)}..."`));

        await this.saveConversation(handle, conversation.messages, conversation.context);
        return conversation;
    }

    /**
     * Update context for a user (preferences, state, etc.)
     */
    async updateContext(handle, newContext) {
        const conversation = await this.getConversation(handle);
        conversation.context = { ...conversation.context, ...newContext };
        await this.saveConversation(handle, conversation.messages, conversation.context);
        return conversation;
    }

    /**
     * Clear conversation history for a user
     */
    async clearConversation(handle) {
        this.conversations.delete(handle);
        
        if (this.isConnected) {
            try {
                await this.collection.deleteOne({ handle });
                console.log(chalk.yellow(`🗑️ Cleared conversation for ${handle}`));
            } catch (error) {
                console.warn(chalk.yellow('⚠️ MongoDB delete error:'), error.message);
            }
        }
    }

    /**
     * Get recent conversations (for admin/debugging)
     */
    async getRecentConversations(limit = 10) {
        if (this.isConnected) {
            try {
                const conversations = await this.collection
                    .find({})
                    .sort({ lastActivity: -1 })
                    .limit(limit)
                    .project({ handle: 1, lastActivity: 1, context: 1 })
                    .toArray();

                return conversations.map(conv => ({
                    handle: conv.handle,
                    last_activity: conv.lastActivity,
                    context: conv.context,
                    messageCount: conv.messages ? conv.messages.length : 0
                }));
            } catch (error) {
                console.warn(chalk.yellow('⚠️ MongoDB query error:'), error.message);
            }
        }

        // Memory fallback
        return Array.from(this.conversations.entries())
            .map(([handle, conv]) => ({
                handle,
                last_activity: conv.lastActivity,
                context: conv.context,
                messageCount: conv.messages ? conv.messages.length : 0
            }))
            .sort((a, b) => b.last_activity - a.last_activity)
            .slice(0, limit);
    }

    /**
     * Get conversation statistics
     */
    async getStats() {
        if (this.isConnected) {
            try {
                const totalConversations = await this.collection.countDocuments();
                const pipeline = [
                    {
                        $group: {
                            _id: null,
                            totalMessages: { $sum: { $size: '$messages' } },
                            avgMessages: { $avg: { $size: '$messages' } }
                        }
                    }
                ];
                
                const stats = await this.collection.aggregate(pipeline).toArray();
                
                return {
                    totalConversations,
                    totalMessages: stats[0]?.totalMessages || 0,
                    avgMessages: Math.round(stats[0]?.avgMessages || 0),
                    isConnected: this.isConnected
                };
            } catch (error) {
                console.warn(chalk.yellow('⚠️ MongoDB stats error:'), error.message);
            }
        }

        return {
            totalConversations: this.conversations.size,
            totalMessages: 0,
            avgMessages: 0,
            isConnected: false
        };
    }

    /**
     * Cleanup and close connections
     */
    async close() {
        if (this.client) {
            await this.client.close();
            this.isConnected = false;
            console.log(chalk.yellow('👋 MongoDB connection closed'));
        }
    }

    // Private methods
    _getMemoryConversation(handle) {
        return this.conversations.get(handle) || this._createEmptyConversation();
    }

    _createEmptyConversation() {
        return {
            messages: [],
            context: {},
            lastActivity: new Date()
        };
    }
}

// Factory function to create store with environment-based config
export function createConversationStore(options = {}) {
    const config = {
        type: 'mongodb',
        mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017',
        databaseName: process.env.MONGO_DB_NAME || 'connectus_chats',
        collectionName: process.env.MONGO_COLLECTION_NAME || 'chats',
        ...options
    };

    return new ConversationStore(config);
}

export default ConversationStore; 