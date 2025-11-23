import { tool } from 'ai';
import { z } from 'zod';
import * as imessage from '../index.js';
import { createGroupChat } from '../createGroupChat.js';
import { execSync } from 'child_process';
import { ethers } from 'ethers';
import axios from 'axios';
import { privateKeyToAccount } from 'viem/accounts';
import { wrapFetchWithPayment } from 'x402-fetch';
import { priceMonitor } from './price-monitor.js';

/**
 * LLM Tools - Function calling capabilities for the AI assistant
 * Uses AI SDK's tool helper for type-safe tool definitions
 */

export const checkTokenPrice = tool({
    description: 'Check the current price of a cryptocurrency token. Use this when a user asks for the price of a token like BTC, ETH, SOL, etc.',
    parameters: z.object({
        symbol: z.enum([
            "BTC/USD","ETH/USD","SOL/USD","BNB/USD","AVAX/USD","MATIC/USD",
            "ARB/USD","OP/USD","DOGE/USD","ADA/USD","DOT/USD","LINK/USD",
            "UNI/USD","ATOM/USD","XRP/USD","LTC/USD","APT/USD","SUI/USD",
            "TRX/USD","NEAR/USD"
        ]).describe('The token symbol pair. MUST be one of the supported pairs.'),
        reasoning: z.string().describe('Why you are checking this price')
    }),
    execute: async ({ symbol, reasoning }) => {
        try {
            // Ensure symbol has /USD if not present (though enum enforces it, good to be safe)
            if (!symbol.includes('/')) {
                symbol = `${symbol.toUpperCase()}/USD`;
            } else {
                symbol = symbol.toUpperCase();
            }
            
            console.log(`💰 AI checking price for ${symbol} (Reason: ${reasoning})`);
            
            const baseUrl = 'https://applaudable-unspeckled-kimberley.ngrok-free.dev';
            const response = await axios.get(`${baseUrl}/api/price/${symbol}`);
            
            if (response.data.success) {
                return {
                    success: true,
                    action: 'price_check_completed',
                    symbol: response.data.symbol,
                    price: response.data.price,
                    timestamp: response.data.timestamp,
                    reasoning,
                    message: `The current price of ${response.data.symbol} is $${response.data.price}`
                };
            } else {
                throw new Error(response.data.error || 'Unknown API error');
            }
        } catch (error) {
            console.error('Error checking token price:', error);
            return {
                success: false,
                error: error.message,
                action: 'price_check_failed',
                symbol
            };
        }
    }
});

export const monitorTokenAndBuy = tool({
    description: 'Start monitoring a token price and automatically buy a Shopify product when it drops below a threshold. Use this when a user says "buy X when Y hits Z price" or similar conditional purchase requests.',
    parameters: z.object({
        symbol: z.enum([
            "BTC/USD","ETH/USD","SOL/USD","BNB/USD","AVAX/USD","MATIC/USD",
            "ARB/USD","OP/USD","DOGE/USD","ADA/USD","DOT/USD","LINK/USD",
            "UNI/USD","ATOM/USD","XRP/USD","LTC/USD","APT/USD","SUI/USD",
            "TRX/USD","NEAR/USD"
        ]).describe('The token symbol to monitor. MUST be one of the supported pairs.'),
        threshold: z.number().describe('The price threshold in USD to trigger the buy. If the price drops BELOW this, the purchase triggers.'),
        productUrl: z.string().describe('The Shopify product URL to buy'),
        size: z.string().default('Any').describe('The size/variant to buy (e.g., "Medium", "Large", "US 10")'),
        reasoning: z.string().describe('Why you are setting up this monitor')
    }),
    execute: async ({ symbol, threshold, productUrl, size, reasoning }) => {
        try {
            // Ensure symbol has /USD if not present
            if (!symbol.includes('/')) {
                symbol = `${symbol.toUpperCase()}/USD`;
            } else {
                symbol = symbol.toUpperCase();
            }

            const userHandle = global.currentMessageHandle || 'unknown';
            console.log(`🛡️ AI setting up monitor for ${userHandle}: Buy ${productUrl} when ${symbol} < ${threshold} (Reason: ${reasoning})`);

            const result = await priceMonitor.startMonitoring(symbol, threshold, userHandle, productUrl, size);

            return {
                success: true,
                action: 'monitor_started',
                session_id: result.session_id,
                symbol,
                threshold,
                productUrl,
                size,
                reasoning,
                message: `I've set up a monitor for ${symbol}. If it drops below $${threshold}, I'll automatically buy the item for you.`
            };

        } catch (error) {
            console.error('Error setting up price monitor:', error);
            return {
                success: false,
                error: error.message,
                action: 'monitor_setup_failed',
                symbol,
                threshold
            };
        }
    }
});

