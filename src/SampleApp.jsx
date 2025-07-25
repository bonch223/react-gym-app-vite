import React, { useState, useEffect, useMemo, useRef } from 'react';

// --- Local Database (IndexedDB) Helper ---
const DB_NAME = 'gymManagementDB_v13'; // Incremented DB version for schema change
const DB_VERSION = 1;

const openDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('members')) db.createObjectStore('members', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('inventory')) db.createObjectStore('inventory', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('services')) db.createObjectStore('services', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('sales')) db.createObjectStore('sales', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('checkins')) db.createObjectStore('checkins', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('shifts')) db.createObjectStore('shifts', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('logs')) db.createObjectStore('logs', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('system_users')) db.createObjectStore('system_users', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('expenses')) db.createObjectStore('expenses', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('branding')) db.createObjectStore('branding', { keyPath: 'id' });
        };
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });
};

const dbAction = async (storeName, mode, action) => {
    const db = await openDB();
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    return new Promise((resolve, reject) => {
        const request = action(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
        transaction.oncomplete = () => db.close();
    });
};

// --- Receipt Generation Helper ---
const generateReceipt = (saleData, branding) => {
    const encoder = new TextEncoder();
    let receipt = new Uint8Array(0);

    const append = (data) => {
        const newArr = new Uint8Array(receipt.length + data.length);
        newArr.set(receipt);
        newArr.set(data, receipt.length);
        receipt = newArr;
    };

    // ESC/POS Commands
    const INIT = new Uint8Array([0x1B, 0x40]);
    const ALIGN_CENTER = new Uint8Array([0x1B, 0x61, 0x01]);
    const ALIGN_LEFT = new Uint8Array([0x1B, 0x61, 0x00]);
    const BOLD_ON = new Uint8Array([0x1B, 0x45, 0x01]);
    const BOLD_OFF = new Uint8Array([0x1B, 0x45, 0x00]);
    const DOUBLE_STRIKE_ON = new Uint8Array([0x1B, 0x47, 0x01]);
    const DOUBLE_STRIKE_OFF = new Uint8Array([0x1B, 0x47, 0x00]);
    const FEED_AND_CUT = new Uint8Array([0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x01]);
    const LF = new Uint8Array([0x0A]); // Line Feed

    // Helper to format a line with left and right text
    const formatLine = (left, right) => {
        const width = 32; // Standard for 58mm paper
        const spaces = width - left.length - right.length;
        return `${left}${' '.repeat(Math.max(0, spaces))}${right}\n`;
    };

    // --- Build Receipt ---
    append(INIT);

    // Header
    append(ALIGN_CENTER);
    append(BOLD_ON);
    append(DOUBLE_STRIKE_ON);
    append(encoder.encode(`${branding.gymName}\n`));
    append(BOLD_OFF);
    append(DOUBLE_STRIKE_OFF);
    append(encoder.encode("Tagum City, Davao Region\n"));
    append(encoder.encode("--------------------------------\n"));
    append(LF);

    // Sale Info
    append(ALIGN_LEFT);
    append(encoder.encode(`Date: ${new Date(saleData.saleDate).toLocaleString()}\n`));
    append(encoder.encode(`Client: ${saleData.memberName || 'Walk-in Client'}\n`));
    if (saleData.note) {
        append(encoder.encode(`Note: ${saleData.note}\n`));
    }
    append(encoder.encode("--------------------------------\n"));
    append(LF);

    // Items
    append(encoder.encode(formatLine("Item", "Price")));
    saleData.items.forEach(item => {
        const itemTotal = (item.price * item.qty).toFixed(2);
        append(encoder.encode(`${item.name} x${item.qty}\n`));
        append(encoder.encode(formatLine("", `P${itemTotal}`)));
    });
    append(encoder.encode("--------------------------------\n"));

    // Totals
    append(BOLD_ON);
    append(encoder.encode(formatLine("TOTAL:", `P${saleData.totalAmount.toFixed(2)}`)));
    append(BOLD_OFF);
    append(LF);

    // Payment Details
    append(encoder.encode(formatLine("Payment Method:", saleData.paymentMethod)));
    if (saleData.paymentMethod === 'Split' || saleData.paymentMethod === 'Cash') {
        append(encoder.encode(formatLine("Cash Paid:", `P${saleData.cashPaid.toFixed(2)}`)));
    }
    if (saleData.paymentMethod === 'Split' || saleData.paymentMethod === 'Online') {
        append(encoder.encode(formatLine("Online Paid:", `P${saleData.onlinePaid.toFixed(2)}`)));
    }
    append(LF);

    // Footer
    append(ALIGN_CENTER);
    append(encoder.encode("Thank you!\n"));

    // Cut paper
    append(FEED_AND_CUT);

    return receipt;
};


// --- Date & Status Helpers ---
const getExpiryDate = (startDate, durationValue, durationUnit) => {
    const date = new Date(startDate);
    date.setUTCHours(0, 0, 0, 0);

    if (durationUnit === 'Months') {
        date.setUTCMonth(date.getUTCMonth() + parseInt(durationValue, 10));
    } else if (durationUnit === 'Days') {
        date.setUTCDate(date.getUTCDate() + parseInt(durationValue, 10));
    } else if (durationUnit === 'Sessions') {
        return null;
    }
    return date.toISOString();
};

const getOverallMemberStatus = (services = []) => {
    if (!services || services.length === 0) return { text: 'No Active Services', color: 'gray', sortOrder: 5 };

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const allPaused = services.every(s => s.status === 'paused');
    if (allPaused) {
        return { text: 'Paused', color: 'blue', sortOrder: 1 };
    }

    let earliestExpiry = null;
    let hasActiveService = false;

    const activeServices = services.filter(s => s.status !== 'paused');

    if (activeServices.length === 0) {
        return { text: 'Paused', color: 'blue', sortOrder: 1 };
    }

    activeServices.forEach(s => {
        if (!s.expiryDate) {
            hasActiveService = true;
            return;
        }
        const expiry = new Date(s.expiryDate);
        expiry.setHours(0, 0, 0, 0);
        if (expiry >= now) {
            hasActiveService = true;
            if (!earliestExpiry || expiry < earliestExpiry) {
                earliestExpiry = expiry;
            }
        }
    });

    if (!hasActiveService) return { text: 'All Expired', color: 'red', sortOrder: 4 };
    if (!earliestExpiry) return { text: 'Active', color: 'green', sortOrder: 3 };

    const fiveDaysFromNow = new Date(now);
    fiveDaysFromNow.setDate(fiveDaysFromNow.getDate() + 5);

    if (earliestExpiry <= fiveDaysFromNow) {
        return { text: 'Expiring Soon', color: 'yellow', sortOrder: 2 };
    }

    return { text: 'Active', color: 'green', sortOrder: 3 };
};

const formatMemberName = (member) => {
    if (!member) return 'Walk-in Client';
    if (member.nickname) return member.nickname;
    return `${member.lastName}, ${member.firstName} ${member.middleInitial || ''}`.trim();
};

const formatMemberFullName = (member) => {
    return `${member.lastName}, ${member.firstName} ${member.middleInitial || ''}`.trim();
};


// --- Icons ---
const Icons = {
    Dashboard: () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>,
    Members: () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M15 21h7a2 2 0 002-2v-1a2 2 0 00-2-2h-7a2 2 0 00-2 2v1a2 2 0 002 2z" /></svg>,
    Inventory: () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>,
    Settings: () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.096 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
    Reports: () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V7a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
    Logs: () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>,
    Barcode: () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-12v8M4 8v8" /></svg>,
    Close: () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>,
    Delete: () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>,
    Edit: () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" /></svg>,
    Add: () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>,
    IDCard: () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 012-2h4a2 2 0 012 2v1m-6.002 5h.004M12 15h.004" /></svg>,
    Renew: () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4 4l16 16" /></svg>,
    SortAsc: () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9M3 12h9m0 0l-3-3m3 3l-3 3" /></svg>,
    SortDesc: () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9M3 12h9m0 0l-3 3m3-3l-3-3" /></svg>,
    Reprint: () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v6a2 2 0 002 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z" clipRule="evenodd" /></svg>,
    Refund: () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z" clipRule="evenodd" /></svg>,
};

// --- Main Application Structure ---
export default function App() {
    const [currentUser, setCurrentUser] = useState(null); // Local user state
    const [isLoading, setIsLoading] = useState(true);
    const [branding, setBranding] = useState({
        gymName: 'Gym Management System',
        logo: null,
        primaryColor: '#4338ca', // indigo-700
        accentColor: '#dc2626', // red-600
    });

    useEffect(() => {
        // Check for logged in user in localStorage
        const savedUser = localStorage.getItem('gymUser');
        if (savedUser) {
            setCurrentUser(JSON.parse(savedUser));
        }

        const fetchBranding = async () => {
            const savedBranding = await dbAction('branding', 'readonly', (store) => store.get('brandSettings'));
            if (savedBranding) {
                setBranding(savedBranding);
            }
            setIsLoading(false);
        };

        fetchBranding();
    }, []);

    useEffect(() => {
        document.documentElement.style.setProperty('--primary-color', branding.primaryColor);
        document.documentElement.style.setProperty('--accent-color', branding.accentColor);
    }, [branding]);

    if (isLoading) {
        return <div className="flex items-center justify-center h-screen bg-gray-100"><div className="text-xl font-semibold">Loading...</div></div>;
    }

    return (
        <>
            <style>{`:root { --primary-color: ${branding.primaryColor}; --accent-color: ${branding.accentColor}; }`}</style>
            <div className="app-container" style={{ '--primary-color': branding.primaryColor, '--accent-color': branding.accentColor }}>
                {currentUser ? <GymManagementSystem currentUser={currentUser} setCurrentUser={setCurrentUser} branding={branding} setBranding={setBranding} /> : <LoginScreen setCurrentUser={setCurrentUser} />}
            </div>
        </>
    );
}

const LoginScreen = ({ setCurrentUser }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        const users = await dbAction('system_users', 'readonly', (store) => store.getAll());

        if (isLogin) {
            const user = users.find(u => u.username === username && u.password === password);
            if (user) {
                const userData = { username: user.username, role: user.role, fullName: user.fullName };
                localStorage.setItem('gymUser', JSON.stringify(userData));
                setCurrentUser(userData);
            } else {
                setError("Invalid username or password.");
            }
        } else { // Sign up
            if (users.find(u => u.username === username)) {
                setError("Username already exists.");
                return;
            }
            const role = users.length === 0 ? 'admin' : 'staff';
            const newUser = { id: Date.now().toString(), username, password, role, fullName, createdAt: new Date().toISOString() };
            await dbAction('system_users', 'readwrite', (store) => store.add(newUser));
            const userData = { username: newUser.username, role: newUser.role, fullName: newUser.fullName };
            localStorage.setItem('gymUser', JSON.stringify(userData));
            setCurrentUser(userData);
        }
    };

    return (
        <div className="hero min-h-screen bg-gradient-to-br from-red-50 to-red-100">
            <div className="hero-content flex-col">
                {/* Gym Logo */}
                <div className="text-center mb-6">
                    <div className="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-indigo-700 to-red-600 rounded-full shadow-lg mb-4">
                        <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 2.71 2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l2.14-2.14 1.43 1.43 1.43-1.43-1.43-1.43L22 16.29l-1.43-1.43z" />
                            <circle cx="12" cy="12" r="1.5" />
                        </svg>
                    </div>
                    <h1 className="text-4xl font-extrabold text-gray-800 mb-2">Rage Fitness</h1>
                    <p className="text-lg text-gray-600 font-medium">Gym Management System</p>
                </div>

                <div className="card w-full max-w-md shadow-2xl bg-base-100 border border-base-300">
                    <div className="card-body p-8">
                        <h2 className="card-title text-3xl font-bold justify-center text-base-content mb-6">
                            {isLogin ? 'Login' : 'Sign Up'}
                        </h2>

                        <div className="alert alert-warning mb-4">
                            <div>
                                <h3 className="font-bold">Important Notice</h3>
                                <div className="text-xs">This is an offline application. All data is stored locally in your browser. Use the Backup feature in Settings to prevent data loss.</div>
                            </div>
                        </div>

                        {error && (
                            <div className="alert alert-error mb-4">
                                <div>{error}</div>
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-6">
                            {!isLogin && (
                                <div className="form-control relative">
                                    <input
                                        type="text"
                                        value={fullName}
                                        onChange={e => setFullName(e.target.value)}
                                        required
                                        className="block w-full px-3 pt-6 pb-2 text-sm border border-gray-200 rounded-lg placeholder-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent peer"
                                        placeholder=" "
                                        id="fullName"
                                    />
                                    <label
                                        htmlFor="fullName"
                                        className="absolute left-3 -top-3 text-sm text-gray-600 bg-base-100 px-2 transition-all duration-200 peer-placeholder-shown:top-3 peer-placeholder-shown:text-base peer-placeholder-shown:text-gray-400 peer-focus:-top-3 peer-focus:text-sm peer-focus:text-primary"
                                    >
                                        Full Name
                                    </label>
                                </div>
                            )}

                            <div className="form-control relative">
                                <input
                                    type="text"
                                    value={username}
                                    onChange={e => setUsername(e.target.value)}
                                    required
                                    className="block w-full px-3 pt-6 pb-2 text-sm border border-gray-200 rounded-lg placeholder-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent peer"
                                    placeholder=" "
                                    id="username"
                                />
                                <label
                                    htmlFor="username"
                                    className="absolute left-3 -top-3 text-sm text-gray-600 bg-base-100 px-2 transition-all duration-200 peer-placeholder-shown:top-3 peer-placeholder-shown:text-base peer-placeholder-shown:text-gray-400 peer-focus:-top-3 peer-focus:text-sm peer-focus:text-primary"
                                >
                                    Username
                                </label>
                            </div>

                            <div className="form-control relative">
                                <input
                                    type="password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    required
                                    className="block w-full px-3 pt-6 pb-2 text-sm border border-gray-200 rounded-lg placeholder-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent peer"
                                    placeholder=" "
                                    id="password"
                                />
                                <label
                                    htmlFor="password"
                                    className="absolute left-3 -top-3 text-sm text-gray-600 bg-base-100 px-2 transition-all duration-200 peer-placeholder-shown:top-3 peer-placeholder-shown:text-base peer-placeholder-shown:text-gray-400 peer-focus:-top-3 peer-focus:text-sm peer-focus:text-primary"
                                >
                                    Password
                                </label>
                            </div>

                            <div className="form-control mt-6">
                                <button type="submit" className="btn btn-primary w-full">
                                    {isLogin ? 'Login' : 'Sign Up'}
                                </button>
                            </div>
                        </form>

                        <div className="divider">OR</div>

                        <div className="text-center">
                            <button
                                onClick={() => setIsLogin(!isLogin)}
                                className="btn btn-ghost btn-sm"
                            >
                                {isLogin ? "Need an account? Sign Up" : "Already have an account? Login"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};


const GymManagementSystem = ({ currentUser, setCurrentUser, branding, setBranding }) => {
    const [activeTab, setActiveTab] = useState('dashboard');
    const [notification, setNotification] = useState(null);

    const [members, setMembers] = useState([]);
    const [inventory, setInventory] = useState([]);
    const [services, setServices] = useState([]);
    const [sales, setSales] = useState([]);
    const [checkIns, setCheckIns] = useState([]);
    const [shifts, setShifts] = useState([]);
    const [logs, setLogs] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [masterPassword, setMasterPassword] = useState(null);
    const [systemUsers, setSystemUsers] = useState([]);
    const [printerCharacteristic, setPrinterCharacteristic] = useState(null);
    const [availablePrinters, setAvailablePrinters] = useState([]);
    const [printQueue, setPrintQueue] = useState([]);
    const [isProcessingQueue, setIsProcessingQueue] = useState(false);


    // --- Data Fetching Hook ---
    const useCollection = (collectionName, setter) => {
        useEffect(() => {
            const fetchData = async () => {
                const result = await dbAction(collectionName, 'readonly', (store) => store.getAll());
                setter(result);
            };
            fetchData();
            const interval = setInterval(fetchData, 2000); // Poll for changes
            return () => clearInterval(interval);
        }, [collectionName, setter]);
    };

    useCollection('members', setMembers);
    useCollection('inventory', setInventory);
    useCollection('services', setServices);
    useCollection('sales', setSales);
    useCollection('checkins', setCheckIns);
    useCollection('shifts', setShifts);
    useCollection('logs', setLogs);
    useCollection('expenses', setExpenses);
    useCollection('system_users', setSystemUsers);

    useEffect(() => {
        const fetchSettings = async () => {
            const settings = await dbAction('settings', 'readonly', (store) => store.get('security'));
            if (settings) {
                setMasterPassword(settings.masterPassword);
            }
        };
        fetchSettings();
    }, []);

    const showNotification = (message, type = 'success') => {
        setNotification({ message, type });
        setTimeout(() => setNotification(null), 5000);
    };

    // Print Queue Management
    const addToPrintQueue = (receiptData, label = 'Receipt') => {
        const printJob = {
            id: Date.now().toString(),
            data: receiptData,
            label,
            timestamp: new Date().toISOString(),
            status: 'queued'
        };
        setPrintQueue(prev => [...prev, printJob]);
        processPrintQueue();
    };

    const processPrintQueue = async () => {
        if (isProcessingQueue || printQueue.length === 0 || !printerCharacteristic) {
            return;
        }

        setIsProcessingQueue(true);
        const [currentJob, ...remainingJobs] = printQueue;
        
        try {
            // Update job status to printing
            setPrintQueue(prev => prev.map(job => 
                job.id === currentJob.id ? { ...job, status: 'printing' } : job
            ));
            
            // Send to printer based on connection type
            if (printerCharacteristic.type === 'bluetooth') {
                await printerCharacteristic.characteristic.writeValue(currentJob.data);
            } else if (printerCharacteristic.type === 'usb') {
                await printerCharacteristic.device.transferOut(printerCharacteristic.endpoint, currentJob.data);
            } else {
                throw new Error('Unknown printer connection type');
            }
            
            // Remove completed job from queue
            setPrintQueue(remainingJobs);
            showNotification(`${currentJob.label} printed successfully`, 'success');
            
        } catch (error) {
            console.error('Print job failed:', error);
            // Update job status to failed
            setPrintQueue(prev => prev.map(job => 
                job.id === currentJob.id ? { ...job, status: 'failed' } : job
            ));
            showNotification(`Failed to print ${currentJob.label}`, 'error');
        } finally {
            setIsProcessingQueue(false);
            // Process next job if any
            if (remainingJobs.length > 0) {
                setTimeout(() => processPrintQueue(), 500); // Small delay between jobs
            }
        }
    };

    const clearPrintQueue = () => {
        setPrintQueue([]);
        setIsProcessingQueue(false);
    };

    const retryFailedJobs = () => {
        setPrintQueue(prev => prev.map(job => 
            job.status === 'failed' ? { ...job, status: 'queued' } : job
        ));
        processPrintQueue();
    };

    // Auto-process queue when printer connects or jobs are added
    useEffect(() => {
        if (printerCharacteristic && printQueue.length > 0 && !isProcessingQueue) {
            processPrintQueue();
        }
    }, [printerCharacteristic, printQueue.length]);

    const addLog = async (action) => {
        const newLog = { id: Date.now().toString(), action, user: currentUser.username, timestamp: new Date().toISOString() };
        await dbAction('logs', 'readwrite', (store) => store.add(newLog));
        setLogs(prev => [...prev, newLog]);
    };

    const handleLogout = async () => {
        const activeShift = shifts.find(s => s.status === 'active');
        if (activeShift) {
            showNotification('Please end your active shift before logging out.', 'error');
            return;
        }
        await addLog('User logged out');
        localStorage.removeItem('gymUser');
        setCurrentUser(null);
    };

    const renderTabContent = () => {
        const activeShift = shifts.find(s => s.status === 'active');
        switch (activeTab) {
            case 'dashboard': return <DashboardTab members={members} inventory={inventory} sales={sales} checkIns={checkIns} showNotification={showNotification} activeShift={activeShift} addLog={addLog} user={currentUser} setSales={setSales} setInventory={setInventory} setCheckIns={setCheckIns} setShifts={setShifts} setExpenses={setExpenses} expenses={expenses} shifts={shifts} printerCharacteristic={printerCharacteristic} branding={branding} addToPrintQueue={addToPrintQueue} />;
            case 'members': return <MembersTab members={members} showNotification={showNotification} services={services} setMembers={setMembers} setSales={setSales} activeShift={activeShift} addLog={addLog} />;
            case 'inventory': return <InventoryTab inventory={inventory} showNotification={showNotification} masterPassword={masterPassword} setInventory={setInventory} currentUser={currentUser} addLog={addLog} />;
            case 'reports': return <ReportsTab sales={sales} shifts={shifts} expenses={expenses} members={members} systemUsers={systemUsers} currentUser={currentUser} showNotification={showNotification} setSales={setSales} setInventory={setInventory} addLog={addLog} inventory={inventory} printerCharacteristic={printerCharacteristic} branding={branding} addToPrintQueue={addToPrintQueue} />;
            case 'logs': return <LogsTab logs={logs} />;
            case 'settings': return <SettingsTab services={services} showNotification={showNotification} masterPassword={masterPassword} setMasterPassword={setMasterPassword} systemUsers={systemUsers} setSystemUsers={setSystemUsers} currentUser={currentUser} setServices={setServices} addLog={addLog} printerCharacteristic={printerCharacteristic} setPrinterCharacteristic={setPrinterCharacteristic} branding={branding} setBranding={setBranding} availablePrinters={availablePrinters} setAvailablePrinters={setAvailablePrinters} printQueue={printQueue} clearPrintQueue={clearPrintQueue} retryFailedJobs={retryFailedJobs} isProcessingQueue={isProcessingQueue} />;
            default: return null;
        }
    };

    return (
        <div className="bg-gray-100 min-h-screen font-sans">
        <Header activeTab={activeTab} setActiveTab={setActiveTab} user={currentUser} onLogout={handleLogout} printerConnected={!!printerCharacteristic} branding={branding} printQueue={printQueue} isProcessingQueue={isProcessingQueue} />
            {notification && <Notification message={notification.message} type={notification.type} onClose={() => setNotification(null)} />}
            <main className="container mx-auto p-4 md:p-8">{renderTabContent()}</main>
        </div>
    );
}


// --- Header and Navigation ---
const Header = ({ activeTab, setActiveTab, user, onLogout, printerConnected, branding, printQueue = [], isProcessingQueue = false }) => {
    const tabs = [
        { id: 'dashboard', label: 'Dashboard', icon: <Icons.Dashboard /> },
        { id: 'members', label: 'Members', icon: <Icons.Members /> },
        { id: 'inventory', label: 'Inventory', icon: <Icons.Inventory /> },
        { id: 'reports', label: 'Reports', icon: <Icons.Reports /> },
        { id: 'logs', label: 'Logs', icon: <Icons.Logs /> },
        { id: 'settings', label: 'Settings', icon: <Icons.Settings /> },
    ];

    const PrinterStatusIcon = () => {
        const queuedJobs = printQueue.filter(job => job.status === 'queued').length;
        const failedJobs = printQueue.filter(job => job.status === 'failed').length;
        
        return (
            <div className="flex items-center space-x-2">
                <div title={printerConnected ? "Printer Connected" : "Printer Disconnected"} className="flex items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-6 w-6 ${printerConnected ? 'text-green-400' : 'text-gray-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm7-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                </div>
                {isProcessingQueue && (
                    <div className="flex items-center text-blue-400" title="Printing...">
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    </div>
                )}
                {queuedJobs > 0 && (
                    <span className="bg-blue-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center" title={`${queuedJobs} jobs queued`}>
                        {queuedJobs}
                    </span>
                )}
                {failedJobs > 0 && (
                    <span className="bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center" title={`${failedJobs} jobs failed`}>
                        {failedJobs}
                    </span>
                )}
            </div>
        );
    };

    return (
        <header className="bg-gray-900 text-white shadow-lg print:hidden">
            <div className="container mx-auto px-6">
                <div className="flex items-center justify-between py-4">
                    <div className="flex items-center gap-4">
                        {branding.logo && <img src={branding.logo} alt="Logo" className="h-10 w-auto" />}
                        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{branding.gymName}</h1>
                    </div>
                    <div className="flex items-center space-x-4">
                        <PrinterStatusIcon />
                        <span className="text-sm hidden md:block">{user.fullName} ({user.role})</span>
                        <button onClick={onLogout} className="bg-[var(--primary-color)] text-white font-bold py-2 px-4 rounded-lg hover:opacity-90 transition-opacity">Logout</button>
                    </div>
                </div>
                <nav className="flex space-x-1 overflow-x-auto">{tabs.map(tab => (<button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center flex-shrink-0 px-4 py-3 font-medium rounded-t-lg transition-colors duration-200 ${activeTab === tab.id ? 'bg-gray-100 text-[var(--primary-color)]' : 'text-white hover:bg-gray-700'}`}>{tab.icon} {tab.label}</button>))} </nav>
            </div>
        </header>
    );
};

// --- Reusable Components ---
const Notification = ({ message, type, onClose }) => {
    const typeClasses = { success: 'bg-green-500', error: 'bg-red-500', info: 'bg-blue-500' };
    return (<div className={`fixed bottom-8 right-8 p-4 rounded-lg shadow-xl text-white z-50 transition-transform transform-gpu print:hidden ${typeClasses[type] || 'bg-gray-800'}`}><span>{message}</span><button onClick={onClose} className="ml-4 font-bold">X</button></div>);
};

const Modal = ({ children, onClose, size = 'md' }) => {
    return (<div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center p-4 print:hidden"><div className={`bg-white rounded-2xl shadow-2xl w-full ${size === 'lg' ? 'max-w-4xl' : 'max-w-md'} relative`}><button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-2 rounded-full z-10"><Icons.Close /></button><div className="p-6">{children}</div></div></div>);
};

const IDModal = ({ id, title, onClose }) => (
    <Modal onClose={onClose}>
        <div className="text-center">
            <h3 className="text-2xl font-bold text-gray-800 mb-4">{title}</h3>
            <p className="text-sm text-gray-500 mb-2">This is the unique ID for barcode generation.</p>
            <p className="font-mono bg-gray-100 p-3 rounded-md mt-4 text-lg text-gray-700 break-all">{id}</p>
            <button onClick={onClose} className="mt-6 bg-[var(--primary-color)] text-white font-bold py-2 px-6 rounded-lg hover:opacity-90 transition-opacity">Close</button>
        </div>
    </Modal>
);

const PasswordModal = ({ onConfirm, onCancel }) => {
    const [password, setPassword] = useState('');
    const handleSubmit = (e) => {
        e.preventDefault();
        onConfirm(password);
    };
    return (
        <Modal onClose={onCancel} size="sm">
            <form onSubmit={handleSubmit}>
                <h3 className="text-xl font-bold text-gray-800 mb-4">Master Password Required</h3>
                <p className="text-sm text-gray-600 mb-4">Please enter the master password to proceed with this action.</p>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-2 border rounded" autoFocus />
                <div className="flex justify-end space-x-3 pt-4">
                    <button type="button" onClick={onCancel} className="bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">Cancel</button>
                    <button type="submit" className="bg-[var(--primary-color)] text-white font-bold py-2 px-4 rounded-lg hover:opacity-90 transition-opacity">Confirm</button>
                </div>
            </form>
        </Modal>
    );
};

const ConfirmationModal = ({ title, message, onConfirm, onCancel, confirmText = "Confirm", confirmColor = "bg-[var(--accent-color)] hover:opacity-90" }) => {
    return (
        <Modal onClose={onCancel} size="sm">
            <div>
                <h3 className="text-xl font-bold text-gray-800 mb-4">{title}</h3>
                <p className="text-sm text-gray-600 mb-6">{message}</p>
                <div className="flex justify-end space-x-3">
                    <button type="button" onClick={onCancel} className="bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">Cancel</button>
                    <button type="button" onClick={onConfirm} className={`text-white font-bold py-2 px-4 rounded-lg ${confirmColor}`}>{confirmText}</button>
                </div>
            </div>
        </Modal>
    );
};


// --- Dashboard / POS Tab ---
const DashboardTab = ({ members, inventory, sales, checkIns, showNotification, activeShift, addLog, user, setSales, setInventory, setCheckIns, setShifts, setExpenses, expenses, shifts, printerCharacteristic, branding, addToPrintQueue }) => {
    const [activeSale, setActiveSale] = useState(null);
    const [inputValue, setInputValue] = useState('');
    const [memberSearch, setMemberSearch] = useState('');
    const [productSearch, setProductSearch] = useState('');
    const [assignMemberSearch, setAssignMemberSearch] = useState('');
    const [saleNote, setSaleNote] = useState('');
    const [shiftModal, setShiftModal] = useState(null); // 'start' or 'end'
    const [paymentModalOpen, setPaymentModalOpen] = useState(false);
    const [expenseModalOpen, setExpenseModalOpen] = useState(false);
    const [cashInModalOpen, setCashInModalOpen] = useState(false);
    const inputRef = useRef(null);
    const inactivityTimerRef = useRef(null);

    // Auto-focus the barcode input when clicking outside focusable elements
    useEffect(() => {
        const handleDocumentClick = (e) => {
            // Check if the clicked element is focusable or inside a focusable element
            const focusableElements = 'input, button, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';
            const clickedElement = e.target;
            const isFocusable = clickedElement.matches(focusableElements) || clickedElement.closest(focusableElements);
            
            // If not focusable and input exists, focus the barcode input
            if (!isFocusable && inputRef.current && document.activeElement !== inputRef.current) {
                inputRef.current.focus();
            }
        };

        document.addEventListener('click', handleDocumentClick);
        return () => document.removeEventListener('click', handleDocumentClick);
    }, []);

    // Auto-focus barcode input after 5 seconds of inactivity
    useEffect(() => {
        const resetInactivityTimer = () => {
            if (inactivityTimerRef.current) {
                clearTimeout(inactivityTimerRef.current);
            }
            
            inactivityTimerRef.current = setTimeout(() => {
                if (inputRef.current && document.activeElement !== inputRef.current) {
                    inputRef.current.focus();
                }
            }, 5000); // 5 seconds
        };

        const handleUserActivity = () => {
            resetInactivityTimer();
        };

        // Listen for user activity events
        document.addEventListener('mousedown', handleUserActivity);
        document.addEventListener('mousemove', handleUserActivity);
        document.addEventListener('keypress', handleUserActivity);
        document.addEventListener('scroll', handleUserActivity);
        document.addEventListener('touchstart', handleUserActivity);

        // Start the initial timer
        resetInactivityTimer();

        return () => {
            // Clean up event listeners and timer
            document.removeEventListener('mousedown', handleUserActivity);
            document.removeEventListener('mousemove', handleUserActivity);
            document.removeEventListener('keypress', handleUserActivity);
            document.removeEventListener('scroll', handleUserActivity);
            document.removeEventListener('touchstart', handleUserActivity);
            
            if (inactivityTimerRef.current) {
                clearTimeout(inactivityTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (activeSale) {
            setSaleNote(activeSale.note || '');
        }
    }, [activeSale]);

    const handleScan = async (e) => { e.preventDefault(); const id = inputValue.trim(); if (!id) return; setInputValue(''); const member = members.find(m => m.id === id); if (member) { handleMemberCheckIn(member); return; } const item = inventory.find(i => i.id === id); if (item) { handleAddItemToSale(item); return; } showNotification(`ID "${id}" not found.`, 'error'); };

    const handleMemberCheckIn = async (member) => {
        if (!activeShift) { showNotification('No active shift. Please start a shift first.', 'error'); return; }
        const activeCheckins = checkIns.filter(ci => ci.status === 'active');
        if (activeCheckins.some(ci => ci.memberId === member.id)) {
            showNotification(`${member.firstName} is already checked in.`, 'info');
            return;
        }
        const newCheckIn = { id: Date.now().toString(), memberId: member.id, memberName: `${member.lastName}, ${member.firstName}`, status: 'active', checkinTimestamp: new Date().toISOString(), shiftId: activeShift.id };
        await dbAction('checkins', 'readwrite', (store) => store.add(newCheckIn));
        setCheckIns(prev => [...prev, newCheckIn]);
        showNotification(`Member ${member.firstName} checked in.`, 'success');
        addLog(`Member ${formatMemberFullName(member)} checked in.`);
        setMemberSearch('');
    };

    const handleMemberCheckOut = async (checkInId) => {
        const checkInToUpdate = checkIns.find(ci => ci.id === checkInId);
        const updatedCheckIn = { ...checkInToUpdate, status: 'completed', checkoutTimestamp: new Date().toISOString() };
        await dbAction('checkins', 'readwrite', (store) => store.put(updatedCheckIn));
        setCheckIns(prev => prev.map(ci => ci.id === checkInId ? updatedCheckIn : ci));
        showNotification('Member checked out.', 'success');
        addLog(`Member ${checkInToUpdate.memberName} checked out.`);
    };

    const handleAddItemToSale = async (item) => {
        if (!activeShift) { showNotification('No active shift. Please start a shift first.', 'error'); return; }
        if (!item.isUnlimited && item.quantity <= 0) { showNotification(`${item.name} is out of stock!`, 'error'); return; }

        let saleToUpdate = activeSale;
        let isNewSale = false;

        if (!saleToUpdate) {
            const newSaleId = Date.now().toString();
            const newSaleData = { id: newSaleId, items: [], totalAmount: 0, saleDate: new Date().toISOString(), status: 'Unpaid', memberId: null, memberName: 'Walk-in Client', note: '', shiftId: activeShift.id, paymentMethod: null, cashPaid: 0, onlinePaid: 0 };
            await dbAction('sales', 'readwrite', (store) => store.add(newSaleData));
            setSales(prev => [...prev, newSaleData]);
            saleToUpdate = newSaleData;
            setActiveSale(saleToUpdate);
            isNewSale = true;
            showNotification('New sale started.', 'info');
        }

        const currentItemInSale = saleToUpdate.items.find(i => i.id === item.id);
        const newItems = currentItemInSale
            ? saleToUpdate.items.map(i => i.id === item.id ? { ...i, qty: i.qty + 1 } : i)
            : [...saleToUpdate.items, { id: item.id, name: item.name, price: item.price, qty: 1 }];

        const newTotal = newItems.reduce((sum, i) => sum + (i.price * i.qty), 0);
        const updatedSale = { ...saleToUpdate, items: newItems, totalAmount: newTotal };

        if (!item.isUnlimited) {
            const updatedInventoryItem = { ...item, quantity: item.quantity - 1 };
            await dbAction('inventory', 'readwrite', (store) => store.put(updatedInventoryItem));
            setInventory(prev => prev.map(i => i.id === item.id ? updatedInventoryItem : i));
        }

        await dbAction('sales', 'readwrite', (store) => store.put(updatedSale));
        setSales(prev => prev.map(s => s.id === updatedSale.id ? updatedSale : s));

        if (isNewSale) {
            setActiveSale(updatedSale);
        } else {
            setActiveSale(prev => ({ ...prev, items: newItems, totalAmount: newTotal }));
        }
        showNotification(`${item.name} added to sale.`, 'success');
        setProductSearch('');
    };

    const handleAssignMemberToSale = async (member) => {
        if (!activeSale) return;
        const memberName = formatMemberName(member);
        const updatedSale = { ...activeSale, memberId: member.id, memberName };
        await dbAction('sales', 'readwrite', (store) => store.put(updatedSale));
        setSales(prev => prev.map(s => s.id === updatedSale.id ? updatedSale : s));
        setActiveSale(updatedSale);
        showNotification(`Sale assigned to ${memberName}.`, 'success');
        setAssignMemberSearch('');
    };

    const handleProcessPayment = async (paymentDetails) => {
        if (!activeSale) return;
        
        // Process payment - this completes regardless of printer connection status
        const updatedSale = {
            ...activeSale,
            status: 'Paid',
            note: saleNote,
            paymentMethod: paymentDetails.method,
            cashPaid: paymentDetails.cashAmount || 0,
            onlinePaid: paymentDetails.onlineAmount || 0,
            // Store discount information
            hasDiscount: paymentDetails.hasDiscount || false,
            discountType: paymentDetails.discountType || null,
            discountValue: paymentDetails.discountValue || 0,
            discountAmount: paymentDetails.discountAmount || 0,
            originalAmount: paymentDetails.originalAmount || activeSale.totalAmount,
            // Update totalAmount to reflect the discounted price
            totalAmount: paymentDetails.finalAmount || activeSale.totalAmount,
        };
        await dbAction('sales', 'readwrite', (store) => store.put(updatedSale));
        setSales(prev => prev.map(s => s.id === updatedSale.id ? updatedSale : s));
        await addLog(`Sale ${activeSale.id.slice(-4)} for ₱${activeSale.totalAmount.toFixed(2)} paid via ${paymentDetails.method}.`);
        showNotification(`Sale marked as Paid.`, 'success');

        // Queue receipt for printing (optional - only if printer is connected)
        if (printerCharacteristic) {
            const receiptData = generateReceipt(updatedSale, branding);
            addToPrintQueue(receiptData, `Receipt #${updatedSale.id.slice(-4)}`);
            addLog(`Queued receipt for sale ${updatedSale.id.slice(-4)} for printing.`);
        } else {
            // Notify user that receipt wasn't printed but payment was successful
            showNotification('Payment completed. No printer connected - receipt not printed.', 'info');
            addLog(`Payment completed for sale ${updatedSale.id.slice(-4)} but receipt not printed (no printer connected).`);
        }

        setActiveSale(null);
        setPaymentModalOpen(false);
    };

    const handleCancelItem = async (itemIndex) => {
        if (!activeSale) return;

        const itemToRemove = activeSale.items[itemIndex];
        const newItems = activeSale.items.filter((_, index) => index !== itemIndex);
        const newTotal = newItems.reduce((sum, i) => sum + (i.price * i.qty), 0);

        const updatedSale = { ...activeSale, items: newItems, totalAmount: newTotal };

        const originalItem = inventory.find(i => i.id === itemToRemove.id);
        if (originalItem && !originalItem.isUnlimited) {
            const updatedInventoryItem = { ...originalItem, quantity: originalItem.quantity + itemToRemove.qty };
            await dbAction('inventory', 'readwrite', (store) => store.put(updatedInventoryItem));
            setInventory(prev => prev.map(i => i.id === originalItem.id ? updatedInventoryItem : i));
        }

        if (newItems.length === 0) {
            await dbAction('sales', 'readwrite', (store) => store.delete(activeSale.id));
            setSales(prev => prev.filter(s => s.id !== activeSale.id));
            setActiveSale(null);
            showNotification('Sale voided as it has no items left.', 'info');
        } else {
            await dbAction('sales', 'readwrite', (store) => store.put(updatedSale));
            setSales(prev => prev.map(s => s.id === updatedSale.id ? updatedSale : s));
            setActiveSale(updatedSale);
            showNotification(`${itemToRemove.name} removed from sale.`, 'success');
        }
        addLog(`Item ${itemToRemove.name} (x${itemToRemove.qty}) removed from sale ${activeSale.id.slice(-4)}.`);
    };

    const handleVoidSale = async () => {
        if (!activeSale) return;

        for (const item of activeSale.items) {
            const originalItem = inventory.find(i => i.id === item.id);
            if (originalItem && !originalItem.isUnlimited) {
                const updatedInventoryItem = { ...originalItem, quantity: originalItem.quantity + item.qty };
                await dbAction('inventory', 'readwrite', (store) => store.put(updatedInventoryItem));
                setInventory(prev => prev.map(i => i.id === originalItem.id ? updatedInventoryItem : i));
            }
        }

        await dbAction('sales', 'readwrite', (store) => store.delete(activeSale.id));
        setSales(prev => prev.filter(s => s.id !== activeSale.id));
        setActiveSale(null);
        await addLog(`Sale ${activeSale.id.slice(-4)} was voided.`);
        showNotification('Sale has been voided.', 'info');
    };

    const handleQuantityChange = async (itemIndex, delta) => {
        if (!activeSale) return;

        const item = activeSale.items[itemIndex];
        const newQty = item.qty + delta;

        if (newQty <= 0) {
            // Remove item if quantity becomes 0 or less
            await handleCancelItem(itemIndex);
            return;
        }

        // Check inventory availability for increase
        if (delta > 0) {
            const inventoryItem = inventory.find(i => i.id === item.id);
            if (inventoryItem && !inventoryItem.isUnlimited && inventoryItem.quantity < 1) {
                showNotification('Not enough inventory available.', 'error');
                return;
            }
        }

        // Update item quantity
        const newItems = activeSale.items.map((i, index) => 
            index === itemIndex ? { ...i, qty: newQty } : i
        );
        const newTotal = newItems.reduce((sum, i) => sum + (i.price * i.qty), 0);
        const updatedSale = { ...activeSale, items: newItems, totalAmount: newTotal };

        // Update inventory
        const inventoryItem = inventory.find(i => i.id === item.id);
        if (inventoryItem && !inventoryItem.isUnlimited) {
            const updatedInventoryItem = { ...inventoryItem, quantity: inventoryItem.quantity - delta };
            await dbAction('inventory', 'readwrite', (store) => store.put(updatedInventoryItem));
            setInventory(prev => prev.map(i => i.id === item.id ? updatedInventoryItem : i));
        }

        // Update sale
        await dbAction('sales', 'readwrite', (store) => store.put(updatedSale));
        setSales(prev => prev.map(s => s.id === updatedSale.id ? updatedSale : s));
        setActiveSale(updatedSale);
        
        showNotification(`${item.name} quantity ${delta > 0 ? 'increased' : 'decreased'}.`, 'success');
    };

    const handleAddExpense = async (expenseData) => {
        const newExpense = {
            ...expenseData,
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            shiftId: activeShift.id,
            addedDuringClose: false,
        };
        await dbAction('expenses', 'readwrite', (store) => store.add(newExpense));
        setExpenses(prev => [...prev, newExpense]);
        addLog(`Recorded expense: ${expenseData.note} for ₱${expenseData.amount.toFixed(2)} via ${expenseData.type}.`);
        showNotification('Expense recorded.', 'success');
        setExpenseModalOpen(false);
    };

    const handleAddCashIn = async (cashInData) => {
        const newCashIn = {
            ...cashInData,
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            shiftId: activeShift.id,
            type: 'Cash In',
        };
        await dbAction('expenses', 'readwrite', (store) => store.add(newCashIn));
        setExpenses(prev => [...prev, newCashIn]);
        addLog(`Recorded cash in: ${cashInData.note} for ₱${cashInData.amount.toFixed(2)}.`);
        showNotification('Cash In recorded.', 'success');
        setCashInModalOpen(false);
    };

    const filteredMembers = memberSearch ? members.filter(m => `${m.firstName} ${m.lastName} ${m.nickname}`.toLowerCase().includes(memberSearch.toLowerCase())) : [];
    const filteredProducts = productSearch ? inventory.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase())) : [];
    const assignableMembers = assignMemberSearch ? members.filter(m => `${m.firstName} ${m.lastName} ${m.nickname}`.toLowerCase().includes(assignMemberSearch.toLowerCase())) : [];
    const unpaidSales = sales.filter(s => s.status === 'Unpaid');
    const activeCheckins = checkIns.filter(ci => ci.status === 'active').sort((a, b) => new Date(b.checkinTimestamp) - new Date(a.checkinTimestamp));

    return (
        <div className="space-y-6">
            <DashboardAnalytics members={members} sales={sales} checkIns={checkIns} />
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6"

                style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                {shiftModal && <ShiftModal type={shiftModal} activeShift={activeShift} sales={sales} expenses={expenses} onCancel={() => setShiftModal(null)} showNotification={showNotification} addLog={addLog} user={user} setShifts={setShifts} setExpenses={setExpenses} shifts={shifts} />}
                {paymentModalOpen && activeSale && <PaymentModal sale={activeSale} onCancel={() => setPaymentModalOpen(false)} onConfirm={handleProcessPayment} />}
                {expenseModalOpen && <ExpenseModal onCancel={() => setExpenseModalOpen(false)} onConfirm={handleAddExpense} />}
                {cashInModalOpen && <CashInModal onCancel={() => setCashInModalOpen(false)} onConfirm={handleAddCashIn} />}

                <div className="lg:col-span-2 space-y-6">
                    {/* Shift Management Card */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-5 border-b border-gray-50">
                            <div className="flex justify-between items-center">
                                <h2 className="text-lg font-semibold text-gray-900">Shift Control</h2>
                                <div className="flex gap-2">
                                    {activeShift && <button onClick={() => setCashInModalOpen(true)} className="bg-indigo-50 text-indigo-700 text-sm font-medium py-2 px-3 rounded-lg hover:bg-indigo-100 transition-colors">Cash In</button>}
                                    {activeShift && <button onClick={() => setExpenseModalOpen(true)} className="bg-amber-50 text-amber-700 text-sm font-medium py-2 px-3 rounded-lg hover:bg-amber-100 transition-colors">Expense</button>}
                                    {activeShift ? <button onClick={() => setShiftModal('end')} className="bg-red-50 text-red-700 text-sm font-medium py-2 px-3 rounded-lg hover:bg-red-100 transition-colors">End Shift</button> : <button onClick={() => setShiftModal('start')} className="bg-green-50 text-green-700 text-sm font-medium py-2 px-3 rounded-lg hover:bg-green-100 transition-colors">Start Shift</button>}
                                </div>
                            </div>
                        </div>
                        <div className="p-5">
                            {activeShift ?
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                    <p className="text-sm text-gray-600">Active since {new Date(activeShift.startTime).toLocaleString()}</p>
                                </div>
                                :
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                                    <p className="text-sm text-gray-500">No active shift</p>
                                </div>
                            }
                        </div>
                    </div>

                    {/* Scanner / Check-in Card */}
                    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 ${!activeShift ? 'opacity-40 pointer-events-none' : ''}`}>
                        <div className="p-5 border-b border-gray-50">
                            <h2 className="text-lg font-semibold text-gray-900">Quick Actions</h2>
                        </div>
                        <div className="p-5 space-y-5">
                            {/* Scanner Input */}
                            <form onSubmit={handleScan}>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Icons.Barcode className="h-5 w-5 text-gray-400" />
                                    </div>
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        value={inputValue}
                                        onChange={(e) => setInputValue(e.target.value)}
                                        className="block w-full pl-10 pr-20 py-3 border border-gray-200 rounded-lg text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                        placeholder="Scan barcode or search..."
                                    />
                                    <button
                                        type="submit"
                                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-indigo-600 hover:text-indigo-700"
                                    >
                                        <span className="text-sm font-medium">Enter</span>
                                    </button>
                                </div>
                            </form>

                            {/* Manual Search Fields */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="relative">
                                    <input
                                        type="text"
                                        placeholder=" "
                                        value={memberSearch}
                                        onChange={e => setMemberSearch(e.target.value)}
                                        className="block w-full px-3 pt-6 pb-2 text-sm border border-gray-200 rounded-lg placeholder-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent peer"
                                        id="memberSearch"
                                    />
                                    <label
                                        htmlFor="memberSearch"
                                        className="absolute text-sm text-gray-500 duration-300 transform -translate-y-4 scale-75 top-4 left-3 origin-[0] peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-1 peer-focus:scale-75 peer-focus:-translate-y-4"
                                    >
                                        Member Check-in
                                    </label>
                                    {filteredMembers.length > 0 &&
                                        <ul className="absolute z-20 w-full bg-white border border-gray-200 rounded-lg mt-1 shadow-lg max-h-40 overflow-y-auto">
                                            {filteredMembers.map(member =>
                                                <li key={member.id} onClick={() => handleMemberCheckIn(member)} className="p-3 hover:bg-gray-50 cursor-pointer text-sm border-b border-gray-50 last:border-b-0">
                                                    {formatMemberFullName(member)}
                                                </li>
                                            )}
                                        </ul>
                                    }
                                </div>
                                <div className="relative">
                                    <input
                                        type="text"
                                        placeholder=" "
                                        value={productSearch}
                                        onChange={e => setProductSearch(e.target.value)}
                                        className="block w-full px-3 pt-6 pb-2 text-sm border border-gray-200 rounded-lg placeholder-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent peer"
                                        id="productSearch"
                                    />
                                    <label
                                        htmlFor="productSearch"
                                        className="absolute text-sm text-gray-500 duration-300 transform -translate-y-4 scale-75 top-4 left-3 origin-[0] peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-1 peer-focus:scale-75 peer-focus:-translate-y-4"
                                    >
                                        Product Search
                                    </label>
                                    {filteredProducts.length > 0 &&
                                        <ul className="absolute z-20 w-full bg-white border border-gray-200 rounded-lg mt-1 shadow-lg max-h-40 overflow-y-auto">
                                            {filteredProducts.map(item =>
                                                <li key={item.id} onClick={() => handleAddItemToSale(item)} className="p-3 hover:bg-gray-50 cursor-pointer text-sm border-b border-gray-50 last:border-b-0">
                                                    {item.name}
                                                </li>
                                            )}
                                        </ul>
                                    }
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Open Sales Card */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-5 border-b border-gray-50">
                            <h2 className="text-lg font-semibold text-gray-900">Open Sales</h2>
                        </div>
                        <div className="p-5">
                            {unpaidSales.length > 0 ? (
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                    {unpaidSales.map(sale => (
                                        <button
                                            key={sale.id}
                                            onClick={(e) => { e.stopPropagation(); setActiveSale(sale); }}
                                            className={`p-3 rounded-lg text-left transition-all duration-200 ${activeSale?.id === sale.id
                                                    ? 'bg-indigo-50 border-2 border-indigo-200 shadow-sm'
                                                    : 'bg-gray-50 border border-gray-200 hover:bg-gray-100 hover:shadow-sm'
                                                }`}
                                        >
                                            <p className="font-medium text-sm text-gray-900 truncate">{sale.memberName}</p>
                                            <p className="text-xs text-indigo-600 font-medium mt-1">₱{sale.totalAmount.toFixed(2)}</p>
                                            <p className="text-xs text-gray-400 mt-1">...{sale.id.slice(-4)}</p>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-gray-500 text-sm text-center py-4">No open sales</p>
                            )}
                        </div>
                    </div>

                    {/* Currently Checked-in Card */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="p-5 border-b border-gray-50">
                            <h3 className="text-lg font-semibold text-gray-900">Active Check-ins</h3>
                        </div>
                        <div className="p-5">
                            {activeCheckins.length > 0 ? (
                                <div className="space-y-3">
                                    {activeCheckins.map(ci => (
                                        <div key={ci.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                                            <div>
                                                <p className="font-medium text-sm text-gray-900">{ci.memberName}</p>
                                                <p className="text-xs text-gray-500">Since {new Date(ci.checkinTimestamp).toLocaleTimeString()}</p>
                                            </div>
                                            <button
                                                onClick={() => handleMemberCheckOut(ci.id)}
                                                className="bg-red-50 text-red-600 text-xs font-medium py-1.5 px-3 rounded-md hover:bg-red-100 transition-colors"
                                            >
                                                Check Out
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-gray-500 text-sm text-center py-4">No active check-ins</p>
                            )}
                        </div>
                    </div>
                </div>
                <div className="lg:col-span-1">
                    {activeSale ? (
                        <div className="bg-white p-6 rounded-2xl shadow-lg sticky top-8" onClick={e => e.stopPropagation()}>
                            <div className="flex justify-between items-center mb-4"><h3 className="text-xl font-bold text-gray-800">Active Sale</h3><button onClick={() => setActiveSale(null)} className="text-sm text-gray-500 hover:text-red-600">Close</button></div>
                            <p className="mb-2"><strong>Client:</strong> {activeSale.memberName}</p>
                            {activeSale.memberId === null && <div className="relative mb-4"><input type="text" placeholder="Assign to member..." value={assignMemberSearch} onChange={e => setAssignMemberSearch(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg" />{assignableMembers.length > 0 && <ul className="absolute z-10 w-full bg-white border border-gray-300 rounded-lg mt-1 shadow-lg max-h-40 overflow-y-auto">{assignableMembers.map(member => <li key={member.id} onClick={() => handleAssignMemberToSale(member)} className="p-2 hover:bg-indigo-50 cursor-pointer">{formatMemberFullName(member)}</li>)}</ul>}</div>}
                            <ul className="space-y-2 mb-4 max-h-60 overflow-y-auto">{activeSale.items.map((item, index) => (<li key={index} className="flex justify-between items-center text-sm"><div className="flex items-center gap-2"><span>{item.name}</span><div className="flex items-center gap-1 bg-gray-100 rounded px-2 py-1"><button onClick={() => handleQuantityChange(index, -1)} className="text-gray-600 hover:text-gray-800 font-bold text-xs w-5 h-5 flex items-center justify-center">-</button><span className="font-mono text-xs min-w-[20px] text-center">{item.qty}</span><button onClick={() => handleQuantityChange(index, 1)} className="text-gray-600 hover:text-gray-800 font-bold text-xs w-5 h-5 flex items-center justify-center">+</button></div></div><span className="font-mono">₱{(item.price * item.qty).toFixed(2)}</span><button onClick={() => handleCancelItem(index)} className="text-red-500 font-bold text-xs ml-2">X</button></li>))}</ul>
                            <div className="border-t pt-4 flex justify-between items-center"><p className="text-lg font-bold">Total:</p><p className="text-2xl font-bold text-[var(--primary-color)]">₱{activeSale.totalAmount.toFixed(2)}</p></div>
                            <textarea value={saleNote} onChange={e => setSaleNote(e.target.value)} placeholder="Add a note to the sale..." className="w-full p-2 border border-gray-300 rounded-lg mt-4 text-sm"></textarea>
                            <div className="mt-2 space-y-3">
                                <button onClick={() => setPaymentModalOpen(true)} className="w-full bg-green-500 text-white font-bold py-3 rounded-lg hover:bg-green-600 transition">Process Payment</button>
                                <button onClick={handleVoidSale} className="w-full bg-[var(--accent-color)] text-white font-bold py-2 rounded-lg hover:opacity-90 transition-opacity text-sm">Void Sale</button>
                            </div>
                        </div>
                    ) : <div className="bg-white p-6 rounded-2xl shadow-lg text-center"><p className="text-gray-500">Select an open sale or scan/search a product to begin.</p></div>}
                </div>
            </div>
        </div>
    );
};

const DashboardAnalytics = ({ members, sales, checkIns }) => {
    const analytics = useMemo(() => {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        const activeMembers = members.filter(m => getOverallMemberStatus(m.activeServices).text === 'Active').length;
        const expiringSoon = members.filter(m => getOverallMemberStatus(m.activeServices).text === 'Expiring Soon').length;

        const checkedInTodayIds = new Set();
        checkIns.forEach(ci => {
            if (new Date(ci.checkinTimestamp).getTime() >= todayStart) {
                checkedInTodayIds.add(ci.memberId);
            }
        });

        const todaysRevenue = sales
            .filter(s => new Date(s.saleDate).getTime() >= todayStart && s.status === 'Paid')
            .reduce((sum, s) => sum + s.totalAmount, 0);

        return {
            activeMembers,
            expiringSoon,
            checkedInToday: checkedInTodayIds.size,
            todaysRevenue
        };
    }, [members, sales, checkIns]);

    const [revenueVisible, setRevenueVisible] = useState(false);

    const StatCard = ({ title, value, icon }) => {
        const isRevenueCard = title === "Today's Revenue";
        const displayValue = isRevenueCard && !revenueVisible ? "••••••" : value;
        
        return (
            <div className="bg-white p-4 rounded-xl shadow-md flex items-center">
                <div className="bg-indigo-100 p-3 rounded-full mr-4">{icon}</div>
                <div className="flex-1">
                    <p className="text-sm text-gray-500">{title}</p>
                    <p className="text-2xl font-bold text-gray-800">{displayValue}</p>
                </div>
                {isRevenueCard && (
                    <button
                        onClick={() => setRevenueVisible(!revenueVisible)}
                        className="ml-2 p-2 text-gray-400 hover:text-gray-600 transition-colors"
                        title="Click to toggle revenue visibility"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                    </button>
                )}
            </div>
        );
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
            style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            <StatCard title="Active Members" value={analytics.activeMembers} icon={<Icons.Members />} />
            <StatCard title="Expiring Soon" value={analytics.expiringSoon} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
            <StatCard title="Checked-in Today" value={analytics.checkedInToday} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
            <StatCard title="Today's Revenue" value={`₱${analytics.todaysRevenue.toFixed(2)}`} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>} />
        </div>
    );
}

const PaymentModal = ({ sale, onCancel, onConfirm }) => {
    const [method, setMethod] = useState('Cash');
    const [cashAmount, setCashAmount] = useState('');
    const [onlineAmount, setOnlineAmount] = useState('');
    const [discount, setDiscount] = useState('0');
    const [discountType, setDiscountType] = useState('percentage'); // 'percentage' or 'fixed'
    const [discountExpanded, setDiscountExpanded] = useState(false);
    const [discountApplied, setDiscountApplied] = useState(false);

    const discountValue = parseFloat(discount) || 0;
    const discountAmount = discountType === 'percentage' 
        ? (discountValue / 100) * sale.totalAmount 
        : discountValue;
    const totalAfterDiscount = Math.max(0, sale.totalAmount - discountAmount);

    useEffect(() => {
        const finalAmount = discountApplied && discountAmount > 0 ? totalAfterDiscount : sale.totalAmount;

        if (method === 'Cash') {
            setCashAmount(finalAmount.toFixed(2));
            setOnlineAmount('');
        } else if (method === 'Online') {
            setOnlineAmount(finalAmount.toFixed(2));
            setCashAmount('');
        } else { // Split
            setCashAmount('');
            setOnlineAmount('');
        }
    }, [method, sale.totalAmount, discountApplied, totalAfterDiscount]);

    const handleSubmit = (e) => {
        e.preventDefault();
        const paymentDetails = {
            method,
            cashAmount: parseFloat(cashAmount) || 0,
            onlineAmount: parseFloat(onlineAmount) || 0,
            // Add discount information
            hasDiscount: discountApplied && discountAmount > 0,
            discountType: discountApplied && discountAmount > 0 ? discountType : null,
            discountValue: discountApplied && discountAmount > 0 ? discountValue : 0,
            discountAmount: discountApplied && discountAmount > 0 ? discountAmount : 0,
            originalAmount: sale.totalAmount,
            finalAmount: discountApplied && discountAmount > 0 ? totalAfterDiscount : sale.totalAmount,
        };
        
        const finalTotal = discountApplied && discountAmount > 0 ? totalAfterDiscount : sale.totalAmount;
        
        if (method === 'Split') {
            if (Math.abs(paymentDetails.cashAmount + paymentDetails.onlineAmount - finalTotal) > 0.001) {
                alert('Split payment amounts must add up to the total amount.');
                return;
            }
        }
        onConfirm(paymentDetails);
    };

    return (
        <Modal onClose={onCancel}>
            <form onSubmit={handleSubmit}>
                <h3 className="text-2xl font-bold text-gray-800 mb-4">Process Payment</h3>
                <div className="mb-4">
                    <p className="text-lg font-semibold">
                        {discountApplied && discountAmount > 0 ? (
                            <>
                                <span className="line-through text-gray-500">₱{sale.totalAmount.toFixed(2)}</span>
                                <span className="ml-2 font-mono text-[var(--primary-color)]">₱{totalAfterDiscount.toFixed(2)}</span>
                                <span className="ml-2 text-sm text-green-600">(₱{discountAmount.toFixed(2)} discount)</span>
                            </>
                        ) : (
                            <>Total Due: <span className="font-mono text-[var(--primary-color)]">₱{sale.totalAmount.toFixed(2)}</span></>
                        )}
                    </p>
                </div>

                <div className="space-y-4">
                    {/* Discount Accordion */}
                    <div className="border rounded-lg">
                        <button
                            type="button"
                            onClick={() => setDiscountExpanded(!discountExpanded)}
                            className="w-full p-3 text-left bg-gray-50 hover:bg-gray-100 rounded-t-lg font-medium text-gray-700 flex justify-between items-center"
                        >
                            <span>Special Discount</span>
                            <svg 
                                className={`w-5 h-5 transform transition-transform ${discountExpanded ? 'rotate-180' : ''}`}
                                fill="none" 
                                stroke="currentColor" 
                                viewBox="0 0 24 24"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                        
                        {discountExpanded && (
                            <div className="p-4 border-t">
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Discount Type</label>
                                        <select 
                                            value={discountType} 
                                            onChange={e => setDiscountType(e.target.value)}
                                            className="w-full p-2 border rounded bg-white"
                                        >
                                            <option value="percentage">Percentage (%)</option>
                                            <option value="fixed">Fixed Amount (₱)</option>
                                        </select>
                                    </div>
                                    
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            {discountType === 'percentage' ? 'Discount Percentage' : 'Discount Amount'}
                                        </label>
                                        <input
                                            type="number"
                                            step={discountType === 'percentage' ? '0.1' : '0.01'}
                                            min="0"
                                            max={discountType === 'percentage' ? '100' : sale.totalAmount.toString()}
                                            value={discount}
                                            onChange={e => setDiscount(e.target.value)}
                                            className="w-full p-2 border rounded"
                                            placeholder={discountType === 'percentage' ? 'Enter percentage (0-100)' : 'Enter amount'}
                                        />
                                    </div>
                                    
                                    {discountValue > 0 && (
                                        <div className="bg-blue-50 p-3 rounded border">
                                            <p className="text-sm text-gray-600">
                                                Discount: {discountType === 'percentage' ? `${discountValue}%` : `₱${discountValue.toFixed(2)}`} 
                                                = ₱{discountAmount.toFixed(2)}
                                            </p>
                                            <p className="text-sm font-semibold text-blue-800">
                                                New Total: ₱{totalAfterDiscount.toFixed(2)}
                                            </p>
                                        </div>
                                    )}
                                    
                                    <button
                                        type="button"
                                        onClick={() => setDiscountApplied(true)}
                                        className="w-full bg-blue-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-600"
                                        disabled={discountValue <= 0}
                                    >
                                        Apply Discount
                                    </button>
                                    
                                    {discountApplied && discountAmount > 0 && (
                                        <div className="bg-green-50 p-2 rounded border border-green-200">
                                            <p className="text-sm text-green-800 font-medium">
                                                ✓ Discount of ₱{discountAmount.toFixed(2)} applied
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Payment Method</label>
                        <select value={method} onChange={e => setMethod(e.target.value)} className="w-full p-2 border rounded bg-white">
                            <option>Cash</option>
                            <option>Online</option>
                            <option>Split</option>
                        </select>
                    </div>

                    {method === 'Cash' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Cash Amount</label>
                            <input type="number" step="0.01" value={cashAmount} onChange={e => setCashAmount(e.target.value)} className="w-full p-2 border rounded" required />
                        </div>
                    )}
                    {method === 'Online' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Online Amount</label>
                            <input type="number" step="0.01" value={onlineAmount} onChange={e => setOnlineAmount(e.target.value)} className="w-full p-2 border rounded" required />
                        </div>
                    )}
                    {method === 'Split' && (
                        <div className="grid grid-cols-2 gap-4 p-4 border rounded-lg">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Cash Amount</label>
                                <input type="number" step="0.01" value={cashAmount} onChange={e => setCashAmount(e.target.value)} placeholder="0.00" className="w-full p-2 border rounded" required />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Online Amount</label>
                                <input type="number" step="0.01" value={onlineAmount} onChange={e => setOnlineAmount(e.target.value)} placeholder="0.00" className="w-full p-2 border rounded" required />
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex justify-end space-x-3 pt-6">
                    <button type="button" onClick={onCancel} className="bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">Cancel</button>
                    <button type="submit" className="bg-green-500 text-white font-bold py-2 px-6 rounded-lg hover:bg-green-600">Confirm Payment</button>
                </div>
            </form>
        </Modal>
    );
};

// --- Members Tab ---
const MembersTab = ({ members, showNotification, services, setMembers, setSales, activeShift, addLog }) => {
    const [editingMember, setEditingMember] = useState(null);
    const [viewingId, setViewingId] = useState(null);
    const [filter, setFilter] = useState('All');
    const [searchTerm, setSearchTerm] = useState('');

    const handleSaveMember = async (memberData, memberId, originalServices) => {
        const dataToSave = {
            ...memberData,
            id: memberId || Date.now().toString(),
        };
        await dbAction('members', 'readwrite', (store) => store.put(dataToSave));

        const newServices = memberData.activeServices.filter(s => !originalServices.some(os => os.purchaseDate === s.purchaseDate && os.serviceId === s.serviceId));
        const paidNewServices = newServices.filter(s => {
            const serviceDef = services.find(service => service.id === s.serviceId);
            return serviceDef && serviceDef.price > 0;
        });

        if (paidNewServices.length > 0) {
            if (!activeShift) {
                showNotification('Cannot create a sale for new services without an active shift.', 'error');
            } else {
                const totalAmount = paidNewServices.reduce((sum, s) => {
                    const serviceDef = services.find(service => service.id === s.serviceId);
                    return sum + (serviceDef ? serviceDef.price : 0);
                }, 0);

                const newSale = {
                    id: Date.now().toString(),
                    items: paidNewServices.map(s => {
                        const serviceDef = services.find(service => service.id === s.serviceId);
                        return { id: s.serviceId, name: s.serviceName, price: serviceDef.price, qty: 1 };
                    }),
                    totalAmount,
                    saleDate: new Date().toISOString(),
                    status: 'Unpaid',
                    memberId: dataToSave.id,
                    memberName: formatMemberFullName(dataToSave),
                    note: 'Membership/Service Purchase',
                    shiftId: activeShift.id,
                    paymentMethod: null,
                    cashPaid: 0,
                    onlinePaid: 0
                };
                await dbAction('sales', 'readwrite', (store) => store.add(newSale));
                setSales(prev => [...prev, newSale]);
                showNotification('Unpaid sale created for new services. Please process payment on the dashboard.', 'info');
            }
        }

        if (memberId) {
            setMembers(prev => prev.map(m => m.id === memberId ? dataToSave : m));
            showNotification('Member updated!', 'success');
            addLog(`Updated member profile for ${formatMemberFullName(dataToSave)}.`);
        } else {
            setMembers(prev => [...prev, dataToSave]);
            showNotification('Member added!', 'success');
            addLog(`Created new member: ${formatMemberFullName(dataToSave)}.`);
        }
        setEditingMember(null);
    };

    const handleDeleteMember = async (memberId) => {
        const memberToDelete = members.find(m => m.id === memberId);
        await dbAction('members', 'readwrite', (store) => store.delete(memberId));
        setMembers(prev => prev.filter(m => m.id !== memberId));
        showNotification('Member deleted.', 'info');
        addLog(`Deleted member: ${formatMemberFullName(memberToDelete)}.`);
    };

    const sortedMembers = useMemo(() => {
        return [...members].sort((a, b) => {
            const statusA = getOverallMemberStatus(a.activeServices).sortOrder;
            const statusB = getOverallMemberStatus(b.activeServices).sortOrder;
            return statusA - statusB;
        });
    }, [members]);

    const filteredMembers = useMemo(() => {
        return sortedMembers.filter(member => {
            const status = getOverallMemberStatus(member.activeServices).text;
            const matchesFilter =
                filter === 'All' ||
                (filter === 'Paused' && status === 'Paused') ||
                (filter === 'Almost Expired' && status === 'Expiring Soon') ||
                (filter === 'No Active' && (status === 'No Active Services' || status === 'All Expired'));

            const matchesSearch = searchTerm === '' ||
                formatMemberFullName(member).toLowerCase().includes(searchTerm.toLowerCase()) ||
                (member.nickname && member.nickname.toLowerCase().includes(searchTerm.toLowerCase()));

            return matchesFilter && matchesSearch;
        });
    }, [sortedMembers, filter, searchTerm]);

    return (
        <div className="bg-white p-8 rounded-2xl shadow-lg">
            {editingMember && <MemberForm member={editingMember} onSave={handleSaveMember} onCancel={() => setEditingMember(null)} services={services} addLog={addLog} />}
            {viewingId && <IDModal id={viewingId.id} title={`ID for ${viewingId.firstName}`} onClose={() => setViewingId(null)} />}
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-800">Manage Members</h2>
                <button
                    onClick={() => setEditingMember({ activeServices: [] })}
                    className="bg-[var(--primary-color)] text-white font-bold py-2 px-4 rounded-lg hover:opacity-90 transition-opacity disabled:bg-gray-400 disabled:cursor-not-allowed"
                    disabled={!activeShift}
                    title={!activeShift ? "Please start a shift to add new members" : "Add New Member"}
                >
                    + Add Member
                </button>
            </div>
            <div className="flex flex-col md:flex-row justify-between gap-4 mb-4">
                <div className="flex space-x-1 bg-gray-200 p-1 rounded-lg">
                    <button onClick={() => setFilter('All')} className={`px-4 py-1 rounded-md text-sm font-semibold ${filter === 'All' ? 'bg-white shadow' : ''}`}>All</button>
                    <button onClick={() => setFilter('Paused')} className={`px-4 py-1 rounded-md text-sm font-semibold ${filter === 'Paused' ? 'bg-white shadow' : ''}`}>Paused</button>
                    <button onClick={() => setFilter('Almost Expired')} className={`px-4 py-1 rounded-md text-sm font-semibold ${filter === 'Almost Expired' ? 'bg-white shadow' : ''}`}>Almost Expired</button>
                    <button onClick={() => setFilter('No Active')} className={`px-4 py-1 rounded-md text-sm font-semibold ${filter === 'No Active' ? 'bg-white shadow' : ''}`}>No Active/Expired</button>
                </div>
                <input type="text" placeholder="Search members..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="p-2 border border-gray-300 rounded-lg" />
            </div>
            <ul className="space-y-3 mt-6">{filteredMembers.map(member => (<MemberListItem key={member.id} member={member} onEdit={() => setEditingMember(member)} onDeleteMember={handleDeleteMember} onViewId={() => setViewingId(member)} />))}</ul>
        </div>
    );
};

const MemberForm = ({ member, onSave, onCancel, services, addLog }) => {
    const [formData, setFormData] = useState({ firstName: '', lastName: '', middleInitial: '', nickname: '', email: '', phone: '', activeServices: [], ...member });
    const [selectedService, setSelectedService] = useState('');
    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
    const [serviceToPause, setServiceToPause] = useState(null);
    const originalServices = useMemo(() => member.activeServices || [], [member.activeServices]);

    const handleChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    const handleAddService = () => {
        const service = services.find(s => s.id === selectedService);
        if (!service) return;
        const expiryDate = getExpiryDate(startDate, service.durationValue, service.durationUnit);
        const newService = {
            serviceId: service.id,
            serviceName: service.name,
            purchaseDate: new Date(startDate).toISOString(),
            expiryDate: expiryDate,
            status: 'active',
            pauseHistory: [],
            notes: service.price <= 0 ? 'Complimentary' : ''
        };
        setFormData(prev => ({ ...prev, activeServices: [...prev.activeServices, newService] }));
    };
    const handleRemoveService = (indexToRemove) => {
        setFormData(prev => ({ ...prev, activeServices: prev.activeServices.filter((_, index) => index !== indexToRemove) }));
    };

    const handlePauseService = (serviceIndex, pauseData) => {
        const updatedServices = [...formData.activeServices];
        const service = updatedServices[serviceIndex];

        const newExpiryDate = new Date(service.expiryDate);
        newExpiryDate.setDate(newExpiryDate.getDate() + pauseData.duration);

        service.status = 'paused';
        service.expiryDate = newExpiryDate.toISOString();
        service.pauseHistory.push({
            pausedOn: new Date().toISOString(),
            duration: pauseData.duration,
            reason: pauseData.reason,
            resumedOn: null
        });

        setFormData(prev => ({ ...prev, activeServices: updatedServices }));
        addLog(`Paused service "${service.serviceName}" for ${formatMemberFullName(formData)} for ${pauseData.duration} days. Reason: ${pauseData.reason}`);
        setServiceToPause(null);
    };

    const handleResumeService = (serviceIndex) => {
        const updatedServices = [...formData.activeServices];
        const service = updatedServices[serviceIndex];
        service.status = 'active';
        const lastPause = service.pauseHistory[service.pauseHistory.length - 1];
        if (lastPause) {
            lastPause.resumedOn = new Date().toISOString();
        }
        setFormData(prev => ({ ...prev, activeServices: updatedServices }));
        addLog(`Resumed service "${service.serviceName}" for ${formatMemberFullName(formData)}.`);
    };

    const handleSubmit = async (e) => { e.preventDefault(); await onSave(formData, member.id, originalServices); };

    return (
        <Modal onClose={onCancel} size="lg">
            {serviceToPause !== null && <PauseServiceModal service={formData.activeServices[serviceToPause]} onCancel={() => setServiceToPause(null)} onConfirm={(pauseData) => handlePauseService(serviceToPause, pauseData)} />}
            <form onSubmit={handleSubmit} className="space-y-4"><h3 className="text-2xl font-bold text-gray-800 mb-4">{member.id ? 'Edit Member' : 'Add New Member'}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input name="lastName" value={formData.lastName} onChange={handleChange} placeholder="Last Name" required className="w-full p-2 border rounded" />
                    <input name="firstName" value={formData.firstName} onChange={handleChange} placeholder="First Name" required className="w-full p-2 border rounded" />
                    <input name="middleInitial" value={formData.middleInitial} onChange={handleChange} placeholder="M.I. (Optional)" className="w-full p-2 border rounded" />
                    <input name="nickname" value={formData.nickname} onChange={handleChange} placeholder="Nickname (Optional)" className="w-full p-2 border rounded" />
                    <input name="email" type="email" value={formData.email} onChange={handleChange} placeholder="Email Address (Optional)" className="w-full p-2 border rounded" />
                    <input name="phone" type="tel" value={formData.phone} onChange={handleChange} placeholder="Phone Number" className="w-full p-2 border rounded" />
                </div>
                <div className="border-t pt-4"><h4 className="text-lg font-semibold mb-2">Manage Services</h4>
                    <ul className="space-y-1 mb-4 max-h-32 overflow-y-auto">{formData.activeServices?.map((s, i) =>
                        <li key={i} className="flex justify-between items-center text-sm bg-gray-100 p-2 rounded">
                            <div>
                                <strong>{s.serviceName}</strong>
                                {s.status === 'paused' && <span className="text-xs bg-yellow-200 text-yellow-800 font-semibold px-2 py-0.5 rounded-full ml-2">Paused</span>}
                                <p className="text-xs">Start: {new Date(s.purchaseDate).toLocaleDateString()} - End: {s.expiryDate ? new Date(s.expiryDate).toLocaleDateString() : 'N/A'}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                {s.status === 'active' ?
                                    <button type="button" onClick={() => setServiceToPause(i)} className="text-xs bg-yellow-500 text-white px-2 py-1 rounded">Pause</button> :
                                    <button type="button" onClick={() => handleResumeService(i)} className="text-xs bg-green-500 text-white px-2 py-1 rounded">Resume</button>
                                }
                                <button type="button" onClick={() => handleRemoveService(i)} className="text-red-500 font-bold">X</button>
                            </div>
                        </li>)}
                    </ul>
                    <div className="flex items-center gap-2"><select value={selectedService} onChange={e => setSelectedService(e.target.value)} className="flex-grow p-2 border rounded bg-white"><option value="">Select a service to add...</option>{services.map(s => <option key={s.id} value={s.id}>{s.name} (₱{s.price})</option>)}</select><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="p-2 border rounded" /><button type="button" onClick={handleAddService} className="bg-blue-500 text-white p-2 rounded hover:bg-blue-600"><Icons.Add /></button></div>
                </div>
                <div className="flex justify-end space-x-3 pt-4"><button type="button" onClick={onCancel} className="bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">Cancel</button><button type="submit" className="bg-green-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-600">Save</button></div>
            </form>
        </Modal>
    );
};

const PauseServiceModal = ({ service, onCancel, onConfirm }) => {
    const [duration, setDuration] = useState(7);
    const [reason, setReason] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        onConfirm({ duration: parseInt(duration, 10), reason });
    };

    return (
        <Modal onClose={onCancel} size="sm">
            <form onSubmit={handleSubmit}>
                <h3 className="text-xl font-bold text-gray-800 mb-4">Pause Service: {service.serviceName}</h3>
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Pause Duration (in days)</label>
                        <input type="number" value={duration} onChange={e => setDuration(e.target.value)} className="w-full p-2 border rounded mt-1" required min="1" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Reason</label>
                        <input type="text" value={reason} onChange={e => setReason(e.target.value)} className="w-full p-2 border rounded mt-1" required />
                    </div>
                </div>
                <div className="flex justify-end space-x-3 pt-6">
                    <button type="button" onClick={onCancel} className="bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">Cancel</button>
                    <button type="submit" className="bg-yellow-500 text-white font-bold py-2 px-6 rounded-lg hover:bg-yellow-600">Confirm Pause</button>
                </div>
            </form>
        </Modal>
    );
};

const MemberListItem = ({ member, onEdit, onDeleteMember, onViewId }) => {
    const status = getOverallMemberStatus(member.activeServices);
    const statusColors = { red: 'bg-red-100 text-red-800', green: 'bg-green-100 text-green-800', yellow: 'bg-yellow-100 text-yellow-800', gray: 'bg-gray-100 text-gray-800', blue: 'bg-blue-100 text-blue-800' };
    const isExpired = status.text === 'All Expired' || status.text === 'No Active Services';
    return (
        <li className="bg-gray-50 p-4 rounded-lg flex flex-col md:flex-row items-start md:items-center justify-between hover:bg-gray-100">
            <div className="flex-1">
                <p className="font-bold text-lg">{member.lastName}, {member.firstName} {member.middleInitial}</p>
                <p className="text-sm text-gray-600">{member.nickname ? `(${member.nickname})` : ''} {member.email} {member.phone ? `| ${member.phone}` : ''}</p>
                <div className="text-xs mt-1 flex flex-col items-start">
                    {member.activeServices?.map((s, i) =>
                        <span key={i} className="bg-gray-200 px-2 py-0.5 rounded-full mt-1">
                            {s.serviceName} (Start: {new Date(s.purchaseDate).toLocaleDateString()} - End: {s.expiryDate ? new Date(s.expiryDate).toLocaleDateString() : 'N/A'})
                            {s.status === 'paused' && <span className="font-semibold text-yellow-800 ml-1">(Paused)</span>}
                        </span>
                    )}
                </div>
            </div>
            <div className="flex items-center space-x-2 mt-2 md:mt-0">
                <span className={`px-3 py-1 text-xs font-semibold rounded-full ${statusColors[status.color]}`}>{status.text}</span>
                <button onClick={onViewId} className="p-2 text-gray-500 hover:text-indigo-600 rounded-full" title="View Member ID"><Icons.IDCard /></button>
                {isExpired ? <button onClick={onEdit} className="p-2 text-gray-500 hover:text-green-600 rounded-full" title="Renew Services"><Icons.Renew /></button> : <button onClick={onEdit} className="p-2 text-gray-500 hover:text-blue-600 rounded-full" title="Edit/Manage Services"><Icons.Edit /></button>}
                <button onClick={() => onDeleteMember(member.id)} className="p-2 text-gray-500 hover:text-red-600 rounded-full" title="Delete Member"><Icons.Delete /></button>
            </div>
        </li>
    );
};

// --- Inventory Tab ---
const InventoryTab = ({ inventory, showNotification, masterPassword, setInventory, currentUser, addLog }) => {
    const [editingItem, setEditingItem] = useState(null);
    const [viewingId, setViewingId] = useState(null);
    const [passwordModal, setPasswordModal] = useState({ isOpen: false, action: null });
    const isAdmin = currentUser.role === 'admin';

    const withPasswordProtection = (action) => {
        if (!masterPassword) {
            action();
            return;
        }
        setPasswordModal({ isOpen: true, action });
    };

    const handlePasswordConfirm = (password) => {
        if (password === masterPassword) {
            passwordModal.action();
            showNotification('Action approved', 'success');
        } else {
            showNotification('Incorrect master password', 'error');
        }
        setPasswordModal({ isOpen: false, action: null });
    };

    const handleSaveItem = async (itemData, itemId) => {
        const dataToSave = { ...itemData, id: itemId || Date.now().toString(), price: parseFloat(itemData.price), quantity: itemData.isUnlimited ? Infinity : parseInt(itemData.quantity, 10) };
        await dbAction('inventory', 'readwrite', (store) => store.put(dataToSave));
        if (itemId) {
            setInventory(prev => prev.map(i => i.id === itemId ? dataToSave : i));
            showNotification('Item updated!', 'success');
            addLog(`Updated inventory item: ${dataToSave.name}`);
        } else {
            setInventory(prev => [...prev, dataToSave]);
            showNotification('Item added!', 'success');
            addLog(`Added new inventory item: ${dataToSave.name}`);
        }
        setEditingItem(null);
    };
    const handleDeleteItem = async (itemId) => {
        const itemToDelete = inventory.find(i => i.id === itemId);
        await dbAction('inventory', 'readwrite', (store) => store.delete(itemId));
        setInventory(prev => prev.filter(i => i.id !== itemId));
        showNotification('Item deleted.', 'info');
        addLog(`Deleted inventory item: ${itemToDelete.name}`);
    };
    return (
        <div className="bg-white p-8 rounded-2xl shadow-lg">
            {passwordModal.isOpen && <PasswordModal onConfirm={handlePasswordConfirm} onCancel={() => setPasswordModal({ isOpen: false, action: null })} />}
            {editingItem && <InventoryForm item={editingItem} onSave={(data, id) => withPasswordProtection(() => handleSaveItem(data, id))} onCancel={() => setEditingItem(null)} />}
            {viewingId && <IDModal id={viewingId.id} title={`ID for ${viewingId.name}`} onClose={() => setViewingId(null)} />}
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-800">Manage Inventory</h2>
                {isAdmin && <button onClick={() => withPasswordProtection(() => setEditingItem({ isUnlimited: false }))} className="bg-[var(--primary-color)] text-white font-bold py-2 px-4 rounded-lg hover:opacity-90 transition-opacity">+ Add Item</button>}
            </div>
            <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200"><thead className="bg-gray-50"><tr><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th><th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th></tr></thead><tbody className="bg-white divide-y divide-gray-200">{inventory.map(item => (<InventoryListItem key={item.id} item={item} onEdit={() => withPasswordProtection(() => setEditingItem(item))} onDeleteItem={() => withPasswordProtection(() => handleDeleteItem(item.id))} onViewId={() => setViewingId(item)} isAdmin={isAdmin} />))}</tbody></table></div>
        </div>
    );
};
const InventoryForm = ({ item, onSave, onCancel }) => {
    const [formData, setFormData] = useState({ name: '', price: '', quantity: '', isUnlimited: false, ...item });
    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };
    const handleSubmit = (e) => { e.preventDefault(); onSave(formData, item.id); };
    return (
        <Modal onClose={onCancel}>
            <form onSubmit={handleSubmit} className="space-y-4"><h3 className="text-2xl font-bold text-gray-800 mb-4">{item.id ? 'Edit Item' : 'Add New Item'}</h3>
                <input name="name" value={formData.name} onChange={handleChange} placeholder="Item Name" required className="w-full p-2 border rounded" />
                <input name="price" type="number" value={formData.price} onChange={handleChange} placeholder="Price (PHP)" required min="0" step="0.01" className="w-full p-2 border rounded" />
                <div>
                    <input name="quantity" type="number" value={formData.quantity} onChange={handleChange} placeholder="Quantity" required min="0" step="1" className="w-full p-2 border rounded" disabled={formData.isUnlimited} />
                    <div className="flex items-center mt-2">
                        <input id="isUnlimited" name="isUnlimited" type="checkbox" checked={formData.isUnlimited} onChange={handleChange} className="h-4 w-4 text-indigo-600 border-gray-300 rounded" />
                        <label htmlFor="isUnlimited" className="ml-2 block text-sm text-gray-900">Unlimited Quantity</label>
                    </div>
                </div>
                <div className="flex justify-end space-x-3 pt-4"><button type="button" onClick={onCancel} className="bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">Cancel</button><button type="submit" className="bg-green-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-600">Save</button></div>
            </form>
        </Modal>
    );
};
const InventoryListItem = ({ item, onEdit, onDeleteItem, onViewId, isAdmin }) => (
    <tr>
        <td className="px-6 py-4 whitespace-nowrap"><div className="text-sm font-medium text-gray-900">{item.name}</div></td>
        <td className="px-6 py-4 whitespace-nowrap"><div className="text-sm text-gray-900">₱{item.price ? item.price.toFixed(2) : '0.00'}</div></td>
        <td className="px-6 py-4 whitespace-nowrap">
            {item.isUnlimited ? <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">Unlimited</span> : <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${item.quantity > 10 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{item.quantity}</span>}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
            <button onClick={onViewId} className="p-2 text-gray-500 hover:text-indigo-600 rounded-full" title="View Item ID"><Icons.IDCard /></button>
            {isAdmin && <>
                <button onClick={onEdit} className="p-2 text-gray-500 hover:text-blue-600 rounded-full" title="Edit Item"><Icons.Edit /></button>
                <button onClick={onDeleteItem} className="p-2 text-gray-500 hover:text-red-600 rounded-full" title="Delete Item"><Icons.Delete /></button>
            </>}
        </td>
    </tr>
);

// --- Reports Tab ---
const ReportsTab = ({ sales, shifts, expenses, members, systemUsers, currentUser, showNotification, setSales, setInventory, addLog, inventory, printerCharacteristic, branding, addToPrintQueue }) => {
    const [reportType, setReportType] = useState('sales');
    const [dateRange, setDateRange] = useState({
        start: new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
    });
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'desc' });
    
    // Set default sort based on report type
    useEffect(() => {
        const defaultSorts = {
            'sales': { key: 'saleDate', direction: 'desc' },
            'shifts': { key: 'endTime', direction: 'desc' },
            'cashflow': { key: 'timestamp', direction: 'desc' },
            'performance': { key: 'totalSales', direction: 'desc' }
        };
        
        if (defaultSorts[reportType]) {
            setSortConfig(defaultSorts[reportType]);
        }
    }, [reportType]);
    const isAdmin = currentUser.role === 'admin';

    const handleDateChange = (e) => {
        setDateRange(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const filteredData = useMemo(() => {
        let start, end;
        if (isAdmin) {
            if (!dateRange.start || !dateRange.end) return { sales: [], shifts: [], cashflow: [], performance: [] };
            start = new Date(dateRange.start);
            start.setHours(0, 0, 0, 0);
            end = new Date(dateRange.end);
            end.setHours(23, 59, 59, 999);
        } else {
            start = new Date();
            start.setHours(0, 0, 0, 0);
            end = new Date();
            end.setHours(23, 59, 59, 999);
        }

        let filteredSales = sales.filter(s => {
            const saleDate = new Date(s.saleDate);
            return saleDate >= start && saleDate <= end;
        });

        let filteredShifts = shifts.filter(sh => {
            if (sh.status !== 'completed') return false;
            const shiftDate = new Date(sh.endTime);
            const matchesDate = shiftDate >= start && shiftDate <= end;
            if (!isAdmin) {
                return matchesDate && sh.user === currentUser.username;
            }
            return matchesDate;
        });

        let filteredCashFlow = expenses.filter(ex => {
            const expenseDate = new Date(ex.timestamp);
            return expenseDate >= start && expenseDate <= end;
        });

        if (!isAdmin) {
            const staffShiftsToday = shifts.filter(s => {
                const shiftDate = new Date(s.startTime); // Use start time to include active shift
                return s.user === currentUser.username && shiftDate >= start && shiftDate <= end;
            });
            const staffShiftIds = staffShiftsToday.map(s => s.id);
            filteredSales = filteredSales.filter(s => staffShiftIds.includes(s.shiftId));
            filteredCashFlow = filteredCashFlow.filter(ex => staffShiftIds.includes(ex.shiftId));
        }

        const performanceData = systemUsers.map(user => {
            const userShifts = shifts.filter(s => s.user === user.username);
            const userShiftIds = userShifts.map(s => s.id);
            const userSales = sales.filter(s => userShiftIds.includes(s.shiftId) && new Date(s.saleDate) >= start && new Date(s.saleDate) <= end);
            const totalSales = userSales.reduce((sum, s) => sum + s.totalAmount, 0);
            const newMembers = userSales.filter(s => s.note === 'Membership/Service Purchase').length;
            return { user: user.fullName, totalSales, newMembers };
        });

        return { sales: filteredSales, shifts: filteredShifts, cashflow: filteredCashFlow, performance: performanceData };
    }, [sales, shifts, expenses, members, systemUsers, dateRange, isAdmin, currentUser.username]);

    const sortedData = useMemo(() => {
        let sortableItems = [...(filteredData[reportType] || [])];
        if (sortConfig.key !== null) {
            sortableItems.sort((a, b) => {
                if (a[sortConfig.key] < b[sortConfig.key]) {
                    return sortConfig.direction === 'asc' ? -1 : 1;
                }
                if (a[sortConfig.key] > b[sortConfig.key]) {
                    return sortConfig.direction === 'asc' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [filteredData, sortConfig, reportType]);

    const requestSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const handleRefund = async (saleToRefund) => {
        // Check if this sale has already been refunded
        const existingRefund = sales.find(s => s.note && s.note.includes(`Refund for sale ID: ${saleToRefund.id.slice(-4)}`));
        if (existingRefund) {
            showNotification('This sale has already been refunded.', 'error');
            return;
        }

        const refundAmount = -saleToRefund.totalAmount;
        const newRefundSale = {
            ...saleToRefund,
            id: Date.now().toString(),
            totalAmount: refundAmount,
            cashPaid: saleToRefund.cashPaid ? -saleToRefund.cashPaid : 0,
            onlinePaid: saleToRefund.onlinePaid ? -saleToRefund.onlinePaid : 0,
            status: 'Refunded',
            note: `Refund for sale ID: ${saleToRefund.id.slice(-4)}`,
            originalSaleId: saleToRefund.id, // Link to original sale
            saleDate: new Date().toISOString(),
        };

        // Mark the original sale as refunded
        const updatedOriginalSale = { ...saleToRefund, status: 'Refunded' };
        await dbAction('sales', 'readwrite', (store) => store.put(updatedOriginalSale));
        setSales(prev => prev.map(s => s.id === saleToRefund.id ? updatedOriginalSale : s));

        for (const item of saleToRefund.items) {
            const originalItem = inventory.find(i => i.id === item.id);
            if (originalItem && !originalItem.isUnlimited) {
                const updatedInventoryItem = { ...originalItem, quantity: originalItem.quantity + item.qty };
                await dbAction('inventory', 'readwrite', (store) => store.put(updatedInventoryItem));
                setInventory(prev => prev.map(i => i.id === originalItem.id ? updatedInventoryItem : i));
            }
        }

        await dbAction('sales', 'readwrite', (store) => store.add(newRefundSale));
        setSales(prev => [...prev, newRefundSale]);

        await addLog(`Processed refund for sale ${saleToRefund.id.slice(-4)} amounting to ₱${saleToRefund.totalAmount.toFixed(2)}`);
        showNotification('Sale refunded successfully.', 'success');
    };

    const handleReprint = async (saleToReprint) => {
        if (!printerCharacteristic) {
            showNotification('Please connect to a printer in Settings before reprinting.', 'error');
            return;
        }
        const receiptData = generateReceipt(saleToReprint, branding);
        addToPrintQueue(receiptData, `Reprint #${saleToReprint.id.slice(-4)}`);
        addLog(`Queued reprint for sale ${saleToReprint.id.slice(-4)}.`);
    };

    const loadScript = (src) => {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.head.appendChild(script);
        });
    };

    const handleGeneratePdf = async () => {
        // Check internet connectivity first
        const checkInternetConnectivity = async () => {
            try {
                const response = await fetch('https://httpbin.org/get', {
                    method: 'GET',
                    mode: 'cors',
                    cache: 'no-cache',
                    timeout: 5000
                });
                return response.ok;
            } catch (error) {
                return false;
            }
        };

        const isOnline = await checkInternetConnectivity();
        if (!isOnline) {
            showNotification('Internet connection required for PDF generation. Please connect to the internet and try again.', 'error');
            return;
        }

        try {
            showNotification('Generating PDF online... please wait.', 'info');
            
            const printableElement = document.getElementById('printableArea');
            if (!printableElement) {
                showNotification('No printable content found', 'error');
                return;
            }

            // Extract styles from stylesheets
            const extractStyles = () => {
                let styles = '';
                try {
                    // Get all stylesheets
                    for (let i = 0; i < document.styleSheets.length; i++) {
                        const styleSheet = document.styleSheets[i];
                        try {
                            if (styleSheet.cssRules) {
                                for (let j = 0; j < styleSheet.cssRules.length; j++) {
                                    styles += styleSheet.cssRules[j].cssText + '\n';
                                }
                            }
                        } catch (e) {
                            // Skip stylesheets that can't be accessed due to CORS
                            console.warn('Could not access stylesheet:', styleSheet.href, e);
                        }
                    }
                    
                    // Add inline styles from style elements
                    const styleElements = document.querySelectorAll('style');
                    styleElements.forEach(styleEl => {
                        styles += styleEl.textContent + '\n';
                    });
                } catch (error) {
                    console.warn('Error extracting styles:', error);
                }
                return styles;
            };

            // Create complete HTML document
            const gymName = branding?.gymName || 'Gym Management System';
            const currentDate = new Date().toLocaleDateString();
            const currentTime = new Date().toLocaleTimeString();
            const generatedBy = currentUser?.fullName || currentUser?.username || 'System';
            
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>${gymName} - ${reportType} Report</title>
                    <style>
                        ${extractStyles()}
                        body { margin: 0; padding: 20px; font-family: Arial, sans-serif; }
                        .pdf-header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
                        .pdf-header h1 { margin: 0; font-size: 24px; }
                        .pdf-metadata { font-size: 12px; color: #666; margin-bottom: 20px; }
                        .printable-content { margin-top: 20px; }
                    </style>
                </head>
                <body>
                    <div class="pdf-header">
                        <h1>${gymName}</h1>
                        <h2>${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Report</h2>
                    </div>
                    <div class="pdf-metadata">
                        <p>Generated by: ${generatedBy}</p>
                        <p>Date & Time: ${currentDate} ${currentTime}</p>
                    </div>
                    <div class="printable-content">
                        ${printableElement.innerHTML}
                    </div>
                </body>
                </html>
            `;

            // Try online PDF generation service
            const generateWithOnlineService = async () => {
                try {
                    // Using HTML/CSS to PDF API (replace with your preferred service)
                    const response = await fetch('https://api.html-css-to-pdf.com/v1/generate', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            html: htmlContent,
                            css: '',
                            paper_format: 'A4',
                            margin_top: '0.4in',
                            margin_right: '0.4in',
                            margin_bottom: '0.4in',
                            margin_left: '0.4in',
                            landscape: false
                        })
                    });

                    if (response.ok) {
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.style.display = 'none';
                        a.href = url;
                        const date = new Date().toISOString().split('T')[0];
                        a.download = `${gymName.replace(/[^a-zA-Z0-9]/g, '-')}-${reportType}-report-${date}.pdf`;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                        
                        showNotification('PDF downloaded successfully!', 'success');
                        addLog(`Downloaded ${reportType} report as PDF for ${gymName}.`);
                        return true;
                    }
                    return false;
                } catch (error) {
                    console.warn('Online PDF service failed:', error);
                    return false;
                }
            };

            // Local PDF generation fallback using jsPDF and html2canvas
            const generateWithLocalLibraries = async () => {
                try {
                    // Load jsPDF and html2canvas from CDN if not already loaded
                    if (!window.jsPDF) {
                        await new Promise((resolve, reject) => {
                            const script = document.createElement('script');
                            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
                            script.onload = resolve;
                            script.onerror = reject;
                            document.head.appendChild(script);
                        });
                    }
                    
                    if (!window.html2canvas) {
                        await new Promise((resolve, reject) => {
                            const script = document.createElement('script');
                            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
                            script.onload = resolve;
                            script.onerror = reject;
                            document.head.appendChild(script);
                        });
                    }

                    // Create a temporary container with the HTML content
                    const tempContainer = document.createElement('div');
                    tempContainer.innerHTML = htmlContent;
                    tempContainer.style.position = 'absolute';
                    tempContainer.style.left = '-9999px';
                    tempContainer.style.top = '0';
                    tempContainer.style.width = '210mm';
                    tempContainer.style.backgroundColor = 'white';
                    tempContainer.style.fontFamily = 'Arial, sans-serif';
                    document.body.appendChild(tempContainer);

                    // Generate canvas from HTML
                    const canvas = await html2canvas(tempContainer, {
                        useCORS: true,
                        allowTaint: true,
                        scale: 2,
                        width: 794, // A4 width in pixels at 96 DPI
                        windowWidth: 794,
                        backgroundColor: '#ffffff'
                    });

                    // Remove temporary container
                    document.body.removeChild(tempContainer);

                    // Create PDF
                    const { jsPDF } = window.jsPDF;
                    const pdf = new jsPDF('portrait', 'mm', 'a4');
                    
                    const imgWidth = 210; // A4 width in mm
                    const imgHeight = (canvas.height * imgWidth) / canvas.width;
                    
                    let heightLeft = imgHeight;
                    let position = 0;
                    
                    // Add first page
                    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgWidth, imgHeight);
                    heightLeft -= 297; // A4 height in mm
                    
                    // Add additional pages if needed
                    while (heightLeft >= 0) {
                        position = heightLeft - imgHeight;
                        pdf.addPage();
                        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgWidth, imgHeight);
                        heightLeft -= 297;
                    }
                    
                    // Save the PDF
                    const date = new Date().toISOString().split('T')[0];
                    const filename = `${gymName.replace(/[^a-zA-Z0-9]/g, '-')}-${reportType}-report-${date}.pdf`;
                    pdf.save(filename);
                    
                    showNotification('PDF downloaded successfully!', 'success');
                    addLog(`Downloaded ${reportType} report as PDF for ${gymName}.`);
                    return true;
                } catch (error) {
                    console.warn('Local PDF generation failed:', error);
                    return false;
                }
            };

            // Try online service first, then local generation
            const success = await generateWithOnlineService() || await generateWithLocalLibraries();
            
            if (!success) {
                // Fallback to browser print dialog
                showNotification('Online PDF service and local generation unavailable. Opening print dialog as fallback...', 'warning');
                
                // Create a new window with the styled content
                const printWindow = window.open('', '_blank');
                printWindow.document.write(htmlContent);
                printWindow.document.close();
                
                // Wait for content to load, then trigger print
                setTimeout(() => {
                    printWindow.print();
                    // Close the window after printing (user may cancel)
                    setTimeout(() => printWindow.close(), 1000);
                }, 500);
                
                addLog(`Opened print dialog for ${reportType} report as fallback.`);
            }
            
            if (!success) {
                // Fallback to browser print dialog
                showNotification('Online PDF services unavailable. Opening print dialog as fallback...', 'warning');
                
                // Create a new window with the styled content
                const printWindow = window.open('', '_blank');
                printWindow.document.write(htmlContent);
                printWindow.document.close();
                
                // Wait for content to load, then trigger print
                setTimeout(() => {
                    printWindow.print();
                    // Close the window after printing (user may cancel)
                    setTimeout(() => printWindow.close(), 1000);
                }, 500);
                
                addLog(`Opened print dialog for ${reportType} report as fallback.`);
            }
            
        } catch (error) {
            console.error("Error generating PDF:", error);
            showNotification('Failed to generate PDF. Please check your internet connection and try again.', 'error');
        }
    };

    const renderReportContent = () => {
        switch (reportType) {
            case 'sales': return <SalesReport data={sortedData} requestSort={requestSort} sortConfig={sortConfig} onRefund={handleRefund} onReprint={handleReprint} />;
            case 'shifts': return <ShiftReport data={sortedData} requestSort={requestSort} sortConfig={sortConfig} />;
            case 'cashflow': return <CashFlowReport data={sortedData} requestSort={requestSort} sortConfig={sortConfig} />;
            case 'performance': return <StaffPerformanceReport data={sortedData} requestSort={requestSort} sortConfig={sortConfig} />;
            default: return <p>Select a report type.</p>;
        }
    };

    const reportTitles = { sales: 'Sales Report', shifts: 'End-of-Shift Report', cashflow: 'Cash Flow Report', performance: 'Staff Performance' };

    return (
        <div className="bg-white p-8 rounded-2xl shadow-lg">
            <div className="print:hidden">
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Reports</h2>
                <p className="text-gray-500 mb-6">Select a report type to generate a report.</p>
                <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6 p-4 bg-gray-50 rounded-lg">
                    <div className="flex space-x-1 bg-gray-200 p-1 rounded-lg">
                        {Object.keys(reportTitles).map(key => (
                            <button key={key} onClick={() => setReportType(key)} className={`px-4 py-2 rounded-md text-sm font-semibold transition ${reportType === key ? 'bg-white shadow text-[var(--primary-color)]' : 'text-gray-600 hover:bg-gray-300'}`}>{reportTitles[key]}</button>
                        ))}
                    </div>
                    <div className="flex items-center gap-2">
                        {isAdmin && <>
                            <input type="date" name="start" value={dateRange.start} onChange={handleDateChange} className="p-2 border border-gray-300 rounded-lg" />
                            <span>to</span>
                            <input type="date" name="end" value={dateRange.end} onChange={handleDateChange} className="p-2 border border-gray-300 rounded-lg" />
                        </>}
                        <button onClick={handleGeneratePdf} className="bg-green-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-600">Download PDF</button>
                    </div>
                </div>
            </div>
            <div id="printableArea">
                <h3 className="text-xl font-bold text-center mb-1">{reportTitles[reportType]}</h3>
                {!isAdmin && <p className="text-center text-gray-600 mb-6">Showing data for today: {new Date().toLocaleDateString()}</p>}
                {isAdmin && <p className="text-center text-gray-600 mb-6">For Period: {new Date(dateRange.start).toLocaleDateString()} to {new Date(dateRange.end).toLocaleDateString()}</p>}
                {renderReportContent()}
            </div>
        </div>
    );
};

const SalesReport = ({ data, requestSort, sortConfig, onRefund, onReprint }) => {
    // Filter out refund transactions from totals calculation
    const regularSales = data.filter(sale => !sale.note?.includes('Refund for sale ID:'));
    const refundSales = data.filter(sale => sale.note?.includes('Refund for sale ID:'));
    
    const totalRevenue = regularSales.reduce((sum, sale) => sum + sale.totalAmount, 0);
    const totalCash = regularSales.reduce((sum, sale) => sum + (sale.cashPaid || 0), 0);
    const totalOnline = regularSales.reduce((sum, sale) => sum + (sale.onlinePaid || 0), 0);
    const totalRefunds = Math.abs(refundSales.reduce((sum, sale) => sum + sale.totalAmount, 0));
    const totalDiscounts = regularSales.reduce((sum, sale) => sum + (sale.discountAmount || 0), 0);
    const originalRevenueBeforeDiscounts = regularSales.reduce((sum, sale) => sum + (sale.originalAmount || sale.totalAmount), 0);

    const getSortIcon = (key) => {
        if (sortConfig.key !== key) return null;
        return sortConfig.direction === 'asc' ? <Icons.SortAsc /> : <Icons.SortDesc />;
    };

    const getStatusBadge = (sale) => {
        if (sale.note?.includes('Refund for sale ID:')) {
            return <span className="px-2 py-1 text-xs font-semibold bg-red-100 text-red-800 rounded-full">REFUND</span>;
        }
        if (sale.status === 'Refunded') {
            return <span className="px-2 py-1 text-xs font-semibold bg-orange-100 text-orange-800 rounded-full">REFUNDED</span>;
        }
        if (sale.status === 'Paid') {
            return <span className="px-2 py-1 text-xs font-semibold bg-green-100 text-green-800 rounded-full">PAID</span>;
        }
        return <span className="px-2 py-1 text-xs font-semibold bg-gray-100 text-gray-800 rounded-full">{sale.status}</span>;
    };

    const canRefund = (sale) => {
        // Can only refund if status is 'Paid' and it's not a refund transaction itself
        return sale.status === 'Paid' && !sale.note?.includes('Refund for sale ID:');
    };

    return (
        <div>
            <div className="mb-4 p-4 bg-indigo-50 rounded-lg">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                    <h4 className="font-bold text-lg text-indigo-800">Net Revenue: ₱{(totalRevenue - totalRefunds).toFixed(2)}</h4>
                    <h4 className="font-semibold text-lg text-green-800">Total Cash: ₱{totalCash.toFixed(2)}</h4>
                    <h4 className="font-semibold text-lg text-blue-800">Total Online: ₱{totalOnline.toFixed(2)}</h4>
                    <h4 className="font-semibold text-lg text-red-800">Total Refunds: ₱{totalRefunds.toFixed(2)}</h4>
                </div>
                {totalDiscounts > 0 && (
                    <div className="border-t pt-2">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <h4 className="font-semibold text-lg text-orange-800">Original Revenue: ₱{originalRevenueBeforeDiscounts.toFixed(2)}</h4>
                            <h4 className="font-semibold text-lg text-purple-800">Total Discounts: ₱{totalDiscounts.toFixed(2)}</h4>
                            <h4 className="font-semibold text-lg text-gray-600">Savings Given: {((totalDiscounts / originalRevenueBeforeDiscounts) * 100).toFixed(1)}%</h4>
                        </div>
                    </div>
                )}
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50"><tr>
                        <th className="px-3 py-3 text-left font-medium text-gray-500 uppercase cursor-pointer" onClick={() => requestSort('saleDate')}>Date {getSortIcon('saleDate')}</th>
                        <th className="px-3 py-3 text-left font-medium text-gray-500 uppercase cursor-pointer" onClick={() => requestSort('memberName')}>Client {getSortIcon('memberName')}</th>
                        <th className="px-3 py-3 text-left font-medium text-gray-500 uppercase">Items Detail</th>
                        <th className="px-3 py-3 text-left font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-3 py-3 text-left font-medium text-gray-500 uppercase">Payment</th>
                        <th className="px-3 py-3 text-right font-medium text-gray-500 uppercase cursor-pointer" onClick={() => requestSort('cashPaid')}>Cash {getSortIcon('cashPaid')}</th>
                        <th className="px-3 py-3 text-right font-medium text-gray-500 uppercase cursor-pointer" onClick={() => requestSort('onlinePaid')}>Online {getSortIcon('onlinePaid')}</th>
                        <th className="px-3 py-3 text-right font-medium text-gray-500 uppercase cursor-pointer" onClick={() => requestSort('totalAmount')}>Total {getSortIcon('totalAmount')}</th>
                        <th className="px-3 py-3 text-center font-medium text-gray-500 uppercase">Actions</th>
                    </tr></thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {data.map(sale => {
                            const isRefundTransaction = sale.note?.includes('Refund for sale ID:');
                            const rowClass = isRefundTransaction ? 'bg-red-50' : sale.status === 'Refunded' ? 'bg-orange-50' : '';
                            
                            return (
                                <tr key={sale.id} className={rowClass}>
                                    <td className="px-3 py-3 whitespace-nowrap">{new Date(sale.saleDate).toLocaleString()}</td>
                                    <td className="px-3 py-3">{sale.memberName}</td>
                                    <td className="px-3 py-3">
                                        <div className="space-y-1">
                                            {sale.items.map((item, idx) => (
                                                <div key={idx} className="flex justify-between text-xs">
                                                    <span>{item.name}</span>
                                                    <span className="font-mono">x{item.qty} @ ₱{item.price.toFixed(2)}</span>
                                                </div>
                                            ))}
                                            {sale.hasDiscount && (
                                                <div className="text-xs text-purple-600 font-semibold mt-1 flex justify-between">
                                                    <span>Discount Applied:</span>
                                                    <span>
                                                        {sale.discountType === 'percentage' 
                                                            ? `${sale.discountValue}% (₱${sale.discountAmount.toFixed(2)})`
                                                            : `Fixed ₱${sale.discountAmount.toFixed(2)}`
                                                        }
                                                    </span>
                                                </div>
                                            )}
                                            {sale.note && (
                                                <div className="text-xs text-gray-500 italic mt-1">{sale.note}</div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-3 py-3">{getStatusBadge(sale)}</td>
                                    <td className="px-3 py-3">{sale.paymentMethod}</td>
                                    <td className="px-3 py-3 text-right font-mono text-sm">
                                        <span className={sale.cashPaid < 0 ? 'text-red-600' : ''}>
                                            ₱{sale.cashPaid?.toFixed(2) || '0.00'}
                                        </span>
                                    </td>
                                    <td className="px-3 py-3 text-right font-mono text-sm">
                                        <span className={sale.onlinePaid < 0 ? 'text-red-600' : ''}>
                                            ₱{sale.onlinePaid?.toFixed(2) || '0.00'}
                                        </span>
                                    </td>
                                    <td className="px-3 py-3 text-right font-mono font-semibold">
                                        <span className={sale.totalAmount < 0 ? 'text-red-600' : 'text-green-600'}>
                                            ₱{sale.totalAmount.toFixed(2)}
                                        </span>
                                    </td>
                                    <td className="px-3 py-3 text-center">
                                        <div className="flex justify-center space-x-1">
                                            <button 
                                                onClick={() => onReprint(sale)} 
                                                className="p-2 text-gray-500 hover:text-blue-600 rounded-full" 
                                                title="Reprint Receipt"
                                            >
                                                <Icons.Reprint />
                                            </button>
                                            {canRefund(sale) && (
                                                <button 
                                                    onClick={() => onRefund(sale)} 
                                                    className="p-2 text-gray-500 hover:text-yellow-600 rounded-full" 
                                                    title="Refund Sale"
                                                >
                                                    <Icons.Refund />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const ShiftReport = ({ data, requestSort, sortConfig }) => {
    const getSortIcon = (key) => {
        if (sortConfig.key !== key) return null;
        return sortConfig.direction === 'asc' ? <Icons.SortAsc /> : <Icons.SortDesc />;
    };
    return (
        <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50"><tr>
                <th className="px-2 py-2 text-left font-medium text-gray-500 uppercase cursor-pointer" onClick={() => requestSort('user')}>User {getSortIcon('user')}</th>
                <th className="px-2 py-2 text-left font-medium text-gray-500 uppercase cursor-pointer" onClick={() => requestSort('endTime')}>End Date {getSortIcon('endTime')}</th>
                <th className="px-2 py-2 text-left font-medium text-gray-500 uppercase">Period</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500 uppercase cursor-pointer" onClick={() => requestSort('cashSales')}>Cash Sales {getSortIcon('cashSales')}</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500 uppercase cursor-pointer" onClick={() => requestSort('expectedCash')}>Expected {getSortIcon('expectedCash')}</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500 uppercase cursor-pointer" onClick={() => requestSort('actualCash')}>Actual {getSortIcon('actualCash')}</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500 uppercase cursor-pointer" onClick={() => requestSort('difference')}>Difference {getSortIcon('difference')}</th>
            </tr></thead>
            <tbody className="bg-white divide-y divide-gray-200">{data.map(sh => (
                <tr key={sh.id}>
                    <td className="px-2 py-2">{sh.user}</td>
                    <td className="px-2 py-2">{new Date(sh.endTime).toLocaleDateString()}</td>
                    <td className="px-2 py-2">{new Date(sh.startTime).toLocaleTimeString()} - {new Date(sh.endTime).toLocaleTimeString()}</td>
                    <td className="px-2 py-2 text-right font-mono">₱{sh.cashSales?.toFixed(2)}</td>
                    <td className="px-2 py-2 text-right font-mono">₱{sh.expectedCash?.toFixed(2)}</td>
                    <td className="px-2 py-2 text-right font-mono">₱{sh.actualCash?.toFixed(2)}</td>
                    <td className={`px-2 py-2 text-right font-mono font-bold ${sh.difference >= 0 ? 'text-green-600' : 'text-red-600'}`}>₱{sh.difference?.toFixed(2)}</td>
                </tr>
            ))}</tbody>
        </table>
    );
};

const CashFlowReport = ({ data, requestSort, sortConfig }) => {
    const cashIn = data.filter(d => d.type === 'Cash In').reduce((sum, d) => sum + d.amount, 0);
    const cashOut = data.filter(d => d.type !== 'Cash In').reduce((sum, d) => sum + d.amount, 0);
    const netFlow = cashIn - cashOut;

    const getSortIcon = (key) => {
        if (sortConfig.key !== key) return null;
        return sortConfig.direction === 'asc' ? <Icons.SortAsc /> : <Icons.SortDesc />;
    };
    return (
        <div>
            <div className="mb-4 p-4 bg-gray-50 rounded-lg grid grid-cols-1 md:grid-cols-3 gap-4">
                <h4 className="font-semibold text-lg text-green-600">Total Cash In: ₱{cashIn.toFixed(2)}</h4>
                <h4 className="font-semibold text-lg text-red-600">Total Cash Out: ₱{cashOut.toFixed(2)}</h4>
                <h4 className={`font-bold text-lg ${netFlow >= 0 ? 'text-blue-600' : 'text-red-600'}`}>Net Cash Flow: ₱{netFlow.toFixed(2)}</h4>
            </div>
            <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50"><tr>
                    <th className="px-2 py-2 text-left font-medium text-gray-500 uppercase cursor-pointer" onClick={() => requestSort('timestamp')}>Date {getSortIcon('timestamp')}</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-500 uppercase">Note</th>
                    <th className="px-2 py-2 text-left font-medium text-gray-500 uppercase cursor-pointer" onClick={() => requestSort('type')}>Type {getSortIcon('type')}</th>
                    <th className="px-2 py-2 text-right font-medium text-gray-500 uppercase cursor-pointer" onClick={() => requestSort('amount')}>Amount {getSortIcon('amount')}</th>
                </tr></thead>
                <tbody className="bg-white divide-y divide-gray-200">{data.map(ex => (<tr key={ex.id}>
                    <td className="px-2 py-2">{new Date(ex.timestamp).toLocaleString()}</td>
                    <td className="px-2 py-2">{ex.note}</td>
                    <td className={`px-2 py-2 font-semibold ${ex.type === 'Cash In' ? 'text-green-600' : 'text-red-600'}`}>{ex.type}</td>
                    <td className="px-2 py-2 text-right font-mono">₱{ex.amount.toFixed(2)}</td>
                </tr>))}</tbody>
            </table>
        </div>
    );
};

const StaffPerformanceReport = ({ data, requestSort, sortConfig }) => {
    const getSortIcon = (key) => {
        if (sortConfig.key !== key) return null;
        return sortConfig.direction === 'asc' ? <Icons.SortAsc /> : <Icons.SortDesc />;
    };
    return (
        <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50"><tr>
                <th className="px-2 py-2 text-left font-medium text-gray-500 uppercase cursor-pointer" onClick={() => requestSort('user')}>Staff Name {getSortIcon('user')}</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500 uppercase cursor-pointer" onClick={() => requestSort('totalSales')}>Total Sales {getSortIcon('totalSales')}</th>
                <th className="px-2 py-2 text-right font-medium text-gray-500 uppercase cursor-pointer" onClick={() => requestSort('newMembers')}>New Memberships Sold {getSortIcon('newMembers')}</th>
            </tr></thead>
            <tbody className="bg-white divide-y divide-gray-200">{data.map(user => (<tr key={user.user}>
                <td className="px-2 py-2">{user.user}</td>
                <td className="px-2 py-2 text-right font-mono">₱{user.totalSales.toFixed(2)}</td>
                <td className="px-2 py-2 text-right font-mono">{user.newMembers}</td>
            </tr>))}</tbody>
        </table>
    );
};


// --- Settings Tab ---
const SettingsTab = ({ services, showNotification, masterPassword, setMasterPassword, systemUsers, setSystemUsers, currentUser, setServices, addLog, printerCharacteristic, setPrinterCharacteristic, branding, setBranding, availablePrinters, setAvailablePrinters, printQueue, clearPrintQueue, retryFailedJobs, isProcessingQueue }) => {
    const [editingService, setEditingService] = useState(null);
    const [passwordModal, setPasswordModal] = useState({ isOpen: false, action: null });
    const [userModalOpen, setUserModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const isAdmin = currentUser.role === 'admin';
    const restoreInputRef = useRef(null);
    const [restoreFile, setRestoreFile] = useState(null);
    const [isRestoreModalVisible, setIsRestoreModalVisible] = useState(false);
    const isWebBluetoothSupported = navigator.bluetooth ? true : false;
    const [localBranding, setLocalBranding] = useState(branding);

    const withPasswordProtection = (action) => {
        if (!masterPassword || !isAdmin) {
            if (isAdmin) action();
            else showNotification("Only admins can perform this action.", "error");
            return;
        }
        setPasswordModal({ isOpen: true, action });
    };

    const handlePasswordConfirm = (password) => {
        if (password === masterPassword) {
            passwordModal.action();
            showNotification('Action approved', 'success');
        } else {
            showNotification('Incorrect master password', 'error');
        }
        setPasswordModal({ isOpen: false, action: null });
    };

    const handleSaveService = async (serviceData, serviceId) => {
        const dataToSave = { ...serviceData, id: serviceId || Date.now().toString(), price: parseFloat(serviceData.price), durationValue: parseInt(serviceData.durationValue, 10) || 0, isFree: parseFloat(serviceData.price) === 0 || !!serviceData.isFree };
        await dbAction('services', 'readwrite', (store) => store.put(dataToSave));
        if (serviceId) {
            setServices(prev => prev.map(s => s.id === serviceId ? dataToSave : s));
            showNotification('Service updated!', 'success');
            addLog(`Updated service: ${dataToSave.name}`);
        } else {
            setServices(prev => [...prev, dataToSave]);
            showNotification('Service added!', 'success');
            addLog(`Added new service: ${dataToSave.name}`);
        }
        setEditingService(null);
    };
    const handleDeleteService = async (serviceId) => {
        const serviceToDelete = services.find(s => s.id === serviceId);
        await dbAction('services', 'readwrite', (store) => store.delete(serviceId));
        setServices(prev => prev.filter(s => s.id !== serviceId));
        showNotification('Service deleted.', 'info');
        addLog(`Deleted service: ${serviceToDelete.name}`);
    };

    const handleAddUser = async (userData) => {
        const adminUser = systemUsers.find(u => u.username === currentUser.username);
        if (adminUser.password !== userData.adminPassword) {
            showNotification('Incorrect admin password.', 'error');
            return;
        }
        if (systemUsers.find(u => u.username === userData.username)) {
            showNotification('Username already exists.', 'error');
            return;
        }

        const newUser = {
            id: Date.now().toString(),
            username: userData.username,
            password: userData.password,
            fullName: userData.fullName,
            role: 'staff',
            createdAt: new Date().toISOString()
        };
        await dbAction('system_users', 'readwrite', (store) => store.add(newUser));
        setSystemUsers(prev => [...prev, newUser]);
        addLog(`Admin ${currentUser.username} created new staff user: ${newUser.username}`);
        showNotification('New staff user created successfully!', 'success');
        setUserModalOpen(false);
    };

    const handleEditUser = async (userData) => {
        const adminUser = systemUsers.find(u => u.username === currentUser.username);
        if (adminUser.password !== userData.adminPassword) {
            showNotification('Incorrect admin password.', 'error');
            return;
        }
        
        // Check if username is already taken by another user
        const existingUser = systemUsers.find(u => u.username === userData.username && u.id !== userData.id);
        if (existingUser) {
            showNotification('Username already exists.', 'error');
            return;
        }

        const updatedUser = {
            ...userData,
            // Don't update role if it's not provided to prevent accidental changes
            role: userData.role || systemUsers.find(u => u.id === userData.id).role
        };
        
        await dbAction('system_users', 'readwrite', (store) => store.put(updatedUser));
        setSystemUsers(prev => prev.map(u => u.id === userData.id ? updatedUser : u));
        addLog(`Admin ${currentUser.username} updated user: ${updatedUser.username}`);
        showNotification('User updated successfully!', 'success');
        setEditingUser(null);
    };

    const handleDeleteUser = async (userId) => {
        const adminUser = systemUsers.find(u => u.username === currentUser.username);
        const userToDelete = systemUsers.find(u => u.id === userId);
        
        if (!userToDelete) {
            showNotification('User not found.', 'error');
            return;
        }
        
        // Prevent deleting the current user if they are admin
        if (userToDelete.username === currentUser.username && userToDelete.role === 'admin') {
            showNotification('Cannot delete your own admin account.', 'error');
            return;
        }
        
        await dbAction('system_users', 'readwrite', (store) => store.delete(userId));
        setSystemUsers(prev => prev.filter(u => u.id !== userId));
        addLog(`Admin ${currentUser.username} deleted user: ${userToDelete.username}`);
        showNotification('User deleted successfully!', 'success');
    };

    const handleBackup = async () => {
        try {
            showNotification('Starting backup... this may take a moment.', 'info');
            const db = await openDB();
            const stores = Array.from(db.objectStoreNames);
            const backupData = {};

            for (const storeName of stores) {
                const data = await dbAction(storeName, 'readonly', store => store.getAll());
                backupData[storeName] = data;
            }
            db.close();

            const jsonString = JSON.stringify(backupData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const date = new Date().toISOString().split('T')[0];
            a.href = url;
            a.download = `gym-backup-${date}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showNotification('Backup created successfully!', 'success');
            addLog('Created a data backup.');
        } catch (error) {
            console.error("Backup failed:", error);
            showNotification('Backup failed. See console for details.', 'error');
        }
    };

    const handleRestoreFileSelect = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        setRestoreFile(file);
        setIsRestoreModalVisible(true);
        restoreInputRef.current.value = ''; // Reset file input to allow re-selection of the same file
    };

    const confirmRestore = () => {
        setIsRestoreModalVisible(false);
        if (!restoreFile) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const backupData = JSON.parse(e.target.result);
                showNotification('Restoring data... Please wait.', 'info');

                const db = await openDB();
                const stores = Array.from(db.objectStoreNames);

                const missingStores = stores.filter(s => !backupData.hasOwnProperty(s));
                if (missingStores.length > 0) {
                    throw new Error(`Invalid backup file. Missing data for: ${missingStores.join(', ')}`);
                }

                const tx = db.transaction(stores, 'readwrite');

                for (const storeName of stores) {
                    const store = tx.objectStore(storeName);
                    store.clear();
                    for (const record of backupData[storeName]) {
                        store.put(record);
                    }
                }

                tx.oncomplete = () => {
                    db.close();
                    showNotification('Restore successful! The application will now reload.', 'success');
                    addLog('Restored data from a backup file.');
                    setTimeout(() => window.location.reload(), 2000);
                };

                tx.onerror = (event) => {
                    throw new Error('Transaction failed during restore: ' + event.target.error);
                };

            } catch (error) {
                console.error("Restore failed:", error);
                showNotification(`Restore failed: ${error.message}`, 'error');
                db.close();
            }
        };
        reader.readAsText(restoreFile);
    };

    const handleConnectPrinter = async () => {
        try {
            // Show a selection modal for printer type
            const printerType = await showPrinterSelectionModal();
            
            if (printerType === 'bluetooth') {
                await connectBluetoothPrinter();
            } else if (printerType === 'usb') {
                await connectUSBPrinter();
            }
        } catch (error) {
            console.error('Printer connection failed:', error);
            showNotification('Failed to connect to printer.', 'error');
        }
    };

    const showPrinterSelectionModal = () => {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center';
            modal.innerHTML = `
                <div class="bg-white p-6 rounded-lg shadow-lg max-w-md w-full mx-4">
                    <h3 class="text-lg font-bold mb-4">Select Printer Type</h3>
                    <div class="space-y-3">
                        <button id="bluetooth-btn" class="w-full p-3 text-left border rounded-lg hover:bg-blue-50 ${
                            typeof navigator.bluetooth !== 'undefined' ? 'border-blue-200' : 'border-gray-300 opacity-50 cursor-not-allowed'
                        }">
                            <div class="font-medium">Bluetooth Printer</div>
                            <div class="text-sm text-gray-600">Connect via Bluetooth (Chrome/Edge required)</div>
                            ${typeof navigator.bluetooth === 'undefined' ? '<div class="text-xs text-red-500 mt-1">Not supported in this browser</div>' : ''}
                        </button>
                        <button id="usb-btn" class="w-full p-3 text-left border rounded-lg hover:bg-green-50 ${
                            typeof navigator.usb !== 'undefined' ? 'border-green-200' : 'border-gray-300 opacity-50 cursor-not-allowed'
                        }">
                            <div class="font-medium">USB Printer</div>
                            <div class="text-sm text-gray-600">Connect via USB (Chrome/Edge required)</div>
                            ${typeof navigator.usb === 'undefined' ? '<div class="text-xs text-red-500 mt-1">Not supported in this browser</div>' : ''}
                        </button>
                    </div>
                    <div class="flex justify-end gap-2 mt-4">
                        <button id="cancel-btn" class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            const bluetoothBtn = modal.querySelector('#bluetooth-btn');
            const usbBtn = modal.querySelector('#usb-btn');
            const cancelBtn = modal.querySelector('#cancel-btn');
            
            const cleanup = () => {
                document.body.removeChild(modal);
            };
            
            bluetoothBtn.onclick = () => {
                if (typeof navigator.bluetooth !== 'undefined') {
                    cleanup();
                    resolve('bluetooth');
                }
            };
            
            usbBtn.onclick = () => {
                if (typeof navigator.usb !== 'undefined') {
                    cleanup();
                    resolve('usb');
                }
            };
            
            cancelBtn.onclick = () => {
                cleanup();
                resolve(null);
            };
            
            modal.onclick = (e) => {
                if (e.target === modal) {
                    cleanup();
                    resolve(null);
                }
            };
        });
    };

    const connectBluetoothPrinter = async () => {
        const device = await navigator.bluetooth.requestDevice({
            filters: [
                { services: ['000018f0-0000-1000-8000-00805f9b34fb'] }, // Generic printer service
                { services: ['0000180a-0000-1000-8000-00805f9b34fb'] }, // Device Information Service
            ],
            optionalServices: [
                '000018f0-0000-1000-8000-00805f9b34fb',
                '0000180a-0000-1000-8000-00805f9b34fb',
                '0000180f-0000-1000-8000-00805f9b34fb', // Battery Service
            ]
        });
        
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
        const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');
        
        const printerInfo = {
            type: 'bluetooth',
            device,
            characteristic,
            name: device.name || 'Bluetooth Printer'
        };
        
        setPrinterCharacteristic(printerInfo);
        showNotification(`Connected to ${printerInfo.name}!`, 'success');
        addLog(`Connected to Bluetooth printer: ${printerInfo.name}`);
    };

    const connectUSBPrinter = async () => {
        const device = await navigator.usb.requestDevice({
            filters: [
                { vendorId: 0x04b8 }, // Epson
                { vendorId: 0x04da }, // Panasonic
                { vendorId: 0x0519 }, // Star Micronics
                { vendorId: 0x0a5f }, // Zebra
                { vendorId: 0x154f }, // SNBC
                { vendorId: 0x0dd4 }, // Opticon
                { vendorId: 0x0fe6 }, // ICS Advent
                { classCode: 7 }      // Printer class
            ]
        });
        
        await device.open();
        
        if (device.configuration === null) {
            await device.selectConfiguration(1);
        }
        
        // Find the bulk OUT endpoint for printing
        let endpoint = null;
        for (const interface_ of device.configuration.interfaces) {
            await device.claimInterface(interface_.interfaceNumber);
            for (const alternate of interface_.alternates) {
                for (const ep of alternate.endpoints) {
                    if (ep.direction === 'out' && ep.type === 'bulk') {
                        endpoint = ep.endpointNumber;
                        break;
                    }
                }
                if (endpoint) break;
            }
            if (endpoint) break;
        }
        
        if (!endpoint) {
            throw new Error('No suitable USB endpoint found for printing');
        }
        
        const printerInfo = {
            type: 'usb',
            device,
            endpoint,
            name: `${device.manufacturerName || 'USB'} ${device.productName || 'Printer'}`
        };
        
        setPrinterCharacteristic(printerInfo);
        showNotification(`Connected to ${printerInfo.name}!`, 'success');
        addLog(`Connected to USB printer: ${printerInfo.name}`);
    };

    const handleBrandingChange = (e) => {
        const { name, value } = e.target;
        setLocalBranding(prev => ({ ...prev, [name]: value }));
    };

    const handleLogoUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setLocalBranding(prev => ({ ...prev, logo: reader.result }));
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSaveBranding = async () => {
        const newBranding = { ...localBranding, id: 'brandSettings' };
        await dbAction('branding', 'readwrite', (store) => store.put(newBranding));
        setBranding(newBranding);
        showNotification('Branding updated successfully!', 'success');
        addLog('Updated application branding.');
    };

    return (
        <div className="space-y-8">
            {isRestoreModalVisible && (
                <ConfirmationModal
                    title="Confirm Data Restore"
                    message="WARNING: Restoring from a backup will completely overwrite all current data in the application. This action cannot be undone. Are you sure you want to proceed?"
                    onConfirm={confirmRestore}
                    onCancel={() => setIsRestoreModalVisible(false)}
                />
            )}
            {passwordModal.isOpen && <PasswordModal onConfirm={handlePasswordConfirm} onCancel={() => setPasswordModal({ isOpen: false, action: null })} />}
            {editingService && <ServiceForm service={editingService} onSave={(data, id) => withPasswordProtection(() => handleSaveService(data, id))} onCancel={() => setEditingService(null)} />}
            {(userModalOpen || editingUser) && (
                <UserFormModal 
                    user={editingUser} 
                    onCancel={() => {
                        setUserModalOpen(false);
                        setEditingUser(null);
                    }} 
                    onConfirm={editingUser ? handleEditUser : handleAddUser} 
                />
            )}

            <div className="bg-white p-8 rounded-2xl shadow-lg">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold text-gray-800">Services & Pricing</h2>
                    {isAdmin && <button onClick={() => withPasswordProtection(() => setEditingService({}))} className="bg-[var(--primary-color)] text-white font-bold py-2 px-4 rounded-lg hover:opacity-90 transition-opacity">+ Add Service</button>}
                </div>
                <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200"><thead className="bg-gray-50"><tr><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Service Name</th><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th><th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th></tr></thead><tbody className="bg-white divide-y divide-gray-200">{services.map(s => (<ServiceListItem key={s.id} service={s} onEdit={() => withPasswordProtection(() => setEditingService(s))} onDelete={() => withPasswordProtection(() => handleDeleteService(s.id))} isAdmin={isAdmin} />))}</tbody></table></div>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-lg">
                <h3 className="text-xl font-bold text-gray-700 mb-4">Hardware</h3>
                {!isWebBluetoothSupported && <p className="text-red-500 text-sm">Web Bluetooth is not supported on this browser. Please use Chrome or Edge.</p>}
                <div className="flex items-center gap-4">
                    <button onClick={handleConnectPrinter} disabled={!isWebBluetoothSupported} className="bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400">Connect to Printer</button>
                    {printerCharacteristic ? <span className="text-green-600 font-semibold">Printer Connected</span> : <span className="text-gray-500">No printer connected</span>}
                </div>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-lg">
                <h3 className="text-xl font-bold text-gray-700 mb-4">Print Queue</h3>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-gray-600">
                            {printQueue.length === 0 ? 'No jobs in queue' : `${printQueue.length} job${printQueue.length > 1 ? 's' : ''} in queue`}
                        </span>
                        {isProcessingQueue && <span className="text-blue-600 text-sm font-medium">Processing...</span>}
                    </div>
                    <div className="flex gap-2">
                        <button 
                            onClick={() => setPrintQueue([])} 
                            disabled={printQueue.length === 0}
                            className="bg-red-500 text-white font-bold py-1 px-3 rounded hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm"
                        >
                            Clear Queue
                        </button>
                        <button 
                            onClick={() => setPrintQueue(prev => prev.map(job => ({ ...job, status: 'pending' })))}
                            disabled={printQueue.filter(job => job.status === 'failed').length === 0}
                            className="bg-yellow-500 text-white font-bold py-1 px-3 rounded hover:bg-yellow-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm"
                        >
                            Retry Failed
                        </button>
                    </div>
                </div>
                
                {printQueue.length > 0 && (
                    <div className="overflow-x-auto max-h-64 overflow-y-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Receipt #</th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {printQueue.map((job, index) => (
                                    <tr key={index}>
                                        <td className="px-4 py-2 text-sm">{job.receiptNumber}</td>
                                        <td className="px-4 py-2 text-sm">{job.type}</td>
                                        <td className="px-4 py-2 text-sm">
                                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                                job.status === 'completed' ? 'bg-green-100 text-green-800' :
                                                job.status === 'failed' ? 'bg-red-100 text-red-800' :
                                                job.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                                                'bg-yellow-100 text-yellow-800'
                                            }`}>
                                                {job.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2 text-sm text-gray-500">
                                            {new Date(job.timestamp).toLocaleTimeString()}
                                        </td>
                                        <td className="px-4 py-2 text-right">
                                            <button 
                                                onClick={() => setPrintQueue(prev => prev.filter((_, i) => i !== index))}
                                                className="text-red-600 hover:text-red-800 text-sm"
                                                title="Remove from queue"
                                            >
                                                Remove
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {isAdmin && <div className="bg-white p-8 rounded-2xl shadow-lg">
                <h3 className="text-xl font-bold text-gray-700 mb-4">Data Management</h3>
                <div className="p-4 bg-yellow-50 border-l-4 border-yellow-400 text-yellow-800 rounded-lg mb-4">
                    <p className="font-bold">Important:</p>
                    <p className="text-sm">Regularly back up your data to prevent loss. Restoring from a backup will overwrite all current data.</p>
                </div>
                <div className="flex gap-4">
                    <button onClick={handleBackup} className="bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700">Backup All Data</button>
                    <button onClick={() => restoreInputRef.current.click()} className="bg-gray-400 text-white font-bold py-2 px-4 rounded-lg cursor-not-allowed" disabled title="Restore feature coming in a future version.">Restore from Backup</button>
                    <input type="file" ref={restoreInputRef} onChange={handleRestoreFileSelect} className="hidden" accept=".json" />
                </div>
            </div>}

            {isAdmin && <div className="bg-white p-8 rounded-2xl shadow-lg">
                <h3 className="text-xl font-bold text-gray-700 mb-2">User Management</h3>
                <button onClick={() => setUserModalOpen(true)} className="bg-blue-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-600 mb-4">+ Add New User</button>
                <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200"><thead className="bg-gray-50"><tr><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Full Name</th><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Username</th><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th><th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th></tr></thead><tbody className="bg-white divide-y divide-gray-200">{systemUsers.map(u => (<UserListItem key={u.id} user={u} currentUser={currentUser} onEdit={setEditingUser} onDelete={(userId) => withPasswordProtection(() => handleDeleteUser(userId))} />))}</tbody></table></div>
            </div>}


                {isAdmin && <div className="bg-white p-8 rounded-2xl shadow-lg">
                <h3 className="text-xl font-bold text-gray-700 mb-4">Branding & Appearance</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Gym Name</label>
                        <input type="text" name="gymName" value={localBranding.gymName} onChange={handleBrandingChange} className="w-full p-2 border rounded mt-1" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Logo</label>
                        <input type="file" onChange={handleLogoUpload} accept="image/*" className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Primary Color</label>
                        <input type="color" name="primaryColor" value={localBranding.primaryColor} onChange={handleBrandingChange} className="w-full h-10 p-1 border rounded" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Accent Color</label>
                        <input type="color" name="accentColor" value={localBranding.accentColor} onChange={handleBrandingChange} className="w-full h-10 p-1 border rounded" />
                    </div>
                </div>
                <button onClick={handleSaveBranding} className="mt-4 bg-green-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-600">Save Branding</button>
            </div>}

        </div>
    );
};
const ServiceForm = ({ service, onSave, onCancel }) => {
    const [formData, setFormData] = useState({ name: '', price: '0', type: 'Membership', durationValue: 1, durationUnit: 'Months', notes: '', isPackage: false, ...service });
    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };
    const handleSubmit = (e) => { e.preventDefault(); onSave(formData, service.id); };
    const showDuration = formData.type === 'Membership' || formData.type === 'Coaching';

    return (
        <Modal onClose={onCancel} size="lg">
            <form onSubmit={handleSubmit} className="space-y-4"><h3 className="text-2xl font-bold text-gray-800 mb-4">{service.id ? 'Edit Service' : 'Add New Service'}</h3>
                <input name="name" value={formData.name} onChange={handleChange} placeholder="Service Name" required className="w-full p-2 border rounded" />
                <div className="grid grid-cols-2 gap-4">
                    <input name="price" type="number" value={formData.price} onChange={handleChange} placeholder="Price (PHP)" required min="0" step="0.01" className="w-full p-2 border rounded" />
                    <select name="type" value={formData.type} onChange={handleChange} className="w-full p-2 border rounded bg-white"><option value="Membership">Membership</option><option value="Coaching">Coaching</option><option value="Package">Package</option><option value="Other">Other</option></select>
                </div>
                {showDuration && <div className="grid grid-cols-2 gap-4"><input name="durationValue" type="number" value={formData.durationValue} onChange={handleChange} placeholder="e.g., 1, 3" required min="1" className="w-full p-2 border rounded" /><select name="durationUnit" value={formData.durationUnit} onChange={handleChange} className="w-full p-2 border rounded bg-white"><option value="Days">Days</option><option value="Months">Months</option><option value="Sessions">Sessions</option></select></div>}
                <textarea name="notes" value={formData.notes} onChange={handleChange} placeholder="Notes (e.g., 'Free promo', 'Includes 1 coaching session')" className="w-full p-2 border rounded"></textarea>
                <div className="flex justify-end space-x-3 pt-4"><button type="button" onClick={onCancel} className="bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">Cancel</button><button type="submit" className="bg-green-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-600">Save</button></div>
            </form>
        </Modal>
    );
};
const ServiceListItem = ({ service, onEdit, onDelete, isAdmin }) => (
    <tr>
        <td className="px-6 py-4 whitespace-nowrap"><div className="font-medium">{service.name}</div><div className="text-xs text-gray-500">{service.notes}</div></td>
        <td className="px-6 py-4 whitespace-nowrap">{service.type}</td>
        <td className="px-6 py-4 whitespace-nowrap">{service.durationValue ? `${service.durationValue} ${service.durationUnit}` : 'N/A'}</td>
        <td className="px-6 py-4 whitespace-nowrap">{service.price > 0 ? `₱${service.price.toFixed(2)}` : 'Free'}</td>
        <td className="px-6 py-4 whitespace-nowrap text-right">
            {isAdmin && <>
                <button onClick={onEdit} className="p-2 text-gray-500 hover:text-blue-600 rounded-full" title="Edit Service"><Icons.Edit /></button>
                <button onClick={onDelete} className="p-2 text-gray-500 hover:text-red-600 rounded-full" title="Delete Service"><Icons.Delete /></button>
            </>}
        </td>
    </tr>
);

const UserFormModal = ({ onCancel, onConfirm, user = null }) => {
    const [fullName, setFullName] = useState(user?.fullName || '');
    const [username, setUsername] = useState(user?.username || '');
    const [password, setPassword] = useState('');
    const [adminPassword, setAdminPassword] = useState('');
    const isEditing = !!user;

    const handleSubmit = (e) => {
        e.preventDefault();
        onConfirm({ fullName, username, password, adminPassword });
    };

    return (
        <Modal onClose={onCancel}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <h3 className="text-2xl font-bold text-gray-800 mb-4">{isEditing ? 'Edit User' : 'Add New Staff User'}</h3>
                <input name="fullName" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Full Name" required className="w-full p-2 border rounded" />
                <input name="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" required className="w-full p-2 border rounded" />
                <input name="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={isEditing ? "New Password (leave blank to keep current)" : "Password"} required={!isEditing} className="w-full p-2 border rounded" />
                <div className="border-t pt-4">
                    <label className="block text-sm font-medium text-gray-700">Admin Password</label>
                    <p className="text-xs text-gray-500 mb-1">Enter your own password to authorize this action.</p>
                    <input name="adminPassword" type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} placeholder="Admin Password" required className="w-full p-2 border rounded" />
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                    <button type="button" onClick={onCancel} className="bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">Cancel</button>
                    <button type="submit" className="bg-blue-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-600">{isEditing ? 'Update User' : 'Create User'}</button>
                </div>
            </form>
        </Modal>
    );
};

