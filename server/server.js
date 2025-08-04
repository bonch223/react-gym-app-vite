import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Semaphore SMS Configuration
const SEMAPHORE_API_URL = 'https://semaphore.co/api/v4/messages';
const SEMAPHORE_API_KEY = process.env.SEMAPHORE_API_KEY;
const SEMAPHORE_SENDER_NAME = process.env.SEMAPHORE_SENDER_NAME || 'RageFitness';

// Rate limiting storage (in production, use Redis or a database)
const rateLimitMap = new Map();

// Middleware
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting function
const checkRateLimit = (phoneNumber) => {
    const now = Date.now();
    const key = phoneNumber;
    const limit = parseInt(process.env.RATE_LIMIT_PER_MINUTE) || 5;
    
    if (!rateLimitMap.has(key)) {
        rateLimitMap.set(key, { count: 1, resetTime: now + 60000 });
        return true;
    }
    
    const entry = rateLimitMap.get(key);
    
    if (now > entry.resetTime) {
        // Reset counter
        entry.count = 1;
        entry.resetTime = now + 60000;
        return true;
    }
    
    if (entry.count >= limit) {
        return false;
    }
    
    entry.count++;
    return true;
};

// Format Philippine phone number
const formatPhilippineNumber = (phoneNumber) => {
    // Remove all non-digit characters
    let cleaned = phoneNumber.replace(/\D/g, '');
    
    // Handle different Philippine number formats
    if (cleaned.startsWith('63')) {
        // Already has country code
        return cleaned;
    } else if (cleaned.startsWith('0')) {
        // Local format (e.g., 09171234567)
        return '63' + cleaned.substring(1);
    } else if (cleaned.length === 10) {
        // 10 digit format (e.g., 9171234567)
        return '63' + cleaned;
    } else {
        // Return as is and let Semaphore handle validation
        return cleaned;
    }
};

// Send SMS via Semaphore
const sendSemaphoreSMS = async (to, message) => {
    try {
        const formattedNumber = formatPhilippineNumber(to);
        
        const payload = {
            apikey: SEMAPHORE_API_KEY,
            number: formattedNumber,
            message: message,
            sendername: SEMAPHORE_SENDER_NAME
        };

        console.log(`🚀 Sending SMS to ${formattedNumber} via Semaphore...`);
        
        const response = await axios.post(SEMAPHORE_API_URL, payload, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000 // 30 second timeout
        });

        return {
            success: true,
            messageId: response.data.message_id || response.data.id,
            status: response.data.status || 'sent',
            credits_used: response.data.credits_used || 1,
            to: formattedNumber,
            response: response.data
        };

    } catch (error) {
        console.error('Semaphore API Error:', error.response?.data || error.message);
        
        if (error.response) {
            // API responded with error
            throw new Error(`Semaphore Error: ${error.response.data.message || error.response.statusText}`);
        } else {
            // Network or other error
            throw new Error(`SMS send failed: ${error.message}`);
        }
    }
};

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        semaphore_configured: !!SEMAPHORE_API_KEY,
        sender_name: SEMAPHORE_SENDER_NAME
    });
});

// Send single SMS endpoint
app.post('/api/sms/send', async (req, res) => {
    try {
        const { to, message } = req.body;

        // Validation
        if (!to || !message) {
            return res.status(400).json({
                success: false,
                error: 'Phone number and message are required'
            });
        }

        if (!SEMAPHORE_API_KEY) {
            return res.status(500).json({
                success: false,
                error: 'Semaphore API key not configured'
            });
        }

        // Check rate limit
        if (!checkRateLimit(to)) {
            return res.status(429).json({
                success: false,
                error: 'Rate limit exceeded. Please try again later.'
            });
        }

        // Send SMS via Semaphore
        const result = await sendSemaphoreSMS(to, message);

        console.log(`✅ SMS sent successfully to ${result.to}: ${result.messageId}`);

        res.json({
            success: true,
            messageId: result.messageId,
            to: result.to,
            status: result.status,
            credits_used: result.credits_used,
            sender: SEMAPHORE_SENDER_NAME
        });

    } catch (error) {
        console.error('Error sending SMS:', error);
        
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to send SMS'
        });
    }
});