export const sendMessage = tool({
    description: 'Send a reply message to the person who just messaged you. Use this when you want to respond to someone.',
    parameters: z.object({
        message: z.string().describe('The message content to send back to the user'),
        reasoning: z.string().describe('Why you decided to send this message now (for logging)')
    }),
    execute: async ({ message, reasoning }) => {
        try {
            // MESSAGE DELAY - Add 2 second delay to make responses feel smooth
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // The handle will be injected by the AI handler from the current conversation context
            const handle = global.currentMessageHandle || 'unknown';
            console.log(`🤖 AI sending reply to ${handle}: "${message}" (Reason: ${reasoning})`);
            
            // Use AppleScript with explicit iMessage service to ensure blue messages
            // No "activate" command means it runs in background without switching windows
            const appleScript = `
            tell application "Messages"
                set serviceID to id of 1st service whose service type = iMessage
                send "${message.replace(/"/g, '\\"')}" to buddy "${handle}" of service id serviceID
            end tell
            `;
            
            execSync(`osascript -e '${appleScript}'`);
            
            return {
                success: true,
                content: message,
                action: 'message_sent',
                to: handle,
                reasoning
            };
        } catch (error) {
            console.error('Error sending message:', error);
            return {
                success: false,
                error: error.message,
                action: 'message_failed'
            };
        }
    }
});

export const sendToSpecificContact = tool({
    description: 'Send a message to a specific phone number (use this if you need to message someone other than the current conversation partner).',
    parameters: z.object({
        phoneNumber: z.string().describe('The phone number to send to (must include country code like +1)'),
        message: z.string().describe('The message content to send'),
        reasoning: z.string().describe('Why you decided to message this specific person'),
        isNewContact: z.boolean().default(false).describe('True if this is a new contact, false for existing')
    }),
    execute: async ({ phoneNumber, message, reasoning, isNewContact }) => {
        try {
            // MESSAGE DELAY - Add 2 second delay to make responses feel more natural
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            console.log(`🤖 AI sending to ${isNewContact ? 'NEW' : 'existing'} contact ${phoneNumber}: "${message}" (Reason: ${reasoning})`);
            
            // Always use AppleScript with explicit iMessage service for consistent blue messages
            // No "activate" command means it runs in background without switching windows
            if (isNewContact) {
                // Use the empty string workaround method for new contacts
                const appleScript = `
                tell application "Messages"
                    set serviceID to id of 1st service whose service type = iMessage
                    send "" to buddy "${phoneNumber}" of service id serviceID
                    send "${message.replace(/"/g, '\\"')}" to buddy "${phoneNumber}" of service id serviceID
                end tell
                `;
                
                execSync(`osascript -e '${appleScript}'`);
            } else {
                // Use same AppleScript method for existing contacts to ensure iMessage
                const appleScript = `
                tell application "Messages"
                    set serviceID to id of 1st service whose service type = iMessage
                    send "${message.replace(/"/g, '\\"')}" to buddy "${phoneNumber}" of service id serviceID
                end tell
                `;
                
                execSync(`osascript -e '${appleScript}'`);
            }
            
            return {
                success: true,
                action: isNewContact ? 'new_contact_messaged' : 'message_sent',
                to: phoneNumber,
                content: message,
                reasoning
            };
        } catch (error) {
            console.error('Error sending to specific contact:', error);
            return {
                success: false,
                error: error.message,
                action: 'specific_contact_failed'
            };
        }
    }
});

export const createGroupChatTool = tool({
    description: 'Create a new group chat with 2 other people (3 total including you). Only use this when explicitly asked to create a group.',
    parameters: z.object({
        phoneNumber1: z.string().describe('First person\'s phone number'),
        phoneNumber2: z.string().describe('Second person\'s phone number'),
        message: z.string().describe('Initial message to send to the group'),
        reasoning: z.string().describe('Why you decided to create this group chat')
    }),
    execute: async ({ phoneNumber1, phoneNumber2, message, reasoning }) => {
        try {
            // MESSAGE DELAY - Add 2 second delay to make responses feel more natural
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            console.log(`🤖 AI creating group chat with ${phoneNumber1} and ${phoneNumber2}: "${message}" (Reason: ${reasoning})`);
            
            if (phoneNumber1 === phoneNumber2) {
                throw new Error('Phone numbers must be different');
            }
            
            const result = await createGroupChat(phoneNumber1, phoneNumber2, message);
            
            return {
                success: result.success,
                action: 'group_chat_created',
                phoneNumber1,
                phoneNumber2,
                message,
                reasoning,
                details: result
            };
        } catch (error) {
            console.error('Error creating group chat:', error);
            return {
                success: false,
                error: error.message,
                action: 'group_chat_failed'
            };
        }
    }
});

