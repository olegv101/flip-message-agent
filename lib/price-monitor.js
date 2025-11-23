import axios from 'axios';
import { shopifyAgent } from './shopify-agent.js';
import { execSync } from 'child_process';

/**
 * Price Monitor - Handles background monitoring of token prices and triggers actions
 */
class PriceMonitor {
    constructor() {
        this.baseUrl = 'https://applaudable-unspeckled-kimberley.ngrok-free.dev';
        this.activeSessions = new Map(); // sessionId -> { userHandle, productUrl, size, symbol, threshold }
        this.isPolling = false;
        this.pollInterval = null;
    }

    /**
     * Start monitoring a token for a user
     */
    async startMonitoring(symbol, threshold, userHandle, productUrl, size) {
        try {
            console.log(`📈 Starting monitor for ${userHandle}: ${symbol} < ${threshold}`);
            
            // Call the external monitoring API
            const response = await axios.post(`${this.baseUrl}/api/monitor/start`, {
                symbol,
                threshold: Number(threshold),
                update_interval: 10
            });

            const { session_id } = response.data;

            if (!session_id) {
                throw new Error('Failed to get session_id from monitoring API');
            }

            // Store session details
            this.activeSessions.set(session_id, {
                userHandle,
                productUrl,
                size,
                symbol,
                threshold,
                startTime: Date.now()
            });

            // Start local polling if not running
            this.startPolling();

            return { success: true, session_id };

        } catch (error) {
            console.error('❌ Failed to start monitoring:', error.message);
            throw error;
        }
    }

    startPolling() {
        if (this.isPolling) return;
        
        this.isPolling = true;
        console.log('🔄 Price Monitor Polling Started');

        this.pollInterval = setInterval(async () => {
            await this.checkSessions();
        }, 10000); // Check every 10 seconds
    }

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.isPolling = false;
        console.log('🛑 Price Monitor Polling Stopped');
    }

    async checkSessions() {
        if (this.activeSessions.size === 0) {
            // Don't stop polling immediately, maybe wait a bit? 
            // For now, keep running or stop if you want to save resources.
            // Let's keep it running for simplicity.
            return;
        }

        for (const [sessionId, data] of this.activeSessions) {
            try {
                // Check status with external API
                const response = await axios.get(`${this.baseUrl}/api/monitor/${sessionId}`);
                const sessionData = response.data.data;

                if (!sessionData) {
                    console.warn(`⚠️ Session ${sessionId} returned no data`);
                    continue;
                }

                console.log(`📊 Monitor ${sessionId}: ${sessionData.symbol} = $${sessionData.price} (Below ${sessionData.threshold}? ${sessionData.is_below_threshold})`);

                if (sessionData.is_below_threshold) {
                    console.log(`🎯 TARGET HIT! Triggering purchase for ${data.userHandle}`);
                    
                    // 1. Notify User
                    this.sendNotification(data.userHandle, `🚨 PRICE ALERT: ${data.symbol} is now $${sessionData.price} (below your limit of $${data.threshold}). Initiating purchase of your item!`);

                    // 2. Trigger Purchase
                    // Run in background so we don't block the polling loop too long? 
                    // shopifyAgent.purchaseProduct is async and handles its own polling. 
                    // We should await it or fire-and-forget?
                    // Better to fire-and-forget but catch errors.
                    shopifyAgent.purchaseProduct(data.productUrl, data.size, data.userHandle)
                        .catch(err => console.error(`Purchase execution failed for ${sessionId}:`, err));

                    // 3. Stop Monitoring this session
                    await this.stopSession(sessionId);
                }

            } catch (error) {
                console.error(`Error checking session ${sessionId}:`, error.message);
                // If session not found (404), maybe remove it?
                if (error.response && error.response.status === 404) {
                    console.log(`Removing stale session ${sessionId}`);
                    this.activeSessions.delete(sessionId);
                }
            }
        }
    }

    async stopSession(sessionId) {
        try {
            await axios.post(`${this.baseUrl}/api/monitor/${sessionId}/stop`);
            this.activeSessions.delete(sessionId);
            console.log(`✅ Stopped monitoring session ${sessionId}`);
        } catch (error) {
            console.error(`Failed to stop session ${sessionId}:`, error.message);
            // Still remove locally
            this.activeSessions.delete(sessionId);
        }
    }

    sendNotification(handle, message) {
        try {
            const appleScript = `
            tell application "Messages"
                set serviceID to id of 1st service whose service type = iMessage
                send "${message.replace(/"/g, '\\"')}" to buddy "${handle}" of service id serviceID
            end tell
            `;
            execSync(`osascript -e '${appleScript}'`);
        } catch (e) {
            console.warn('Failed to send notification:', e.message);
        }
    }
}

export const priceMonitor = new PriceMonitor();

