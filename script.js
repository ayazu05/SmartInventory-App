// Global App State
let inventoryList = [];
let currentUserData = null;
let db = null;

// Force Hide Loading Screen Guard
function forceHideSplash() {
    const splash = document.getElementById('appSplashLoader');
    if (splash) {
        splash.style.display = 'none';
        splash.classList.add('hidden');
    }
}

// App Entry Point
document.addEventListener("DOMContentLoaded", () => {
    setTimeout(forceHideSplash, 1000);

    initFirebaseSafely();
    checkUserAuthentication();
    setupNetworkListeners();
    setupEventListeners();
});

// 1. Firebase Safe Initializer
function initFirebaseSafely() {
    try {
        if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
            db = firebase.firestore();
            db.enablePersistence({ synchronizeTabs: true }).catch(err => {
                console.warn("Firestore Persistence Note:", err.code);
            });
        }
    } catch (err) {
        console.error("Firebase init bypass:", err);
    } finally {
        forceHideSplash();
    }
}

// 2. Authentication Flow & Session Guard
function checkUserAuthentication() {
    const savedPhone = localStorage.getItem('userPhone');
    const savedUserData = localStorage.getItem('userData');

    if (savedPhone && savedUserData) {
        try {
            currentUserData = JSON.parse(savedUserData);
            updateUserUI(currentUserData);
            hideAuthModal();
            loadUserInventory();
        } catch (e) {
            showAuthModal();
        }
    } else {
        showAuthModal();
    }
}

function showAuthModal() {
    const authOverlay = document.getElementById('authOverlay');
    if (authOverlay) {
        authOverlay.classList.remove('hidden');
    }
}

function hideAuthModal() {
    const authOverlay = document.getElementById('authOverlay');
    if (authOverlay) {
        authOverlay.classList.add('hidden');
    }
}

function switchAuthView(view) {
    document.getElementById('authLoginView').classList.toggle('hidden', view !== 'login');
    document.getElementById('authRegisterView').classList.toggle('hidden', view !== 'register');
    document.getElementById('authOtpView').classList.add('hidden');
}

// Instant Login / Registration Handler
async function processAuth(type) {
    if (type === 'login') {
        const phone = document.getElementById('loginPhone').value.trim();
        if (!phone || phone.length < 10) {
            alert("Please enter a valid 10-digit Phone Number");
            return;
        }

        // Fetch User profile from Firestore or create session
        let userData = { phone: phone, name: "User " + phone.slice(-4), farm: "My Farm" };
        
        if (db) {
            try {
                const userDoc = await db.collection('users').doc(phone).get();
                if (userDoc.exists) {
                    userData = userDoc.data();
                } else {
                    await db.collection('users').doc(phone).set(userData);
                }
            } catch (e) {
                console.warn("Auth DB warning, falling back locally:", e);
            }
        }

        loginUserSession(userData);

    } else if (type === 'register') {
        const name = document.getElementById('regName').value.trim();
        const farm = document.getElementById('regFarm').value.trim();
        const email = document.getElementById('regEmail').value.trim();
        const phone = document.getElementById('regPhone').value.trim();

        if (!name || !phone || phone.length < 10) {
            alert("Please fill all required fields correctly!");
            return;
        }

        const userData = { name, farm, email, phone };

        if (db) {
            try {
                await db.collection('users').doc(phone).set(userData);
            } catch (e) {
                console.warn("Could not save user profile to cloud:", e);
            }
        }

        loginUserSession(userData);
    }
}

function loginUserSession(userData) {
    currentUserData = userData;
    localStorage.setItem('userPhone', userData.phone);
    localStorage.setItem('userData', JSON.stringify(userData));

    updateUserUI(userData);
    hideAuthModal();
    loadUserInventory();
    showToast("Logged in successfully!");
}