// Send bulk SMS endpoint
app.post('/api/sms/send-bulk', async (req, res) => {
    try {
        const { recipients, message } = req.body;

        // Validation
        if (!Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Recipients array is required and must not be empty'
            });
        }

        if (!message) {
            return res.status(400).json({
                success: false,
                error: 'Message is required'
            });
        }

        if (!SEMAPHORE_API_KEY) {
            return res.status(500).json({
                success: false,
                error: 'Semaphore API key not configured'
            });
        }

        // Limit bulk send size
        if (recipients.length > 100) {
            return res.status(400).json({
                success: false,
                error: 'Maximum 100 recipients allowed per bulk send'
            });
        }

        const results = [];
        const errors = [];
        let totalCreditsUsed = 0;

        console.log(`📨 Starting bulk SMS send to ${recipients.length} recipients...`);

        // Send messages sequentially to avoid overwhelming the API
        for (const recipient of recipients) {
            try {
                const { phone, personalizedMessage } = recipient;
                
                if (!phone) {
                    errors.push({ recipient, error: 'Phone number missing' });
                    continue;
                }

                // Check rate limit for each number
                if (!checkRateLimit(phone)) {
                    errors.push({ recipient, error: 'Rate limit exceeded' });
                    continue;
                }

                const messageToSend = personalizedMessage || message;
                const result = await sendSemaphoreSMS(phone, messageToSend);

                results.push({
                    phone: result.to,
                    messageId: result.messageId,
                    status: result.status,
                    credits_used: result.credits_used,
                    success: true
                });

                totalCreditsUsed += result.credits_used || 1;

                console.log(`✅ Bulk SMS sent to ${result.to}: ${result.messageId}`);

                // Small delay to avoid hitting rate limits
                await new Promise(resolve => setTimeout(resolve, 200));

            } catch (error) {
                console.error(`❌ Error sending to ${recipient.phone}:`, error.message);
                errors.push({
                    recipient,
                    error: error.message
                });
            }
        }

        console.log(`📊 Bulk SMS completed: ${results.length} sent, ${errors.length} failed, ${totalCreditsUsed} credits used`);

        res.json({
            success: true,
            total: recipients.length,
            sent: results.length,
            failed: errors.length,
            credits_used: totalCreditsUsed,
            sender: SEMAPHORE_SENDER_NAME,
            results,
            errors
        });

    } catch (error) {
        console.error('Error in bulk SMS send:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process bulk SMS request'
        });
    }
});

// Get Semaphore account balance
app.get('/api/semaphore/balance', async (req, res) => {
    try {
        if (!SEMAPHORE_API_KEY) {
            return res.status(500).json({
                success: false,
                error: 'Semaphore API key not configured'
            });
        }

        const response = await axios.get('https://semaphore.co/api/v4/account', {
            params: {
                apikey: SEMAPHORE_API_KEY
            }
        });
        
        res.json({
            success: true,
            balance: response.data.credit_balance,
            account_name: response.data.account_name,
            status: response.data.status
        });
    } catch (error) {
        console.error('Error fetching Semaphore balance:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch account balance'
        });
    }
});

// Get message status (if supported by Semaphore)
app.get('/api/sms/status/:messageId', async (req, res) => {
    try {
        const { messageId } = req.params;
        
        if (!SEMAPHORE_API_KEY) {
            return res.status(500).json({
                success: false,
                error: 'Semaphore API key not configured'
            });
        }

        // Note: Check Semaphore API documentation for message status endpoint
        res.json({
            success: true,
            messageId,
            status: 'delivered', // Placeholder - implement actual status check
            note: 'Message status checking implementation needed'
        });

    } catch (error) {
        console.error('Error fetching message status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch message status'
        });
    }
});

// Test SMS endpoint (for development)
app.post('/api/sms/test', async (req, res) => {
    try {
        const testMessage = `Hello from ${SEMAPHORE_SENDER_NAME}! This is a test message sent at ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}.`;
        const testNumber = req.body.testNumber || '639171234567'; // Default test number
        
        const result = await sendSemaphoreSMS(testNumber, testMessage);
        
        res.json({
            success: true,
            message: 'Test SMS sent successfully',
            result
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// Start server
app.listen(PORT, () => {
    console.log('\n🏋️‍♂️ Rage Fitness Gym SMS Server Started! 🏋️‍♀️');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Semaphore SMS configured: ${!!SEMAPHORE_API_KEY}`);
    console.log(`📤 Sender name: ${SEMAPHORE_SENDER_NAME}`);
    console.log(`🌐 CORS origin: ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`);
    console.log(`⚡ Rate limit: ${process.env.RATE_LIMIT_PER_MINUTE || 5} SMS per minute per number`);
    console.log('\n📍 Available endpoints:');
    console.log('   POST /api/sms/send - Send single SMS');
    console.log('   POST /api/sms/send-bulk - Send bulk SMS');
    console.log('   GET  /api/semaphore/balance - Check account balance');
    console.log('   POST /api/sms/test - Send test SMS');
    console.log('   GET  /health - Health check\n');
});
