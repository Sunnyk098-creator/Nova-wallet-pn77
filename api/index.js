import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set, update, runTransaction, increment } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyD5oCT3Qj2mvub0xjQsXVkGvyxm1Kc6aU8",
  authDomain: "nova-wallet-c97f1.firebaseapp.com",
  databaseURL: "https://nova-wallet-c97f1-default-rtdb.firebaseio.com",
  projectId: "nova-wallet-c97f1",
  storageBucket: "nova-wallet-c97f1.firebasestorage.app",
  messagingSenderId: "623660520566",
  appId: "1:623660520566:web:9fb41a1bcfd24487dd3b57"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// NEW SECURE BOT TOKEN
const BOT_TOKEN = "8824808158:AAFW68CINMy7yFBPboLmQE-5plgpQCWcwZg";

function getExactDate() {
    return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

// Format IP for Firebase keys
function sanitizeIP(ipStr) {
    if (!ipStr) return 'unknown';
    return ipStr.split(',')[0].trim().replace(/\./g, '_').replace(/:/g, '_');
}

// Backend function to securely send TG messages
async function sendTelegramMsg(chatId, text) {
    try {
        if (!chatId) return false;
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
        });
        return true;
    } catch (e) { return false; }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');

    if (req.method === 'OPTIONS') return res.status(200).end();

    let isApiRequest = false;
    let apiParams = {};

    // CHECK FOR EXTERNAL API PARAMETERS
    if (req.method === 'GET') {
        if (req.query && (req.query.key || req.query.token || req.query.balance || req.query.leaderboard || req.query.txn || req.query.authentication)) {
            isApiRequest = true;
            apiParams = req.query;
        } else {
            return res.redirect(302, 'https://nova-wallet-pn77.vercel.app');
        }
    }

    let body = req.body || {};
    if (req.method === 'POST') {
        if (typeof body === 'string') { 
            try { body = JSON.parse(body); } 
            catch (e) { return res.status(400).json({ status: 'error', message: 'Invalid JSON' }); } 
        }
        if (body.key || body.token || body.balance || body.leaderboard || body.txn || body.authentication) {
            isApiRequest = true;
            apiParams = body;
        }
    }

    // EXTERNAL API HANDLER
    if (isApiRequest) {
        try {
            // Fetch all users to resolve TgUserId, CustomId or Phone number
            const usersSnap = await get(ref(db, 'users'));

            function resolveUser(input) {
                if (!input) return null;
                let foundKey = null;
                let foundData = null;
                const strInput = String(input).trim();
                const lowerInput = strInput.toLowerCase();
                
                if (usersSnap.exists()) {
                    usersSnap.forEach(u => {
                        let d = u.val();
                        if (u.key === strInput || d.tgUserId === strInput || (d.customId && d.customId.toLowerCase() === lowerInput)) {
                            foundKey = u.key;
                            foundData = d;
                        }
                    });
                }
                return foundKey ? { key: foundKey, data: foundData } : null;
            }

            // 1. BALANCE CHECK API
            if (apiParams.balance) {
                const userObj = resolveUser(apiParams.balance);
                if (!userObj) return res.status(404).json({ status: "error", message: "User not found" });
                
                return res.status(200).json({
                    status: "success",
                    data: {
                        name: userObj.data.name || "Unknown",
                        number: userObj.key,
                        tgUserId: userObj.data.tgUserId || "N/A",
                        balance: Number(userObj.data.balance) || 0
                    }
                });
            }

            // 2. LEADERBOARD API
            if (apiParams.leaderboard) {
                if (!usersSnap.exists()) return res.status(404).json({ status: "error", message: "No users found" });
                let usersArr = [];
                usersSnap.forEach(u => {
                    let d = u.val();
                    usersArr.push({ name: d.name || "Unknown", number: u.key, tgUserId: d.tgUserId || "N/A", balance: Number(d.balance) || 0 });
                });
                usersArr.sort((a, b) => b.balance - a.balance);
                
                return res.status(200).json({
                    status: "success",
                    data: usersArr.slice(0, 3)
                });
            }

            // 3. FIND TRANSACTION API
            if (apiParams.txn) {
                const tId = String(apiParams.txn).trim().toUpperCase();
                const tSnap = await get(ref(db, `transactions/${tId}`));
                if (!tSnap.exists()) return res.status(404).json({ status: "error", message: "Transaction not found" });
                return res.status(200).json({
                    status: "success",
                    data: tSnap.val()
                });
            }

            // 4. ADMIN TRANSFER API
            if (apiParams.authentication) {
                const AUTH_KEY = "owcfoc2953vdoae03973dmdpsogw rl9282";
                if (apiParams.authentication !== AUTH_KEY) return res.status(401).json({ status: "error", message: "Unauthorized access" });
                
                const amt = Number(apiParams.amount);
                if (!apiParams.sender || !apiParams.receiver || isNaN(amt) || amt <= 0) {
                    return res.status(400).json({ status: "error", message: "Invalid parameters. Required: sender, receiver, amount" });
                }

                // Resolving users via Telegram ID or Phone number automatically
                const senderObj = resolveUser(apiParams.sender);
                const receiverObj = resolveUser(apiParams.receiver);
                
                if (!senderObj) return res.status(404).json({ status: "error", message: `Sender (${apiParams.sender}) not found in database` });
                if (!receiverObj) return res.status(404).json({ status: "error", message: `Receiver (${apiParams.receiver}) not found in database` });
                
                const sData = senderObj.data;
                const rData = receiverObj.data;
                const senderPhone = senderObj.key;
                const receiverPhone = receiverObj.key;

                if (Number(sData.balance) < amt) return res.status(400).json({ status: "error", message: "Sender has Insufficient balance" });

                let txnId = 'TXN' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2,5).toUpperCase();
                let updates = {};
                
                updates[`users/${senderPhone}/balance`] = Number(sData.balance) - amt;
                updates[`users/${receiverPhone}/balance`] = Number(rData.balance) + amt;
                
                const d = new Date();
                const pad = (n) => n < 10 ? '0'+n : n;
                const apiTimestamp = `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

                updates[`transactions/${txnId}`] = {
                    id: txnId, type: 'out', title: 'Admin Authorized Transfer', amount: amt, status: 'Success', date: getExactDate(), timestamp: Date.now(), icon: 'fa-exchange-alt', color: 'blue', senderId: senderPhone, receiverId: receiverPhone, name: rData.name || 'User', number: receiverPhone, comment: apiParams.comment || 'Admin API Txn', isApi: true
                };

                await update(ref(db), updates);

                return res.status(200).json({
                    status: "success",
                    message: "Payment successfully transferred",
                    data: {
                        transaction_id: txnId,
                        amount: amt,
                        sender: { number: senderPhone, tgUserId: sData.tgUserId || "N/A" },
                        receiver: { number: receiverPhone, tgUserId: rData.tgUserId || "N/A" },
                        timestamp: apiTimestamp
                    }
                });
            }

            // 5. EXISTING PAYOUT / UPI WITHDRAWAL API
            if (apiParams.key || apiParams.token) {
                let apiKey = apiParams.key || apiParams.token;
                let target = apiParams.paytm || apiParams.upi_id;
                let amt = Number(apiParams.amount);
                let comment = apiParams.comment || 'API Txn';

                if (!target || isNaN(amt) || amt <= 0) {
                    return res.status(400).json({ status: "error", message: "Invalid parameters" });
                }
                
                let senderPhone = null;
                let senderData = null;
                if (usersSnap.exists()) {
                    usersSnap.forEach(u => {
                        if (u.val().apiKey === apiKey) {
                            senderPhone = u.key;
                            senderData = u.val();
                        }
                    });
                }
                
                if (!senderPhone) return res.status(401).json({ status: "error", message: "Invalid API key" });
                if (Number(senderData.balance) < amt) return res.status(400).json({ status: "error", message: "Low Balance" });
                
                let txnId = 'API' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2,5).toUpperCase();
                let updates = {};
                updates[`users/${senderPhone}/balance`] = Number(senderData.balance) - amt;
                
                let receiverName = "";
                let receiverNumber = target;

                const pad = (n) => n < 10 ? '0'+n : n;
                const d = new Date();
                const apiTimestamp = `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

                if (apiParams.paytm) { // Transfer internal using TgUserId or Phone
                    const receiverObj = resolveUser(apiParams.paytm);
                    if (!receiverObj) return res.status(404).json({ status: "error", message: `Receiver (${apiParams.paytm}) not found` });
                    
                    receiverName = receiverObj.data.name || 'User';
                    receiverNumber = receiverObj.key; // Resolved real phone number
                    updates[`users/${receiverNumber}/balance`] = Number(receiverObj.data.balance) + amt;
                    updates[`transactions/${txnId}`] = { id: txnId, type: 'out', title: 'API Transfer to ' + receiverNumber, amount: amt, status: 'Success', date: getExactDate(), timestamp: Date.now(), icon: 'fa-code', color: 'blue', senderId: senderPhone, receiverId: receiverNumber, comment: comment, isApi: true };
                } else if (apiParams.upi_id) { // Withdrawal
                    receiverName = "Bank Withdraw";
                    updates[`transactions/${txnId}`] = { id: txnId, type: 'out', title: 'API Withdrawal', amount: amt, status: 'Pending', date: getExactDate(), timestamp: Date.now(), icon: 'fa-university', color: 'yellow', senderId: senderPhone, receiverId: 'SYSTEM', number: apiParams.upi_id, comment: comment, isApi: true };
                }
                
                await update(ref(db), updates);
                
                return res.status(200).json({
                    status: "success",
                    message: "Payment successful",
                    data: {
                        transaction_id: txnId,
                        amount: amt,
                        receiver: {
                            name: receiverName,
                            number: receiverNumber
                        },
                        comment: comment,
                        timestamp: apiTimestamp
                    }
                });
            }

            // Fallback for missing valid external API parameter logic
            return res.status(400).json({ status: "error", message: "Action missing or not recognized" });

        } catch (err) {
            return res.status(500).json({ status: "error", message: err.message });
        }
    }

    // INTERNAL APP HANDLER LOGIC
    if (req.method !== 'POST') return res.status(405).json({ error: "invalid" });

    try {
        const action = body.action;
        const data = body.data || {};
        const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
        const safeIp = sanitizeIP(rawIp);

        if (action === 'SEND_TG_MSG') {
            const { chatId, text } = data;
            if(chatId && text) {
                await sendTelegramMsg(chatId, text);
            }
            return res.json({ data: "Success" });
        }

        if (action === 'CHECK_IP') {
            if (safeIp === 'unknown') return res.json({ data: null });
            const ipSnap = await get(ref(db, `ips/${safeIp}`));
            if (ipSnap.exists()) {
                const linkedPhone = ipSnap.val();
                const uSnap = await get(ref(db, `users/${linkedPhone}`));
                if (uSnap.exists() && !uSnap.val().isBanned) {
                    let userData = uSnap.val();
                    userData.phone = linkedPhone;
                    return res.json({ data: userData });
                }
            }
            return res.json({ data: null });
        }

        if (action === 'LOGOUT') {
            if (safeIp !== 'unknown') {
                await update(ref(db), { [`users/${data.phone}/lastIp`]: null, [`ips/${safeIp}`]: null });
            }
            return res.json({ data: "Success" });
        }

        if (action === 'CLEAR_HISTORY') {
            const phone = data.phone;
            if(!phone) throw new Error("Missing user identification");
            const tSnap = await get(ref(db, "transactions"));
            let updates = {};
            if(tSnap.exists()) {
                tSnap.forEach(c => {
                    let t = c.val();
                    if(t.senderId === phone || t.receiverId === phone) updates[`transactions/${t.id}`] = null;
                });
            }
            if (Object.keys(updates).length > 0) await update(ref(db), updates);
            return res.json({ data: "Success" });
        }

        if (action === 'CHECK_USER') {
            let targetPhone = String(data.phone || '').trim();
            let normalizedInput = targetPhone.toLowerCase(); 
            const customSnap = await get(ref(db, `custom_ids/${normalizedInput}`));
            if (customSnap.exists()) targetPhone = customSnap.val(); 
            
            const snap = await get(ref(db, `users/${targetPhone}`));
            let userData = snap.exists() ? snap.val() : null;
            if (userData) userData.resolvedPhone = targetPhone; 
            else {
                const fallbackSnap = await get(ref(db, `users/${data.phone || ''}`));
                if (fallbackSnap.exists()) { userData = fallbackSnap.val(); userData.resolvedPhone = data.phone; }
            }
            return res.json({ data: userData });
        }

        if (action === 'LOGIN') {
            const loginInput = String(data.phone || '').trim().toLowerCase();
            let userSnap = null; let userPhone = null;
            if (loginInput.includes('@')) {
                const usersSnap = await get(ref(db, 'users'));
                if (usersSnap.exists()) { usersSnap.forEach(child => { let u = child.val(); if (u.email && u.email.toLowerCase() === loginInput) { userSnap = child; userPhone = child.key; } }); }
            } else { userSnap = await get(ref(db, `users/${loginInput}`)); userPhone = loginInput; }

            if (!userSnap || (typeof userSnap.exists === 'function' && !userSnap.exists()) || userSnap.val().password !== data.password) { throw new Error("Invalid Phone/Email or Password!"); }
            if (userSnap.val().isBanned) throw new Error("Account is Banned.");
            
            let userData = userSnap.val(); userData.phone = userPhone; 
            if (safeIp !== 'unknown') { await update(ref(db), { [`users/${userPhone}/lastIp`]: safeIp, [`ips/${safeIp}`]: userPhone }); }
            return res.json({ data: userData });
        }

        if (action === 'REGISTER') {
            const snap = await get(ref(db, `users/${data.phone || ''}`));
            if (snap.exists()) throw new Error("Phone number already registered!");

            const allUsersSnap = await get(ref(db, 'users'));
            if (allUsersSnap.exists()) {
                let duplicateEmail = false;
                let duplicateTg = false;
                allUsersSnap.forEach(child => {
                    let u = child.val();
                    if (data.userObj.email && u.email && u.email.toLowerCase() === data.userObj.email.toLowerCase()) {
                        duplicateEmail = true;
                    }
                    if (data.userObj.tgUserId && u.tgUserId && u.tgUserId === data.userObj.tgUserId) {
                        duplicateTg = true;
                    }
                });
                if (duplicateEmail) throw new Error("Email already registered!");
                if (duplicateTg) throw new Error("Telegram ID already registered!");
            }

            data.userObj.lastIp = safeIp;
            await set(ref(db, `users/${data.phone || ''}`), data.userObj);
            if (safeIp !== 'unknown') { await set(ref(db, `ips/${safeIp}`), data.phone || ''); }
            
            if(data.userObj.tgUserId) {
                await sendTelegramMsg(data.userObj.tgUserId, `🎉 <b>Welcome To Nova Wallet!</b>\n\nYour account has been successfully created. Enjoy our secure and fast wallet services!`);
            }
            return res.json({ data: "Success" });
        }

        if (action === 'UPDATE_CREDS') { await update(ref(db, `users/${data.phone}`), { password: data.password, pin: data.pin }); return res.json({ data: "Success" }); }
        
        if (action === 'UPDATE_PROFILE') {
            const { phone, name, tgUserId, botAlerts, email } = data;
            const updates = {};
            if(name !== undefined) updates[`users/${phone}/name`] = name;
            if(tgUserId !== undefined) updates[`users/${phone}/tgUserId`] = tgUserId;
            if(botAlerts !== undefined) updates[`users/${phone}/botAlerts`] = botAlerts;
            if(email !== undefined) updates[`users/${phone}/email`] = email;
            await update(ref(db), updates);
            return res.json({ data: "Success" });
        }

        if (action === 'UPDATE_DP') {
            if(!data.phone || !data.dp) throw new Error("Missing details");
            await update(ref(db, `users/${data.phone}`), { dp: data.dp });
            return res.json({ data: "Success" });
        }
        
        if (action === 'SET_CUSTOM_ID') {
            const { phone, customId } = data;
            const normalizedCustomId = String(customId).toLowerCase().trim(); 
            const uSnap = await get(ref(db, `users/${phone}`));
            if (!uSnap.exists()) throw new Error("User not found!");
            const user = uSnap.val();
            let currentBal = Number(user.balance) || 0;
            const cost = 5; 
            if (currentBal < cost) throw new Error("Insufficient Balance for Custom ID!");
            const cidSnap = await get(ref(db, `custom_ids/${normalizedCustomId}`));
            if (cidSnap.exists()) throw new Error("Custom ID already taken!");
            
            const updates = {};
            updates[`users/${phone}/balance`] = currentBal - cost;
            updates[`users/${phone}/customId`] = normalizedCustomId;
            updates[`custom_ids/${normalizedCustomId}`] = phone;
            await update(ref(db), updates);
            return res.json({ data: "Success" });
        }
        
        if (action === 'UPDATE_PREFS') {
            const updates = {};
            if(data.theme !== undefined) updates[`users/${data.phone}/theme`] = data.theme;
            if(data.accentColor !== undefined) updates[`users/${data.phone}/accentColor`] = data.accentColor;
            await update(ref(db), updates);
            return res.json({ data: "Success" });
        }

        if (action === 'GENERATE_API') { await update(ref(db, `users/${data.phone}`), { apiKey: data.newKey }); return res.json({ data: "Success" }); }

        if (action === 'SET_CUSTOM_API') {
            const { phone, newKey } = data;
            if (!newKey || /\s/.test(newKey)) throw new Error("Invalid API Key!");
            const usersSnap = await get(ref(db, 'users'));
            let exists = false;
            if(usersSnap.exists()){ usersSnap.forEach(u => { if(u.val().apiKey === newKey && u.key !== phone) exists = true; }); }
            if(exists) throw new Error("API Key already taken!");
            await update(ref(db, `users/${phone}`), { apiKey: newKey });
            return res.json({ data: "Success" });
        }

        if (action === 'UPDATE_PRIVACY') { await update(ref(db), { [`users/${data.phone}/privacyMode`]: data.privacyMode }); return res.json({ data: "Success" }); }
        if (action === 'TOGGLE_TXN_VISIBILITY') { await update(ref(db), { [`users/${data.phone}/hiddenTxns/${data.txnId}`]: data.isHidden ? true : null }); return res.json({ data: "Success" }); }

        if (action === 'SYNC') {
            if (!data.phone) return res.json({ error: "invalid" });
            try {
                const [uSnap, cSnap, tSnap, pSnap] = await Promise.all([ 
                    get(ref(db, `users/${data.phone}`)), get(ref(db, "settings")), get(ref(db, "transactions")), get(ref(db, "posts"))
                ]);
                let userData = uSnap.val() || {};
                
                let txns = [];
                if(tSnap.exists()) {
                    tSnap.forEach(c => {
                        let t = c.val();
                        if(t.senderId === data.phone || t.receiverId === data.phone) txns.push(t);
                    });
                }
                txns.sort((a, b) => b.timestamp - a.timestamp);
                let postsArr = []; if (pSnap.exists()) pSnap.forEach(p => { postsArr.push(p.val()); });
                return res.json({ data: { user: userData, settings: cSnap.val() || {}, txns: txns, posts: postsArr }});
            } catch (syncErr) { return res.json({ error: "invalid" }); }
        }

        if (action === 'EXECUTE_TXN') {
            let amt = Number(data.amount) || 0;
            const uSnap = await get(ref(db, `users/${data.sender}`));
            if (!uSnap.exists()) throw new Error("User not found!");
            let sBal = Number(uSnap.val().balance) || 0; let sKeeper = Number(uSnap.val().keeperBalance) || 0;
            
            if (['SEND', 'GHOST_SEND', 'WITHDRAW', 'KEEPER_LOCK'].includes(data.mode)) { if (sBal < amt) throw new Error("Insufficient Balance!"); }
            if (data.mode === 'KEEPER_WITHDRAW') { if (sKeeper < amt) throw new Error("Insufficient Keeper Balance!"); }

            const updates = {};
            if (data.mode === 'SEND' || data.mode === 'GHOST_SEND') {
                const rSnap = await get(ref(db, `users/${data.receiver}`));
                if (!rSnap.exists()) throw new Error("Receiver not found!");
                updates[`users/${data.sender}/balance`] = sBal - amt; updates[`users/${data.receiver}/balance`] = Number(rSnap.val().balance) + amt;
            }
            else if (data.mode === 'WITHDRAW') updates[`users/${data.sender}/balance`] = sBal - amt;
            else if (data.mode === 'KEEPER_LOCK') { updates[`users/${data.sender}/balance`] = sBal - amt; updates[`users/${data.sender}/keeperBalance`] = sKeeper + amt; } 
            else if (data.mode === 'KEEPER_WITHDRAW') { updates[`users/${data.sender}/keeperBalance`] = sKeeper - amt; updates[`users/${data.sender}/balance`] = sBal + amt; } 
            else if (data.mode === 'DEPOSIT') updates[`users/${data.sender}/balance`] = sBal + amt;
            
            if(data.txn) { data.txn.date = getExactDate(); updates[`transactions/${data.txn.id}`] = data.txn; }
            await update(ref(db), updates); return res.json({ data: "Success" });
        }

        if (action === 'BULK_PAY') {
            let total = Number(data.amount) * data.receivers.length;
            const uSnap = await get(ref(db, `users/${data.sender}`));
            if (!uSnap.exists() || Number(uSnap.val().balance) < total) throw new Error("Insufficient Balance!");
            
            const updates = { [`users/${data.sender}/balance`]: Number(uSnap.val().balance) - total };
            for(let num of data.receivers) {
                const rSnap = await get(ref(db, `users/${num}`));
                let rBal = rSnap.exists() ? Number(rSnap.val().balance) : 0;
                updates[`users/${num}/balance`] = rBal + Number(data.amount);
                let tId = 'TXN' + Date.now().toString(36).toUpperCase();
                updates[`transactions/${tId}`] = { id: tId, type: 'out', title: 'Bulk Send', amount: data.amount, status: 'Success', date: getExactDate(), timestamp: Date.now(), icon: 'fa-users', color: 'purple', senderId: data.sender, receiverId: num };
            }
            await update(ref(db), updates); return res.json({ data: "Success" });
        }
        
        if (action === 'CREATE_LIFAFA') {
            const uSnap = await get(ref(db, `users/${data.phone}`));
            let totalDeduction = Number(data.totalDeduction);
            if (!uSnap.exists() || Number(uSnap.val().balance) < totalDeduction) throw new Error("Insufficient Balance!");
            
            let lifId = Math.random().toString(36).substring(2, 14).toUpperCase();
            let lifafaData = {
                id: lifId, createdBy: data.phone, type: data.type || 'standard', amountPerUser: Number(data.amountPerUser) || 0,
                minAmount: Number(data.minAmount) || 0, maxAmount: Number(data.maxAmount) || 0, totalUsers: Number(data.totalUsers),
                remainingUsers: Number(data.totalUsers), hasPassword: !!data.password, password: data.password || null, channels: data.channels || [],
                referActive: data.referActive || false, referAmount: Number(data.referAmount) || 0, status: 'ACTIVE', timestamp: Date.now()
            };

            data.txn.date = getExactDate();
            await update(ref(db), { [`users/${data.phone}/balance`]: Number(uSnap.val().balance) - totalDeduction, [`lifafas/${lifId}`]: lifafaData, [`transactions/${data.txn.id}`]: data.txn });
            return res.json({ data: lifId });
        }

        if (action === 'GET_LIFAFA_DETAILS') {
            const lifSnap = await get(ref(db, `lifafas/${data.lifafaId}`));
            if (!lifSnap.exists()) throw new Error("Lifafa not found or expired.");
            let lifafa = lifSnap.val();
            let alreadyClaimed = lifafa.claimers && lifafa.claimers[data.phone] ? true : false;
            return res.json({ data: { id: lifafa.id, type: lifafa.type, remainingUsers: lifafa.remainingUsers, totalUsers: lifafa.totalUsers, amountPerUser: lifafa.amountPerUser, hasPassword: lifafa.hasPassword, channels: lifafa.channels || [], referActive: lifafa.referActive, alreadyClaimed: alreadyClaimed }});
        }

        if (action === 'VERIFY_LIFAFA_CHANNELS') {
            const lifSnap = await get(ref(db, `lifafas/${data.lifafaId}`));
            if (!lifSnap.exists()) throw new Error("Lifafa not found.");
            let lifafa = lifSnap.val();
            
            if (!lifafa.channels || lifafa.channels.length === 0) return res.json({ data: "Success" }); 
            for (let channel of lifafa.channels) {
                let url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${channel}&user_id=${data.tgUserId}`;
                try {
                    let tgRes = await fetch(url); let tgData = await tgRes.json();
                    if (!tgData.ok) throw new Error(`Please join channel: ${channel}`);
                    let status = tgData.result.status;
                    if (!['member', 'administrator', 'creator'].includes(status)) throw new Error(`You have not joined ${channel}`);
                } catch(err) { throw new Error(err.message || "Failed to verify channel membership."); }
            }
            return res.json({ data: "Success" });
        }

        if (action === 'CLAIM_LIFAFA') {
            const lifafaRef = ref(db, `lifafas/${data.lifafaId}`); await update(ref(db), { dummy: null }); 
            const result = await runTransaction(lifafaRef, (currentData) => {
                if (currentData === null) return null; if (currentData.claimers && currentData.claimers[data.phone]) return; if (currentData.remainingUsers <= 0) return; 
                if (currentData.hasPassword && currentData.password !== data.password) throw new Error("Incorrect Lifafa Password!");
                currentData.remainingUsers -= 1; if (!currentData.claimers) currentData.claimers = {}; currentData.claimers[data.phone] = true; return currentData;
            });

            if (!result.committed) throw new Error("Lifafa invalid, empty, or already claimed by you.");
            
            let lifafaData = result.snapshot.val(); let reward = 0;
            if (lifafaData.type === 'scratch') { let min = Number(lifafaData.minAmount); let max = Number(lifafaData.maxAmount); reward = Math.floor(Math.random() * (max - min + 1)) + min; } 
            else if (lifafaData.type === 'coin') { let win = Math.random() < 0.5; reward = win ? (Number(lifafaData.amountPerUser) * 2) : 0; } 
            else { reward = Number(lifafaData.amountPerUser); }

            const uSnap = await get(ref(db, `users/${data.phone}`));
            const updates = {};
            updates[`users/${data.phone}/balance`] = Number(uSnap.val().balance) + reward; 
            data.txn.date = getExactDate(); data.txn.amount = reward; updates[`transactions/${data.txn.id}`] = data.txn;

            if (lifafaData.referActive && data.referrerPhone && data.referrerPhone !== data.phone) {
                const refSnap = await get(ref(db, `users/${data.referrerPhone}`));
                if (refSnap.exists()) {
                    let referReward = Number(lifafaData.referAmount) || 0;
                    if (referReward > 0) {
                        updates[`users/${data.referrerPhone}/balance`] = Number(refSnap.val().balance) + referReward;
                        let refTxnId = 'TXN' + Date.now().toString(36).toUpperCase();
                        updates[`transactions/${refTxnId}`] = { id: refTxnId, type: 'in', title: 'Lifafa Referral Reward', amount: referReward, status: 'Success', date: getExactDate(), timestamp: Date.now(), icon: 'fa-user-plus', color: 'blue', senderId: 'SYSTEM', receiverId: data.referrerPhone, name: 'Referral System' };
                    }
                }
            }

            await update(ref(db), updates); return res.json({ data: { amount: reward, type: lifafaData.type, referActive: lifafaData.referActive } });
        }

        if (action === 'CREATE_GIFT') {
            let amt = Number(data.amount) || 0; const total = amt * data.users;
            const snap = await get(ref(db, `users/${data.phone}`));
            if (!snap.exists() || Number(snap.val().balance) < total) throw new Error("Insufficient Balance!");
            data.txn.date = getExactDate();
            const updates = { [`users/${data.phone}/balance`]: Number(snap.val().balance) - total, [`giftcodes/${data.code}`]: { amountPerUser: amt, remainingUsers: data.users, totalUsers: data.users, createdBy: data.phone }, [`transactions/${data.txn.id}`]: data.txn };
            await update(ref(db), updates); return res.json({ data: "Success" });
        }

        if (action === 'CLAIM_GIFT') {
            let resultAmount = 0; const codeRef = ref(db, `giftcodes/${data.code}`); await update(ref(db), { dummy: null }); 
            const result = await runTransaction(codeRef, (currentData) => {
                if (currentData === null) return null; if (currentData.claimers && currentData.claimers[data.phone]) return; if (currentData.remainingUsers <= 0) return; 
                currentData.remainingUsers -= 1; if (!currentData.claimers) currentData.claimers = {}; currentData.claimers[data.phone] = true; return currentData;
            });
            if (!result.committed) throw new Error("Code invalid, expired, or already claimed.");
            
            resultAmount = Number(result.snapshot.val().amountPerUser);
            const uSnap = await get(ref(db, `users/${data.phone}`));
            
            data.txn.date = getExactDate();
            data.txn.amount = resultAmount;
            const updates = { [`users/${data.phone}/balance`]: Number(uSnap.val().balance) + resultAmount, [`transactions/${data.txn.id}`]: data.txn };
            if (result.snapshot.val().remainingUsers <= 0) updates[`giftcodes/${data.code}`] = null; 
            await update(ref(db), updates); return res.json({ data: resultAmount });
        }

        return res.status(400).json({ error: "Unknown Action" });
    } catch (e) { 
        if (e.message && e.message.includes("Insufficient") || e.message.includes("not found") || e.message.includes("Password") || e.message.includes("join channel") || e.message.includes("already claimed") || e.message.includes("Invalid Phone") || e.message.includes("already registered")) {
            return res.json({ error: e.message });
        }
        return res.status(500).json({ error: "invalid" }); 
    }
}