function updateUserUI(userData) {
    if (!userData) return;
    
    // Header & Drawer updates
    const nameEl = document.getElementById('menuUserName');
    const farmEl = document.getElementById('menuUserFarm');
    if (nameEl) nameEl.innerText = userData.name || 'User';
    if (farmEl) farmEl.innerText = userData.farm || 'My Farm';

    // Profile Tab Inputs
    const pName = document.getElementById('profName');
    const pFarm = document.getElementById('profFarm');
    const pEmail = document.getElementById('profEmail');
    const pPhone = document.getElementById('profPhone');

    if (pName) pName.value = userData.name || '';
    if (pFarm) pFarm.value = userData.farm || '';
    if (pEmail) pEmail.value = userData.email || '';
    if (pPhone) pPhone.value = userData.phone || '';
}

function logoutUser() {
    if (confirm("Are you sure you want to Sign Out?")) {
        localStorage.removeItem('userPhone');
        localStorage.removeItem('userData');
        localStorage.removeItem('localInventoryData');
        
        inventoryList = [];
        currentUserData = null;
        
        renderInventoryList();
        showAuthModal();
        closeMenu();
        showToast("Signed Out");
    }
}

// 3. User Specific Inventory Management
function loadUserInventory() {
    const phone = localStorage.getItem('userPhone');
    if (!phone) return;

    // Load Local User Cache
    const localKey = 'inventory_' + phone;
    const saved = localStorage.getItem(localKey);
    if (saved) {
        try {
            inventoryList = JSON.parse(saved);
        } catch (e) {
            inventoryList = [];
        }
    } else {
        inventoryList = [];
    }

    renderInventoryList();
    fetchCloudInventory();
}

function saveUserInventory() {
    const phone = localStorage.getItem('userPhone');
    if (!phone) return;

    const localKey = 'inventory_' + phone;
    localStorage.setItem(localKey, JSON.stringify(inventoryList));
    renderInventoryList();
}

async function fetchCloudInventory() {
    const phone = localStorage.getItem('userPhone');
    if (!db || !phone) return;

    try {
        const doc = await db.collection('inventories').doc(phone).get();
        if (doc.exists && doc.data().items) {
            inventoryList = doc.data().items || [];
            saveUserInventory();
        }
    } catch (err) {
        console.warn("Cloud Fetch Error:", err);
    }
}

// 4. Add / Deduct Inventory Actions
async function uploadToCloudProcess() {
    const nameInput = document.getElementById('prodName');
    const qtyInput = document.getElementById('prodQty');
    
    const name = nameInput ? nameInput.value.trim() : '';
    const qty = qtyInput ? parseInt(qtyInput.value, 10) : 0;

    if (!name || isNaN(qty) || qty <= 0) {
        alert("Please enter a valid Product Name and Quantity.");
        return;
    }

    requestCancel('modalDetails');

    const existingIndex = inventoryList.findIndex(item => item.name.toLowerCase() === name.toLowerCase());

    if (existingIndex > -1) {
        inventoryList[existingIndex].qty += qty;
        inventoryList[existingIndex].lastUpdated = new Date().toISOString();
    } else {
        inventoryList.push({
            id: 'item_' + Date.now(),
            name: name,
            qty: qty,
            lastUpdated: new Date().toISOString()
        });
    }

    saveUserInventory();

    // Push to Firestore under User Phone Document
    const phone = localStorage.getItem('userPhone');
    if (db && phone) {
        try {
            await db.collection('inventories').doc(phone).set({
                items: inventoryList,
                lastUpdated: new Date().toISOString()
            }, { merge: true });
            showToast("Saved to Cloud!");
        } catch (error) {
            showToast("Saved Locally");
        }
    } else {
        showToast("Saved Locally");
    }

    if (nameInput) nameInput.value = '';
    if (qtyInput) qtyInput.value = '';
}

