import { privateKeyToAccount } from 'viem/accounts';
import { wrapFetchWithPayment } from 'x402-fetch';
import { execSync } from 'child_process';
import axios from 'axios';

/**
 * Shopify Agent - Handles x402 payments and Shopify automation tasks
 */
export class ShopifyAgent {
    constructor() {
        this.privateKey = process.env.WALLET_PRIVATE_KEY;
        this.taskEndpoint = 'https://undecorously-uncongestive-cindy.ngrok-free.dev/tasks/create';
    }

    getAccount() {
        if (!this.privateKey) {
            throw new Error('WALLET_PRIVATE_KEY not found in environment variables');
        }
        const formattedKey = this.privateKey.startsWith('0x') ? this.privateKey : `0x${this.privateKey}`;
        return privateKeyToAccount(formattedKey);
    }

    /**
     * Execute a Shopify order task
     * @param {string} productUrl 
     * @param {string} size 
     * @param {string} userHandle - Optional, for sending progress updates
     */
    async purchaseProduct(productUrl, size, userHandle = null) {
        console.log(`🛍️ ShopifyAgent: Purchasing ${productUrl} (Size: ${size})`);
        
        try {
            const account = this.getAccount();
            console.log(`🔑 Using wallet: ${account.address}`);
            
            // Wrap fetch with x402 payment
            const fetchWithPayment = wrapFetchWithPayment(fetch, account);
            
            const payload = {
                task_type: "shopify_order",
                input_data: {
                    product_url: productUrl,
                    size: size
                }
            };

            // 1. Create Task & Pay
            console.log(`🚀 Sending payment and task request...`);
            const response = await fetchWithPayment(this.taskEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Payment/Task failed: ${response.status} ${errorText}`);
            }

            const taskData = await response.json();
            const taskId = taskData.task_id;
            
            if (!taskId) {
                throw new Error('No task_id returned from service');
            }
            
            console.log(`✅ Task started (ID: ${taskId})`);
            
            // Notify user of start
            if (userHandle) {
                this.sendUpdate(userHandle, "Payment confirmed! I've started the purchase process for you.");
            }

            // 2. Poll for completion
            return await this.pollTaskStatus(taskId, userHandle);

        } catch (error) {
            console.error('❌ ShopifyAgent Error:', error);
            if (userHandle) {
                this.sendUpdate(userHandle, `Purchase failed: ${error.message}`);
            }
            throw error;
        }
    }

    async pollTaskStatus(taskId, userHandle) {
        const statusUrl = this.taskEndpoint.replace('/create', `/${taskId}`);
        console.log(`⏳ Polling status at: ${statusUrl}`);

        const maxAttempts = 120; // 2 minutes max
        let lastProgressCount = 0;

        for (let i = 0; i < maxAttempts; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));

            try {
                const res = await axios.get(statusUrl);
                const data = res.data;
                const status = data.current_status || data.status;

                // Handle progress updates
                if (data.result_data && data.result_data.progress) {
                    const steps = data.result_data.progress;
                    if (steps.length > lastProgressCount) {
                        const newSteps = steps.slice(lastProgressCount);
                        
                        // Notify user of key steps
                        newSteps.forEach(step => {
                            console.log(`   ➡️ [PROGRESS] ${step.message}`);
                            if (userHandle) {
                                const msgLower = step.message.toLowerCase();
                                if (msgLower.includes('adding') && msgLower.includes('cart')) {
                                    this.sendUpdate(userHandle, "Found the item! Adding it to cart...");
                                } else if (msgLower.includes('checkout')) {
                                    this.sendUpdate(userHandle, "Heading to checkout now...");
                                } else if (msgLower.includes('submitting')) {
                                    this.sendUpdate(userHandle, "Almost there, submitting the order...");
                                }
                            }
                        });
                        
                        lastProgressCount = steps.length;
                    }
                }

                if (status === 'completed' || status === 'success') {
                    console.log('✅ Task Completed Successfully!');
                    if (userHandle) {
                        this.sendUpdate(userHandle, `Success! Order placed. ${JSON.stringify(data.result_data?.order_details || 'Check email for confirmation.')}`);
                    }
                    return { success: true, data };
                } else if (status === 'failed' || status === 'error') {
                    throw new Error(data.error_message || 'Task failed');
                }

            } catch (error) {
                // If it's a polling error (network), ignore and retry. If it's a logic error thrown above, rethrow.
                if (error.message === 'Task failed' || error.message.includes('Task failed')) throw error;
                console.warn(`⚠️ Polling warn: ${error.message}`);
            }
        }
        
        throw new Error('Task timed out');
    }

    sendUpdate(handle, message) {
        try {
            const appleScript = `
            tell application "Messages"
                set serviceID to id of 1st service whose service type = iMessage
                send "${message.replace(/"/g, '\\"')}" to buddy "${handle}" of service id serviceID
            end tell
            `;
            execSync(`osascript -e '${appleScript}'`);
        } catch (e) {
            console.warn('Failed to send iMessage update:', e.message);
        }
    }
}

export const shopifyAgent = new ShopifyAgent();