export const getConversationHistory = tool({
    description: 'Get recent message history with a specific contact. Use this to understand context of ongoing conversations.',
    parameters: z.object({
        handle: z.string().describe('The phone number or handle to get history for'),
        limit: z.number().default(10).describe('Number of recent messages to retrieve')
    }),
    execute: async ({ handle, limit }) => {
        try {
            // This would integrate with your conversation store
            // For now, returning a placeholder that indicates the capability
            console.log(`🤖 AI checking history for ${handle} (last ${limit} messages)`);
            
            return {
                success: true,
                action: 'history_retrieved',
                handle,
                messages: [], // This would be populated from conversation store
                note: 'History retrieval capability - would integrate with conversation store'
            };
        } catch (error) {
            console.error('Error getting conversation history:', error);
            return {
                success: false,
                error: error.message,
                action: 'history_failed'
            };
        }
    }
});

export const skipResponse = tool({
    description: 'Skip sending a response to the user. Use this ONLY when you genuinely should not respond (e.g., waiting for more context, user said something that doesn\'t need a reply). By default, your text response will be sent automatically.',
    parameters: z.object({
        reasoning: z.string().describe('Why you decided not to respond to this message')
    }),
    execute: async ({ reasoning }) => {
        console.log(`🤖 AI skipping response. Reason: ${reasoning}`);
        
        return {
            success: true,
            action: 'response_skipped',
            reasoning,
            status: 'The AI decided not to send a response'
        };
    }
});

export const waitForMoreInput = tool({
    description: 'Wait for more input from the user before responding. This will skip the automatic response. Use when you need more information.',
    parameters: z.object({
        reasoning: z.string().describe('Why you decided to wait instead of responding immediately'),
        expectation: z.string().describe('What kind of follow-up you\'re expecting from the user')
    }),
    execute: async ({ reasoning, expectation }) => {
        console.log(`🤖 AI deciding to wait. Reason: ${reasoning}. Expecting: ${expectation}`);
        
        return {
            success: true,
            action: 'waiting_for_input',
            reasoning,
            expectation,
            status: 'The AI is waiting for more information before responding'
        };
    }
});

export const analyzeMessage = tool({
    description: 'Analyze an incoming message for sentiment, intent, urgency, and decide on appropriate response strategy.',
    parameters: z.object({
        messageContent: z.string().describe('The message content to analyze'),
        senderHandle: z.string().describe('Who sent the message'),
        isGroupMessage: z.boolean().default(false).describe('Whether this is from a group chat')
    }),
    execute: async ({ messageContent, senderHandle, isGroupMessage }) => {
        // Simple analysis - could be enhanced with actual sentiment analysis
        const analysis = {
            hasQuestion: messageContent.includes('?'),
            hasUrgentWords: /urgent|emergency|asap|help|problem/i.test(messageContent),
            isGreeting: /^(hi|hello|hey|good morning|good afternoon|good evening)/i.test(messageContent.trim()),
            isShort: messageContent.length < 20,
            wordCount: messageContent.split(' ').length,
            hasEmojis: /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/u.test(messageContent)
        };

        console.log(`🤖 AI analyzing message from ${senderHandle}: "${messageContent}"`);
        
        return {
            success: true,
            action: 'message_analyzed',
            sender: senderHandle,
            isGroup: isGroupMessage,
            analysis,
            recommendation: analysis.hasUrgentWords ? 'respond_immediately' : 
                          analysis.hasQuestion ? 'respond_soon' : 
                          analysis.isGreeting ? 'respond_politely' : 'consider_waiting'
        };
    }
});

