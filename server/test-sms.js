#!/usr/bin/env node

/**
 * Test script for Semaphore SMS integration
 * Usage: node test-sms.js [phone_number]
 * Example: node test-sms.js 09171234567
 */

import axios from 'axios';

const SERVER_URL = 'http://localhost:3001';
const TEST_PHONE = process.argv[2] || '639171234567'; // Default test number

console.log('🧪 Rage Fitness Gym SMS Test Script');
console.log('=' .repeat(50));

// Test 1: Health Check
async function testHealthCheck() {
    console.log('\n1️⃣ Testing Health Check...');
    try {
        const response = await axios.get(`${SERVER_URL}/health`);
        console.log('✅ Health Check Status:', response.data.status);
        console.log('📱 Semaphore Configured:', response.data.semaphore_configured);
        console.log('📤 Sender Name:', response.data.sender_name);
        return true;
    } catch (error) {
        console.log('❌ Health Check Failed:', error.message);
        return false;
    }
}

// Test 2: Account Balance
async function testAccountBalance() {
    console.log('\n2️⃣ Testing Account Balance...');
    try {
        const response = await axios.get(`${SERVER_URL}/api/semaphore/balance`);
        console.log('✅ Account Balance:', response.data.balance);
        console.log('🏢 Account Name:', response.data.account_name);
        console.log('📊 Status:', response.data.status);
        return true;
    } catch (error) {
        console.log('❌ Balance Check Failed:', error.response?.data?.error || error.message);
        return false;
    }
}

// Test 3: Send Test SMS
async function testSendSMS() {
    console.log(`\n3️⃣ Testing SMS Send to ${TEST_PHONE}...`);
    
    const testMessage = `Hello from Rage Fitness Gym! This is a test message sent at ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}. Your gym membership is important to us! 💪`;
    
    try {
        const response = await axios.post(`${SERVER_URL}/api/sms/send`, {
            to: TEST_PHONE,
            message: testMessage
        });
        
        console.log('✅ SMS Sent Successfully!');
        console.log('📱 To:', response.data.to);
        console.log('📧 Message ID:', response.data.messageId);
        console.log('📊 Status:', response.data.status);
        console.log('💰 Credits Used:', response.data.credits_used);
        console.log('📤 Sender:', response.data.sender);
        console.log('💬 Message Length:', testMessage.length, 'characters');
        return true;
    } catch (error) {
        console.log('❌ SMS Send Failed:', error.response?.data?.error || error.message);
        return false;
    }
}

// Test 4: Send Bulk SMS (Small Test)
async function testBulkSMS() {
    console.log('\n4️⃣ Testing Bulk SMS (2 recipients)...');
    
    const recipients = [
        { phone: TEST_PHONE, personalizedMessage: 'Hi! This is bulk message #1 from Rage Fitness Gym! 🏋️‍♂️' },
        { phone: TEST_PHONE, personalizedMessage: 'Hi! This is bulk message #2 from Rage Fitness Gym! 💪' }
    ];
    
    try {
        const response = await axios.post(`${SERVER_URL}/api/sms/send-bulk`, {
            message: 'Default bulk message from Rage Fitness Gym!',
            recipients: recipients
        });
        
        console.log('✅ Bulk SMS Completed!');
        console.log('📊 Total:', response.data.total);
        console.log('✅ Sent:', response.data.sent);
        console.log('❌ Failed:', response.data.failed);
        console.log('💰 Credits Used:', response.data.credits_used);
        console.log('📤 Sender:', response.data.sender);
        
        if (response.data.errors && response.data.errors.length > 0) {
            console.log('⚠️ Errors:');
            response.data.errors.forEach((error, index) => {
                console.log(`   ${index + 1}. ${error.error}`);
            });
        }
        
        return true;
    } catch (error) {
        console.log('❌ Bulk SMS Failed:', error.response?.data?.error || error.message);
        return false;
    }
}

// Main test runner
async function runTests() {
    console.log(`📞 Testing with phone number: ${TEST_PHONE}`);
    console.log('🏁 Starting tests...\n');
    
    const results = [];
    
    // Run all tests
    results.push(await testHealthCheck());
    results.push(await testAccountBalance());
    results.push(await testSendSMS());
    results.push(await testBulkSMS());
    
    // Summary
    const passed = results.filter(r => r).length;
    const total = results.length;
    
    console.log('\n' + '='.repeat(50));
    console.log(`📋 Test Summary: ${passed}/${total} tests passed`);
    
    if (passed === total) {
        console.log('🎉 All tests passed! Your Semaphore SMS integration is working perfectly!');
        console.log('💡 You can now use SMS in your gym app to:');
        console.log('   • Send membership expiry reminders');
        console.log('   • Send workout reminders');
        console.log('   • Send welcome messages to new members');
        console.log('   • Send class schedules and updates');
    } else {
        console.log('⚠️ Some tests failed. Please check your configuration:');
        console.log('   • Make sure SEMAPHORE_API_KEY is set in .env');
        console.log('   • Verify your Semaphore account has credits');
        console.log('   • Check that the phone number format is correct');
        console.log('   • Ensure the server is running on port 3001');
    }
    
    console.log('\n🏋️‍♂️ Rage Fitness Gym SMS Testing Complete! 💪');
}

// Error handling
process.on('unhandledRejection', (error) => {
    console.log('\n❌ Unhandled Error:', error.message);
    console.log('💡 Make sure the SMS server is running: npm run dev');
    process.exit(1);
});

// Run the tests
runTests().catch((error) => {
    console.log('\n❌ Test Suite Failed:', error.message);
    process.exit(1);
});
