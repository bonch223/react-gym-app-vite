# Rage Fitness Gym SMS Server 💪

A Node.js SMS server for gym management using **Semaphore SMS** (Philippines-based SMS provider).

## 🚀 Features

- ✅ Send single SMS messages
- ✅ Send bulk SMS to multiple recipients
- ✅ Custom sender name ("RageFitness")
- ✅ Philippine phone number formatting
- ✅ Rate limiting (5 SMS per minute per number)
- ✅ Credit usage tracking
- ✅ Account balance checking
- ✅ Error handling and logging

## 📱 Semaphore SMS Setup

### 1. Create Semaphore Account
1. Go to [https://semaphore.co/](https://semaphore.co/)
2. Sign up for an account
3. Verify your account and phone number

### 2. Get API Key
1. Login to your Semaphore dashboard
2. Go to **API Settings** or **Account Settings**
3. Copy your **API Key**

### 3. Buy Credits
1. Go to **Buy Credits** in your dashboard
2. Purchase credits (5000 credits ≈ ₱2,500-3,000)
3. **5000 credits = ~5000 SMS messages** (for standard 160-character messages)

### 4. Configure Environment Variables
Update your `.env` file:

```env
# Semaphore SMS Configuration
SEMAPHORE_API_KEY=your_actual_api_key_here
SEMAPHORE_SENDER_NAME=RageFitness

# Server Configuration
PORT=3001
CORS_ORIGIN=http://localhost:5173
RATE_LIMIT_PER_MINUTE=5
```

**Important Notes:**
- Replace `{{SEMAPHORE_API_KEY}}` with your actual API key from Semaphore
- `SEMAPHORE_SENDER_NAME` can be up to 11 characters (alphanumeric)
- Suggested sender names: `RageFitness`, `RageGym`, `RageFitnessGM`

## 🏃‍♂️ Running the Server

```bash
# Install dependencies
npm install

# Start development server (with auto-reload)
npm run dev

# Start production server
npm start
```

## 📡 API Endpoints

### Send Single SMS
```bash
POST /api/sms/send
Content-Type: application/json

{
  "to": "09171234567",
  "message": "Hello from Rage Fitness Gym! Your membership expires tomorrow."
}
```

### Send Bulk SMS
```bash
POST /api/sms/send-bulk
Content-Type: application/json

{
  "message": "Don't forget your workout today!",
  "recipients": [
    { "phone": "09171234567" },
    { "phone": "09181234567", "personalizedMessage": "Hi John! Don't forget your workout today!" }
  ]
}
```

### Check Account Balance
```bash
GET /api/semaphore/balance
```

### Test SMS (Development)
```bash
POST /api/sms/test
Content-Type: application/json

{
  "testNumber": "09171234567"
}
```

### Health Check
```bash
GET /health
```

## 📞 Philippine Phone Number Formats

The server automatically handles different Philippine number formats:

- `09171234567` → `639171234567`
- `639171234567` → `639171234567` (no change)
- `9171234567` → `639171234567`

## 💰 Cost Breakdown

### Semaphore Pricing (Approximate)
- **1 SMS Credit** = ₱0.50-1.00 (~$0.009-0.018 USD)
- **5000 Credits** = ₱2,500-5,000 (~$45-90 USD)
- **Monthly Cost for 500 SMS** = ₱250-500 (~$4.50-9 USD)

### Message Length & Credits
- **≤160 characters** = 1 credit
- **161-320 characters** = 2 credits
- **321-480 characters** = 3 credits

## 🔧 Example Gym Messages

```javascript
// Membership expiry reminder
"Hi John! Your membership at Rage Fitness expires tomorrow. Renew now to continue your fitness journey!"

// Workout reminder
"Don't forget your workout today at 6 PM! See you at Rage Fitness Gym. Let's get those gains! 💪"

// Welcome message
"Welcome to Rage Fitness Gym! Your membership is now active. Download our app and start your fitness journey today!"

// Class reminder
"Reminder: Your Zumba class starts in 30 minutes. Room 2, Rage Fitness Gym. See you there!"
```

## 🛠️ Integration with Frontend

```javascript
// Send SMS from your React/frontend app
const sendSMS = async (phoneNumber, message) => {
  try {
    const response = await fetch('http://localhost:3001/api/sms/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: phoneNumber,
        message: message
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('SMS sent successfully!', result);
    } else {
      console.error('SMS failed:', result.error);
    }
  } catch (error) {
    console.error('Error sending SMS:', error);
  }
};

// Usage
sendSMS('09171234567', 'Hello from Rage Fitness Gym!');
```

## 🚨 Security Notes

- Never commit your actual API key to git
- Use environment variables for all sensitive data
- Implement proper authentication in production
- Consider implementing user-specific rate limiting
- Monitor credit usage to avoid unexpected charges

## 🔄 Migration from Twilio

This server was previously using Twilio. All endpoints remain the same, only the SMS provider changed to Semaphore for better Philippine coverage and lower costs.

## 📞 Support

- **Semaphore Support**: [https://semaphore.co/contact](https://semaphore.co/contact)
- **Documentation**: [https://semaphore.co/docs](https://semaphore.co/docs)

---

**Ready to send SMS messages to your gym members! 🏋️‍♂️💪**
