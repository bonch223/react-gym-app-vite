import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import twilio from 'twilio';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Twilio client
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

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

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        twilio_configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
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

        // Check rate limit
        if (!checkRateLimit(to)) {
            return res.status(429).json({
                success: false,
                error: 'Rate limit exceeded. Please try again later.'
            });
        }

        // Format phone number (ensure it starts with +)
        const formattedPhone = to.startsWith('+') ? to : `+${to}`;

        // Send SMS via Twilio
        const result = await client.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: formattedPhone
        });

        console.log(`SMS sent successfully to ${formattedPhone}: ${result.sid}`);

        res.json({
            success: true,
            messageId: result.sid,
            to: formattedPhone,
            status: result.status
        });

    } catch (error) {
        console.error('Error sending SMS:', error);
        
        // Handle Twilio-specific errors
        if (error.code) {
            return res.status(400).json({
                success: false,
                error: `Twilio Error ${error.code}: ${error.message}`,
                twilioError: true
            });
        }

        res.status(500).json({
            success: false,
            error: 'Failed to send SMS'
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

        // Limit bulk send size (Twilio free tier has limits)
        if (recipients.length > 50) {
            return res.status(400).json({
                success: false,
                error: 'Maximum 50 recipients allowed per bulk send'
            });
        }

        const results = [];
        const errors = [];

        // Send messages sequentially to avoid rate limiting
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

                const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;
                const messageToSend = personalizedMessage || message;

                const result = await client.messages.create({
                    body: messageToSend,
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to: formattedPhone
                });

                results.push({
                    phone: formattedPhone,
                    messageId: result.sid,
                    status: result.status,
                    success: true
                });

                console.log(`Bulk SMS sent to ${formattedPhone}: ${result.sid}`);

                // Small delay to avoid hitting rate limits
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.error(`Error sending to ${recipient.phone}:`, error);
                errors.push({
                    recipient,
                    error: error.message,
                    code: error.code
                });
            }
        }

        res.json({
            success: true,
            total: recipients.length,
            sent: results.length,
            failed: errors.length,
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

// Get Twilio account info (for debugging)
app.get('/api/twilio/account', async (req, res) => {
    try {
        const account = await client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
        
        res.json({
            success: true,
            account: {
                sid: account.sid,
                friendlyName: account.friendlyName,
                status: account.status,
                type: account.type
            }
        });
    } catch (error) {
        console.error('Error fetching account info:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch account information'
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

// Start server
app.listen(PORT, () => {
    console.log(`🚀 SMS Server running on port ${PORT}`);
    console.log(`📱 Twilio configured: ${!!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)}`);
    console.log(`🌐 CORS origin: ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`);
});
