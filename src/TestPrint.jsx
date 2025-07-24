import React, { useState, useRef, useCallback } from 'react';

// --- Helper: ESC/POS Command Generation ---
// A simple class to build command sets for thermal printers.
// For a full implementation, you would use a library or consult your printer's manual.
class EscPosEncoder {
  constructor() {
    this._buffer = [];
    // Initialize printer
    this._buffer.push(0x1B, 0x40); 
  }

  text(value) {
    const bytes = new TextEncoder().encode(value);
    this._buffer.push(...bytes);
    return this;
  }

  newline(lines = 1) {
    for (let i = 0; i < lines; i++) {
      this._buffer.push(0x0A);
    }
    return this;
  }
  
  cut() {
    // Partial cut command
    this._buffer.push(0x1D, 0x56, 0x42, 0x00);
    return this;
  }

  encode() {
    return new Uint8Array(this._buffer);
  }
}


// --- Main React Component ---

export default function App() {
  const [printMode, setPrintMode] = useState('usb'); // 'usb' or 'bluetooth'
  const [log, setLog] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  
  // Refs to hold the device and its characteristic (for bluetooth)
  const usbDevice = useRef(null);
  const bluetoothCharacteristic = useRef(null);

  const addLog = useCallback((message) => {
    console.log(message);
    setLog(prev => [`[${new Date().toLocaleTimeString()}] ${message}`, ...prev]);
  }, []);

  // --- USB-Specific Functions ---

  const handleConnectUsb = async () => {
    if (!navigator.usb) {
      addLog('Error: WebUSB is not supported by this browser.');
      alert('WebUSB is not supported. Please use Chrome or Edge on desktop.');
      return;
    }

    try {
      addLog('Requesting USB device...');
      // Filters can be used to only show specific printers.
      // Common thermal printers use vendorId: 0x0483, 0x04b8, etc.
      // Leaving it empty shows all devices.
      const device = await navigator.usb.requestDevice({ filters: [] });
      usbDevice.current = device;
      
      addLog(`Device selected: ${device.manufacturerName} ${device.productName}`);
      
      addLog('Opening device...');
      await device.open();
      
      addLog('Selecting configuration...');
      await device.selectConfiguration(1);
      
      // THIS IS THE CRITICAL STEP THAT FAILS
      addLog('Claiming interface...');
      // The interface number is usually 0 for printers.
      await device.claimInterface(0); 
      
      addLog('✅ USB Printer Connected and Claimed!');
      setIsConnected(true);

    } catch (error) {
      addLog(`Error: ${error.message}`);
      if (error.message.includes('claimInterface')) {
          addLog('Hint: Another program (like the OS printer driver) is using the device. You may need to use a tool like Zadig to detach the kernel driver.');
      }
    }
  };

  const handlePrintUsb = async () => {
    if (!usbDevice.current) {
      addLog('Error: No USB device connected.');
      return;
    }

    try {
      // Find the correct endpoint to write to. It's usually an "OUT" direction.
      const endpoint = usbDevice.current.configuration.interfaces[0].alternate.endpoints.find(e => e.direction === 'out');
      
      if (!endpoint) {
        addLog('Error: Could not find an OUT endpoint on the device.');
        return;
      }
      
      addLog(`Printing to endpoint: ${endpoint.endpointNumber}`);

      // Create receipt data using ESC/POS commands
      const encoder = new EscPosEncoder();
      const printData = encoder
        .text('Rage Fitness Gym')
        .newline()
        .text('Official Receipt')
        .newline(2)
        .text(`Date: ${new Date().toLocaleDateString()}`)
        .newline()
        .text('Item: 1 Month Membership')
        .newline()
        .text('Amount: P1500.00')
        .newline(3)
        .text('Thank you!')
        .newline(2)
        .cut()
        .encode();

      await usbDevice.current.transferOut(endpoint.endpointNumber, printData);
      addLog('✅ Print command sent successfully!');

    } catch (error) {
      addLog(`Error printing: ${error.message}`);
    }
  };

  // --- Bluetooth-Specific Functions ---

  const handleConnectBluetooth = async () => {
    if (!navigator.bluetooth) {
        addLog('Error: Web Bluetooth is not supported by this browser.');
        alert('Web Bluetooth is not supported. Please use Chrome or Edge on desktop/Android.');
        return;
    }

    try {
        addLog('Requesting Bluetooth device...');
        // '000018f0-0000-1000-8000-00805f9b34fb' is a standard service for printers
        // You may need to find the specific service UUID for your printer model.
        const device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true, // More reliable for finding devices
            // optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb'] 
        });

        addLog(`Device selected: ${device.name}`);
        addLog('Connecting to GATT Server...');
        const server = await device.gatt.connect();

        addLog('Getting Primary Service...');
        // You MUST find the correct service UUID for your printer. This is a common one.
        const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');

        addLog('Getting Characteristic...');
        // And the correct characteristic UUID.
        const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');
        bluetoothCharacteristic.current = characteristic;

        addLog('✅ Bluetooth Printer Connected!');
        setIsConnected(true);

    } catch (error) {
        addLog(`Bluetooth Error: ${error.message}`);
    }
  };

  const handlePrintBluetooth = async () => {
    if (!bluetoothCharacteristic.current) {
        addLog('Error: No Bluetooth characteristic available.');
        return;
    }

    try {
        addLog('Printing via Bluetooth...');
        const encoder = new EscPosEncoder();
        const printData = encoder
            .text('Rage Fitness Gym')
            .newline()
            .text('Bluetooth Test Print')
            .newline(2)
            .text('This is a test.')
            .newline(3)
            .cut()
            .encode();

        // Bluetooth printing often requires sending data in smaller chunks
        const chunkSize = 100; 
        for (let i = 0; i < printData.length; i += chunkSize) {
            const chunk = printData.slice(i, i + chunkSize);
            await bluetoothCharacteristic.current.writeValue(chunk);
        }

        addLog('✅ Print command sent successfully!');
    } catch (error) {
        addLog(`Error printing: ${error.message}`);
    }
  };

  const handleConnect = () => {
    setIsConnected(false);
    if (printMode === 'usb') {
      handleConnectUsb();
    } else {
      handleConnectBluetooth();
    }
  };

  const handlePrint = () => {
    if (printMode === 'usb') {
      handlePrintUsb();
    } else {
      handlePrintBluetooth();
    }
  };


  return (
    <div className="bg-gray-900 text-white min-h-screen font-sans p-4 md:p-8 flex justify-center items-center">
      <div className="w-full max-w-2xl bg-gray-800 rounded-2xl shadow-2xl p-6 space-y-6">
        
        <header className="text-center">
          <h1 className="text-3xl font-bold text-cyan-400">RageFit Web-Printer</h1>
          <p className="text-gray-400 mt-1">Connect to USB or Bluetooth Thermal Printers</p>
        </header>

        {/* --- Step 1: Mode Selection --- */}
        <div className="p-4 bg-gray-700/50 rounded-lg">
          <h2 className="font-semibold text-lg mb-3">1. Select Connection Type</h2>
          <div className="flex gap-4">
            <button 
              onClick={() => { setPrintMode('usb'); setIsConnected(false); }}
              className={`w-full p-3 rounded-md font-bold transition-all ${printMode === 'usb' ? 'bg-cyan-500 text-white shadow-lg' : 'bg-gray-600 hover:bg-gray-500'}`}
            >
              USB
            </button>
            <button 
              onClick={() => { setPrintMode('bluetooth'); setIsConnected(false); }}
              className={`w-full p-3 rounded-md font-bold transition-all ${printMode === 'bluetooth' ? 'bg-indigo-500 text-white shadow-lg' : 'bg-gray-600 hover:bg-gray-500'}`}
            >
              Bluetooth
            </button>
          </div>
        </div>

        {/* --- Step 2 & 3: Connect and Print --- */}
        <div className="p-4 bg-gray-700/50 rounded-lg text-center space-y-4">
            <h2 className="font-semibold text-lg mb-2">2. Connect and Print</h2>
            <div className="flex flex-col md:flex-row gap-4">
                <button
                    onClick={handleConnect}
                    disabled={isConnected}
                    className="w-full p-4 bg-green-600 rounded-lg font-bold text-white hover:bg-green-500 transition disabled:bg-gray-500 disabled:cursor-not-allowed"
                >
                    {isConnected ? 'Connected' : 'Connect to Printer'}
                </button>
                <button
                    onClick={handlePrint}
                    disabled={!isConnected}
                    className="w-full p-4 bg-blue-600 rounded-lg font-bold text-white hover:bg-blue-500 transition disabled:bg-gray-500 disabled:cursor-not-allowed"
                >
                    Print Test Receipt
                </button>
            </div>
        </div>

        {/* --- Step 4: Logs --- */}
        <div className="p-4 bg-black/30 rounded-lg">
          <h2 className="font-semibold text-lg mb-2">Logs</h2>
          <div className="h-48 bg-gray-900 rounded-md p-3 overflow-y-auto font-mono text-sm text-gray-300">
            {log.length === 0 ? <span className="text-gray-500">Waiting for actions...</span> : log.map((line, i) => <p key={i}>{line}</p>)}
          </div>
        </div>
      </div>
    </div>
  );
}
