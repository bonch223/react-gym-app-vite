# Twilio SMS Setup Instructions

## 🚀 Quick Start

### 1. Get Your Twilio Credentials

1. Go to [Twilio Console](https://console.twilio.com/)
2. Find your **Account SID** and **Auth Token** on the dashboard
3. Get a Twilio phone number:
   - Go to **Phone Numbers** → **Manage** → **Buy a number**
   - For testing, you can get a free trial number

### 2. Configure Environment Variables

Edit the file `server/.env` and replace the placeholder values:

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_actual_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890
```

### 3. Start the Servers

**Terminal 1 - Start the SMS Server:**
```bash
cd server
npm run dev
```

**Terminal 2 - Start the React App:**
```bash
npm run dev
```

### 4. Test SMS Functionality

1. Import the SMSTest component in your App.jsx:
```jsx
import SMSTest from './SMSTest';

function App() {
  return (
    <div className="App">
      <SMSTest />
    </div>
  );
}
```

2. Visit your React app and test:
   - Click "Test Server Connection" to verify the server is running
   - Enter a phone number (with country code, e.g., +1234567890)
   - Enter a message and click "Send SMS"

## 📱 Important Notes

### Trial Account Limitations
- **Twilio trial accounts** can only send messages to **verified phone numbers**
- To verify a phone number: Twilio Console → Phone Numbers → Verified Caller IDs
- Messages will be prefixed with "Sent from your Twilio trial account"

### Phone Number Format
- Always include the country code (e.g., +1 for US, +44 for UK)
- Example: +1234567890 (US number)

### Rate Limiting
- The server has built-in rate limiting (5 messages per minute per phone number)
- This prevents accidental spam and respects Twilio's limits

## 🛠 API Endpoints

Your server provides these endpoints:

### Send Single SMS
```
POST http://localhost:3001/api/sms/send
Content-Type: application/json

{
  "to": "+1234567890",
  "message": "Hello from your gym app!"
}
```

### Send Bulk SMS
```
POST http://localhost:3001/api/sms/send-bulk
Content-Type: application/json

{
  "message": "General announcement",
  "recipients": [
    { "phone": "+1234567890" },
    { "phone": "+1987654321", "personalizedMessage": "Custom message for this person" }
  ]
}
```

### Health Check
```
GET http://localhost:3001/health
```

## 🔧 Troubleshooting

### Common Issues

1. **"Twilio configured: false"** in server logs
   - Check your `.env` file has the correct Twilio credentials
   - Restart the server after updating credentials

2. **"Cannot connect to server"** error
   - Make sure the server is running on port 3001
   - Check that both React app and server are running

3. **Twilio Error 21608: Phone number not found**
   - Make sure your Twilio phone number is correct in the `.env` file
   - Format should be: +1234567890

4. **Messages not being delivered**
   - For trial accounts, ensure the recipient number is verified
   - Check the phone number format includes country code

### Upgrading Your Twilio Account

To send messages to any phone number and remove trial limitations:
1. Add payment method to your Twilio account
2. This will automatically upgrade you from trial to paid account
3. Remove the trial account prefix from messages

## 💡 Next Steps

Once everything is working, you can integrate SMS functionality into your gym app:

- Send workout reminders
- Class schedule notifications  
- Membership renewal alerts
- Emergency notifications
- Welcome messages for new members

Example integration:
```jsx
const sendWorkoutReminder = async (memberPhone, memberName, classTime) => {
  const message = `Hi ${memberName}! Reminder: Your workout class is scheduled for ${classTime}. See you there! 💪`;
  
  const response = await fetch('http://localhost:3001/api/sms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: memberPhone, message })
  });
  
  return response.json();
};
```