export const searchTalent = tool({
    description: 'Search for experts, professionals, and business partners based on user requirements. Use this when someone asks for connections, introductions, or help finding specific types of professionals.',
    parameters: z.object({
        query: z.string().describe('A search query describing the type of expert or professional needed (e.g., "Chinese manufacturing partners", "supply chain experts", "web3 developers")'),
        reasoning: z.string().describe('Why you decided to search for talent based on the user\'s message'),
        topResults: z.number().default(3).describe('Number of results to return (1-10)')
    }),
    execute: async ({ query, reasoning, topResults }) => {
        try {
            console.log(`🔍 AI searching for talent: "${query}" (Reason: ${reasoning})`);
            
            const apiUrl = 'https://connectus-backend-1092093853782.us-central1.run.app/api/talent/search';
            const requestBody = {
                query: query,
                userEmail: 'alex.chen@citrussqueeze.com',
                top_k: Math.min(Math.max(topResults, 1), 10) // Ensure between 1-10
            };
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                throw new Error(`API request failed: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (data.success && data.results && data.results.length > 0) {
                // Format the results for easy consumption
                const formattedResults = data.results.map(person => ({
                    name: person.name,
                    title: person.title,
                    company: person.company,
                    industry: person.industry,
                    location: person.location,
                    email: person.email,
                    phone: person.phone,
                    expertise: person.profileContext?.substring(0, 200) + '...', // Truncate for readability
                    connectionContext: person.connectionContext || person.connection_context || 'Connection details not available'
                }));
                
                console.log(`✅ Found ${formattedResults.length} talent matches`);
                
                return {
                    success: true,
                    action: 'talent_search_completed',
                    query: query,
                    reasoning: reasoning,
                    resultsCount: formattedResults.length,
                    results: formattedResults,
                    message: `Found ${formattedResults.length} expert${formattedResults.length === 1 ? '' : 's'} matching "${query}"`
                };
            } else {
                return {
                    success: true,
                    action: 'talent_search_no_results',
                    query: query,
                    reasoning: reasoning,
                    resultsCount: 0,
                    results: [],
                    message: `No experts found matching "${query}". Try a different search term.`
                };
            }
            
        } catch (error) {
            console.error('Error searching for talent:', error);
            return {
                success: false,
                error: error.message,
                action: 'talent_search_failed',
                query: query,
                message: 'Failed to search for experts. Please try again later.'
            };
        }
    }
});

export const sendLink = tool({
    description: 'Send a scheduling link to someone. Use this when someone asks to schedule a meeting, find a time to meet, book a consultation, or set up a call. The link defaults to the alpha-me scheduling platform.',
    parameters: z.object({
        url: z.string().url().default('https://www.alpha-me.xyz').describe('The URL to send (defaults to alpha-me scheduling link)'),
        contextMessage: z.string().optional().describe('Optional message to send before the link to provide context (e.g., "Here\'s the link to schedule a time:")'),
        phoneNumber: z.string().optional().describe('Optional phone number to send to (if different from current conversation partner). Must include country code like +1'),
        reasoning: z.string().describe('Why you decided to send this scheduling link'),
        isNewContact: z.boolean().default(false).describe('True if sending to a new contact, false for existing (only relevant if phoneNumber is provided)')
    }),
    execute: async ({ url = 'https://www.alpha-me.xyz', contextMessage, phoneNumber, reasoning, isNewContact }) => {
        try {
            // MESSAGE DELAY - Add 2 second delay to make responses feel more natural
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Determine the target handle (use phoneNumber if provided, otherwise use current conversation)
            const targetHandle = phoneNumber || global.currentMessageHandle || 'unknown';
            
            console.log(`🔗 AI sending scheduling link to ${targetHandle}: ${url} (Reason: ${reasoning})`);
            
            // If a context message is provided, send it first
            if (contextMessage) {
                if (phoneNumber && isNewContact) {
                    // Use empty string workaround for new contacts
                    const appleScript = `
                    tell application "Messages"
                        set serviceID to id of 1st service whose service type = iMessage
                        send "" to buddy "${phoneNumber}" of service id serviceID
                        send "${contextMessage.replace(/"/g, '\\"')}" to buddy "${phoneNumber}" of service id serviceID
                    end tell
                    `;
                    execSync(`osascript -e '${appleScript}'`);
                } else {
                    // Always use AppleScript for consistent iMessage delivery
                    const appleScript = `
                    tell application "Messages"
                        set serviceID to id of 1st service whose service type = iMessage
                        send "${contextMessage.replace(/"/g, '\\"')}" to buddy "${targetHandle}" of service id serviceID
                    end tell
                    `;
                    execSync(`osascript -e '${appleScript}'`);
                }
                // Small delay between context and link
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // Send the actual link
            if (phoneNumber && isNewContact) {
                const appleScript = `
                tell application "Messages"
                    set serviceID to id of 1st service whose service type = iMessage
                    send "${url.replace(/"/g, '\\"')}" to buddy "${phoneNumber}" of service id serviceID
                end tell
                `;
                execSync(`osascript -e '${appleScript}'`);
            } else {
                // Always use AppleScript for consistent iMessage delivery
                const appleScript = `
                tell application "Messages"
                    set serviceID to id of 1st service whose service type = iMessage
                    send "${url.replace(/"/g, '\\"')}" to buddy "${targetHandle}" of service id serviceID
                end tell
                `;
                execSync(`osascript -e '${appleScript}'`);
            }
            
            return {
                success: true,
                action: 'scheduling_link_sent',
                to: targetHandle,
                url: url,
                contextMessage: contextMessage || null,
                reasoning: reasoning,
                message: `Successfully sent scheduling link to ${targetHandle}`
            };
        } catch (error) {
            console.error('Error sending scheduling link:', error);
            return {
                success: false,
                error: error.message,
                action: 'link_send_failed',
                url: url
            };
        }
    }
});

export const checkWalletBalance = tool({
    description: 'Check ETH and USDC balance for a wallet address on Base Sepolia testnet. Use this when the user asks about their wallet balance or wants to check how much funds they have.',
    parameters: z.object({
        walletAddress: z.string().describe('The Ethereum wallet address to check (0x...)'),
        reasoning: z.string().describe('Why you are checking this wallet balance')
    }),
    execute: async ({ walletAddress, reasoning }) => {
        try {
            console.log(`💳 AI checking wallet balance for ${walletAddress} (Reason: ${reasoning})`);
            
            // Validate wallet address format
            if (!ethers.isAddress(walletAddress)) {
                return {
                    success: false,
                    error: 'Invalid wallet address format',
                    action: 'balance_check_failed',
                    walletAddress
                };
            }
            
            // Get RPC endpoint from env or use default Base Sepolia RPC
            const rpcUrl = process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org';
            
            // Create provider
            const provider = new ethers.JsonRpcProvider(rpcUrl);
            
            // Get ETH balance
            const balanceWei = await provider.getBalance(walletAddress);
            const balanceEth = ethers.formatEther(balanceWei);
            
            // Get USDC Balance (Base Sepolia USDC Contract)
            const usdcAddress = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
            const usdcAbi = ['function balanceOf(address owner) view returns (uint256)'];
            const usdcContract = new ethers.Contract(usdcAddress, usdcAbi, provider);
            
            let balanceUsdc = '0.0';
            try {
                const usdcWei = await usdcContract.balanceOf(walletAddress);
                // USDC has 6 decimals
                balanceUsdc = ethers.formatUnits(usdcWei, 6);
            } catch (e) {
                console.warn('Failed to fetch USDC balance:', e.message);
            }
            
            console.log(`✅ Balance for ${walletAddress}: ${balanceEth} ETH, ${balanceUsdc} USDC`);
            
            return {
                success: true,
                action: 'balance_checked',
                walletAddress,
                balance: {
                    wei: balanceWei.toString(),
                    eth: balanceEth,
                    usdc: balanceUsdc
                },
                network: 'Base Sepolia',
                reasoning,
                message: `Wallet ${walletAddress} has ${balanceEth} ETH and ${balanceUsdc} USDC on Base Sepolia`
            };
        } catch (error) {
            console.error('Error checking wallet balance:', error);
            return {
                success: false,
                error: error.message,
                action: 'balance_check_failed',
                walletAddress
            };
        }
    }
});

export const topUpAccount = tool({
    description: 'Generate a Coinbase onramp link for the user to top up their crypto wallet with fiat currency. Use this when the user wants to buy crypto, add funds via card/bank, or convert USD to USDC.',
    parameters: z.object({
        destinationAddress: z.string().describe('The wallet address to receive the funds (0x...)'),
        paymentAmount: z.string().describe('The amount in fiat currency to purchase (e.g., "100.00")'),
        paymentCurrency: z.string().default('USD').describe('The fiat currency for payment (USD, EUR, etc.)'),
        purchaseCurrency: z.string().default('USDC').describe('The cryptocurrency to purchase (USDC, ETH, etc.)'),
        destinationNetwork: z.string().default('base').describe('The blockchain network (base, ethereum, polygon, etc.)'),
        paymentMethod: z.string().default('CARD').describe('Payment method (CARD, ACH, WIRE)'),
        country: z.string().default('US').describe('User country code (US, GB, etc.)'),
        subdivision: z.string().default('NY').describe('State/province code (e.g., NY, CA)'),
        partnerUserRef: z.string().optional().describe('Optional unique user reference ID'),
        reasoning: z.string().describe('Why you decided to initiate this top-up')
    }),
    execute: async ({ 
        destinationAddress, 
        paymentAmount, 
        paymentCurrency = 'USD',
        purchaseCurrency = 'USDC',
        destinationNetwork = 'base',
        paymentMethod = 'CARD',
        country = 'US',
        subdivision,
        partnerUserRef,
        reasoning 
    }) => {
        try {
            console.log(`💵 AI initiating account top-up for ${destinationAddress}: ${paymentAmount} ${paymentCurrency} -> ${purchaseCurrency} (Reason: ${reasoning})`);
            
            // Validate wallet address format
            if (!ethers.isAddress(destinationAddress)) {
                return {
                    success: false,
                    error: 'Invalid wallet address format',
                    action: 'topup_failed',
                    destinationAddress
                };
            }
            
            // Get API endpoint from env or use default
            const apiUrl = process.env.COINBASE_ONRAMP_API || 'https://undecorously-uncongestive-cindy.ngrok-free.dev/coinbase/onramp';
            
            // Build request body with all required fields
            const requestBody = {
                destination_address: destinationAddress,
                destination_network: destinationNetwork,
                purchase_currency: purchaseCurrency,
                payment_amount: paymentAmount,
                payment_currency: paymentCurrency,
                payment_method: paymentMethod,
                country: country,
                subdivision: subdivision,
                client_ip: '181.10.161.120', // Default IP - could be made dynamic
                redirect_url: process.env.TOPUP_REDIRECT_URL || 'https://yourapp.com/success',
                partner_user_ref: partnerUserRef || `user_${Date.now()}_${Math.random().toString(36).substring(7)}`
            };
            
            // Make API request
            console.log('📤 Sending request to Coinbase API:', JSON.stringify(requestBody, null, 2));
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            
            // Try to parse response as JSON
            let data;
            try {
                data = await response.json();
            } catch (e) {
                const text = await response.text();
                console.error('❌ Non-JSON response:', text);
                throw new Error(`Coinbase API returned non-JSON response: ${response.status} ${text}`);
            }
            
            if (!response.ok) {
                console.error('❌ Coinbase API Error Response:', JSON.stringify(data, null, 2));
                throw new Error(`Coinbase API request failed: ${response.status} ${response.statusText}. Details: ${JSON.stringify(data)}`);
            }
            
            console.log(`✅ Coinbase onramp link generated successfully`);
            
            // Return the onramp link for the AI to include in its response
            // (Don't send it here - let the AI's text response include it to avoid duplicates)
            
            return {
                success: true,
                action: 'topup_initiated',
                destinationAddress,
                paymentAmount,
                paymentCurrency,
                purchaseCurrency,
                destinationNetwork,
                onrampUrl: data.onramp_url || data.url || data.link || null,
                apiResponse: data,
                reasoning,
                message: `Successfully generated top-up link for ${paymentAmount} ${paymentCurrency} to buy ${purchaseCurrency} on ${destinationNetwork}`
            };
            
        } catch (error) {
            console.error('Error initiating account top-up:', error);
            return {
                success: false,
                error: error.message,
                action: 'topup_failed',
                destinationAddress
            };
        }
    }
});

export const searchShopifyProducts = tool({
    description: 'Search for Shopify products using AI-powered search. Use this when the user is looking for specific products to buy.',
    parameters: z.object({
        query: z.string().describe('Search query for the product (e.g., "black leather jacket")'),
        numResults: z.number().default(5).describe('Number of results to return (1-50)'),
        reasoning: z.string().describe('Why you decided to search for these products')
    }),
    execute: async ({ query, numResults = 5, reasoning }) => {
        try {
            console.log(`🛍️ AI searching Shopify products: "${query}" (Reason: ${reasoning})`);
            
            const apiUrl = 'https://undecorously-uncongestive-cindy.ngrok-free.dev/shopify/search';
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    query,
                    num_results: numResults
                })
            });
            
            if (!response.ok) {
                throw new Error(`Shopify Search API request failed: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                 console.log(`✅ Found ${data.count} products`);
                 return {
                     success: true,
                     action: 'shopify_search_completed',
                     query,
                     count: data.count,
                     results: data.results, // Array of URLs
                     reasoning,
                     message: `Found ${data.count} products matching "${query}"`
                 };
            } else {
                 return {
                     success: true, // It was a successful search, just no results
                     action: 'shopify_search_no_results',
                     query,
                     count: 0,
                     results: [],
                     reasoning,
                     message: `No products found matching "${query}"`
                 };
            }
            
        } catch (error) {
            console.error('Error searching Shopify products:', error);
            return {
                success: false,
                error: error.message,
                action: 'shopify_search_failed',
                query
            };
        }
    }
});