function deleteStockItem(index) {
    if (confirm("Delete this item?")) {
        inventoryList.splice(index, 1);
        saveUserInventory();

        const phone = localStorage.getItem('userPhone');
        if (db && phone) {
            db.collection('inventories').doc(phone).set({
                items: inventoryList,
                lastUpdated: new Date().toISOString()
            }, { merge: true });
        }
        showToast("Item deleted");
    }
}

// 5. UI Render Helpers
function renderInventoryList() {
    const container = document.getElementById('stockListContainer');
    const totalItemsEl = document.getElementById('statTotalItems');
    const totalQtyEl = document.getElementById('statTotalQty');

    if (!container) return;

    container.innerHTML = '';
    let totalQty = 0;

    if (inventoryList.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>No stock items found for this user.</p></div>`;
    } else {
        inventoryList.forEach((item, index) => {
            totalQty += Number(item.qty) || 0;
            const card = document.createElement('div');
            card.className = 'stock-card';
            card.innerHTML = `
                <div class="stock-info">
                    <h4>${escapeHtml(item.name)}</h4>
                    <span class="qty-badge">Qty: ${item.qty}</span>
                </div>
                <button class="btn-delete" onclick="deleteStockItem(${index})" title="Delete Item">
                    <i class="fas fa-trash"></i>
                </button>
            `;
            container.appendChild(card);
        });
    }

    if (totalItemsEl) totalItemsEl.innerText = inventoryList.length;
    if (totalQtyEl) totalQtyEl.innerText = totalQty;
}

function filterInventory() {
    const query = document.getElementById('searchInput')?.value.toLowerCase() || '';
    const cards = document.querySelectorAll('.stock-card');
    cards.forEach(card => {
        const name = card.querySelector('h4')?.innerText.toLowerCase() || '';
        card.style.display = name.includes(query) ? 'flex' : 'none';
    });
}

function setupNetworkListeners() {
    window.addEventListener('online', () => {
        showToast("Internet Back Online!");
        updateNetworkStatusUI(true);
        fetchCloudInventory();
    });

    window.addEventListener('offline', () => {
        showToast("Offline Mode Active");
        updateNetworkStatusUI(false);
    });
}

function updateNetworkStatusUI(isOnline) {
    const statusPill = document.querySelector('.status-pill');
    if (statusPill) {
        statusPill.className = isOnline ? "status-pill green" : "status-pill red";
        statusPill.innerHTML = isOnline 
            ? `<span class="dot"></span> Live Cloud` 
            : `<span class="dot"></span> Offline`;
    }
}

function showToast(msg) {
    const toast = document.getElementById('successPopUp');
    const msgEl = document.getElementById('popUpMessage');
    if (toast && msgEl) {
        msgEl.innerText = msg;
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 3000);
    }
}

function requestCancel(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('hidden');
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function(m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
}

function setupEventListeners() {
    const btnOpen = document.getElementById('btnOpenMenu');
    const btnClose = document.getElementById('btnCloseMenu');
    const drawer = document.getElementById('menuDrawer');
    const backdrop = document.getElementById('drawerBackdrop');

    if (btnOpen && drawer && backdrop) {
        btnOpen.onclick = () => {
            drawer.classList.add('open');
            backdrop.classList.add('open');
        };
    }

    if (btnClose && drawer && backdrop) {
        const closeFn = () => {
            drawer.classList.remove('open');
            backdrop.classList.remove('open');
        };
        btnClose.onclick = closeFn;
        backdrop.onclick = closeFn;
    }
}

function closeMenu() {
    const drawer = document.getElementById('menuDrawer');
    const backdrop = document.getElementById('drawerBackdrop');
    if (drawer) drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    
    const targetTab = document.getElementById('tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
    if (targetTab) targetTab.classList.add('active');
}

function handleStockIn() {
    const modal = document.getElementById('modalDetails');
    if (modal) modal.classList.remove('hidden');
}

function handleStockOut() {
    const modal = document.getElementById('modalStockOutSelect');
    if (modal) modal.classList.remove('hidden');
}
