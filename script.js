const API_URL = '/api/backend';
const BOT_TOKEN = "8824808158:AAFUrAVMDqxR9JzdXLb4J80vwSgGldNgaq8";

let currentUser = null, pendingSignupUser = null, pendingOTP = null, otpMode = 'signup', resetPinPhone = null;
let globalSettings = {}, knownTxnStatuses = {}, transactions = [];
let currentBalance = 0, keeperBalance = 0;
let isBalanceVisible = false;
let uploadedScreenshotBase64 = null;

// Scanner State
let html5QrCode = null;
let currentQRZoom = 1;
let isQRTorchOn = false;

// Custom PIN Modal State
let currentPinInput = "";
let pendingAction = null;

// Public Lifafa State
let currentLifafaId = null;
let currentLifafaDetails = null;
let lifafaClaimerPhone = null;
let lifafaClaimerTgId = null;
let lifafaReferrerPhone = null;

const sndClick = new Audio("https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3");
const sndSuccess = new Audio("https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3"); 
const sndCredit = new Audio("https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3"); 
const sndDebit = new Audio("https://assets.mixkit.co/active_storage/sfx/2572/2572-preview.mp3");  

function playSound(type) {
    if(localStorage.getItem('nw_sound') === 'false') return;
    try { 
        if(type === 'click') sndClick.play();
        else if(type === 'credit') sndCredit.play();
        else if(type === 'debit') sndDebit.play();
        else if(type === 'success') sndSuccess.play();
    } catch(e){}
}

document.addEventListener('click', () => { playSound('click'); });

let isActionOnCooldown = false;
function checkCooldown() {
    if (isActionOnCooldown) { showToast("Please wait 3 seconds before next action!"); return false; }
    isActionOnCooldown = true; setTimeout(() => { isActionOnCooldown = false; }, 3000);
    return true;
}

async function apiCall(action, data = {}) {
    try {
        let res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }) });
        const responseText = await res.text();
        let result;
        try { result = JSON.parse(responseText); } catch (e) { throw new Error("API Error"); }
        if(!res.ok || result.error) throw new Error(result.error || "Server error");
        return result.data;
    } catch(err) { 
        if(err.message !== "invalid") showToast(err.message); 
        throw err; 
    }
}

async function sendTelegramMsg(chatId, text, isTxnAlert = true) {
    try {
        if(!chatId) return false;
        if (isTxnAlert && currentUser && currentUser.botAlerts === false) { return true; }
        let res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' }) }); 
        return (await res.json()).ok;
    } catch (e) { return false; }
}

function formatTgMsg(type, title, amount, extra) {
    return `🔔 <b>Nova Wallet Alert</b>\n\n📝 ${title}\n💰 Amount: ₹${amount}\nℹ️ ${extra}`;
}