export const payAndAccessService = tool({
    description: 'Access an x402-gated premium service or API by making a crypto payment. Use this when you need to perform an action that requires payment (like buying a product, accessing premium content, or running a paid automation task). IMPORTANT: For buying products, you must use the specific "shopify_order" task structure.',
    parameters: z.object({
        url: z.string().url().default('https://undecorously-uncongestive-cindy.ngrok-free.dev/tasks/create').describe('The full URL of the x402-gated service endpoint. Defaults to the main automation endpoint.'),
        method: z.string().default('POST').describe('HTTP method (GET, POST, etc.)'),
        data: z.any().optional().describe('JSON data to send in the request body. For buying products, use: { "task_type": "shopify_order", "input_data": { "product_url": "URL", "size": "Size" } }'),
        reasoning: z.string().describe('Why you are paying for this service')
    }),
    execute: async ({ url = 'https://undecorously-uncongestive-cindy.ngrok-free.dev/tasks/create', method = 'POST', data = {}, reasoning }) => {
        try {
            console.log(`💸 AI attempting x402 payment for service: ${url} (Reason: ${reasoning})`);
            
            // Check for private key
            const privateKey = process.env.WALLET_PRIVATE_KEY;
            if (!privateKey) {
                throw new Error('WALLET_PRIVATE_KEY not found in environment variables. Cannot make payment.');
            }
            
            // Setup Viem account from private key
            // Ensure it starts with 0x
            const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
            const account = privateKeyToAccount(formattedKey);
            
            console.log(`🔑 Using wallet: ${account.address}`);
            
            // Use x402-fetch (proven to work in tests) instead of axios interceptor
            const fetchWithPayment = wrapFetchWithPayment(fetch, account);
            
            // Make the request
            console.log(`🚀 Sending ${method} request to ${url}...`);
            
            // x402-fetch uses standard fetch API
            const requestOptions = {
                method,
                headers: {
                    'Content-Type': 'application/json'
                }
            };
            
            if (method !== 'GET' && method !== 'HEAD') {
                requestOptions.body = JSON.stringify(data);
            }
            
            const response = await fetchWithPayment(url, requestOptions);
            
            console.log(`✅ Payment successful! Service responded with status: ${response.status}`);
            
            if (!response.ok) {
                // Try to read error body
                const errorText = await response.text();
                throw new Error(`Request failed with status ${response.status}: ${errorText}`);
            }
            
            let finalResult = await response.json();
            
            // POLLING LOGIC: If we get a task_id, poll for completion
            if (finalResult && finalResult.task_id) {
                const taskId = finalResult.task_id;
                const baseUrl = url.substring(0, url.lastIndexOf('/tasks/')); // Attempt to derive base URL or just use the known structure
                // For this specific endpoint structure, the status URL is likely base + /tasks/{taskId}
                // Since the input url was .../tasks/create, we can replace 'create' with the ID if it ends in create
                
                let statusUrl;
                if (url.endsWith('/create')) {
                    statusUrl = url.replace('/create', `/${taskId}`);
                } else {
                    // Fallback: assume the API returns a status_url, or construct it
                    statusUrl = response.data.status_url || `${url.replace(/\/tasks\/create\/?$/, '')}/tasks/${taskId}`;
                }
                
                console.log(`⏳ Task started (ID: ${taskId}). Polling for completion at ${statusUrl}...`);
                
                // Send initial update to user (Payment confirmed)
                // We need to find the current user handle. It's stored in global.currentMessageHandle
                const userHandle = global.currentMessageHandle;
                if (userHandle) {
                    try {
                        const appleScript = `
                        tell application "Messages"
                            set serviceID to id of 1st service whose service type = iMessage
                            send "Payment confirmed with x402! Starting the purchase process now..." to buddy "${userHandle}" of service id serviceID
                        end tell
                        `;
                        execSync(`osascript -e '${appleScript}'`);
                    } catch (e) {
                        console.warn('Failed to send progress update:', e.message);
                    }
                }
                
                // Poll every 1 second, max 60 seconds
                const maxAttempts = 60;
                const delayMs = 1000;
                
                let lastProgressCount = 0;
                
                for (let i = 0; i < maxAttempts; i++) {
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    
                    try {
                        console.log(`🔄 Checking status (Attempt ${i+1}/${maxAttempts})...`);
                        const statusResponse = await axios.get(statusUrl);
                        const statusData = statusResponse.data;
                        
                        // Check for "current_status" (from your example) OR "status" (standard)
                        const currentStatus = statusData.current_status || statusData.status;
                        console.log(`   Status: ${currentStatus}`);
                        
                        // Print new progress steps if any
                        if (statusData.result_data && statusData.result_data.progress) {
                            const steps = statusData.result_data.progress;
                            if (steps.length > lastProgressCount) {
                                // Print only new steps
                                const newSteps = steps.slice(lastProgressCount);
                                newSteps.forEach(step => {
                                    console.log(`   ➡️ [PROGRESS] ${step.message} (${step.timestamp})`);
                                    
                                    // Send updates for key milestones to the user
                                    // Key milestones: "Adding product to cart", "Starting checkout", "Submitting order"
                                    if (userHandle) {
                                        let updateMsg = null;
                                        const msgLower = step.message.toLowerCase();
                                        
                                        if (msgLower.includes('adding') && msgLower.includes('cart')) {
                                            updateMsg = "Found it! Adding to cart...";
                                        } else if (msgLower.includes('checkout') && msgLower.includes('starting')) {
                                            updateMsg = "Heading to checkout...";
                                        } else if (msgLower.includes('submitting order')) {
                                            updateMsg = "Almost done, submitting order...";
                                        }
                                        
                                        if (updateMsg) {
                                            try {
                                                const appleScript = `
                                                tell application "Messages"
                                                    set serviceID to id of 1st service whose service type = iMessage
                                                    send "${updateMsg}" to buddy "${userHandle}" of service id serviceID
                                                end tell
                                                `;
                                                execSync(`osascript -e '${appleScript}'`);
                                            } catch (e) { console.warn('Failed to send progress update'); }
                                        }
                                    }
                                });
                                lastProgressCount = steps.length;
                            }
                        }
                        
                        if (currentStatus === 'completed' || currentStatus === 'success') {
                            console.log('✅ Task completed successfully!');
                            finalResult = statusData;
                            break;
                        } else if (currentStatus === 'failed' || currentStatus === 'error') {
                            console.error(`❌ Task failed: ${statusData.error_message || 'Unknown error'}`);
                            finalResult = statusData;
                            break; 
                        }
                        // If 'pending' or 'processing', continue loop
                    } catch (pollError) {
                        console.warn(`⚠️ Error checking status: ${pollError.message}. Retrying...`);
                    }
                }
            }

            return {
                success: true,
                action: 'x402_payment_completed',
                url,
                status: response.status,
                data: finalResult,
                walletUsed: account.address,
                reasoning,
                message: finalResult.status === 'completed' 
                    ? `Successfully paid and executed task. Result: ${JSON.stringify(finalResult.result || finalResult)}`
                    : `Payment successful, but task status is: ${finalResult.status || 'unknown'}`
            };
            
        } catch (error) {
            console.error('Error executing x402 payment:', error);
            
            // Extract helpful error info if available
            let errorInfo = { message: error.message };
            
            // Handle x402-fetch error structure if different
            if (error.response) {
                 errorInfo = {
                    status: error.response.status,
                    statusText: error.response.statusText
                };
            }
            
            return {
                success: false,
                error: error.message,
                details: errorInfo,
                action: 'x402_payment_failed',
                url
            };
        }
    }
});

