import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, update, set } from "firebase/database";

const firebaseConfig = {
    databaseURL: "https://nova-wallet-c97f1-default-rtdb.firebaseio.com"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });
    
    try {
        const { action, data } = req.body;
        
        // Fetch Dashboard Stats
        if (action === 'FETCH_DASHBOARD') {
            const snap = await get(ref(db, '/'));
            const dataVal = snap.val() || {};
            const users = dataVal.users || {};
            const txns = dataVal.transactions || {};
            
            let totalBal = 0;
            Object.values(users).forEach(u => totalBal += (Number(u.balance) || 0));
            
            return res.json({ 
                usersCount: Object.keys(users).length,
                totalBalance: totalBal,
                txnsCount: Object.keys(txns).length
            });
        }

        // Manage User Balance (Credit/Debit/Reset)
        if (action === 'UPDATE_BALANCE') {
            const { phone, amount, type } = data;
            const uSnap = await get(ref(db, `users/${phone}`));
            if (!uSnap.exists()) throw new Error("User not found!");
            
            let currentBal = Number(uSnap.val().balance) || 0;
            let newBal = (type === 'credit') ? (currentBal + amount) : (type === 'debit') ? (currentBal - amount) : 0;
            
            await update(ref(db, `users/${phone}`), { balance: newBal });
            return res.json({ success: true, newBalance: newBal });
        }

        // Fetch User Logs/History
        if (action === 'FETCH_USER_DATA') {
            const snap = await get(ref(db, '/'));
            const dataVal = snap.val() || {};
            return res.json({ 
                user: dataVal.users[data.phone] || null,
                txns: Object.values(dataVal.transactions || {}).filter(t => t.senderId === data.phone || t.receiverId === data.phone)
            });
        }

        return res.status(400).json({ error: "Invalid Action" });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
