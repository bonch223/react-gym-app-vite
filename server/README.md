# Gym Management SMS Server

A simple Express.js server that integrates with Twilio to send SMS messages for the gym management application.

## 🚀 Quick Setup

### 1. Install Dependencies
```bash
cd server
npm install
```

### 2. Set up Twilio Account (Free)
1. Go to [twilio.com](https://www.twilio.com) and create a free account
2. Complete phone number verification
3. Get your free Twilio phone number
4. Find your Account SID and Auth Token in the Twilio Console

### 3. Configure Environment Variables
1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your Twilio credentials:
   ```env
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_auth_token_here
   TWILIO_PHONE_NUMBER=+1234567890
   PORT=3001
   CORS_ORIGIN=http://localhost:5173
   ```

### 4. Start the Server
```bash
# Development mode with auto-restart
npm run dev

# Or production mode
npm start
```

The server will start on `http://localhost:3001`

## 📱 Twilio Free Tier Limits

- **500 SMS messages** per month
- Can only send to **verified phone numbers** (unless you upgrade)
- Messages include "Sent from a Twilio trial account" prefix

### To verify phone numbers for testing:
1. Go to Twilio Console > Phone Numbers > Manage > Verified Caller IDs
2. Add the phone numbers you want to test with
3. Verify them via SMS or call

## 🔧 API Endpoints

### Health Check
```http
GET /health
```

### Send Single SMS
```http
POST /api/sms/send
Content-Type: application/json

{
  "to": "+1234567890",
  "message": "Hello from Rage Fitness!"
}
```

### Send Bulk SMS
```http
POST /api/sms/send-bulk
Content-Type: application/json

{
  "message": "Hello from Rage Fitness!",
  "recipients": [
    {
      "phone": "+1234567890",
      "personalizedMessage": "Hi John, your membership expires soon!"
    },
    {
      "phone": "+0987654321",
      "personalizedMessage": "Hi Jane, thanks for being a member!"
    }
  ]
}
```

## 🛡️ Features

- **Rate Limiting**: Prevents spam (5 messages per minute per number by default)
- **Error Handling**: Proper Twilio error reporting
- **Bulk SMS**: Send to multiple recipients with personalized messages
- **CORS Enabled**: Works with your React frontend
- **Phone Formatting**: Automatically formats phone numbers

## 🔍 Testing

1. Start the server: `npm run dev`
2. Test health endpoint: `curl http://localhost:3001/health`
3. Send a test SMS to your verified number:
   ```bash
   curl -X POST http://localhost:3001/api/sms/send \
     -H "Content-Type: application/json" \
     -d '{"to":"+1234567890","message":"Test message from gym app!"}'
   ```

## 🚨 Important Notes

- **Never commit your `.env` file** to version control
- Keep your Twilio credentials secure
- For production, consider using environment variables or a secrets manager
- The free tier only works with verified numbers unless you upgrade your account

## 🔄 Production Deployment

For production deployment, consider:
- Using environment variables instead of `.env` files
- Adding request logging and monitoring
- Implementing authentication/authorization
- Using a proper database for rate limiting
- Setting up proper error alerts