function formatDateTime() { return new Date().toLocaleString('en-IN', { hour12: true, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function generateApiKey() { return 'NW-' + Math.random().toString(36).substring(2, 10).toUpperCase(); }
function generateTxnId() { return 'TXN' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase(); }

function updateApiKeyUI() {
    let key = currentUser?.apiKey || 'NW-PENDING'; 
    let elUrlFull = document.getElementById('ui-api-url-full'); 
    if(elUrlFull) elUrlFull.innerHTML = `https://nova-wallet-pn77.vercel.app/api?key=<span class="text-red-400 font-bold">${key}</span>&paytm=<span class="text-green-400">{number}</span>&amount=<span class="text-green-400">{amount}</span>&comment=<span class="text-green-400">{comment}</span>`;
    
    let elUrlUpi = document.getElementById('ui-api-url-upi'); 
    if(elUrlUpi) elUrlUpi.innerHTML = `https://nova-wallet-pn77.vercel.app/api?token=<span class="text-red-400 font-bold">${key}</span>&upi_id=<span class="text-green-400">{upi_id}</span>&amount=<span class="text-green-400">{amount}</span>&comment=<span class="text-green-400">{comment}</span>`;

    let elDisp = document.getElementById('ui-api-key-display'); if(elDisp) elDisp.innerText = key;
}

async function regenerateApiKey() {
    if(!confirm("Are you sure? Old API key will stop working immediately.")) return;
    let newKey = generateApiKey(); await apiCall('GENERATE_API', { phone: currentUser?.phone, newKey });
    if(currentUser) currentUser.apiKey = newKey; 
    updateApiKeyUI(); showToast("API Key Regenerated!");
}

function showAuthView(view) { ['login', 'signup', 'otp', 'reset-pin'].forEach(v => document.getElementById('auth-' + v).classList.add('hidden')); document.getElementById('auth-' + view).classList.remove('hidden'); }

async function logoutUser() { 
    if (currentUser && currentUser.phone) {
        try { await apiCall('LOGOUT', { phone: currentUser.phone }); } catch(e) {}
    }
    localStorage.removeItem('novaSession'); 
    currentUser = null; 
    location.reload(); 
}

async function checkAuth() {
    try {
        let userFromIp = await apiCall('CHECK_IP', {});
        if (userFromIp && !userFromIp.isBanned) {
            currentUser = userFromIp;
            localStorage.setItem('novaSession', currentUser.phone);
            if (!currentUser.apiKey) { currentUser.apiKey = generateApiKey(); await apiCall('GENERATE_API', { phone: currentUser.phone, newKey: currentUser.apiKey }); }
            document.getElementById('auth-wrapper').classList.add('hidden');
            initApp();
            return;
        }
    } catch(e) { console.log("IP Check skipped."); }

    let sessionPhone = localStorage.getItem('novaSession');
    if (sessionPhone) {
        try {
            let user = await apiCall('CHECK_USER', { phone: sessionPhone });
            if (user) {
                currentUser = user; 
                currentUser.phone = sessionPhone; 
                if(currentUser.isBanned) { document.getElementById('banned-wrapper').classList.remove('hidden'); document.getElementById('banned-wrapper').style.display = 'flex'; return; }
                if (!currentUser.apiKey) { currentUser.apiKey = generateApiKey(); await apiCall('GENERATE_API', { phone: currentUser.phone, newKey: currentUser.apiKey }); }
                document.getElementById('auth-wrapper').classList.add('hidden'); 
                initApp();
            } else { 
                localStorage.removeItem('novaSession');
                document.getElementById('auth-wrapper').classList.remove('hidden'); showAuthView('login');
            }
        } catch(e) { 
            console.warn("Auth Check Network Error. Continuing session blindly.");
            setTimeout(checkAuth, 3000); 
        }
    } else { 
        document.getElementById('auth-wrapper').classList.remove('hidden'); showAuthView('login'); 
    }
}

async function processLogin() {
    let loginCredential = document.getElementById('login-phone').value.trim(); 
    let pass = document.getElementById('login-pass').value;
    try { 
        let user = await apiCall('LOGIN', { phone: loginCredential, password: pass }); 
        localStorage.setItem('novaSession', user.phone); currentUser = user; 
        if (!currentUser.apiKey) { currentUser.apiKey = generateApiKey(); await apiCall('GENERATE_API', { phone: currentUser.phone, newKey: currentUser.apiKey }); } 
        document.getElementById('auth-wrapper').classList.add('hidden'); initApp(); 
    } catch(e) {}
}

async function processSignupStep1() {
    let name = document.getElementById('reg-name').value; 
    let phone = document.getElementById('reg-phone').value; 
    let email = document.getElementById('reg-email').value;
    let pass = document.getElementById('reg-pass').value; 
    let pin = document.getElementById('reg-pin').value; 
    let telegram = document.getElementById('reg-telegram').value;
    try {
        let exists = await apiCall('CHECK_USER', { phone }); if(exists) return showToast("Phone number already registered!");
        
        pendingSignupUser = { 
            name, email, password: pass, pin, tgUserId: telegram, isBanned: false, balance: 0, keeperBalance: 0, 
            apiKey: generateApiKey(), botAlerts: true, timestamp: Date.now()
        }; 
        pendingSignupUser.phone = phone; 
        pendingOTP = Math.floor(100000 + Math.random() * 900000).toString(); 
        otpMode = 'signup';
        
        let btn = document.getElementById('btn-signup-otp'); btn.innerText = "SENDING..."; btn.disabled = true;
        let success = await sendTelegramMsg(telegram, `🔐 Your Nova Wallet OTP\n📲 OTP: <b>${pendingOTP}</b>`, false); btn.innerText = "SEND OTP TO TELEGRAM"; btn.disabled = false;
        if(success) { showToast("OTP Sent to Telegram!"); showAuthView('otp'); } else { alert("Could not send OTP. Start the bot first!"); }
    } catch(e) {}
}

async function processResetPinStep1() {
    resetPinPhone = document.getElementById('reset-phone').value;
    try {
        let user = await apiCall('CHECK_USER', { phone: resetPinPhone }); if(!user) return showToast("User not found!");
        pendingOTP = Math.floor(100000 + Math.random() * 900000).toString(); otpMode = 'reset_pin';
        let success = await sendTelegramMsg(user.tgUserId, `🔐 Your Nova Wallet OTP\n📲 OTP: <b>${pendingOTP}</b>`, false);
        if(success) { showToast("OTP Sent to Telegram!"); showAuthView('otp'); } else { alert("Failed to send OTP."); }
    } catch(e) {}
}

async function processResetPinStep2() {
    let newPass = document.getElementById('reset-new-pass').value; let newPin = document.getElementById('reset-new-pin').value;
    await apiCall('UPDATE_CREDS', { phone: resetPinPhone, password: newPass, pin: newPin }); showToast("Updated successfully!"); showAuthView('login');
}

async function verifyOTP() {
    let userOTP = document.getElementById('otp-input').value;
    if(userOTP === pendingOTP) {
        if(otpMode === 'signup') {
            let userPhone = pendingSignupUser.phone; let dbUser = { ...pendingSignupUser }; delete dbUser.phone;
            await apiCall('REGISTER', { phone: userPhone, userObj: dbUser }); localStorage.setItem('novaSession', userPhone); currentUser = pendingSignupUser; document.getElementById('auth-wrapper').classList.add('hidden'); initApp(); showToast("Account Created!");
        } else if (otpMode === 'reset_pin') { document.getElementById('form-reset-1').classList.add('hidden'); document.getElementById('form-reset-2').classList.remove('hidden'); showAuthView('reset-pin'); }
    } else { showToast("Invalid OTP!"); }
}

function createTxnObj(type, title, amount, status, icon, color, name, number) { return { id: generateTxnId(), type, title, amount, status, date: new Date().toLocaleString(), timestamp: Date.now(), icon, color, name, number, senderName: currentUser?.name || 'User', senderId: type==='out'?(currentUser?.phone||'SYSTEM'):(number!=='N/A'?number:'SYSTEM'), receiverId: type==='in'?(currentUser?.phone||'SYSTEM'):(number!=='N/A'?number:'SYSTEM') }; }

async function syncLoop() {
    if(!currentUser) return;
    await syncData();
    setTimeout(syncLoop, 3000); 
}

async function syncData() {
    if(!currentUser) return;
    try {
        let data = await apiCall('SYNC', { phone: currentUser.phone });
        if(data.user) {
            if(data.user.isBanned) { document.getElementById('banned-wrapper').classList.remove('hidden'); document.getElementById('banned-wrapper').style.display = 'flex'; return; }
            
            let prevBalance = currentBalance;
            let savedPhone = currentUser.phone;
            currentUser = { ...currentUser, ...data.user };
            currentUser.phone = savedPhone; 

            currentBalance = data.user.balance || 0; 
            keeperBalance = data.user.keeperBalance || 0;
            
            if (currentBalance > prevBalance) playSound('credit');
            else if (currentBalance < prevBalance && !isActionOnCooldown) playSound('debit');

            if(data.user.apiKey && data.user.apiKey !== currentUser.apiKey) { currentUser.apiKey = data.user.apiKey; updateApiKeyUI(); }
        }
        if(data.settings) {
            globalSettings = data.settings;
            if(globalSettings.upiId) { let upiEl = document.getElementById('ui-upi-id'); if(upiEl) upiEl.innerText = globalSettings.upiId; }
            if(globalSettings.maintenance) { document.getElementById('maintenance-wrapper').classList.remove('hidden'); document.getElementById('maintenance-wrapper').style.display = 'flex'; } else { document.getElementById('maintenance-wrapper').classList.add('hidden'); }
        }
        if(data.txns) {
            transactions = data.txns;
            transactions.forEach(t => {
                if (knownTxnStatuses[t.id] && knownTxnStatuses[t.id] === 'Pending' && t.status !== 'Pending') { showToast(`Status Update: ${t.title} is now ${t.status}`); }
                knownTxnStatuses[t.id] = t.status;
            });
        }
        updateUI();
        updateStatsDashboard();
    } catch(e) { console.warn("DB Sync Background Error Ignored."); }
}

function toggleBalanceVisibility() {
    let eyeEl = document.getElementById('eye-balance');
    if(!eyeEl) return;
    isBalanceVisible = !isBalanceVisible;
    if(isBalanceVisible) {
        eyeEl.classList.remove('fa-eye-slash'); eyeEl.classList.add('fa-eye');
        document.querySelectorAll('.global-balance').forEach(el => el.classList.remove('privacy-blur'));
    } else {
        eyeEl.classList.remove('fa-eye'); eyeEl.classList.add('fa-eye-slash');
        document.querySelectorAll('.global-balance').forEach(el => el.classList.add('privacy-blur'));
    }
}

let sendResolvedPhone = null; let debounceTimer;
let sNumEl = document.getElementById('send-num');
if(sNumEl) {
    sNumEl.addEventListener('input', function() {
        clearTimeout(debounceTimer); let val = this.value.trim();
        let nameField = document.getElementById('send-name');
        
        if(val.length >= 3) {
            nameField.innerHTML = "Scanning database...";
            debounceTimer = setTimeout(async () => {
                try { 
                    let user = await apiCall('CHECK_USER', { phone: val }); 
                    if(user) {
                        sendResolvedPhone = user.resolvedPhone || user.phone;
                        let dpUrl = user.dp || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.name)}`;
                        nameField.className = "w-full bg-[#1a1a1a] border border-red-500/30 rounded-xl px-4 py-3 text-sm mb-5 font-bold cursor-not-allowed transition-all min-h-[60px] flex items-center shadow-lg text-white";
                        nameField.innerHTML = `
                            <div class="flex items-center gap-3 w-full">
                                <img src="${dpUrl}" class="w-10 h-10 rounded-full object-cover border-2 border-red-500 shadow-md">
                                <div class="text-left flex-1 truncate">
                                    <p class="font-black text-sm flex items-center gap-1">${user.name} <i class="fas fa-check-circle text-green-500 text-xs"></i></p>
                                    <p class="text-[9px] text-gray-400 uppercase font-black tracking-widest">Nova User</p>
                                </div>
                            </div>`;
                    } else { nameField.innerHTML = 'User Not Found'; sendResolvedPhone = null; }
                } catch(e) { nameField.innerHTML = 'Error'; }
            }, 500);
        } else { nameField.innerHTML = ''; sendResolvedPhone = null; }
    });
}

// ----------------------------------------------------
// CUSTOM PIN PAD & ACTION INTERCEPTOR
// ----------------------------------------------------

function initiateAction(type) {
    if(!checkCooldown()) return;
    
    if(type === 'send') {
        if (!sendResolvedPhone) return showToast("Invalid Receiver!");
        let amt = parseFloat(document.getElementById('send-amt').value);
        if(isNaN(amt) || amt <= 0) return showToast("Invalid Amount!");
        if(amt > currentBalance) return showToast("Insufficient Balance!");
    } else if (type === 'bulk') {
        let numsText = document.getElementById('bulk-nums').value.trim();
        let amt = parseFloat(document.getElementById('bulk-amt').value);
        if(isNaN(amt) || amt <= 0) return showToast("Invalid amount!");
        if(!numsText) return showToast("Receivers list cannot be empty!");
    } else if (type === 'withdraw') {
        let amt = parseFloat(document.getElementById('with-amt').value);
        if(isNaN(amt) || amt <= 0) return showToast("Invalid amount!");
        if(amt > currentBalance) return showToast("Insufficient Balance!");
    } else if (type === 'gift') {
        let amt = parseFloat(document.getElementById('gift-amt').value);
        let users = parseInt(document.getElementById('gift-users').value);
        if(isNaN(amt) || amt <= 0 || isNaN(users) || users <= 0) return showToast("Invalid inputs!");
        if((amt * users) > currentBalance) return showToast("Insufficient Balance!");
    } else if (type === 'lifafa') {
        let users = parseInt(document.getElementById('lif-users').value);
        if (isNaN(users) || users <= 0) return showToast("Invalid users limit!");
    } else if (type === 'keeper_lock') {
        let amt = parseFloat(document.getElementById('kl-amt').value);
        if(isNaN(amt) || amt <= 0) return showToast("Invalid amount!");
        if(amt > currentBalance) return showToast("Insufficient Wallet Balance!");
    } else if (type === 'keeper_with') {
        let amt = parseFloat(document.getElementById('kw-amt').value);
        if(isNaN(amt) || amt <= 0) return showToast("Invalid amount!");
        if(amt > keeperBalance) return showToast("Insufficient Keeper Balance!");
    }

    pendingAction = type;
    currentPinInput = "";
    updatePinDashes();
    document.getElementById('custom-pin-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('custom-pin-modal').classList.remove('opacity-0'), 10);
}

function pinKeyPress(num) {
    if(currentPinInput.length < 4) { currentPinInput += num; updatePinDashes(); }
}

function pinKeyBackspace() {
    if(currentPinInput.length > 0) { currentPinInput = currentPinInput.slice(0, -1); updatePinDashes(); }
}

function updatePinDashes() {
    for(let i=1; i<=4; i++) {
        let dash = document.getElementById('pin-dot-' + i);
        if(i <= currentPinInput.length) { dash.innerText = "•"; dash.classList.add('filled'); } 
        else { dash.innerText = "_"; dash.classList.remove('filled'); }
    }
}

function closePinModal() {
    document.getElementById('custom-pin-modal').classList.add('opacity-0');
    setTimeout(() => document.getElementById('custom-pin-modal').classList.add('hidden'), 300);
}

// ----------------------------------------------------
// LOADING SCREEN + ACTION TRIGGER
// ----------------------------------------------------
function submitPinModal() {
    if(currentPinInput.length !== 4) return showToast("Enter 4-digit PIN");
    
    if(currentPinInput === currentUser?.pin) {
        let actionToRun = pendingAction; 
        pendingAction = null; 
        currentPinInput = "";
        closePinModal(); 

        const loader = document.getElementById('action-loading-screen');
        if(loader) {
            loader.style.opacity = '1';
            loader.style.pointerEvents = 'auto';
        }

        setTimeout(() => {
            if(loader) {
                loader.style.opacity = '0';
                loader.style.pointerEvents = 'none';
            }
            executePendingAction(actionToRun);
        }, 1000);

    } else {
        showToast("Incorrect Security PIN!"); 
        currentPinInput = ""; 
        updatePinDashes();
    }
}

async function executePendingAction(actionObj) {
    if(actionObj === 'send') await processSend();
    else if(actionObj === 'bulk') await processBulk();
    else if(actionObj === 'withdraw') await processWithdraw();
    else if(actionObj === 'lifafa') await processLifafaCreate();
    else if(actionObj === 'gift') await processGiftCreate();
    else if(actionObj === 'keeper_lock') await processKeeperLock();
    else if(actionObj === 'keeper_with') await processKeeperWithdraw();
}

// ----------------------------------------------------
// DUAL RECEIPT UIs LOGIC
// ----------------------------------------------------

// 1. Immediate Success (Rocket UI)
function showActionSuccess(data) {
    let txn = data.txn;
    if(!txn) return;

    let rocketOverlay = document.getElementById('rocket-overlay');
    if(rocketOverlay) {
        rocketOverlay.classList.remove('hidden');
        setTimeout(() => { rocketOverlay.classList.add('hidden'); }, 1500);
    }

    document.getElementById('txn-result-amount').innerText = parseFloat(txn.amount).toFixed(2);
    document.getElementById('txn-result-name').innerText = txn.name || 'User';
    document.getElementById('txn-result-desc').innerText = txn.number || 'N/A';
    document.getElementById('txn-result-id').innerText = txn.id;
    document.getElementById('txn-result-date').innerText = txn.date;

    if (data.isLifafa) {
        document.getElementById('txn-result-desc').innerHTML = data.lifafaDetailsHtml + (data.lifafaLink ? `<br><br><span class="bg-red-900/50 text-red-500 px-2 py-1 rounded border border-red-500 font-mono text-[10px] break-all select-all">${data.lifafaLink}</span>` : '');
    }

    let dpImg = document.getElementById('txn-result-dp');
    let initialDiv = document.getElementById('txn-result-initial');
    dpImg.src = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(txn.name || 'User')}`;
    dpImg.classList.remove('hidden');
    initialDiv.classList.add('hidden');

    let titleEl = document.getElementById('txn-result-title');
    let iconEl = document.getElementById('txn-result-icon');
    let iconBg = document.getElementById('txn-result-icon-bg');

    if (txn.status === 'Success' || txn.status === 'Approved') {
        titleEl.innerText = "Action Completed";
        iconEl.className = "fas fa-check text-green-500";
        iconBg.className = "w-20 h-20 rounded-full flex items-center justify-center text-4xl mb-4 shadow-inner bg-green-900/20 border border-green-500/30 animate-[slideDown_0.5s_ease-out]";
    } else if (txn.status === 'Pending') {
        titleEl.innerText = "Request Pending";
        iconEl.className = "fas fa-clock text-yellow-500";
        iconBg.className = "w-20 h-20 rounded-full flex items-center justify-center text-4xl mb-4 shadow-inner bg-yellow-900/20 border border-yellow-500/30 animate-[slideDown_0.5s_ease-out]";
    }

    document.getElementById('txn-result-overlay').classList.remove('hidden');
}

function closeSuccessOverlay() {
    document.getElementById('txn-result-overlay').classList.add('hidden');
}

// 2. Detailed Transaction Modal (History UI)
let currentModalTxnId = '';
function openTxnModal(txnId) { 
    let txn = transactions.find(t => t.id === txnId); 
    if(!txn) return; 
    currentModalTxnId = txn.id; 
    
    let titleEl = document.getElementById('receipt-main-title');
    let dpContainer = document.getElementById('receipt-dp-container');
    let dpImg = document.getElementById('receipt-dp');
    
    if (txn.type === 'out') { titleEl.innerText = `Payment to ${txn.name || 'User'}`; } 
    else { titleEl.innerText = `Received from ${txn.name || 'User'}`; }
    
    dpImg.src = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(txn.name || 'User')}`;
    dpContainer.classList.remove('hidden');

    document.getElementById('receipt-date').innerText = txn.date;
    
    let amtEl = document.getElementById('receipt-amount');
    amtEl.innerText = `${txn.type === 'in' ? '+' : '-'}₹${parseFloat(txn.amount).toFixed(2)}`;
    amtEl.className = `text-5xl font-black tracking-tighter ${txn.type === 'in' ? 'text-green-500' : 'text-red-500'}`;
    
    let statusEl = document.getElementById('receipt-status');
    if(txn.status === 'Success' || txn.status === 'Approved') {
        statusEl.innerHTML = `<i class="fas fa-check-circle"></i> Success`;
        statusEl.className = "inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border border-green-500/30 text-green-500 bg-green-900/20";
    } else if(txn.status === 'Pending') {
        statusEl.innerHTML = `<i class="fas fa-clock"></i> Pending`;
        statusEl.className = "inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border border-yellow-500/30 text-yellow-500 bg-yellow-900/20";
    } else {
        statusEl.innerHTML = `<i class="fas fa-times-circle"></i> Failed`;
        statusEl.className = "inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border border-red-500/30 text-red-500 bg-red-900/20";
    }

    document.getElementById('receipt-txn-id').innerText = txn.id;
    
    let methodEl = document.getElementById('receipt-method');
    let catEl = document.getElementById('receipt-category');
    
    if(txn.title.includes('Deposit')) { methodEl.innerHTML = `<i class="fas fa-university"></i> Bank/UPI Add`; catEl.innerText = "Self Deposit"; }
    else if(txn.title.includes('Withdraw')) { methodEl.innerHTML = `<i class="fas fa-university"></i> Bank Withdraw`; catEl.innerText = "Withdrawal"; }
    else if(txn.title.includes('Gift')) { methodEl.innerHTML = `<i class="fas fa-gift"></i> Gift Card`; catEl.innerText = "Voucher"; }
    else if(txn.title.includes('Lifafa')) { methodEl.innerHTML = `<i class="fas fa-envelope-open-text"></i> Lifafa`; catEl.innerText = "Public Link"; }
    else if(txn.isApi) { methodEl.innerHTML = `<i class="fas fa-code"></i> API Transfer`; catEl.innerText = "P2P received"; }
    else { methodEl.innerHTML = `<i class="fas fa-exchange-alt"></i> Wallet Transfer`; catEl.innerText = "P2P Transfer"; }

    let notesBox = document.getElementById('receipt-notes-box');
    let notesEl = document.getElementById('receipt-notes');
    if(txn.number && txn.number !== 'N/A') {
        notesEl.innerText = `Target: ${txn.number}`;
        notesBox.classList.remove('hidden');
    } else { notesBox.classList.add('hidden'); }

    let commentBox = document.getElementById('receipt-comment-box');
    let commentEl = document.getElementById('receipt-comment');
    if(txn.comment) {
        commentEl.innerText = txn.comment;
        commentBox.classList.remove('hidden');
    } else { commentBox.classList.add('hidden'); }

    document.getElementById('detailed-receipt-modal').classList.add('active');
}

function closeDetailedReceipt() {
    document.getElementById('detailed-receipt-modal').classList.remove('active');
}

function copyReceiptData(elementId, isInput = false) {
    let el = document.getElementById(elementId);
    if(el) {
        let text = isInput ? el.value : el.innerText;
        navigator.clipboard.writeText(text);
        showToast("Copied to clipboard!");
    }
}

// ----------------------------------------------------
// CORE ACTIONS WITH RECEIPT INTEGRATION
// ----------------------------------------------------

async function processSend() {
    let amt = parseFloat(document.getElementById('send-amt').value); 
    let comment = document.getElementById('send-comment').value.trim();
    try {
        let receiver = await apiCall('CHECK_USER', { phone: sendResolvedPhone }); 
        if (!receiver) return showToast("Receiver not found!");
        let name = receiver.name || 'Unknown User'; 

        let txn = createTxnObj('out', 'Sent to ' + name, amt, 'Success', 'fa-paper-plane', 'yellow', name, sendResolvedPhone);
        txn.comment = comment;

        await apiCall('EXECUTE_TXN', { mode: 'SEND', sender: currentUser?.phone, receiver: sendResolvedPhone, amount: amt, txn });
        
        playSound('debit');
        sendTelegramMsg(currentUser?.tgUserId, formatTgMsg('out', 'Payment Sent to ' + name, amt, `TXN: ${txn.id}`)); 
        
        document.getElementById('form-send').reset(); 
        currentBalance -= amt; 
        transactions.unshift(txn);
        updateUI(); 
        showActionSuccess({ txn: txn });
    } catch(e) { showToast(e.message || "Payment processing failed."); }
}

async function processAdd() {
    let utr = document.getElementById('add-utr').value.trim(); 
    let amt = parseFloat(document.getElementById('add-amt').value);
    
    if(isNaN(amt) || amt <= 0) return showToast("Invalid amount!");
    if (!utr) return showToast("UTR number is required!");
    if (!uploadedScreenshotBase64) return showToast("Please upload a payment screenshot!");
    
    try {
        let txn = createTxnObj('in', 'Deposit via UTR', amt, 'Pending', 'fa-clock', 'yellow', 'Self Deposit', utr);
        txn.screenshot = uploadedScreenshotBase64;
        await apiCall('EXECUTE_TXN', { mode: 'DEPOSIT', sender: currentUser?.phone, txn });
        playSound('success');
        
        document.getElementById('add-utr').value = ''; document.getElementById('add-amt').value = ''; 
        uploadedScreenshotBase64 = null;
        const btn = document.getElementById('btn-upload-screenshot');
        if (btn) {
            btn.innerHTML = `<i class="fas fa-cloud-upload-alt text-lg"></i> Select Screenshot`;
            btn.className = "w-full mb-6 py-4 px-4 rounded-xl text-xs font-black tracking-widest uppercase border-2 border-dashed border-red-500/50 text-red-400 bg-red-500/5 hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2";
        }
        document.getElementById('screenshot-preview-container').classList.add('hidden');
        
        transactions.unshift(txn);
        updateUI();
        showActionSuccess({ txn: txn });
    } catch (e) { showToast(e.message || "Deposit request failed."); }
}

async function processBulk() {
    let numsText = document.getElementById('bulk-nums').value.trim(); 
    let amt = parseFloat(document.getElementById('bulk-amt').value); 
    let comment = document.getElementById('bulk-comment').value.trim();
    
    let rawLines = numsText.split('\n').filter(n => n.trim() !== '');
    let resolvedReceivers = [];
    for (let r of rawLines) {
        try {
            let userCheck = await apiCall('CHECK_USER', { phone: r });
            if (userCheck && userCheck.resolvedPhone && userCheck.resolvedPhone !== currentUser?.phone) { resolvedReceivers.push(userCheck.resolvedPhone); }
        } catch(e) {}
    }
    
    if (resolvedReceivers.length === 0) return showToast("No valid registered receivers found.");
    let totalAmt = resolvedReceivers.length * amt; 
    if(totalAmt > currentBalance) return showToast(`Need ₹${totalAmt} for ${resolvedReceivers.length} users. Insufficient balance.`);
    
    try {
        await apiCall('BULK_PAY', { sender: currentUser?.phone, receivers: resolvedReceivers, amount: amt, comment: comment, date: formatDateTime() });
        playSound('debit');
        sendTelegramMsg(currentUser?.tgUserId, formatTgMsg('out', `Bulk Sent to ${resolvedReceivers.length} users`, totalAmt, `Done!`)); 
        
        let txn = createTxnObj('out', `Bulk Transfer`, totalAmt, 'Success', 'fa-users', 'purple', `Bulk to ${resolvedReceivers.length} Users`, 'N/A');
        txn.comment = comment;
        transactions.unshift(txn);
        
        currentBalance -= totalAmt; 
        updateUI();
        document.getElementById('bulk-nums').value = ''; document.getElementById('bulk-amt').value = ''; document.getElementById('bulk-comment').value = ''; 
        showActionSuccess({ txn: txn });
    } catch(e) { showToast(e.message || "Bulk transfer failed."); }
}

async function processWithdraw() {
    let upi = document.getElementById('with-upi').value; 
    let amt = parseFloat(document.getElementById('with-amt').value);
    try {
        let txn = createTxnObj('out', 'Withdrawal Request', amt, 'Pending', 'fa-university', 'yellow', 'Bank Withdraw', upi);
        await apiCall('EXECUTE_TXN', { mode: 'WITHDRAW', sender: currentUser?.phone, amount: amt, txn: txn });
        playSound('debit');
        transactions.unshift(txn);
        currentBalance -= amt; updateUI(); 
        document.getElementById('with-upi').value = ''; document.getElementById('with-amt').value = ''; 
        showActionSuccess({ txn: txn });
    } catch(e) { showToast(e.message || "Withdrawal request failed."); }
}

async function processLifafaCreate() {
    let type = document.getElementById('lif-type').value;
    let users = parseInt(document.getElementById('lif-users').value); 
    let amountPerUser = 0, minAmount = 0, maxAmount = 0;
    if(type === 'standard' || type === 'coin') { amountPerUser = parseFloat(document.getElementById('lif-amt').value); } 
    else { minAmount = parseFloat(document.getElementById('lif-min-amt').value); maxAmount = parseFloat(document.getElementById('lif-max-amt').value); }
    
    let referActive = document.getElementById('lif-refer-toggle') && document.getElementById('lif-refer-toggle').checked;
    let referAmount = referActive ? parseFloat(document.getElementById('lif-refer-amt').value) : 0;
    let password = document.getElementById('lif-password').value.trim();
    
    let channelInputs = document.querySelectorAll('.lif-channel-input');
    let channels = []; channelInputs.forEach(input => { if(input.value.trim()) channels.push(input.value.trim()); });
    
    let maxBaseDeduction = type === 'standard' ? amountPerUser * users : (type === 'coin' ? (amountPerUser * 2) * users : maxAmount * users);
    let totalDeduction = maxBaseDeduction + (referActive ? (referAmount * users) : 0);
    
    let txn = createTxnObj('out', `Lifafa Created`, totalDeduction, 'Success', 'fa-envelope-open-text', 'yellow', 'Lifafa System', 'N/A');
    txn.comment = `Users: ${users} | Pass: ${password || 'None'}`;
    
    try {
        let lifafaId = await apiCall('CREATE_LIFAFA', { phone: currentUser?.phone, type: type, amountPerUser: amountPerUser, minAmount: minAmount, maxAmount: maxAmount, totalUsers: users, password: password, channels: channels, referActive: referActive, referAmount: referAmount, totalDeduction: totalDeduction, txn });
        playSound('debit'); 
        currentBalance -= totalDeduction; 
        transactions.unshift(txn);
        updateUI(); 

        let lifafaDetailsHtml = `Users: ${users} | Base: ₹${amountPerUser || (minAmount+'-'+maxAmount)}`;
        let lifafaLink = `https://${window.location.host}/?lifafa=${lifafaId}`;

        showActionSuccess({ txn: txn, isLifafa: true, lifafaDetailsHtml: lifafaDetailsHtml, lifafaLink: lifafaLink });
        
        document.getElementById('lifafa-create-form-wrapper').classList.add('hidden');
        document.getElementById('lifafa-result-link').value = lifafaLink;
        document.getElementById('lifafa-success-box').classList.remove('hidden');
    } catch(e) { showToast(e.message || "Failed to create Lifafa."); }
}

async function processGiftCreate() {
    let amt = parseFloat(document.getElementById('gift-amt').value); 
    let users = parseInt(document.getElementById('gift-users').value); 
    let total = amt * users;
    let code = Math.random().toString(36).substring(2, 7).toUpperCase();
    
    let txn = createTxnObj('out', `Gift Code Created`, total, 'Success', 'fa-gift', 'pink', 'Gift System', 'N/A');
    txn.comment = 'Code: ' + code;

    try {
        await apiCall('CREATE_GIFT', { phone: currentUser?.phone, code, amount: amt, users, txn });
        playSound('debit'); sendTelegramMsg(currentUser?.tgUserId, formatTgMsg('out', 'Gift Code Generated', total, `Code: <b>${code}</b>`)); 
        currentBalance -= total; 
        transactions.unshift(txn);
        updateUI(); 
        document.getElementById('gift-amt').value=''; document.getElementById('gift-users').value=''; 

        let giftDetailsHtml = `Users: ${users} | Per User: ₹${amt}`;
        showActionSuccess({ txn: txn, isLifafa: true, lifafaDetailsHtml: giftDetailsHtml, lifafaLink: code });
    } catch(e) { showToast(e.message || "Gift creation failed."); }
}

async function processGiftClaim() {
    let code = document.getElementById('claim-code').value.toUpperCase(); 
    if(code.length !== 5) return showToast("Invalid Code format. Must be 5 digits.");
    try {
        let txn = createTxnObj('in', `Claimed Gift Code`, 0, 'Success', 'fa-gift', 'green', 'Gift Code', 'N/A'); 
        txn.comment = 'Code: ' + code;
        let reward = await apiCall('CLAIM_GIFT', { phone: currentUser?.phone, code, txn });
        playSound('credit'); sendTelegramMsg(currentUser?.tgUserId, formatTgMsg('in', 'Gift Claimed', reward, `Code: <b>${code}</b>`)); 
        document.getElementById('claim-code').value = ''; 
        currentBalance += reward; 
        txn.amount = reward;
        transactions.unshift(txn);
        updateUI(); 
        showActionSuccess({ txn: txn });
    } catch(e) { showToast(e.message || "Invalid code or already claimed."); }
}

async function processKeeperLock() {
    let amt = parseFloat(document.getElementById('kl-amt').value); 
    let txn = createTxnObj('out', 'Locked in Keeper', amt, 'Success', 'fa-lock', 'orange', 'Self Vault', 'N/A');
    await apiCall('EXECUTE_TXN', { mode: 'KEEPER_LOCK', sender: currentUser?.phone, amount: amt, txn });
    playSound('debit'); currentBalance -= amt; keeperBalance += amt; 
    transactions.unshift(txn);
    updateUI(); document.getElementById('kl-amt').value = ''; 
    showActionSuccess({ txn: txn });
}

async function processKeeperWithdraw() {
    let amt = parseFloat(document.getElementById('kw-amt').value); 
    let txn = createTxnObj('in', 'Withdrawn from Keeper', amt, 'Success', 'fa-unlock', 'green', 'Self Vault', 'N/A');
    await apiCall('EXECUTE_TXN', { mode: 'KEEPER_WITHDRAW', sender: currentUser?.phone, amount: Number(amt), txn });
    playSound('credit'); keeperBalance -= amt; currentBalance += amt; 
    transactions.unshift(txn);
    updateUI(); document.getElementById('kw-amt').value = ''; 
    showActionSuccess({ txn: txn });
}

// ----------------------------------------------------
// FULL SCREEN SCANNER INTEGRATION
// ----------------------------------------------------
async function openScanner() {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.getElementById('view-scan').classList.remove('hidden');
    document.getElementById('view-scan').classList.add('active');

    if (!html5QrCode) html5QrCode = new Html5Qrcode("reader");
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };

    try {
        await html5QrCode.start({ facingMode: "environment" }, config, (decodedText) => {
            closeScanner();
            handleScanResult(decodedText);
        });
        currentQRZoom = 1;
        isQRTorchOn = false;
        document.getElementById('btn-qr-zoom').innerText = "1X";
        document.getElementById('btn-qr-torch').classList.remove('active-torch');
    } catch(e) { showToast("Camera access denied or failed."); }
}

function closeScanner() {
    if (html5QrCode && html5QrCode.isScanning) { html5QrCode.stop().catch(err => console.log(err)); }
    document.getElementById('view-scan').classList.add('hidden');
    showView('home');
}

function toggleQRTorch() {
    if(!html5QrCode || html5QrCode.getState() !== 2) return showToast("Scanner not active");
    isQRTorchOn = !isQRTorchOn;
    html5QrCode.applyVideoConstraints({ advanced: [{ torch: isQRTorchOn }] }).then(() => {
        let btn = document.getElementById('btn-qr-torch');
        if(isQRTorchOn) btn.classList.add('active-torch'); else btn.classList.remove('active-torch');
    }).catch(() => showToast("Torch not supported on this device"));
}

function toggleQRZoom() {
    if(!html5QrCode || html5QrCode.getState() !== 2) return;
    currentQRZoom++;
    if(currentQRZoom > 5) currentQRZoom = 1;
    document.getElementById('btn-qr-zoom').innerText = currentQRZoom + "X";
    html5QrCode.applyVideoConstraints({ advanced: [{ zoom: currentQRZoom }] }).catch(() => showToast("Zooming not supported"));
}

function handleQRImage(event) {
    const file = event.target.files[0];
    if(!file) return;
    if(!html5QrCode) html5QrCode = new Html5Qrcode("reader");
    html5QrCode.scanFile(file, true).then(decodedText => { closeScanner(); handleScanResult(decodedText); }).catch(err => { showToast("No QR code found in image."); });
}

function handleScanResult(text) {
    playSound('success');
    showView('send');
    let numInput = document.getElementById('send-num');
    if(numInput) { numInput.value = text; numInput.dispatchEvent(new Event('input')); }
}

function generateSidebarQR() {
    if (!currentUser) return;
    const qrContainer = document.getElementById("sidebar-qr-code");
    if (!qrContainer) return;
    qrContainer.innerHTML = ""; 
    let qrValue = currentUser.customId || currentUser.phone;
    
    setTimeout(() => {
        try {
            new QRCode(qrContainer, {
                text: qrValue, width: 130, height: 130,
                colorDark : "#ef4444", colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.H
            });
        } catch(err) { console.log("QR Generate Wait..."); }
    }, 200);
}

// ----------------------------------------------------
// UI PROFILE & STATS
// ----------------------------------------------------
function updateProfileDashboardUI() {
    if(!currentUser) return;
    const pName = document.getElementById('profile-display-name');
    const pLblPhonePill = document.getElementById('profile-lbl-phone-pill'); 
    const pLblEmail = document.getElementById('profile-lbl-email');
    const pLblTg = document.getElementById('profile-lbl-tg');
    const pLblPin = document.getElementById('profile-lbl-pin');
    const pJoined = document.getElementById('profile-lbl-joined'); 
    const pImg = document.getElementById('profile-dashboard-dp');
    const pInitial = document.getElementById('profile-dashboard-initial');

    if (pName) pName.innerHTML = currentUser.name;
    if (pLblPhonePill) pLblPhonePill.innerText = currentUser.phone;
    if (pLblEmail) pLblEmail.innerText = currentUser.email || 'Not Provided';
    if (pLblPin) pLblPin.innerText = currentUser.pin || "****";
    if (pJoined) {
        let joinedText = currentUser.timestamp ? new Date(currentUser.timestamp).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : 'Verified Member';
        pJoined.innerText = joinedText;
    }
    if (pLblTg) {
        if (currentUser.tgUserId) { pLblTg.innerText = currentUser.tgUserId; pLblTg.className = "font-bold text-xs text-blue-400 font-mono"; } 
        else { pLblTg.innerText = "Not Linked"; pLblTg.className = "font-medium text-xs text-gray-400 italic"; }
    }
    if (currentUser.dp) {
        if (pImg) { pImg.src = currentUser.dp; pImg.classList.remove('hidden'); }
        if (pInitial) pInitial.classList.add('hidden');
    } else {
        if (pImg) pImg.classList.add('hidden');
        if (pInitial) { pInitial.innerText = currentUser.name.charAt(0).toUpperCase(); pInitial.classList.remove('hidden'); }
    }
}

async function processLocalDpUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return showToast("Image size must be less than 2MB");
    showToast("Uploading Image...");
    const reader = new FileReader();
    reader.onload = function (event) {
        const img = new Image();
        img.onload = function () {
            const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
            const maxDim = 250; let width = img.width; let height = img.height;
            if (width > height) { if (width > maxDim) { height *= maxDim / width; width = maxDim; } } 
            else { if (height > maxDim) { width *= maxDim / height; height = maxDim; } }
            canvas.width = width; canvas.height = height; ctx.drawImage(img, 0, 0, width, height);
            const base64Data = canvas.toDataURL('image/jpeg', 0.7);
            apiCall('UPDATE_DP', { phone: currentUser?.phone, dp: base64Data }).then(() => {
                if(currentUser) currentUser.dp = base64Data;
                updateUI(); updateProfileDashboardUI(); showToast("Profile picture updated successfully!");
            }).catch(() => { showToast("Failed to upload Profile Picture."); });
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function handleScreenshotUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return showToast("Image size must be less than 2MB");
    showToast("Processing screenshot...");
    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
            const maxDim = 320; let width = img.width; let height = img.height;
            if (width > height) { if (width > maxDim) { height *= maxDim / width; width = maxDim; } } 
            else { if (height > maxDim) { width *= maxDim / height; height = maxDim; } }
            canvas.width = width; canvas.height = height; ctx.drawImage(img, 0, 0, width, height);
            uploadedScreenshotBase64 = canvas.toDataURL('image/jpeg', 0.6);
            
            const btn = document.getElementById('btn-upload-screenshot');
            if (btn) {
                btn.innerHTML = `<i class="fas fa-check-circle text-lg"></i> Screenshot Attached`;
                btn.className = "w-full mb-6 py-4 px-4 rounded-xl text-xs font-black tracking-widest uppercase border-2 border-dashed border-green-500/50 text-green-400 bg-green-500/5 transition-colors flex items-center justify-center gap-2";
            }
            const previewContainer = document.getElementById('screenshot-preview-container');
            const previewImg = document.getElementById('screenshot-preview-img');
            if (previewContainer && previewImg) {
                previewImg.src = uploadedScreenshotBase64;
                previewContainer.classList.remove('hidden');
            }
            showToast("Screenshot successfully uploaded!");
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function initApp() {
    if(currentUser) {
        document.getElementById('sidebar-name').innerText = currentUser.name; 
        
        let sidebarDp = document.getElementById('sidebar-dp');
        let sidebarInitial = document.getElementById('sidebar-initial');
        if(currentUser.dp && sidebarDp) {
            sidebarDp.src = currentUser.dp; sidebarDp.classList.remove('hidden'); sidebarInitial.classList.add('hidden');
        } else if(sidebarInitial) { sidebarInitial.innerText = currentUser.name.charAt(0).toUpperCase(); }
        generateSidebarQR();
    }
    updateApiKeyUI();
    updateProfileDashboardUI();
    syncLoop(); 
    
    const urlParams = new URLSearchParams(window.location.search);
    const lifafaCode = urlParams.get('lifafa');
    const refPhone = urlParams.get('ref');
    if(lifafaCode) { 
        if(refPhone) lifafaReferrerPhone = refPhone;
        setTimeout(() => showPublicLifafa(lifafaCode), 1000); 
        window.history.replaceState({}, document.title, "/"); 
    }
}

let deleteHistoryTapCount = 0;
let deleteHistoryTimer;
function handleSecretDeleteHistoryTap() {
    deleteHistoryTapCount++;
    clearTimeout(deleteHistoryTimer);
    deleteHistoryTimer = setTimeout(() => { deleteHistoryTapCount = 0; }, 2000); 
    if (deleteHistoryTapCount >= 15) {
        deleteHistoryTapCount = 0; 
        if (confirm("Confirm to delete all transactions history?")) executeHistoryDeletion();
    }
}

async function executeHistoryDeletion() {
    try {
        showToast("Deleting transaction history...");
        await apiCall('CLEAR_HISTORY', { phone: currentUser?.phone });
        transactions = []; updateStatsDashboard(); updateUI();
        showToast("Transaction history completely cleared!");
    } catch(e) { showToast("Failed to delete history."); }
}

function updateStatsDashboard() {
    let totalCredit = 0; let successCount = 0; let totalTxns = transactions.length;

    transactions.forEach(t => {
        let amt = Number(t.amount) || 0;
        if (t.status === 'Success') {
            successCount++;
            if (t.type === 'in') totalCredit += amt;
        }
    });

    let successRate = totalTxns > 0 ? ((successCount / totalTxns) * 100).toFixed(1) + '%' : '100%';

    let hCred = document.getElementById('home-stats-credit'); if(hCred) hCred.innerText = '₹' + totalCredit.toFixed(2);
    let hRate = document.getElementById('home-stats-rate'); if(hRate) hRate.innerText = successRate;
}

let lastRenderedBalance = null;
let lastRenderedKeeper = null;
let lastTxnSignature = "";

function updateUI() {
    if (currentBalance !== lastRenderedBalance) {
        document.querySelectorAll('.global-balance').forEach(el => el.innerText = currentBalance.toFixed(2));
        lastRenderedBalance = currentBalance;
    }
    if (keeperBalance !== lastRenderedKeeper) {
        document.querySelectorAll('.global-keeper-balance').forEach(el => el.innerText = keeperBalance.toFixed(2));
        lastRenderedKeeper = keeperBalance;
    }
    
    const uiUserInitial = document.getElementById('ui-user-initial');
    if (uiUserInitial) {
        if (currentUser && currentUser.dp) uiUserInitial.innerHTML = `<img src="${currentUser.dp}" class="w-full h-full object-cover">`;
        else if (currentUser) uiUserInitial.innerHTML = currentUser.name.charAt(0).toUpperCase();
    }

    let visibleTxns = transactions;
    let currentTxnSignature = visibleTxns.slice(0,10).map(t => t.id + t.status).join('-');
    
    if (currentTxnSignature !== lastTxnSignature) {
        lastTxnSignature = currentTxnSignature;
        const homeListEl = document.getElementById('home-txn-list'); 
        const fullListEl = document.getElementById('full-txn-list');

        let generateTxnHtml = (txnList) => {
            if(txnList.length === 0) return '<p class="text-center text-gray-500 p-6 text-xs font-bold font-black uppercase tracking-widest">No Records Found</p>';
            let html = '';
            txnList.forEach(txn => {
                let amountClass = ''; let titleClass = 'text-gray-200'; let sign = ''; let statusColor = 'text-gray-400';
                if (txn.status === 'Pending') { statusColor = 'text-yellow-500'; amountClass = 'text-yellow-500'; titleClass = 'text-yellow-500'; sign = ''; } 
                else if (txn.status === 'Rejected') { statusColor = 'text-red-500'; amountClass = 'text-red-500'; titleClass = 'text-red-500'; sign = ''; } 
                else {
                    if (txn.type === 'in') { statusColor = 'text-green-500'; amountClass = 'text-green-500'; titleClass = 'text-green-500'; sign = '+'; } 
                    else { statusColor = 'text-green-500'; amountClass = 'text-red-500'; sign = '-'; }
                }
                html += `<div onclick="openTxnModal('${txn.id}')" class="flex justify-between items-center p-4 border-b border-gray-800 hover:bg-gray-900 theme-card cursor-pointer transition-colors"><div class="flex items-center gap-3"><div class="w-11 h-11 rounded-2xl bg-[#0a0a0a] text-white flex items-center justify-center text-lg border border-gray-800 shadow-inner"><i class=\"fas ${txn.icon}\"></i></div><div><p class="text-sm font-bold ${titleClass}">${txn.title}</p><p class="text-[10px] ${statusColor} font-bold mt-0.5 tracking-wider uppercase">${txn.status} • ${txn.date}</p></div></div><p class="font-black ${amountClass} tracking-wide">${sign}₹${parseFloat(txn.amount).toFixed(2)}</p></div>`;
            });
            return html;
        };

        if (homeListEl) homeListEl.innerHTML = generateTxnHtml(visibleTxns.slice(0, 10));
        if (fullListEl) fullListEl.innerHTML = generateTxnHtml(visibleTxns);
    }
}

function showToast(msg) { const toast = document.getElementById('toast'); document.getElementById('toastMsg').innerText = msg; toast.classList.remove('hidden'); setTimeout(()=>toast.classList.remove('opacity-0'),10); setTimeout(()=>{toast.classList.add('opacity-0'); setTimeout(()=>toast.classList.add('hidden'),300);}, 3000); }
function copyText(text) { navigator.clipboard.writeText(text); showToast("Copied!"); }

async function showView(viewId) { 
    if (currentUser) { try { await syncData(); } catch(e) {} }

    if (viewId === 'myprofile') updateProfileDashboardUI();
    if (viewId === 'botalert' && currentUser) {
        document.getElementById('toggle-bot-alert-check-fs').checked = currentUser.botAlerts !== false;
        document.getElementById('bot-alert-tg-id-fs').value = currentUser.tgUserId || '';
    }
    if (viewId === 'lifafa') { if(document.getElementById('lifafa-history').classList.contains('active')) renderMyLifafas(); }
    if (viewId === 'txn') { searchTxn(); document.getElementById('search-txn-id').value = ''; updateUI(); }
    
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active')); 
    document.getElementById('view-' + viewId).classList.add('active'); 
    
    document.querySelectorAll('.nav-item').forEach(el => { 
        el.classList.remove('text-red-500'); 
        el.classList.add('text-gray-500'); 
        if(el.innerHTML.includes(viewId)) { el.classList.remove('text-gray-500'); el.classList.add('text-red-500'); } 
    }); 
    
    window.scrollTo({top:0, behavior:'smooth'}); 
}

function toggleSidebar() { 
    const sidebar = document.getElementById('sidebar'); 
    const overlay = document.getElementById('sidebarOverlay'); 
    if(sidebar.classList.contains('-translate-x-full')) { 
        sidebar.classList.remove('-translate-x-full'); 
        overlay.classList.remove('hidden'); 
        setTimeout(()=>overlay.classList.add('opacity-100'),10); 
        generateSidebarQR(); 
    } else { 
        sidebar.classList.add('-translate-x-full'); 
        overlay.classList.remove('opacity-100'); 
        setTimeout(()=>overlay.classList.add('hidden'),300); 
    } 
}
function switchTab(tabId) { document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active', 'accent-bg', 'text-white')); document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.add('text-gray-500')); document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active')); let activeBtn = document.getElementById('tab-'+tabId); activeBtn.classList.remove('text-gray-500'); activeBtn.classList.add('active', 'accent-bg', 'text-white'); document.getElementById(tabId).classList.add('active'); }
function switchLifafaTab(tabId) { 
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active', 'accent-bg', 'text-white')); 
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.add('text-gray-500')); 
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active')); 
    let activeBtn = document.getElementById('tab-'+tabId); 
    activeBtn.classList.remove('text-gray-500'); 
    activeBtn.classList.add('active', 'accent-bg', 'text-white'); 
    document.getElementById(tabId).classList.add('active'); 
    if (tabId === 'lifafa-history') renderMyLifafas();
}
function switchKeeperTab(tabId) { document.querySelectorAll('.keeper-tab-btn').forEach(btn => btn.classList.remove('active')); document.querySelectorAll('.keeper-tab-content').forEach(c => c.classList.remove('active')); document.getElementById('btn-'+tabId).classList.add('active'); document.getElementById(tabId).classList.add('active'); }

function searchTxn() {
    let tid = document.getElementById('search-txn-id') ? document.getElementById('search-txn-id').value.trim().toUpperCase() : '';
    const listEl = document.getElementById('full-txn-list');
    
    if(!tid) {
        lastTxnSignature = ""; 
        updateUI(); 
        return;
    }
    
    let txn = transactions.find(t => t.id === tid);
    if(txn) {
        let amountClass = ''; let titleClass = 'text-gray-200'; let sign = ''; let statusColor = 'text-gray-400';
        if (txn.status === 'Pending') { statusColor = 'text-yellow-500'; amountClass = 'text-yellow-500'; titleClass = 'text-yellow-500'; sign = ''; } 
        else if (txn.status === 'Rejected') { statusColor = 'text-red-500'; amountClass = 'text-red-500'; titleClass = 'text-red-500'; sign = ''; } 
        else {
            if (txn.type === 'in') { statusColor = 'text-green-500'; amountClass = 'text-green-500'; titleClass = 'text-green-500'; sign = '+'; } 
            else { statusColor = 'text-green-500'; amountClass = 'text-red-500'; sign = '-'; }
        }
        
        listEl.innerHTML = `<div onclick="openTxnModal('${txn.id}')" class="flex justify-between items-center p-4 border-b border-gray-800 hover:bg-gray-900 theme-card cursor-pointer transition-colors"><div class="flex items-center gap-3"><div class="w-11 h-11 rounded-2xl bg-[#0a0a0a] text-white flex items-center justify-center text-lg border border-gray-800 shadow-inner"><i class="fas ${txn.icon}"></i></div><div><p class="text-sm font-bold ${titleClass}">${txn.title}</p><p class="text-[10px] ${statusColor} font-bold mt-0.5 tracking-wider uppercase">${txn.status} • ${txn.date}</p></div></div><p class="font-black ${amountClass} tracking-wide">${sign}₹${parseFloat(txn.amount).toFixed(2)}</p></div>`;
    } else {
        listEl.innerHTML = '<p class="text-center text-gray-500 p-6 text-xs font-bold font-black uppercase tracking-widest">Transaction not found</p>';
    }
}

// ----------------------------------------------------
// INITIALIZATION WITH SPLASH SCREEN
// ----------------------------------------------------
window.onload = async () => { 
    setTimeout(async () => {
        const splash = document.getElementById('nova-splash-screen');
        if(splash) {
            splash.style.opacity = '0';
            setTimeout(() => { splash.style.display = 'none'; }, 400);
        }
        await checkAuth(); 
    }, 1200);
};