export const bookUberRide = tool({
    description: 'Book an Uber ride for the user. Use this when the user wants to request a ride from one location to another. This handles the crypto payment automatically.',
    parameters: z.object({
        origin: z.string().describe('The pickup location/address'),
        destination: z.string().describe('The dropoff location/address'),
        reasoning: z.string().describe('Why you are booking this ride')
    }),
    execute: async ({ origin, destination, reasoning }) => {
        try {
            console.log(`🚗 AI booking Uber ride: ${origin} -> ${destination} (Reason: ${reasoning})`);
            
            // Re-use the payment logic by creating a task
            const url = 'https://undecorously-uncongestive-cindy.ngrok-free.dev/tasks/create';
            
            // Check for private key
            const privateKey = process.env.WALLET_PRIVATE_KEY;
            if (!privateKey) {
                throw new Error('WALLET_PRIVATE_KEY not found in environment variables. Cannot make payment.');
            }
            
            // Setup Viem account
            const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
            const account = privateKeyToAccount(formattedKey);
            
            console.log(`🔑 Using wallet: ${account.address}`);
            
            const fetchWithPayment = wrapFetchWithPayment(fetch, account);
            
            const taskData = {
                task_type: 'uber_ride',
                input_data: {
                    from_address: origin,
                    to_address: destination
                }
            };
            
            console.log(`🚀 Sending Uber request to ${url}...`);
            
            const response = await fetchWithPayment(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(taskData)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Uber request failed: ${response.status} ${errorText}`);
            }
            
            let finalResult = await response.json();
            
            // POLLING LOGIC
            if (finalResult && finalResult.task_id) {
                const taskId = finalResult.task_id;
                const statusUrl = url.replace('/create', `/${taskId}`);
                
                console.log(`⏳ Uber task started (ID: ${taskId}). Polling...`);
                
                // Notify user
                const userHandle = global.currentMessageHandle;
                if (userHandle) {
                    try {
                        const appleScript = `
                        tell application "Messages"
                            set serviceID to id of 1st service whose service type = iMessage
                            send "Uber requested with x402! Confirming payment and finding a driver..." to buddy "${userHandle}" of service id serviceID
                        end tell
                        `;
                        execSync(`osascript -e '${appleScript}'`);
                    } catch (e) {}
                }
                
                // Poll
                const maxAttempts = 60;
                for (let i = 0; i < maxAttempts; i++) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    try {
                        const statusResponse = await axios.get(statusUrl);
                        const statusData = statusResponse.data;
                        const currentStatus = statusData.current_status || statusData.status;
                        
                        console.log(`   Uber Status: ${currentStatus}`);
                        
                        if (statusData.result_data && statusData.result_data.progress) {
                            // Could add specific progress notifications here
                        }
                        
                        if (currentStatus === 'completed' || currentStatus === 'success') {
                            finalResult = statusData;
                            break;
                        } else if (currentStatus === 'failed') {
                            throw new Error(statusData.error_message || 'Uber booking failed');
                        }
                    } catch (pollError) {
                        if (pollError.message.includes('failed')) throw pollError;
                        console.warn('Polling error, retrying...');
                    }
                }
            }
            
            return {
                success: true,
                action: 'uber_booked',
                origin,
                destination,
                data: finalResult,
                message: `Uber ride booked successfully! Status: ${finalResult.current_status}`
            };
            
        } catch (error) {
            console.error('Error booking Uber:', error);
            return {
                success: false,
                error: error.message,
                action: 'uber_booking_failed'
            };
        }
    }
});

// Export all tools as an object for easy access
export const llmTools = {
    payAndAccessService,
    skipResponse,
    sendToSpecificContact,
    createGroupChat: createGroupChatTool,
    getConversationHistory,
    waitForMoreInput,
    analyzeMessage,
    searchTalent,
    sendLink,
    checkWalletBalance,
    topUpAccount,
    searchShopifyProducts,
    bookUberRide,
    checkTokenPrice,
    monitorTokenAndBuy,
    // Deprecated - keeping for backwards compatibility
    sendMessage
}; 