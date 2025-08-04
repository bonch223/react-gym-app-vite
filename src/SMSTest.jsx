import React, { useState } from 'react';

const SMSTest = () => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const sendSMS = async (e) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('http://localhost:3001/api/sms/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: phoneNumber,
          message: message,
        }),
      });

      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({
        success: false,
        error: 'Failed to connect to server: ' + error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const testServerConnection = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:3001/health');
      const data = await response.json();
      setResult({
        success: true,
        message: 'Server is running',
        data: data,
      });
    } catch (error) {
      setResult({
        success: false,
        error: 'Cannot connect to server: ' + error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-8 p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-6 text-center">SMS Test</h2>
      
      {/* Server Test Button */}
      <div className="mb-6">
        <button
          onClick={testServerConnection}
          disabled={loading}
          className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
        >
          {loading ? 'Testing...' : 'Test Server Connection'}
        </button>
      </div>

      {/* SMS Form */}
      <form onSubmit={sendSMS} className="space-y-4">
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
            Phone Number (with country code)
          </label>
          <input
            id="phone"
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="+1234567890"
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-1">
            Message
          </label>
          <textarea
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Enter your message here..."
            required
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !phoneNumber || !message}
          className="w-full bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
        >
          {loading ? 'Sending...' : 'Send SMS'}
        </button>
      </form>

      {/* Result Display */}
      {result && (
        <div className={`mt-6 p-4 rounded-md ${result.success ? 'bg-green-100 border border-green-400' : 'bg-red-100 border border-red-400'}`}>
          <h3 className={`font-semibold ${result.success ? 'text-green-800' : 'text-red-800'}`}>
            {result.success ? 'Success!' : 'Error'}
          </h3>
          <pre className={`mt-2 text-sm ${result.success ? 'text-green-700' : 'text-red-700'} whitespace-pre-wrap`}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export default SMSTest;