const ShiftModal = ({ type, activeShift, sales, expenses, onCancel, showNotification, addLog, user, setShifts, setExpenses, shifts }) => {
    const [startingCash, setStartingCash] = useState('');
    const [actualCash, setActualCash] = useState('');
    const [expenseModalOpen, setExpenseModalOpen] = useState(false);
    const [centavosInput, setCentavosInput] = useState('');
    const [showEndShiftConfirmation, setShowEndShiftConfirmation] = useState(false);
    
// Cash denomination state
  const [denominations, setDenominations] = useState({
    1000: 0,
    500: 0,
    200: 0,
    100: 0,
    50: 0,
    20: 0,
    10: 0,
    5: 0,
    1: 0,
    0.50: 0, // 50 centavos
    0.25: 0, // 25 centavos
    0.01: 0  // 1 centavo
  });

    // Calculate total from denominations
    const denominationTotal = useMemo(() => {
        return Object.entries(denominations).reduce((total, [value, count]) => {
            return total + (parseFloat(value) * parseInt(count));
        }, 0);
    }, [denominations]);

// Update actualCash when denomination total changes
useEffect(() => {
    setActualCash(denominationTotal.toFixed(2));
}, [denominationTotal]);

    useEffect(() => {
        if (type === 'start') {
            const lastShift = [...shifts].filter(s => s.status === 'completed').sort((a, b) => new Date(b.endTime) - new Date(a.endTime))[0];
            if (lastShift && lastShift.actualCash) {
                setStartingCash(lastShift.actualCash.toFixed(2));
            }
        }
    }, [type, shifts]);

    const handleDenominationChange = (denomination, value) => {
        setDenominations(prev => ({
            ...prev,
            [denomination]: Math.max(0, parseInt(value) || 0)
        }));
    };

    const handleCentavosChange = (value) => {
        // Update the input state immediately for natural typing
        setCentavosInput(value);
        
        // Remove any non-numeric characters except decimal point
        let cleanValue = value.replace(/[^0-9.]/g, '');
        
        // If the input is just a number without decimal, convert it to centavos
        // e.g., "50" becomes "0.50", "25" becomes "0.25"
        if (cleanValue && !cleanValue.includes('.') && cleanValue.length <= 2) {
            const numValue = parseInt(cleanValue);
            if (numValue <= 99) {
                cleanValue = (numValue / 100).toFixed(2);
            }
        }
        
        // Ensure the value doesn't exceed 99.99 (reasonable limit for centavos)
        const numericValue = parseFloat(cleanValue);
        if (numericValue > 99.99) {
            cleanValue = '99.99';
        }
        
        // Store the centavos value as a number in the 0.01 key (since we're dealing with total centavos)
        const centavosValue = parseFloat(cleanValue) || 0;
        setDenominations(prev => ({
            ...prev,
            0.01: centavosValue * 100 // Convert to number of 1-centavo coins for calculation
        }));
    };

    const resetDenominations = () => {
        const resetDenoms = Object.keys(denominations).reduce((acc, key) => {
            acc[key] = 0;
            return acc;
        }, {});
        setDenominations(resetDenoms);
        setCentavosInput(''); // Also reset the centavos input
    };

    const handleStartShift = async (e) => {
        e.preventDefault();
        const newShift = { id: Date.now().toString(), startTime: new Date().toISOString(), status: 'active', startingCash: parseFloat(startingCash), user: user.username };
        await dbAction('shifts', 'readwrite', (store) => store.add(newShift));
        setShifts(prev => [...prev, newShift]);
        await addLog(`User ${user.username} started a shift with starting cash of ₱${parseFloat(startingCash).toFixed(2)}.`);
        showNotification('Shift started successfully!', 'success');
        onCancel();
    };

    const handleEndShiftRequest = (e) => {
        e.preventDefault();
        
        // Always show confirmation modal for end shift
        setShowEndShiftConfirmation(true);
    };

    const handleConfirmEndShift = async () => {
        const shiftExpenses = expenses.filter(ex => ex.shiftId === activeShift.id);
        const cashSales = sales.filter(s => s.shiftId === activeShift.id).reduce((sum, s) => sum + (s.cashPaid || 0), 0);
        const cashExpenses = shiftExpenses.filter(ex => ex.type === 'Cash Drawer').reduce((sum, ex) => sum + ex.amount, 0);
        const cashIns = shiftExpenses.filter(ex => ex.type === 'Cash In').reduce((sum, ex) => sum + ex.amount, 0);
        const expectedCash = (activeShift.startingCash + cashSales + cashIns) - cashExpenses;

        const updatedShift = { ...activeShift, endTime: new Date().toISOString(), status: 'completed', cashSales, cashOut: cashExpenses, cashIn: cashIns, actualCash: parseFloat(actualCash), expectedCash, difference: parseFloat(actualCash) - expectedCash };
        await dbAction('shifts', 'readwrite', (store) => store.put(updatedShift));
        setShifts(prev => prev.map(s => s.id === activeShift.id ? updatedShift : s));
        await addLog(`User ${user.username} ended shift ${activeShift.id.slice(-4)}.`);
        showNotification('Shift ended successfully!', 'success');
        setShowEndShiftConfirmation(false);
        onCancel();
    };

    const handleAddLateExpense = async (expenseData) => {
        const newExpense = {
            ...expenseData,
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            shiftId: activeShift.id,
            addedDuringClose: true,
        };
        await dbAction('expenses', 'readwrite', (store) => store.add(newExpense));
        setExpenses(prev => [...prev, newExpense]);
        addLog(`Recorded late expense: ${expenseData.note} for ₱${expenseData.amount.toFixed(2)} via ${expenseData.type}.`);
        showNotification('Late expense recorded.', 'success');
        setExpenseModalOpen(false);
    };

    if (type === 'start') {
        return (
            <Modal onClose={onCancel} size="sm">
                <form onSubmit={handleStartShift}>
                    <h3 className="text-xl font-bold text-gray-800 mb-4">Start New Shift</h3>
                    <label className="block text-sm font-medium text-gray-700">Starting Cash in Drawer</label>
                    <input type="number" step="0.01" value={startingCash} onChange={e => setStartingCash(e.target.value)} className="w-full p-2 border rounded mt-1" required autoFocus />
                    <div className="flex justify-end space-x-3 pt-4">
                        <button type="button" onClick={onCancel} className="bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">Cancel</button>
                        <button type="submit" className="bg-green-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-600">Start Shift</button>
                    </div>
                </form>
            </Modal>
        );
    }

    if (type === 'end' && activeShift) {
        const shiftSales = sales.filter(s => s.shiftId === activeShift.id);
        const shiftExpenses = expenses.filter(ex => ex.shiftId === activeShift.id);
        const cashSales = shiftSales.reduce((sum, s) => sum + (s.cashPaid || 0), 0);
        const onlineSales = shiftSales.reduce((sum, s) => sum + (s.onlinePaid || 0), 0);
        const cashOut = shiftExpenses.filter(ex => ex.type === 'Cash Drawer').reduce((sum, ex) => sum + ex.amount, 0);
        const cashIn = shiftExpenses.filter(ex => ex.type === 'Cash In').reduce((sum, ex) => sum + ex.amount, 0);
        const expectedCash = (activeShift.startingCash + cashSales + cashIn) - cashOut;

        return (
            <Modal onClose={onCancel}>
                {expenseModalOpen && <ExpenseModal onCancel={() => setExpenseModalOpen(false)} onConfirm={handleAddLateExpense} />}
                {showEndShiftConfirmation && <EndShiftConfirmationModal 
                    totalCash={parseFloat(actualCash || 0)}
                    expectedCash={expectedCash}
                    onConfirm={handleConfirmEndShift} 
                    onCancel={() => setShowEndShiftConfirmation(false)} 
                />}
                <form onSubmit={handleEndShiftRequest}>
                    <h3 className="text-xl font-bold text-gray-800 mb-4">End Shift</h3>
                    <div className="space-y-3 text-sm">
                        <p><strong>Start Time:</strong> {new Date(activeShift.startTime).toLocaleString()}</p>
                        <p><strong>Starting Cash:</strong> ₱{activeShift.startingCash.toFixed(2)}</p>
                        <p><strong>Total Cash Sales:</strong> ₱{cashSales.toFixed(2)}</p>
                        <p><strong>Total Online Sales:</strong> ₱{onlineSales.toFixed(2)}</p>
                        <div className="border-t pt-2 mt-2">
                            <h4 className="font-semibold mb-1">Cash Movements:</h4>
                            {shiftExpenses.length > 0 ? (
                                <ul className="text-xs list-disc pl-5">
                                    {shiftExpenses.map(ex => (
                                        <li key={ex.id} className={ex.type === 'Cash In' ? 'text-green-600' : 'text-red-600'}>
                                            {ex.type}: {ex.note}: ₱{ex.amount.toFixed(2)} {ex.addedDuringClose && "(Added Late)"}
                                        </li>
                                    ))}
                                </ul>
                            ) : <p className="text-xs text-gray-500">No cash movements recorded.</p>}
                            <p className="font-bold text-right">Total Cash In: <span className="text-green-600">₱{cashIn.toFixed(2)}</span></p>
                            <p className="font-bold text-right">Total Cash Out: <span className="text-red-600">₱{cashOut.toFixed(2)}</span></p>
                            <button type="button" onClick={() => setExpenseModalOpen(true)} className="text-xs bg-gray-200 px-2 py-1 rounded mt-1 hover:bg-gray-300">Add Late Expense</button>
                        </div>
                        <p className="font-bold pt-2 border-t mt-2"><strong>Expected Cash in Drawer:</strong> ₱{expectedCash.toFixed(2)}</p>
                        <div>
                            <label className="block font-medium text-gray-700">Actual Cash Counted</label>
                            <div className="space-y-2">
                                <div className="bg-gray-50 p-3 rounded border">
                                    <div className="flex justify-between items-center mb-2">
                                        <h5 className="font-medium text-sm">Cash Denominations</h5>
                                        <button
                                            type="button"
                                            onClick={resetDenominations}
                                            className="text-xs bg-gray-200 px-2 py-1 rounded hover:bg-gray-300"
                                        >
                                            Reset
                                        </button>
                                    </div>
                                    
                                    <div className="grid grid-cols-2 gap-4 text-xs">
                                        {/* Bills */}
                                        <div className="border-2 border-green-200 bg-green-50 rounded-lg p-3 space-y-1">
                                            <h6 className="font-medium text-green-800 text-center mb-2">Bills</h6>
                                            {[1000, 500, 200, 100, 50, 20].map(value => (
                                                <div key={value} className="flex items-center justify-between">
                                                    <span>₱{value}:</span>
                                                    <input 
                                                        type="number" 
                                                        min="0" 
                                                        value={denominations[value] || ''} 
                                                        onChange={e => handleDenominationChange(value, e.target.value)}
                                                        className="w-16 p-1 border rounded text-center bg-white"
                                                        placeholder="0"
                                                    />
                                                </div>
                                            ))}
                                        </div>

                                        {/* Coins and Centavos */}
                                        <div className="space-y-3">
                                            {/* Coins */}
                                            <div className="border-2 border-blue-200 bg-blue-50 rounded-lg p-3 space-y-1">
                                                <h6 className="font-medium text-blue-800 text-center mb-2">Coins</h6>
                                                {[10, 5, 1].map(value => (
                                                    <div key={value} className="flex items-center justify-between">
                                                        <span>₱{value}:</span>
                                                        <input 
                                                            type="number" 
                                                            min="0" 
                                                            value={denominations[value] || ''} 
                                                            onChange={e => handleDenominationChange(value, e.target.value)}
                                                            className="w-16 p-1 border rounded text-center bg-white"
                                                            placeholder="0"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                            
                                            {/* Centavos */}
                                            <div className="border-2 border-orange-200 bg-orange-50 rounded-lg p-3 space-y-1">
                                                <h6 className="font-medium text-orange-800 text-center mb-2">Centavos</h6>
                                                <div className="flex items-center justify-between">
                                                    <span className="pr-2">Total:</span>
                                                    <input 
                                                        type="text" 
                                                        min="0" 
                                                        value={centavosInput} 
                                                        onChange={e => handleCentavosChange(e.target.value)}
                                                        onBlur={e => {
                                                            // Format the input when focus is lost
                                                            const numericValue = parseFloat(e.target.value) || 0;
                                                            if (numericValue > 0) {
                                                                setCentavosInput(numericValue.toFixed(2));
                                                            } else {
                                                                setCentavosInput('');
                                                            }
                                                        }}
                                                        className="w-24 p-1 border rounded text-center bg-white"
                                                        placeholder="0.00"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div className="mt-2 pt-2 border-t">
                                        <p className="text-sm font-medium text-right">
                                            Total: ₱{denominationTotal.toFixed(2)}
                                        </p>
                                    </div>
                                </div>
                                
                            <div className="mt-1">
                                <input 
                                    type="number" 
                                    readOnly 
                                    step="0.01" 
                                    value={actualCash} 
                                    className="w-full p-2 border rounded bg-gray-100 text-gray-600" 
                                    placeholder="Total from denominations above"
                                />
                            </div>
                            </div>
                        </div>
                        <p><strong>Difference:</strong> <span className={`font-bold ${parseFloat(actualCash) - expectedCash >= 0 ? 'text-green-600' : 'text-red-600'}`}>₱{(parseFloat(actualCash || 0) - expectedCash).toFixed(2)}</span></p>
                    </div>
                    <div className="flex justify-end space-x-3 pt-4">
                        <button type="button" onClick={onCancel} className="bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">Cancel</button>
                        <button type="submit" className="bg-[var(--accent-color)] text-white font-bold py-2 px-4 rounded-lg hover:opacity-90 transition-opacity">Review & End Shift</button>
                    </div>
                </form>
            </Modal>
        );
    }

    return null;
};

const EndShiftConfirmationModal = ({ totalCash, expectedCash, onConfirm, onCancel }) => {
    const difference = totalCash - expectedCash;
    const isZeroCash = totalCash === 0;
    
    return (
        <Modal onClose={onCancel} size="sm">
            <div className="text-center">
                <div className="mb-6">
                    <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-yellow-100 mb-4">
                        <svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.232 13.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 mb-4">Confirm End Shift</h3>
                </div>
                
                <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
                    <div className="text-sm space-y-2">
                        <div className="flex justify-between">
                            <span className="text-gray-600">Expected Cash:</span>
                            <span className="font-mono">₱{expectedCash.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-600">Actual Cash:</span>
                            <span className="font-mono">₱{totalCash.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between border-t pt-2 font-semibold">
                            <span className="text-gray-700">Difference:</span>
                            <span className={`font-mono ${difference >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                ₱{difference.toFixed(2)}
                            </span>
                        </div>
                    </div>
                </div>

                {isZeroCash && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                        <div className="flex items-center mb-2">
                            <svg className="h-5 w-5 text-red-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="font-semibold text-red-800">Zero Cash Alert</span>
                        </div>
                        <p className="text-sm text-red-700">
                            You are ending the shift with ₱0.00 in the cash drawer. Please verify this is correct.
                        </p>
                    </div>
                )}

                <div className="text-left text-sm text-gray-600 mb-6">
                    <h4 className="font-semibold mb-2">Please confirm:</h4>
                    <ul className="space-y-1 text-xs">
                        <li>✓ All cash has been counted accurately</li>
                        <li>✓ All transactions have been recorded</li>
                        <li>✓ Any cash discrepancies have been noted</li>
                        {isZeroCash && <li className="text-red-600">✓ Zero cash amount is intentional</li>}
                    </ul>
                </div>

                <div className="flex space-x-3">
                    <button 
                        type="button" 
                        onClick={onCancel} 
                        className="flex-1 bg-gray-200 text-gray-700 font-bold py-3 px-4 rounded-lg hover:bg-gray-300 transition-colors"
                    >
                        Cancel
                    </button>
                    <button 
                        type="button" 
                        onClick={onConfirm} 
                        className="flex-1 bg-red-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-red-700 transition-colors"
                    >
                        End Shift
                    </button>
                </div>
            </div>
        </Modal>
    );
};

const ExpenseModal = ({ onCancel, onConfirm }) => {
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [type, setType] = useState('Cash Drawer');

    const handleSubmit = (e) => {
        e.preventDefault();
        onConfirm({ amount: parseFloat(amount), note, type });
    };

    return (
        <Modal onClose={onCancel} size="sm">
            <form onSubmit={handleSubmit}>
                <h3 className="text-xl font-bold text-gray-800 mb-4">Record Expense / Cash Out</h3>
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Amount</label>
                        <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="w-full p-2 border rounded mt-1" required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Note / Reason</label>
                        <input type="text" value={note} onChange={e => setNote(e.target.value)} className="w-full p-2 border rounded mt-1" required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Payment Source</label>
                        <select value={type} onChange={e => setType(e.target.value)} className="w-full p-2 border rounded bg-white mt-1">
                            <option>Cash Drawer</option>
                            <option>Online</option>
                        </select>
                    </div>
                </div>
                <div className="flex justify-end space-x-3 pt-6">
                    <button type="button" onClick={onCancel} className="bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">Cancel</button>
                    <button type="submit" className="bg-blue-500 text-white font-bold py-2 px-6 rounded-lg hover:bg-blue-600">Save Expense</button>
                </div>
            </form>
        </Modal>
    );
};

const CashInModal = ({ onCancel, onConfirm }) => {
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        onConfirm({ amount: parseFloat(amount), note });
    };

    return (
        <Modal onClose={onCancel} size="sm">
            <form onSubmit={handleSubmit}>
                <h3 className="text-xl font-bold text-gray-800 mb-4">Record Cash In</h3>
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Amount</label>
                        <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="w-full p-2 border rounded mt-1" required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Note / Reason</label>
                        <input type="text" value={note} onChange={e => setNote(e.target.value)} className="w-full p-2 border rounded mt-1" required />
                    </div>
                </div>
                <div className="flex justify-end space-x-3 pt-6">
                    <button type="button" onClick={onCancel} className="bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">Cancel</button>
                    <button type="submit" className="bg-green-500 text-white font-bold py-2 px-6 rounded-lg hover:bg-green-600">Save Cash In</button>
                </div>
            </form>
        </Modal>
    );
};


const UserListItem = ({ user, currentUser, onEdit, onDelete }) => {
    const isCurrentUser = user.username === currentUser.username;
    const canDelete = user.role !== 'admin' || !isCurrentUser; // Can't delete own admin account

    return (
        <tr>
            <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm font-medium text-gray-900">{user.fullName}</div>
                <div className="text-sm text-gray-500">{new Date(user.createdAt).toLocaleDateString()}</div>
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm text-gray-900">{user.username}</div>
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    user.role === 'admin' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                }`}>
                    {user.role}
                </span>
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <button 
                    onClick={() => onEdit(user)} 
                    className="p-2 text-gray-500 hover:text-blue-600 rounded-full" 
                    title="Edit User"
                >
                    <Icons.Edit />
                </button>
                {canDelete && (
                    <button 
                        onClick={() => onDelete(user.id)} 
                        className="p-2 text-gray-500 hover:text-red-600 rounded-full" 
                        title="Delete User"
                    >
                        <Icons.Delete />
                    </button>
                )}
            </td>
        </tr>
    );
};

const LogsTab = ({ logs }) => {
    const sortedLogs = [...logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return (
        <div className="bg-white p-8 rounded-2xl shadow-lg">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">System Logs</h2>
            <div className="overflow-x-auto max-h-[60vh]">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {sortedLogs.map(log => (
                            <tr key={log.id}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(log.timestamp).toLocaleString()}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{log.user}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{log.action}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
